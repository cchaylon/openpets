import { session } from "electron";

import { getAppState, subscribeAppState } from "../app-state.js";
import { logInfo, logWarn } from "../logger.js";
import {
  focusPetWindow,
  isPetWebContents,
  resetPetPlayback,
  sendPetAudio,
  sendPetConversationView,
  setPetConversationLayout,
  startPetCapture,
  stopPetCapture,
} from "../pet-window.js";
import {
  type AiVoicePreferences,
  type ConversationMessage,
  type PetConversationView,
  type PetWindowLayout,
} from "../shared-types.js";
import { AiVoiceClient, type AiVoiceEvent } from "./ai-voice-client.js";
import { getAiVoiceDeviceId } from "./ai-voice-device-id.js";
import { startAltHoldShortcut, stopAltHoldShortcut } from "./ai-voice-shortcut.js";

const maxMessages = 40;
const bubbleHoldMs = 12_000;
const hintBubbleHoldMs = 8_000;
const thinkingTimeoutMs = 20_000;

const client = new AiVoiceClient();

let initialized = false;
let unsubscribeState: (() => void) | null = null;
let unsubscribeClient: (() => void) | null = null;
let config: AiVoicePreferences = { enabled: false, otaUrl: "" };
let configSignature = "";
let currentLayout: PetWindowLayout = "base";

let chatOpen = false;
let messages: ConversationMessage[] = [];
let messageSeq = 0;
let bubble = "";
let voiceActive = false;
let voiceLabel = "对话中";
let chatStatus = "";

let altHeld = false;
let captureActive = false;
let pendingVoiceStart = false;
let awaitCaptureEnd = false;
let assistantMessageId: number | null = null;
let assistantBuffer = "";
let lastUserMessage = "";

let bubbleTimer: NodeJS.Timeout | null = null;
let thinkingTimer: NodeJS.Timeout | null = null;
let dropAudio = false;

export function configureAiVoice(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  installMicrophonePermissions();
  unsubscribeClient = client.on(handleClientEvent);
  unsubscribeState = subscribeAppState(() => refreshConfiguration());
  refreshConfiguration();
  logInfo("ai-voice", "conversation configured");
}

export function republishAiVoiceView(): void {
  const layout = desiredLayout();
  currentLayout = layout;
  setPetConversationLayout(layout);
  sendPetConversationView(buildView());
}

export function toggleAiVoiceChat(): void {
  if (chatOpen) {
    closeAiVoiceChat();
    return;
  }
  openChat();
}

export function closeAiVoiceChat(): void {
  if (!chatOpen) {
    return;
  }
  chatOpen = false;
  chatStatus = "";
  updateView();
}

export function sendAiVoiceChatText(text: string): void {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return;
  }
  beginAssistantTurn();
  appendMessage("user", trimmed);
  lastUserMessage = trimmed;
  clearBubble();
  clearThinkingTimer();
  voiceActive = false;
  chatStatus = "连接中…";
  updateView();

  void (async () => {
    if (!config.enabled) {
      chatStatus = "";
      updateView();
      return;
    }
    if (!isConfigUsable()) {
      chatStatus = "";
      updateView();
      return;
    }
    try {
      const target = { otaUrl: config.otaUrl, deviceId: getAiVoiceDeviceId() };
      await client.ensureReady(target);
      await interruptIfBusy();
      client.sendText(trimmed);
      chatStatus = "思考中…";
      startThinkingTimer();
      updateView();
    } catch (error) {
      failTurn(`AI语音连接失败：${errorMessage(error)}`);
    }
  })();
}

export function handleAiVoiceMicChunk(bytes: Uint8Array): void {
  client.sendAudio(bytes);
}

export function handleAiVoiceMicEnded(): void {
  if (!awaitCaptureEnd) {
    return;
  }
  awaitCaptureEnd = false;
  captureActive = false;
  if (client.state === "listening") {
    client.stopListening();
  }
  voiceLabel = "思考中…";
  chatStatus = chatOpen ? "思考中…" : "";
  startThinkingTimer();
  updateView();
}

export function handleAiVoiceMicError(message: string): void {
  awaitCaptureEnd = false;
  captureActive = false;
  void client.abort();
  failTurn(`麦克风不可用：${message}`);
}

export function handleAiVoiceWindowVisibilityChange(visible: boolean): void {
  if (visible) {
    return;
  }
  chatOpen = false;
  chatStatus = "";
  bubble = "";
  voiceActive = false;
  voiceLabel = "对话中";
  if (captureActive) {
    captureActive = false;
    stopPetCapture();
  }
  if (client.state === "speaking" || client.state === "thinking" || client.state === "listening") {
    dropAudio = true;
    void client.abort();
  }
  resetPetPlayback();
  awaitCaptureEnd = false;
  pendingVoiceStart = false;
  clearBubbleTimer();
  clearThinkingTimer();
  setLayout("base");
}

