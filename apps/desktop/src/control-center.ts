import { join } from "node:path";

import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
} from "electron";

import {
  getAppState,
  resetPetPosition,
  setDefaultPetId,
  setInstalledPets,
  subscribeAppState,
  updatePreferences,
  type InstalledPetRecord,
} from "./app-state.js";
import { getAiVoiceDeviceId } from "./ai-voice/index.js";
import { builtInPet, petSpriteUrl } from "./built-in-pet.js";
import { logError, logInfo } from "./logger.js";
import {
  installPetFromDirectory,
  installPetFromZip,
  listInstalledPets,
  removeInstalledPet,
} from "./pet-install.js";
import { applyPetWindowPreferences, isPetWindowVisible, refreshPetWindow, resetPetWindowPosition } from "./pet-window.js";
import {
  BUILT_IN_PET_ID,
  type ControlCenterSnapshot,
  type ImportPetResult,
  type PreferencePatch,
  type PetSummary,
} from "./shared-types.js";

let controlCenter: BrowserWindow | null = null;
let ipcRegistered = false;

export function openControlCenter(): void {
  if (controlCenter && !controlCenter.isDestroyed()) {
    if (controlCenter.isMinimized()) {
      controlCenter.restore();
    }
    controlCenter.show();
    controlCenter.focus();
    return;
  }

  controlCenter = new BrowserWindow({
    title: "DeskPet 控制中心",
    width: 1040,
    height: 720,
    minWidth: 900,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f6f8fc",
    icon: join(app.getAppPath(), "assets", "app-icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: join(app.getAppPath(), "control-center-preload.cjs"),
    },
  });

  controlCenter.setMenuBarVisibility(false);
  controlCenter.once("ready-to-show", () => controlCenter?.show());
  controlCenter.on("closed", () => {
    controlCenter = null;
  });

  const devUrl = process.env.DESKPET_RENDERER_URL;
  const load = devUrl
    ? controlCenter.loadURL(devUrl)
    : controlCenter.loadFile(join(app.getAppPath(), "dist", "renderer", "index.html"));
  load.catch((error: unknown) => {
    logError("control-center", "window load failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  logInfo("control-center", "window opened", { devUrl: devUrl ?? null });
}

export function buildSnapshot(): ControlCenterSnapshot {
  const state = getAppState();
  const pets: PetSummary[] = [
    builtInPet,
    ...state.installedPets.map((pet) => toPetSummary(pet)),
  ];
  return {
    appVersion: app.getVersion(),
    preferences: state.preferences,
    pets,
    currentPetId: state.preferences.defaultPetId,
    petVisible: isPetWindowVisible(),
    aiVoiceDeviceId: getAiVoiceDeviceId(),
  };
}

export function broadcastSnapshot(): void {
  if (!controlCenter || controlCenter.isDestroyed()) {
    return;
  }
  controlCenter.webContents.send("deskpet:snapshot-changed", buildSnapshot());
}

export function registerControlCenterIpc(): void {
  if (ipcRegistered) {
    return;
  }
  ipcRegistered = true;

  subscribeAppState(() => broadcastSnapshot());

  ipcMain.handle("deskpet:get-snapshot", (event) => {
    ensureTrustedSender(event);
    return buildSnapshot();
  });

  ipcMain.handle("deskpet:update-preferences", (event, patch: unknown) => {
    ensureTrustedSender(event);
    const before = getAppState().preferences;
    const sanitized = sanitizePreferencePatch(patch);
    const next = updatePreferences(sanitized);

    if (next.petScale !== before.petScale) {
      refreshPetWindow();
    } else if (next.alwaysOnTop !== before.alwaysOnTop) {
      applyPetWindowPreferences();
    }
    if (next.launchAtLogin !== before.launchAtLogin) {
      applyLoginItemSetting(next.launchAtLogin);
    }

    return buildSnapshot();
  });

  ipcMain.handle("deskpet:set-default-pet", (event, petId: unknown) => {
    ensureTrustedSender(event);
    if (typeof petId !== "string" || !isKnownPetId(petId)) {
      throw new Error("未知的宠物。");
    }
    setDefaultPetId(petId);
    refreshPetWindow();
    return buildSnapshot();
  });

  ipcMain.handle("deskpet:import-pet-folder", async (event): Promise<ImportPetResult> => {
    ensureTrustedSender(event);
    const selection = await showOpenDialog({
      title: "选择宠物文件夹",
      buttonLabel: "导入",
      properties: ["openDirectory"],
    });
    if (selection.canceled || !selection.filePaths[0]) {
      return { ok: false, message: "已取消导入。" };
    }
    try {
      const record = await installPetFromDirectory(selection.filePaths[0]);
      rememberInstalledPet(record);
      return { ok: true, message: `已导入宠物：${record.displayName}` };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  });

  ipcMain.handle("deskpet:import-pet-zip", async (event): Promise<ImportPetResult> => {
    ensureTrustedSender(event);
    const selection = await showOpenDialog({
      title: "选择宠物 ZIP",
      buttonLabel: "导入",
      properties: ["openFile"],
      filters: [{ name: "宠物包", extensions: ["zip"] }],
    });
    if (selection.canceled || !selection.filePaths[0]) {
      return { ok: false, message: "已取消导入。" };
    }
    try {
      const record = await installPetFromZip(selection.filePaths[0]);
      rememberInstalledPet(record);
      return { ok: true, message: `已导入宠物：${record.displayName}` };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  });

  ipcMain.handle("deskpet:remove-pet", async (event, petId: unknown) => {
    ensureTrustedSender(event);
    if (typeof petId !== "string" || petId === BUILT_IN_PET_ID) {
      throw new Error("内置宠物不能删除。");
    }
    const state = getAppState();
    if (!state.installedPets.some((pet) => pet.id === petId)) {
      throw new Error("未找到该宠物。");
    }
    await removeInstalledPet(petId);
    setInstalledPets(state.installedPets.filter((pet) => pet.id !== petId));
    refreshPetWindow();
    return buildSnapshot();
  });

  ipcMain.handle("deskpet:reset-pet-position", (event) => {
    ensureTrustedSender(event);
    resetPetPosition();
    resetPetWindowPosition();
    return buildSnapshot();
  });
}

export async function reconcileInstalledPets(): Promise<void> {
  setInstalledPets(await listInstalledPets());
}

function toPetSummary(record: InstalledPetRecord): PetSummary {
  return {
    id: record.id,
    displayName: record.displayName,
    description: record.description,
    builtIn: false,
    spriteVersion: record.spriteVersion,
    spriteUrl: petSpriteUrl(record.id),
  };
}

function rememberInstalledPet(record: InstalledPetRecord): void {
  const current = getAppState().installedPets.filter((pet) => pet.id !== record.id);
  setInstalledPets([...current, record]);
}

function isKnownPetId(petId: string): boolean {
  return petId === BUILT_IN_PET_ID || getAppState().installedPets.some((pet) => pet.id === petId);
}

function sanitizePreferencePatch(value: unknown): PreferencePatch {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
    ...(Object.hasOwn(record, "petScale") ? { petScale: record.petScale } : {}),
    ...(Object.hasOwn(record, "showOnLaunch") ? { showOnLaunch: record.showOnLaunch } : {}),
    ...(Object.hasOwn(record, "launchAtLogin") ? { launchAtLogin: record.launchAtLogin } : {}),
    ...(Object.hasOwn(record, "alwaysOnTop") ? { alwaysOnTop: record.alwaysOnTop } : {}),
    ...(Object.hasOwn(record, "aiVoice") ? { aiVoice: sanitizeAiVoicePatch(record.aiVoice) } : {}),
  };
}

function sanitizeAiVoicePatch(value: unknown): { enabled?: unknown; otaUrl?: unknown } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
    ...(Object.hasOwn(record, "enabled") ? { enabled: record.enabled } : {}),
    ...(Object.hasOwn(record, "otaUrl") ? { otaUrl: record.otaUrl } : {}),
  };
}

function showOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  return controlCenter
    ? dialog.showOpenDialog(controlCenter, options)
    : dialog.showOpenDialog(options);
}

function applyLoginItemSetting(openAtLogin: boolean): void {
  try {
    app.setLoginItemSettings({ openAtLogin });
  } catch (error) {
    logError("app", "login item setting failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function ensureTrustedSender(event: IpcMainInvokeEvent): void {
  if (!controlCenter || controlCenter.isDestroyed() || event.sender !== controlCenter.webContents) {
    throw new Error("未授权的请求来源。");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
