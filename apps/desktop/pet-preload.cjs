const { ipcRenderer } = require("electron");

const FRAME_RATE = 16000;
const FRAME_SAMPLES = 960;
const FRAME_DURATION_US = 60000;
const TTS_SAMPLE_RATE = 24000;
const MAX_RENDERED_MESSAGES = 40;

const pageParams = new URLSearchParams(window.location.search);
const petId = pageParams.get("petId") || "builtin";
const petName = pageParams.get("petName") || "DeskPet";
const petScale = Number(pageParams.get("scale")) || 0.75;
const petSpriteVersion = pageParams.get("spriteVersion") === "2" ? 2 : 1;

let dragging = false;
let moved = false;
let startX = 0;
let startY = 0;
let clickTimer = null;

let ui = null;
let view = emptyView();
let lastMessagesSignature = "";
let chatWasOpen = false;

let captureRequested = false;
let captureQueue = Promise.resolve();
let captureSession = null;

let playbackContext = null;
let playbackDecoder = null;
let playbackNextTime = 0;
let playbackTimestamp = 0;
const playbackSources = new Set();

/* ---------------- 宠物指针交互 ---------------- */

function endDrag() {
  if (!dragging) {
    return;
  }
  dragging = false;
  document.documentElement.dataset.dragging = "false";
  ipcRenderer.send("deskpet:drag-end");
}

function isPetTarget(target) {
  return Boolean(target && typeof target.closest === "function" && target.closest(".pet-hitbox"));
}

window.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !isPetTarget(event.target)) {
    return;
  }
  dragging = true;
  moved = false;
  startX = event.screenX;
  startY = event.screenY;
  document.documentElement.dataset.dragging = "true";
  if (event.target && typeof event.target.setPointerCapture === "function") {
    try {
      event.target.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; the main process still tracks the cursor.
    }
  }
  ipcRenderer.send("deskpet:drag-start");
});

window.addEventListener("pointermove", (event) => {
  if (!dragging) {
    return;
  }
  if (Math.hypot(event.screenX - startX, event.screenY - startY) > 4) {
    moved = true;
  }
  ipcRenderer.send("deskpet:drag-move");
});

window.addEventListener("pointerup", () => {
  const wasClick = dragging && !moved;
  endDrag();
  if (!wasClick) {
    return;
  }
  // Delay the single click so a double click can open the Control Center
  // without toggling the chat twice.
  if (clickTimer) {
    clearTimeout(clickTimer);
  }
  clickTimer = setTimeout(() => {
    clickTimer = null;
    ipcRenderer.send("deskpet:pet-clicked");
  }, 240);
});

window.addEventListener("pointercancel", () => {
  endDrag();
});

window.addEventListener("blur", () => {
  endDrag();
});

window.addEventListener("contextmenu", (event) => {
  if (!isPetTarget(event.target)) {
    return;
  }
  event.preventDefault();
  ipcRenderer.send("deskpet:context-menu");
});

window.addEventListener("dblclick", (event) => {
  if (!isPetTarget(event.target)) {
    return;
  }
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
  }
  ipcRenderer.send("deskpet:open-control-center");
});

window.addEventListener("dragstart", (event) => {
  event.preventDefault();
});

ipcRenderer.on("deskpet:reaction", (_event, reaction) => {
  if (typeof reaction === "string") {
    document.documentElement.dataset.reactionState = reaction;
  }
});

ipcRenderer.on("deskpet:motion", (_event, motion) => {
  if (motion === "left" || motion === "right") {
    document.documentElement.dataset.motionState = motion;
  } else {
    document.documentElement.dataset.motionState = "idle";
  }
});

/* ---------------- 对话视图 ---------------- */

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    applyPetMetadata();
    initChatUi();
  }, { once: true });
} else {
  applyPetMetadata();
  initChatUi();
}

function applyPetMetadata() {
  const root = document.documentElement;
  const width = Math.ceil(192 * petScale);
  const height = Math.ceil(208 * petScale);
  root.style.setProperty("--pet-scale", String(petScale));
  root.style.setProperty("--pet-width", `${width}px`);
  root.style.setProperty("--pet-height", `${height}px`);

  const sprite = document.querySelector(".sprite");
  if (sprite) {
    sprite.style.backgroundImage = `url("petdesk-asset://spritesheet/${encodeURIComponent(petId)}")`;
    sprite.style.backgroundSize = `1536px ${petSpriteVersion === 2 ? 2288 : 1872}px`;
  }
  const stage = document.querySelector(".stage");
  if (stage) {
    stage.setAttribute("aria-label", petName);
  }
  const hitbox = document.querySelector(".pet-hitbox");
  if (hitbox) {
    hitbox.setAttribute("aria-label", petName);
  }
}

