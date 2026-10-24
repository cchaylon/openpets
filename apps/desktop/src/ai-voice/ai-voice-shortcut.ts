import { UiohookKey, uIOhook } from "uiohook-napi";

import { logError, logInfo } from "../logger.js";

export interface AltHoldCallbacks {
  readonly onPress: () => void;
  readonly onRelease: () => void;
}

let started = false;
let listenerInstalled = false;
let altHeld = false;
let callbacks: AltHoldCallbacks | null = null;

/** Watches the global Alt key so holding it can drive push-to-talk. */
export function startAltHoldShortcut(nextCallbacks: AltHoldCallbacks): void {
  callbacks = nextCallbacks;
  installListeners();
  if (started) {
    return;
  }
  try {
    uIOhook.start();
    started = true;
    logInfo("shortcut", "alt hold listener started");
  } catch (error) {
    logError("shortcut", "alt hold listener failed to start", { error: error instanceof Error ? error.message : String(error) });
  }
}

export function stopAltHoldShortcut(): void {
  callbacks = null;
  altHeld = false;
  if (!started) {
    return;
  }
  try {
    uIOhook.stop();
  } catch {
    // Stopping an already stopped hook is harmless.
  }
  started = false;
  logInfo("shortcut", "alt hold listener stopped");
}

function installListeners(): void {
  if (listenerInstalled) {
    return;
  }
  listenerInstalled = true;
  uIOhook.on("keydown", (event) => {
    if (!callbacks || altHeld || !isAltKey(event.keycode)) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    altHeld = true;
    callbacks.onPress();
  });
  uIOhook.on("keyup", (event) => {
    if (!callbacks || !altHeld || !isAltKey(event.keycode)) {
      return;
    }
    altHeld = false;
    callbacks.onRelease();
  });
}

function isAltKey(keycode: number): boolean {
  return keycode === UiohookKey.Alt || keycode === UiohookKey.AltRight;
}
