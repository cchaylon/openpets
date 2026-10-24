const { contextBridge, ipcRenderer } = require("electron");

let snapshotListenerInstalled = false;

contextBridge.exposeInMainWorld("deskpet", {
  getSnapshot: () => ipcRenderer.invoke("deskpet:get-snapshot"),
  updatePreferences: (patch) => ipcRenderer.invoke("deskpet:update-preferences", patch),
  setDefaultPet: (petId) => ipcRenderer.invoke("deskpet:set-default-pet", petId),
  importPetFolder: () => ipcRenderer.invoke("deskpet:import-pet-folder"),
  importPetZip: () => ipcRenderer.invoke("deskpet:import-pet-zip"),
  removePet: (petId) => ipcRenderer.invoke("deskpet:remove-pet", petId),
  resetPetPosition: () => ipcRenderer.invoke("deskpet:reset-pet-position"),
  onSnapshotChanged: (listener) => {
    if (snapshotListenerInstalled || typeof listener !== "function") {
      return;
    }
    snapshotListenerInstalled = true;
    ipcRenderer.on("deskpet:snapshot-changed", (_event, snapshot) => {
      try {
        listener(snapshot);
      } catch (error) {
        console.error("DeskPet snapshot listener failed.", error);
      }
    });
  },
});