function initChatUi() {
  const panel = document.querySelector('[data-role="chat-panel"]');
  const log = document.querySelector('[data-role="chat-log"]');
  const status = document.querySelector('[data-role="chat-status"]');
  const input = document.querySelector('[data-role="chat-input"]');
  const send = document.querySelector('[data-role="chat-send"]');
  const form = document.querySelector('[data-role="chat-form"]');
  const close = document.querySelector('[data-role="chat-close"]');
  const bubble = document.querySelector('[data-role="answer-bubble"]');
  const voiceLabel = document.querySelector('[data-role="voice-status-label"]');

  if (!panel || !log || !input || !form || !send) {
    return;
  }

  ui = { panel, log, status, input, send, form, close, bubble, voiceLabel };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendChatText();
  });

  input.addEventListener("input", () => {
    updateSendButton();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      ipcRenderer.send("deskpet:chat-close");
    }
  });

  close?.addEventListener("click", (event) => {
    event.preventDefault();
    ipcRenderer.send("deskpet:chat-close");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !view.chatOpen) {
      return;
    }
    if (document.activeElement === input) {
      return;
    }
    ipcRenderer.send("deskpet:chat-close");
  });

  renderView();

  function sendChatText() {
    const text = input.value.trim();
    if (!text) {
      return;
    }
    input.value = "";
    updateSendButton();
    ipcRenderer.send("deskpet:chat-send", text);
  }
}

ipcRenderer.on("deskpet:conversation-view", (_event, next) => {
  view = sanitizeView(next);
  renderView();
});

function emptyView() {
  return {
    chatOpen: false,
    messages: [],
    bubble: "",
    voiceActive: false,
    voiceLabel: "对话中",
    chatStatus: "",
  };
}

function sanitizeView(value) {
  if (!value || typeof value !== "object") {
    return emptyView();
  }
  const messages = Array.isArray(value.messages)
    ? value.messages
      .slice(-MAX_RENDERED_MESSAGES)
      .filter((message) => message && typeof message === "object" && typeof message.text === "string")
      .map((message) => ({
        id: typeof message.id === "number" ? message.id : 0,
        role: message.role === "user" ? "user" : "assistant",
        text: message.text,
      }))
    : [];
  return {
    chatOpen: value.chatOpen === true,
    messages,
    bubble: typeof value.bubble === "string" ? value.bubble : "",
    voiceActive: value.voiceActive === true,
    voiceLabel: typeof value.voiceLabel === "string" && value.voiceLabel.length > 0 ? value.voiceLabel : "对话中",
    chatStatus: typeof value.chatStatus === "string" ? value.chatStatus : "",
  };
}

function renderView() {
  document.documentElement.dataset.chatOpen = view.chatOpen ? "true" : "false";
  document.documentElement.dataset.voiceActive = view.voiceActive ? "true" : "false";

  if (!ui) {
    return;
  }

  ui.status.textContent = view.chatStatus;
  if (ui.voiceLabel) {
    ui.voiceLabel.textContent = view.voiceLabel;
  }

  const bubbleText = view.chatOpen ? "" : view.bubble;
  ui.bubble.textContent = bubbleText;
  ui.bubble.dataset.visible = bubbleText.length > 0 ? "true" : "false";

  const signature = JSON.stringify(view.messages);
  if (signature !== lastMessagesSignature) {
    lastMessagesSignature = signature;
    renderMessages();
  }

  if (view.chatOpen && !chatWasOpen) {
    window.setTimeout(() => {
      if (ui && view.chatOpen) {
        ui.input.focus();
      }
    }, 30);
  }
  chatWasOpen = view.chatOpen;

  updateSendButton();
}

function renderMessages() {
  if (!ui) {
    return;
  }
  const container = ui.log;
  container.textContent = "";
  if (view.messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    const icon = document.createElement("div");
    icon.className = "chat-empty-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "🐾";
    empty.append(icon, "点击宠物说话，或长按 Alt 进行语音对话");
    container.append(empty);
    return;
  }
  for (const message of view.messages) {
    const row = document.createElement("div");
    row.className = `chat-message is-${message.role}`;
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.textContent = message.text;
    row.append(bubble);
    container.append(row);
  }
  container.scrollTop = container.scrollHeight;
}

