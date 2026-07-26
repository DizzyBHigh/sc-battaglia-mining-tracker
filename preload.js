"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  pickLogFile: () => ipcRenderer.invoke("pick-log-file"),
  getDefaultLog: () => ipcRenderer.invoke("get-default-log"),
  getSavedLog: () => ipcRenderer.invoke("get-saved-log"),
  overlayToggle: () => ipcRenderer.invoke("overlay-toggle"),
  overlayShow: () => ipcRenderer.invoke("overlay-show"),
  overlayHide: () => ipcRenderer.invoke("overlay-hide"),
  overlayClickThrough: (enabled) =>
    ipcRenderer.invoke("overlay-click-through", enabled),
  overlayGetClickThrough: () => ipcRenderer.invoke("overlay-get-click-through"),
  overlayIsVisible: () => ipcRenderer.invoke("overlay-is-visible"),
  captureScreen: (options) => ipcRenderer.invoke("capture-screen", options || {}),
});