export function shutdownAiVoice(): void {
  unsubscribeClient?.();
  unsubscribeState?.();
  unsubscribeClient = null;
  unsubscribeState = null;
  stopAltHoldShortcut();
  client.close();
  clearBubbleTimer();
  clearThinkingTimer();
  initialized = false;
}

function refreshConfiguration(): void {
  const next = getAppState().preferences.aiVoice;
  const signature = `${next.enabled}|${next.otaUrl}`;
  if (signature === configSignature) {
    return;
  }
  const changed = configSignature.length > 0;
  configSignature = signature;
  config = { ...next };

  if (changed) {
    stopVoice();
    client.close();
    resetPetPlayback();
    logInfo("ai-voice", "configuration changed", { enabled: next.enabled, hasOtaUrl: next.otaUrl.length > 0 });
  }

  if (next.enabled) {
    startAltHoldShortcut({
      onPress: handleAltPress,
      onRelease: handleAltRelease,
    });
  } else {
    stopAltHoldShortcut();
  }
  updateView();
}

function handleAltPress(): void {
  altHeld = true;
  if (!config.enabled) {
    return;
  }
  if (!isConfigUsable()) {
    showHint(missingConfigHint());
    return;
  }
  if (pendingVoiceStart) {
    return;
  }
  pendingVoiceStart = true;
  captureActive = false;
  awaitCaptureEnd = false;
  voiceActive = true;
  voiceLabel = "连接中…";
  chatStatus = chatOpen ? "连接中…" : "";
  clearBubble();
  clearThinkingTimer();
  updateView();

  void beginVoiceTurn();
}

async function beginVoiceTurn(): Promise<void> {
  try {
    const target = { otaUrl: config.otaUrl, deviceId: getAiVoiceDeviceId() };
    await client.ensureReady(target);
    pendingVoiceStart = false;
    if (!altHeld) {
      resetVoiceStatus();
      updateView();
      return;
    }

    await interruptIfBusy();
    if (!altHeld) {
      resetVoiceStatus();
      updateView();
      return;
    }

    beginAssistantTurn();
    client.startListening();
    captureActive = true;
    voiceActive = true;
    voiceLabel = "聆听中…";
    chatStatus = chatOpen ? "聆听中…" : "";
    startPetCapture();
    updateView();
  } catch (error) {
    pendingVoiceStart = false;
    if (!altHeld) {
      resetVoiceStatus();
      updateView();
      return;
    }
    failTurn(`AI语音连接失败：${errorMessage(error)}`);
  }
}

function handleAltRelease(): void {
  altHeld = false;
  pendingVoiceStart = false;
  if (captureActive) {
    captureActive = false;
    awaitCaptureEnd = true;
    stopPetCapture();
    voiceLabel = "思考中…";
    chatStatus = chatOpen ? "思考中…" : "";
    startThinkingTimer();
  }
  updateView();
}

function handleClientEvent(event: AiVoiceEvent): void {
  switch (event.kind) {
    case "state":
      if (event.state === "speaking") {
        dropAudio = false;
      }
      if (event.state === "idle" && !altHeld && !assistantMessageId) {
        chatStatus = "";
        voiceActive = false;
        updateView();
      }
      break;
    case "stt": {
      if (event.text.startsWith("%")) {
        return;
      }
      const text = event.text.trim();
      if (text.length === 0) {
        return;
      }
      clearThinkingTimer();
      if (text !== lastUserMessage) {
        appendMessage("user", text);
      }
      lastUserMessage = text;
      voiceLabel = "思考中…";
      chatStatus = "思考中…";
      updateView();
      break;
    }
    case "sentence": {
      clearThinkingTimer();
      dropAudio = false;
      if (assistantMessageId === null) {
        // The answer has started while Alt may still be held: stop the
        // microphone so the speaker output cannot be fed back as input.
        if (captureActive) {
          captureActive = false;
          awaitCaptureEnd = false;
          stopPetCapture();
        }
        assistantMessageId = appendMessage("assistant", event.text);
        assistantBuffer = event.text;
      } else {
        assistantBuffer += event.text;
        updateMessage(assistantMessageId, assistantBuffer);
      }
      bubble = assistantBuffer;
      clearBubbleTimer();
      voiceActive = true;
      voiceLabel = "回答中…";
      chatStatus = "回答中…";
      updateView();
      break;
    }
    case "answer-end": {
      clearThinkingTimer();
      dropAudio = false;
      if (assistantMessageId === null && (client.state === "thinking" || client.state === "listening")) {
        // Acknowledgement of an interrupted turn that raced with a new one.
        break;
      }
      assistantMessageId = null;
      assistantBuffer = "";
      voiceActive = false;
      voiceLabel = "对话中";
      chatStatus = "";
      scheduleBubbleHide(bubbleHoldMs);
      updateView();
      break;
    }
    case "audio":
      if (!dropAudio) {
        sendPetAudio(event.bytes);
      }
      break;
    case "emotion":
      logInfo("ai-voice", "emotion", { emotion: event.emotion });
      break;
    case "error":
      failTurn(event.message);
      break;
  }
}