function updateSendButton() {
  if (!ui) {
    return;
  }
  ui.send.disabled = ui.input.value.trim().length === 0;
}

/* ---------------- 下行语音播放 ---------------- */

ipcRenderer.on("deskpet:tts-audio", (_event, payload) => {
  const bytes = toUint8Array(payload);
  if (bytes && bytes.byteLength > 0) {
    playAudioPacket(bytes);
  }
});

ipcRenderer.on("deskpet:playback-reset", () => {
  resetPlayback();
});

function ensurePlayback() {
  if (typeof AudioDecoder === "undefined" || typeof AudioContext === "undefined") {
    throw new Error("当前环境不支持语音播放。");
  }
  if (!playbackContext) {
    playbackContext = new AudioContext();
    playbackNextTime = playbackContext.currentTime;
  }
  if (playbackContext.state === "suspended") {
    void playbackContext.resume();
  }
  if (!playbackDecoder) {
    playbackDecoder = new AudioDecoder({
      output: (audioData) => {
        try {
          enqueueDecodedAudio(audioData);
        } catch (error) {
          console.warn("DeskPet audio decode output failed.", error);
        } finally {
          audioData.close();
        }
      },
      error: (error) => {
        console.warn("DeskPet audio decoder error.", error);
      },
    });
    playbackDecoder.configure({
      codec: "opus",
      sampleRate: TTS_SAMPLE_RATE,
      numberOfChannels: 1,
    });
  }
}

function playAudioPacket(bytes) {
  try {
    ensurePlayback();
    playbackDecoder.decode(new EncodedAudioChunk({
      type: "key",
      timestamp: playbackTimestamp,
      data: bytes,
    }));
    playbackTimestamp += FRAME_DURATION_US;
  } catch (error) {
    console.warn("DeskPet audio packet dropped.", error);
  }
}

function enqueueDecodedAudio(audioData) {
  if (!playbackContext) {
    return;
  }
  const frames = audioData.numberOfFrames;
  if (!Number.isFinite(frames) || frames <= 0) {
    return;
  }
  const buffer = playbackContext.createBuffer(1, frames, audioData.sampleRate);
  const channel = buffer.getChannelData(0);
  audioData.copyTo(channel, { planeIndex: 0, format: "f32-planar" });

  const source = playbackContext.createBufferSource();
  source.buffer = buffer;
  source.connect(playbackContext.destination);
  const startAt = Math.max(playbackContext.currentTime + 0.08, playbackNextTime);
  playbackNextTime = startAt + buffer.duration;
  source.addEventListener("ended", () => {
    playbackSources.delete(source);
  });
  playbackSources.add(source);
  source.start(startAt);
}

function resetPlayback() {
  for (const source of playbackSources) {
    try {
      source.stop();
    } catch {
      // Sources that already ended cannot be stopped again.
    }
  }
  playbackSources.clear();
  playbackNextTime = playbackContext ? playbackContext.currentTime : 0;
  playbackTimestamp = 0;
  if (playbackDecoder) {
    try {
      playbackDecoder.reset();
    } catch {
      // Resetting a closed decoder is harmless.
    }
  }
}

/* ---------------- 上行录音与 Opus 编码 ---------------- */

ipcRenderer.on("deskpet:voice-capture-start", () => {
  captureRequested = true;
  queueCapture(startCapture);
});

ipcRenderer.on("deskpet:voice-capture-stop", () => {
  captureRequested = false;
  queueCapture(stopCapture);
});

function queueCapture(task) {
  captureQueue = captureQueue.then(task).catch((error) => {
    console.warn("DeskPet microphone task failed.", error);
    reportMicError(error);
  });
}

