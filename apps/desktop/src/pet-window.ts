import { join } from "node:path";

import { BrowserWindow, Menu, app, ipcMain, screen, type IpcMainEvent, type WebContents } from "electron";

import { getAppState, setPetPosition } from "./app-state.js";
import { builtInPet, petSpriteUrl } from "./built-in-pet.js";
import { clampPetPosition, getDefaultPetPosition, getPetWindowSize, type WindowSize } from "./display.js";
import { logError, logInfo } from "./logger.js";
import {
  CHAT_PANEL_EXTRA_HEIGHT,
  CHAT_PANEL_MIN_WIDTH,
  VOICE_PANEL_EXTRA_HEIGHT,
  VOICE_PANEL_MIN_WIDTH,
  reactionDurationMs,
} from "./pet-render.js";
import {
  BUILT_IN_PET_ID,
  type PetConversationView,
  type PetReaction,
  type PetSummary,
  type PetWindowLayout,
} from "./shared-types.js";

export interface PetWindowHooks {
  readonly onVisibilityChanged: () => void;
  readonly onOpenControlCenter: () => void;
  readonly onChatToggle: () => void;
  readonly onChatSend: (text: string) => void;
  readonly onChatClose: () => void;
  readonly onMicChunk: (bytes: Uint8Array) => void;
  readonly onMicEnded: () => void;
  readonly onMicError: (message: string) => void;
  readonly onContentLoaded: () => void;
}

const maxChatMessageLength = 500;
const maxAudioChunkBytes = 8 * 1024;

let petWindow: BrowserWindow | null = null;
let hooks: PetWindowHooks | null = null;
let quitting = false;
let reactionTimer: NodeJS.Timeout | null = null;
let saveTimer: NodeJS.Timeout | null = null;
let dragState: { readonly cursorX: number; readonly cursorY: number; readonly windowX: number; readonly windowY: number } | null = null;
let ipcRegistered = false;
let currentLayout: PetWindowLayout = "base";

export function configurePetWindow(nextHooks: PetWindowHooks): void {
  hooks = nextHooks;
}

export function getCurrentPet(): PetSummary {
  const state = getAppState();
  const petId = state.preferences.defaultPetId;
  if (petId === BUILT_IN_PET_ID) {
    return builtInPet;
  }
  const installed = state.installedPets.find((pet) => pet.id === petId);
  if (!installed) {
    return builtInPet;
  }
  return {
    id: installed.id,
    displayName: installed.displayName,
    description: installed.description,
    builtIn: false,
    spriteVersion: installed.spriteVersion,
    spriteUrl: petSpriteUrl(installed.id),
  };
}

export function isPetWindowVisible(): boolean {
  return Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible());
}

export function isPetWebContents(contents: WebContents | null | undefined): boolean {
  return Boolean(petWindow && !petWindow.isDestroyed() && contents === petWindow.webContents);
}

export function createPetWindow(): BrowserWindow {
  if (petWindow && !petWindow.isDestroyed()) {
    return petWindow;
  }

  currentLayout = "base";
  const state = getAppState();
  const size = getPetWindowSize(state.preferences.petScale);
  const position = state.preferences.petPosition
    ? clampPetPosition(state.preferences.petPosition, size)
    : getDefaultPetPosition(size);

  const created = new BrowserWindow({
    title: "DeskPet",
    width: size.width,
    height: size.height,
    x: position.x,
    y: position.y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: state.preferences.alwaysOnTop,
    focusable: true,
    show: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: join(app.getAppPath(), "pet-preload.cjs"),
    },
  });

  petWindow = created;
  created.setMenu(null);
  applyAlwaysOnTop();

  if (process.platform === "darwin") {
    created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  created.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  created.webContents.on("render-process-gone", (_event, details) => {
    logError("pet.window", "renderer process gone", { details });
  });

  created.on("close", (event) => {
    if (quitting) {
      return;
    }
    event.preventDefault();
    created.hide();
    hooks?.onVisibilityChanged();
  });

  created.on("move", schedulePositionSave);
  created.on("moved", savePositionNow);
  created.on("closed", () => {
    if (petWindow === created) {
      petWindow = null;
      currentLayout = "base";
    }
  });
  created.on("show", () => applyAlwaysOnTop());
  created.on("restore", () => applyAlwaysOnTop());

  registerPetWindowIpc();
  void loadPetContent();
  logInfo("pet.window", "window created", { position, size, petId: getCurrentPet().id });
  return created;
}

export function showPetWindow(): void {
  const window = createPetWindow();
  const [x, y] = window.getPosition();
  const size = window.getBounds();
  const clamped = clampPetPosition({ x, y }, size);
  window.setPosition(clamped.x, clamped.y, false);
  applyAlwaysOnTop();
  window.showInactive();
  hooks?.onVisibilityChanged();
}

export function hidePetWindow(): void {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  savePositionNow();
  applyLayoutSize("base");
  petWindow.hide();
  hooks?.onVisibilityChanged();
}

