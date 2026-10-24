import { Menu, Tray, app } from "electron";

import { createTrayIcon } from "./assets.js";
import { openControlCenter } from "./control-center.js";
import { logInfo } from "./logger.js";
import {
  getCurrentPet,
  isPetWindowVisible,
  preparePetWindowForQuit,
  togglePetWindow,
} from "./pet-window.js";

let tray: Tray | null = null;

export function createAppTray(): Tray {
  if (tray) {
    return tray;
  }
  tray = new Tray(createTrayIcon());
  tray.setToolTip("DeskPet");
  if (process.platform === "darwin") {
    tray.setIgnoreDoubleClickEvents(true);
  }
  refreshTrayMenu();
  logInfo("tray", "tray created");
  return tray;
}

export function refreshTrayMenu(): void {
  if (!tray) {
    return;
  }
  const currentPet = getCurrentPet();
  const visible = isPetWindowVisible();

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "DeskPet", enabled: false },
    {
      label: `当前宠物：${currentPet.displayName}`,
      click: () => openControlCenter(),
    },
    { type: "separator" },
    {
      label: visible ? "隐藏宠物" : "显示宠物",
      click: () => {
        togglePetWindow();
        refreshTrayMenu();
      },
    },
    {
      label: "打开控制中心",
      click: () => openControlCenter(),
    },
    { type: "separator" },
    {
      label: "退出 DeskPet",
      click: () => {
        preparePetWindowForQuit();
        app.quit();
      },
    },
  ]));
}
