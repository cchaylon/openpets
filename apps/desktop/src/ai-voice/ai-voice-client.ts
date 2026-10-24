import { logError, logInfo, logWarn } from "../logger.js";

export type AiVoiceConnectionState = "idle" | "connecting" | "ready" | "listening" | "thinking" | "speaking";

export interface AiVoiceConfig {
  readonly otaUrl: string;
  readonly deviceId: string;
}

export type AiVoiceEvent =
  | { readonly kind: "state"; readonly state: AiVoiceConnectionState }
  | { readonly kind: "stt"; readonly text: string }
  | { readonly kind: "sentence"; readonly text: string }
  | { readonly kind: "answer-end" }
  | { readonly kind: "emotion"; readonly emotion: string }
  | { readonly kind: "audio"; readonly bytes: Uint8Array }
  | { readonly kind: "error"; readonly message: string };

const otaTimeoutMs = 10_000;
const helloTimeoutMs = 6_000;
const handshakeSettleMs = 1_000;

export class AiVoiceClient {
  readonly #listeners = new Set<(event: AiVoiceEvent) => void>();
  #config: AiVoiceConfig | null = null;
  #socket: WebSocket | null = null;
  #state: AiVoiceConnectionState = "idle";
  #connectPromise: Promise<void> | null = null;
  #helloResolve: (() => void) | null = null;
  #helloReject: ((error: Error) => void) | null = null;
  #intentionalClose = false;
  readonly #abortResolvers = new Set<() => void>();

  on(listener: (event: AiVoiceEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get state(): AiVoiceConnectionState {
    return this.#state;
  }

  get isReady(): boolean {
    return this.#socket !== null && this.#state !== "idle" && this.#state !== "connecting";
  }

  async ensureReady(config: AiVoiceConfig): Promise<void> {
    if (this.#config && sameConfig(this.#config, config)) {
      if (this.#connectPromise) {
        return this.#connectPromise;
      }
      if (this.isReady) {
        return;
      }
    }
    this.close();
    this.#config = { ...config };
    const promise = this.#connect(config);
    this.#connectPromise = promise;
    try {
      await promise;
    } catch (error) {
      if (!this.#socket) {
        this.#setState("idle");
      }
      throw error;
    } finally {
      if (this.#connectPromise === promise) {
        this.#connectPromise = null;
      }
    }
  }

  startListening(): void {
    this.#sendControl({ type: "listen", state: "start", mode: "auto" });
    this.#setState("listening");
  }

  stopListening(): void {
    this.#sendControl({ type: "listen", state: "stop" });
    if (this.#state === "listening") {
      this.#setState("thinking");
    }
  }

  sendText(text: string): void {
    this.#sendControl({ type: "listen", state: "detect", text });
    this.#setState("thinking");
  }

  abort(): Promise<void> {
    const socket = this.#socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.#abortResolvers.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, 600);
      this.#abortResolvers.add(finish);
      try {
        socket.send(JSON.stringify({ type: "abort", reason: "client_interrupt" }));
      } catch {
        finish();
      }
    });
  }