export function togglePetWindow(): void {
  if (isPetWindowVisible()) {
    hidePetWindow();
  } else {
    showPetWindow();
  }
}

export function focusPetWindow(): void {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  if (!petWindow.isVisible()) {
    petWindow.show();
  }
  petWindow.focus();
  petWindow.webContents.focus();
}

export function applyPetWindowPreferences(): void {
  applyAlwaysOnTop();
}

export function refreshPetWindow(): void {
  if (!petWindow || petWindow.isDestroyed()) {
    createPetWindow();
    return;
  }
  applyAlwaysOnTop();
  applyLayoutSize(currentLayout);
  void loadPetContent();
}

export function resetPetWindowPosition(): void {
  if (!petWindow || petWindow.isDestroyed()) {
    createPetWindow();
    return;
  }
  const baseSize = getPetWindowSize(getAppState().preferences.petScale);
  const basePosition = getDefaultPetPosition(baseSize);
  const targetSize = getWindowSizeForLayout(currentLayout);
  const targetPosition = clampPetPosition({
    x: basePosition.x + baseSize.width / 2 - targetSize.width / 2,
    y: basePosition.y + baseSize.height - targetSize.height,
  }, targetSize);
  petWindow.setBounds({
    x: targetPosition.x,
    y: targetPosition.y,
    width: targetSize.width,
    height: targetSize.height,
  }, false);
  setPetPosition(basePosition);
}

export function setPetConversationLayout(layout: PetWindowLayout): void {
  currentLayout = layout;
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  applyLayoutSize(layout);
}

export function sendPetConversationView(view: PetConversationView): void {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  petWindow.webContents.send("deskpet:conversation-view", view);
}

export function sendPetAudio(bytes: Uint8Array): void {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  petWindow.webContents.send("deskpet:tts-audio", bytes);
}

export function resetPetPlayback(): void {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  petWindow.webContents.send("deskpet:playback-reset");
}

export function startPetCapture(): void {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  petWindow.webContents.send("deskpet:voice-capture-start");
}

export function stopPetCapture(): void {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  petWindow.webContents.send("deskpet:voice-capture-stop");
}

export function playPetReaction(reaction: PetReaction): void {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  const window = petWindow;
  window.webContents.send("deskpet:reaction", reaction);
  if (reactionTimer) {
    clearTimeout(reactionTimer);
    reactionTimer = null;
  }
  if (reaction !== "idle") {
    reactionTimer = setTimeout(() => {
      reactionTimer = null;
      if (!window.isDestroyed()) {
        window.webContents.send("deskpet:reaction", "idle");
      }
    }, reactionDurationMs(reaction));
  }
}

export function savePositionNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  const bounds = petWindow.getBounds();
  const baseSize = getPetWindowSize(getAppState().preferences.petScale);
  const basePosition = clampPetPosition({
    x: bounds.x + bounds.width / 2 - baseSize.width / 2,
    y: bounds.y + bounds.height - baseSize.height,
  }, baseSize);
  setPetPosition(basePosition);
}

export function preparePetWindowForQuit(): void {
  quitting = true;
  savePositionNow();
  if (reactionTimer) {
    clearTimeout(reactionTimer);
    reactionTimer = null;
  }
}

function schedulePositionSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    savePositionNow();
  }, 250);
}

function applyAlwaysOnTop(): void {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  petWindow.setAlwaysOnTop(getAppState().preferences.alwaysOnTop);
}

function getWindowSizeForLayout(layout: PetWindowLayout): WindowSize {
  const baseSize = getPetWindowSize(getAppState().preferences.petScale);
  if (layout === "chat") {
    return {
      width: Math.max(baseSize.width, CHAT_PANEL_MIN_WIDTH),
      height: baseSize.height + CHAT_PANEL_EXTRA_HEIGHT,
    };
  }
  if (layout === "voice") {
    return {
      width: Math.max(baseSize.width, VOICE_PANEL_MIN_WIDTH),
      height: baseSize.height + VOICE_PANEL_EXTRA_HEIGHT,
    };
  }
  return baseSize;
}

function applyLayoutSize(layout: PetWindowLayout): void {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  const targetSize = getWindowSizeForLayout(layout);
  const bounds = petWindow.getBounds();
  const anchorX = bounds.x + bounds.width / 2;
  const anchorBottom = bounds.y + bounds.height;
  const position = clampPetPosition({
    x: anchorX - targetSize.width / 2,
    y: anchorBottom - targetSize.height,
  }, targetSize);
  if (bounds.width === targetSize.width && bounds.height === targetSize.height && bounds.x === position.x && bounds.y === position.y) {
    return;
  }
  petWindow.setBounds({
    x: position.x,
    y: position.y,
    width: targetSize.width,
    height: targetSize.height,
  }, false);
  if (layout === "base") {
    setPetPosition(position);
  }
}