async function startCapture() {
  if (captureSession) {
    await finishCapture(captureSession, false);
    captureSession = null;
  }
  if (typeof AudioEncoder === "undefined") {
    throw new Error("当前环境不支持 Opus 音频编码。");
  }
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    throw new Error("未找到可用的麦克风。");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  if (!captureRequested) {
    stopStream(stream);
    ipcRenderer.send("deskpet:mic-ended");
    return;
  }

  const context = new AudioContext({ sampleRate: FRAME_RATE, latencyHint: "interactive" });
  await context.resume();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(1024, 1, 1);
  const silence = context.createGain();
  silence.gain.value = 0;

  const session = {
    stream,
    context,
    source,
    processor,
    silence,
    encoder: null,
    pending: new Float32Array(FRAME_SAMPLES),
    pendingLength: 0,
    frameTimestamp: 0,
    closed: false,
  };

  session.encoder = await createEncoder(session);
  processor.onaudioprocess = (event) => {
    if (session.closed) {
      return;
    }
    const input = event.inputBuffer.getChannelData(0);
    appendSamples(session, input);
  };
  source.connect(processor);
  processor.connect(silence);
  silence.connect(context.destination);
  captureSession = session;
}

async function stopCapture() {
  const session = captureSession;
  captureSession = null;
  if (!session) {
    if (!captureRequested) {
      ipcRenderer.send("deskpet:mic-ended");
    }
    return;
  }
  await finishCapture(session, true);
  ipcRenderer.send("deskpet:mic-ended");
}

async function createEncoder(session) {
  const base = {
    codec: "opus",
    sampleRate: FRAME_RATE,
    numberOfChannels: 1,
    bitrate: 24000,
  };
  let encoderConfig = base;
  try {
    const withFrameDuration = {
      ...base,
      opus: { frameDuration: 60000, application: "voip" },
    };
    const support = await AudioEncoder.isConfigSupported(withFrameDuration);
    if (support && support.supported) {
      encoderConfig = withFrameDuration;
    }
  } catch {
    // Older Chromium builds may not accept the opus options block.
  }

  const encoder = new AudioEncoder({
    output: (chunk) => {
      if (session.closed || !chunk || chunk.byteLength === 0) {
        return;
      }
      const buffer = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(buffer);
      ipcRenderer.send("deskpet:mic-chunk", buffer);
    },
    error: (error) => {
      reportMicError(error instanceof Error ? error : new Error("音频编码失败。"));
    },
  });
  encoder.configure(encoderConfig);
  return encoder;
}

function appendSamples(session, input) {
  let offset = 0;
  while (offset < input.length && !session.closed) {
    const take = Math.min(FRAME_SAMPLES - session.pendingLength, input.length - offset);
    session.pending.set(input.subarray(offset, offset + take), session.pendingLength);
    session.pendingLength += take;
    offset += take;
    if (session.pendingLength === FRAME_SAMPLES) {
      encodeSamples(session, session.pending);
      session.pending = new Float32Array(FRAME_SAMPLES);
      session.pendingLength = 0;
    }
  }
}

function encodeSamples(session, samples) {
  if (!session.encoder) {
    return;
  }
  const audioData = new AudioData({
    format: "f32-planar",
    sampleRate: FRAME_RATE,
    numberOfFrames: FRAME_SAMPLES,
    numberOfChannels: 1,
    timestamp: session.frameTimestamp,
    data: samples,
  });
  session.frameTimestamp += FRAME_DURATION_US;
  session.encoder.encode(audioData);
  audioData.close();
}

async function finishCapture(session, flush) {
  session.closed = true;
  session.processor.onaudioprocess = null;
  try {
    session.processor.disconnect();
    session.source.disconnect();
    session.silence.disconnect();
  } catch {
    // Disconnecting nodes that were never connected is harmless.
  }
  stopStream(session.stream);
  try {
    await session.context.close();
  } catch {
    // Context teardown is best effort.
  }

  if (session.encoder) {
    if (flush) {
      if (session.pendingLength > 0) {
        const padded = new Float32Array(FRAME_SAMPLES);
        padded.set(session.pending.subarray(0, session.pendingLength));
        encodeSamples(session, padded);
      }
      session.closed = false;
      try {
        await session.encoder.flush();
      } catch {
        // Flushing a failed encoder cannot be recovered.
      }
      session.closed = true;
    }
    try {
      session.encoder.close();
    } catch {
      // Encoder teardown is best effort.
    }
  }
}

function stopStream(stream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function reportMicError(error) {
  captureRequested = false;
  const message = error instanceof Error && error.message ? error.message : String(error);
  ipcRenderer.send("deskpet:mic-error", message);
}

/* ---------------- 工具函数 ---------------- */

function toUint8Array(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}