function failTurn(message: string): void {
  pendingVoiceStart = false;
  captureActive = false;
  awaitCaptureEnd = false;
  dropAudio = true;
  clearThinkingTimer();
  clearBubbleTimer();
  assistantMessageId = null;
  assistantBuffer = "";
  voiceActive = false;
  chatStatus = "";
  resetPetPlayback();
  logWarn("ai-voice", "turn failed", { message });
  if (chatOpen) {
    appendAssistantMessage(message);
    bubble = "";
  } else {
    bubble = message;
    scheduleBubbleHide(hintBubbleHoldMs);
  }
  updateView();
}

function openChat(): void {
  chatOpen = true;
  focusPetWindow();
  clearBubble();
  if (!config.enabled) {
    appendAssistantMessageOnce("AI语音对话已关闭，请在控制中心 → 设置 → AI语音对话 中开启。");
  } else if (!isConfigUsable()) {
    appendAssistantMessageOnce(missingConfigHint());
  }
  updateView();
}

function showHint(text: string): void {
  voiceActive = false;
  voiceLabel = "对话中";
  chatStatus = "";
  clearThinkingTimer();
  if (chatOpen) {
    appendAssistantMessageOnce(text);
  } else {
    bubble = text;
    scheduleBubbleHide(hintBubbleHoldMs);
  }
  updateView();
}

function beginAssistantTurn(): void {
  assistantMessageId = null;
  assistantBuffer = "";
  lastUserMessage = "";
}

async function interruptIfBusy(): Promise<void> {
  if (client.state === "speaking" || client.state === "thinking" || client.state === "listening") {
    dropAudio = true;
    const aborted = client.abort();
    resetPetPlayback();
    await aborted;
  }
}

function stopVoice(): void {
  if (captureActive) {
    stopPetCapture();
  }
  captureActive = false;
  awaitCaptureEnd = false;
  pendingVoiceStart = false;
  altHeld = false;
  resetVoiceStatus();
}

function resetVoiceStatus(): void {
  voiceActive = false;
  voiceLabel = "对话中";
  chatStatus = "";
}

function appendMessage(role: ConversationMessage["role"], text: string): number {
  messageSeq += 1;
  messages.push({ id: messageSeq, role, text });
  if (messages.length > maxMessages) {
    messages = messages.slice(messages.length - maxMessages);
  }
  return messageSeq;
}

function appendAssistantMessage(text: string): void {
  appendMessage("assistant", text);
}

function appendAssistantMessageOnce(text: string): void {
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant" && last.text === text) {
    return;
  }
  appendMessage("assistant", text);
}

function updateMessage(id: number, text: string): void {
  messages = messages.map((message) => (message.id === id ? { ...message, text } : message));
}

function scheduleBubbleHide(delayMs: number): void {
  clearBubbleTimer();
  bubbleTimer = setTimeout(() => {
    bubbleTimer = null;
    bubble = "";
    updateView();
  }, delayMs);
}

function clearBubble(): void {
  clearBubbleTimer();
  bubble = "";
}

function clearBubbleTimer(): void {
  if (bubbleTimer) {
    clearTimeout(bubbleTimer);
    bubbleTimer = null;
  }
}

function startThinkingTimer(): void {
  clearThinkingTimer();
  thinkingTimer = setTimeout(() => {
    thinkingTimer = null;
    if (client.state === "thinking" || client.state === "listening") {
      voiceActive = false;
      voiceLabel = "对话中";
      chatStatus = "";
      updateView();
    }
  }, thinkingTimeoutMs);
}

function clearThinkingTimer(): void {
  if (thinkingTimer) {
    clearTimeout(thinkingTimer);
    thinkingTimer = null;
  }
}

function updateView(): void {
  const layout = desiredLayout();
  setLayout(layout);
  sendPetConversationView(buildView());
}

function setLayout(layout: PetWindowLayout): void {
  if (layout === currentLayout) {
    return;
  }
  currentLayout = layout;
  setPetConversationLayout(layout);
}

function desiredLayout(): PetWindowLayout {
  if (chatOpen) {
    return "chat";
  }
  if (voiceActive || bubble.length > 0) {
    return "voice";
  }
  return "base";
}

function buildView(): PetConversationView {
  const showBubble = bubble.length > 0 && !chatOpen;
  return {
    chatOpen,
    messages: messages.map((message) => ({ ...message })),
    bubble: showBubble ? bubble : "",
    voiceActive,
    voiceLabel,
    chatStatus,
  };
}

function isConfigUsable(): boolean {
  return config.enabled && config.otaUrl.trim().length > 0;
}

function missingConfigHint(): string {
  return "还没有配置 AI 语音服务。请打开控制中心 → 设置 → AI语音对话，填写 OTA 地址；设备 ID 会自动生成。";
}

function installMicrophonePermissions(): void {
  const applicationSession = session.defaultSession;
  applicationSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === "media" && isPetWebContents(webContents));
  });
  applicationSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === "media" && isPetWebContents(webContents);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