async function loadPetContent(): Promise<void> {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  const pet = getCurrentPet();
  const scale = getAppState().preferences.petScale;
  try {
    await petWindow.loadFile(join(app.getAppPath(), "pet.html"), {
      query: {
        petId: pet.id,
        petName: pet.displayName,
        scale: String(scale),
        spriteVersion: String(pet.spriteVersion),
      },
    });
    hooks?.onContentLoaded();
  } catch (error) {
    logError("pet.window", "pet content load failed", {
      petId: pet.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function registerPetWindowIpc(): void {
  if (ipcRegistered) {
    return;
  }
  ipcRegistered = true;

  ipcMain.on("deskpet:drag-start", (event) => {
    if (!isFromPetWindow(event) || !petWindow) {
      return;
    }
    const [windowX, windowY] = petWindow.getPosition();
    const cursor = screen.getCursorScreenPoint();
    dragState = { cursorX: cursor.x, cursorY: cursor.y, windowX, windowY };
    petWindow.webContents.send("deskpet:motion", "idle");
  });

  ipcMain.on("deskpet:drag-move", (event) => {
    if (!isFromPetWindow(event) || !petWindow || !dragState) {
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const dx = cursor.x - dragState.cursorX;
    const dy = cursor.y - dragState.cursorY;
    if (Math.abs(dx) > 4) {
      petWindow.webContents.send("deskpet:motion", dx > 0 ? "right" : "left");
    }
    const size = petWindow.getBounds();
    const target = clampPetPosition({ x: dragState.windowX + dx, y: dragState.windowY + dy }, {
      width: size.width,
      height: size.height,
    });
    petWindow.setPosition(target.x, target.y, false);
  });

  ipcMain.on("deskpet:drag-end", (event) => {
    if (!isFromPetWindow(event)) {
      return;
    }
    dragState = null;
    petWindow?.webContents.send("deskpet:motion", "idle");
    savePositionNow();
  });

  ipcMain.on("deskpet:pet-clicked", (event) => {
    if (!isFromPetWindow(event)) {
      return;
    }
    playPetReaction("waving");
    hooks?.onChatToggle();
  });

  ipcMain.on("deskpet:open-control-center", (event) => {
    if (!isFromPetWindow(event)) {
      return;
    }
    hooks?.onOpenControlCenter();
  });

  ipcMain.on("deskpet:context-menu", (event) => {
    if (!isFromPetWindow(event)) {
      return;
    }
    showPetContextMenu();
  });

  ipcMain.on("deskpet:chat-send", (event, text: unknown) => {
    if (!isFromPetWindow(event) || typeof text !== "string") {
      return;
    }
    const trimmed = text.trim().slice(0, maxChatMessageLength);
    if (trimmed.length > 0) {
      hooks?.onChatSend(trimmed);
    }
  });

  ipcMain.on("deskpet:chat-close", (event) => {
    if (!isFromPetWindow(event)) {
      return;
    }
    hooks?.onChatClose();
  });

  ipcMain.on("deskpet:mic-chunk", (event, chunk: unknown) => {
    if (!isFromPetWindow(event)) {
      return;
    }
    const bytes = toBytes(chunk);
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > maxAudioChunkBytes) {
      return;
    }
    hooks?.onMicChunk(bytes);
  });

  ipcMain.on("deskpet:mic-ended", (event) => {
    if (!isFromPetWindow(event)) {
      return;
    }
    hooks?.onMicEnded();
  });

  ipcMain.on("deskpet:mic-error", (event, message: unknown) => {
    if (!isFromPetWindow(event)) {
      return;
    }
    hooks?.onMicError(typeof message === "string" && message.length > 0 ? message : "麦克风不可用。");
  });
}

function showPetContextMenu(): void {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  const currentPet = getCurrentPet();
  const menu = Menu.buildFromTemplate([
    { label: `当前宠物：${currentPet.displayName}`, enabled: false },
    { type: "separator" },
    {
      label: "AI语音对话",
      click: () => {
        hooks?.onChatToggle();
      },
    },
    {
      label: "打开控制中心",
      click: () => hooks?.onOpenControlCenter(),
    },
    { type: "separator" },
    { label: "挥手", click: () => playPetReaction("waving") },
    { label: "跳跃", click: () => playPetReaction("jumping") },
    { label: "思考", click: () => playPetReaction("review") },
    { label: "等待", click: () => playPetReaction("waiting") },
    { type: "separator" },
    {
      label: "隐藏宠物",
      click: () => hidePetWindow(),
    },
    {
      label: "退出 DeskPet",
      click: () => {
        preparePetWindowForQuit();
        app.quit();
      },
    },
  ]);
  menu.popup({ window: petWindow });
}

function isFromPetWindow(event: IpcMainEvent): boolean {
  return Boolean(petWindow && !petWindow.isDestroyed() && event.sender === petWindow.webContents);
}

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}