  sendAudio(bytes: Uint8Array): void {
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN || this.#state !== "listening") {
      return;
    }
    try {
      this.#socket.send(bytes);
    } catch (error) {
      logWarn("ai-voice", "audio frame dropped", { error: errorMessage(error) });
    }
  }

  close(): void {
    this.#intentionalClose = true;
    this.#resolveAborts();
    this.#rejectHello(new Error("AI语音连接已关闭。"));
    const socket = this.#socket;
    this.#socket = null;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      try {
        socket.close();
      } catch {
        // Closing a socket that is already gone is harmless.
      }
    }
    this.#setState("idle");
    this.#config = null;
  }

  async #connect(config: AiVoiceConfig): Promise<void> {
    this.#setState("connecting");
    this.#intentionalClose = false;

    const target = await requestOtaTarget(config);
    const socket = new WebSocket(target.url);
    socket.binaryType = "arraybuffer";
    this.#socket = socket;

    const opened = new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("无法连接AI语音服务，请检查 OTA 地址与网络。")), { once: true });
    });
    const helloReceived = new Promise<void>((resolve, reject) => {
      this.#helloResolve = resolve;
      this.#helloReject = reject;
    });
    // The connection can fail before anyone awaits the hello; keep the rejection observed.
    void helloReceived.catch(() => undefined);

    socket.addEventListener("message", (event) => {
      void this.#handleMessage(event.data);
    });
    socket.addEventListener("close", () => this.#handleClose(socket));
    socket.addEventListener("error", () => {
      if (this.#socket === socket) {
        logWarn("ai-voice", "socket error");
      }
    });

    await opened;
    logInfo("ai-voice", "socket connected", { otaUrl: config.otaUrl, deviceId: config.deviceId });
    socket.send(JSON.stringify({
      type: "hello",
      version: 1,
      transport: "websocket",
      audio_params: {
        format: "opus",
        sample_rate: 16000,
        channels: 1,
        frame_duration: 60,
      },
      features: {
        mcp: false,
        aec: false,
        emoji: true,
      },
    }));

    await withTimeout(helloReceived, helloTimeoutMs, "AI语音服务握手超时。");
    this.#helloResolve = null;
    this.#helloReject = null;
    await delay(handshakeSettleMs);
    if (this.#socket !== socket) {
      throw new Error("AI语音连接已关闭。");
    }
    this.#setState("ready");
    logInfo("ai-voice", "session ready");
  }

  async #handleMessage(data: unknown): Promise<void> {
    if (typeof data === "string") {
      this.#handleText(data);
      return;
    }
    if (data instanceof ArrayBuffer) {
      this.#emit({ kind: "audio", bytes: new Uint8Array(data) });
      return;
    }
    if (ArrayBuffer.isView(data)) {
      this.#emit({ kind: "audio", bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) });
      return;
    }
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      this.#emit({ kind: "audio", bytes: new Uint8Array(await data.arrayBuffer()) });
    }
  }

  #handleText(raw: string): void {
    const text = raw.trim();
    if (!text.startsWith("{")) {
      this.#emitError(text.length > 0 ? text : "AI语音服务返回了无法识别的消息。");
      return;
    }
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(text) as Record<string, unknown>;
    } catch {
      logWarn("ai-voice", "invalid json message");
      return;
    }
    switch (message.type) {
      case "hello": {
        const sessionId = typeof message.session_id === "string" ? message.session_id : "";
        logInfo("ai-voice", "server hello", { sessionId });
        this.#helloResolve?.();
        break;
      }
      case "stt": {
        if (typeof message.text === "string" && message.text.trim().length > 0) {
          this.#emit({ kind: "stt", text: message.text.trim() });
        }
        break;
      }
      case "llm": {
        if (typeof message.emotion === "string") {
          this.#emit({ kind: "emotion", emotion: message.emotion });
        }
        break;
      }
      case "tts": {
        if (message.state === "start") {
          this.#setState("speaking");
        } else if (message.state === "sentence_start") {
          if (typeof message.text === "string" && message.text.trim().length > 0) {
            this.#emit({ kind: "sentence", text: message.text.trim() });
          }
          this.#setState("speaking");
        } else if (message.state === "stop") {
          this.#resolveAborts();
          this.#emit({ kind: "answer-end" });
          this.#setState("ready");
        }
        break;
      }
      case "pong":
      case "iot":
      case "mcp":
        break;
      default:
        logInfo("ai-voice", "ignored message", { type: typeof message.type === "string" ? message.type : "unknown" });
    }
  }

  #handleClose(socket: WebSocket): void {
    if (this.#socket !== socket) {
      return;
    }
    this.#socket = null;
    this.#resolveAborts();
    if (!this.#intentionalClose) {
      this.#rejectHello(new Error("AI语音连接在握手前断开。"));
      logInfo("ai-voice", "connection closed by server");
    }
    this.#setState("idle");
    if (!this.#intentionalClose) {
      this.#connectPromise = null;
    }
  }

  #sendControl(payload: Record<string, unknown>): void {
    const socket = this.#socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("AI语音尚未连接。");
    }
    socket.send(JSON.stringify(payload));
  }

  #rejectHello(error: Error): void {
    const reject = this.#helloReject;
    this.#helloResolve = null;
    this.#helloReject = null;
    reject?.(error);
  }

  #resolveAborts(): void {
    for (const finish of [...this.#abortResolvers]) {
      finish();
    }
  }

  #setState(state: AiVoiceConnectionState): void {
    if (this.#state === state) {
      return;
    }
    this.#state = state;
    this.#emit({ kind: "state", state });
  }

  #emit(event: AiVoiceEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        logError("ai-voice", "listener failed", { error: errorMessage(error) });
      }
    }
  }

  #emitError(message: string): void {
    logError("ai-voice", "server error", { message });
    this.#emit({ kind: "error", message });
  }
}

