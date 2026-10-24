import { app } from "electron";

import { getAppState, initAppState } from "./app-state.js";
import {
  broadcastSnapshot,
  openControlCenter,
  reconcileInstalledPets,
  registerControlCenterIpc,
} from "./control-center.js";
import { logError, logInfo, initLogger } from "./logger.js";
import { registerPetAssetProtocol, registerPetAssetScheme } from "./pet-asset-protocol.js";
import {
  configurePetWindow,
  createPetWindow,
  isPetWindowVisible,
  preparePetWindowForQuit,
  showPetWindow,
} from "./pet-window.js";
import { createAppTray, refreshTrayMenu } from "./tray.js";
import {
  closeAiVoiceChat,
  configureAiVoice,
  handleAiVoiceMicChunk,
  handleAiVoiceMicEnded,
  handleAiVoiceMicError,
  handleAiVoiceWindowVisibilityChange,
  republishAiVoiceView,
  sendAiVoiceChatText,
  shutdownAiVoice,
  toggleAiVoiceChat,
} from "./ai-voice/index.js";

app.setName("DeskPet");
registerPetAssetScheme();

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (app.isReady()) {
      openControlCenter();
    }
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
  });

  app.whenReady().then(async () => {
    if (process.platform === "win32") {
      app.setAppUserModelId("dev.deskpet.app");
    }

    initLogger(app.getPath("userData"));
    logInfo("app", "starting", {
      version: app.getVersion(),
      platform: process.platform,
    });

    initAppState();
    await reconcileInstalledPets();

    registerPetAssetProtocol();
    registerControlCenterIpc();
    configurePetWindow({
      onVisibilityChanged: () => {
        refreshTrayMenu();
        broadcastSnapshot();
        handleAiVoiceWindowVisibilityChange(isPetWindowVisible());
      },
      onOpenControlCenter: openControlCenter,
      onChatToggle: toggleAiVoiceChat,
      onChatSend: sendAiVoiceChatText,
      onChatClose: closeAiVoiceChat,
      onMicChunk: handleAiVoiceMicChunk,
      onMicEnded: handleAiVoiceMicEnded,
      onMicError: handleAiVoiceMicError,
      onContentLoaded: republishAiVoiceView,
    });
    createAppTray();
    createPetWindow();
    configureAiVoice();

    const preferences = getAppState().preferences;
    if (preferences.showOnLaunch) {
      showPetWindow();
    }
    try {
      app.setLoginItemSettings({ openAtLogin: preferences.launchAtLogin });
    } catch (error) {
      logError("app", "login item initialization failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (process.platform === "darwin") {
      app.dock?.hide();
    }

    logInfo("app", "ready", {
      defaultPetId: preferences.defaultPetId,
      petScale: preferences.petScale,
      showOnLaunch: preferences.showOnLaunch,
    });
  }).catch((error: unknown) => {
    logError("app", "startup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    app.quit();
  });

  app.on("before-quit", () => {
    shutdownAiVoice();
    preparePetWindowForQuit();
  });

  app.on("window-all-closed", () => {
    // DeskPet is a tray-first app: closing windows must not quit it.
  });

  app.on("activate", () => {
    if (app.isReady()) {
      openControlCenter();
    }
  });
}