async function requestOtaTarget(config: AiVoiceConfig): Promise<{ url: string; token: string }> {
  const candidates = buildOtaCandidates(config.otaUrl);
  const failures: string[] = [];

  for (const candidate of candidates) {
    let response: Response;
    try {
      response = await fetch(candidate, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Device-Id": config.deviceId,
          "Client-Id": config.deviceId,
        },
        body: JSON.stringify({
          version: 0,
          mac_address: config.deviceId,
          application: { name: "DeskPet", version: "1.0.0" },
          board: { type: "deskpet", mac: config.deviceId },
        }),
        signal: AbortSignal.timeout(otaTimeoutMs),
      });
    } catch (error) {
      failures.push(`${candidate}：${errorMessage(error)}`);
      continue;
    }

    const text = await response.text();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      failures.push(`${candidate}：返回内容无法解析（HTTP ${response.status}）`);
      continue;
    }

    if (typeof payload.error === "string" && payload.error.length > 0) {
      throw new Error(`OTA 拒绝请求：${payload.error}`);
    }
    if (!response.ok) {
      failures.push(`${candidate}：HTTP ${response.status}`);
      continue;
    }

    const activation = isRecord(payload.activation) ? payload.activation : null;
    if (activation) {
      const code = typeof activation.code === "string" ? activation.code : "";
      throw new Error(code.length > 0
        ? `设备未绑定，请先在智控台输入激活码 ${code} 绑定后重试。`
        : "设备未绑定，请先在智控台完成绑定后重试。");
    }

    const websocket = isRecord(payload.websocket) ? payload.websocket : null;
    const baseUrl = websocket && typeof websocket.url === "string" ? websocket.url.trim() : "";
    const token = websocket && typeof websocket.token === "string" ? websocket.token.trim() : "";
    const url = resolveWebsocketUrl(baseUrl, candidate);
    url.searchParams.set("device-id", config.deviceId);
    url.searchParams.set("client-id", config.deviceId);
    if (token.length > 0) {
      url.searchParams.set("authorization", `Bearer ${token}`);
    }
    return { url: url.toString(), token };
  }

  throw new Error(`OTA 请求失败（已尝试 ${candidates.length} 个地址）：${failures.join("；")}`);
}

function buildOtaCandidates(otaUrl: string): string[] {
  let primary: URL;
  try {
    primary = new URL(otaUrl);
  } catch {
    throw new Error("OTA 地址无效。");
  }
  const candidates = [primary.toString()];
  if (primary.port === "8002" || primary.port === "8003") {
    const alternate = new URL(primary.toString());
    alternate.port = primary.port === "8002" ? "8003" : "8002";
    candidates.push(alternate.toString());
    logInfo("ai-voice", "OTA fallback candidate", { primary: primary.toString(), alternate: alternate.toString() });
  }
  return candidates;
}

function resolveWebsocketUrl(returnedUrl: string, otaUrl: string): URL {
  const fallback = (): URL => {
    const ota = new URL(otaUrl);
    const protocol = ota.protocol === "https:" ? "wss:" : "ws:";
    const url = new URL(`${protocol}//${ota.hostname}:8000/xiaozhi/v1/`);
    logInfo("ai-voice", "websocket address fallback", { returnedUrl, fallback: url.toString() });
    return url;
  };

  if (returnedUrl.length === 0) {
    return fallback();
  }
  let url: URL;
  try {
    url = new URL(returnedUrl);
  } catch {
    return fallback();
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    return fallback();
  }
  // The manager API returns this placeholder when `server.websocket` is unset.
  if (url.hostname === "xiaozhi.server.com") {
    return fallback();
  }
  return url;
}

function sameConfig(left: AiVoiceConfig, right: AiVoiceConfig): boolean {
  return left.otaUrl === right.otaUrl && left.deviceId === right.deviceId;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
