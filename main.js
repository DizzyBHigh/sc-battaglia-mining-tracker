"use strict";

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  globalShortcut,
  screen,
  desktopCapturer,
  nativeImage,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { createServer } = require("./server/app");

const PORT = 17845;
let mainWindow = null;
let overlayWindow = null;
let serverHandle = null;
let overlayClickThrough = true;

function defaultLogCandidates() {
  const home = os.homedir();
  const localAppData =
    process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  return [
    process.env.SC_GAME_LOG,
    path.join(localAppData, "StarCitizen", "LIVE", "Game.log"),
    path.join(localAppData, "StarCitizen", "PTU", "Game.log"),
    path.join(localAppData, "StarCitizen", "TECH-PREVIEW", "Game.log"),
    "C:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE\\Game.log",
    "D:\\Roberts Space Industries\\StarCitizen\\LIVE\\Game.log",
    "E:\\Roberts Space Industries\\StarCitizen\\LIVE\\Game.log",
    "E:\\Star Citizen\\LIVE\\Game.log",
  ].filter(Boolean);
}

function findLogPath() {
  for (const c of defaultLogCandidates()) {
    try {
      if (c && fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch (_) {}
  }
  return null;
}

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function loadAppConfig() {
  try {
    const p = configPath();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf8")) || {};
  } catch (_) {
    return {};
  }
}

function saveAppConfig(patch) {
  try {
    const cur = loadAppConfig();
    const next = { ...cur, ...patch };
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), "utf8");
    return next;
  } catch (e) {
    console.error("[config] save failed:", e.message);
    return null;
  }
}

function resolveLogPath() {
  const cfg = loadAppConfig();
  if (cfg.logPath) {
    try {
      if (fs.existsSync(cfg.logPath) && fs.statSync(cfg.logPath).isFile()) {
        return cfg.logPath;
      }
    } catch (_) {}
  }
  return findLogPath();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0d1117",
    title: "SC Battaglia Mining Tracker",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show();
    overlayWindow.setAlwaysOnTop(true, "screen-saver");
    return overlayWindow;
  }

  const display = screen.getPrimaryDisplay();
  const { width, height, x: wx, y: wy } = display.workArea;
  const barW = Math.min(Math.max(720, Math.floor(width * 0.7)), width - 24);
  const barH = 88;
  const barX = wx + Math.floor((width - barW) / 2);
  const barY = wy + height - barH - 16;

  overlayWindow = new BrowserWindow({
    width: barW,
    height: barH,
    x: barX,
    y: barY,
    minWidth: 320,
    minHeight: 56,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    focusable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  setOverlayClickThrough(overlayClickThrough);

  overlayWindow.loadURL(`http://127.0.0.1:${PORT}/overlay.html`);

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });

  return overlayWindow;
}

function toggleOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (overlayWindow.isVisible()) {
      overlayWindow.hide();
      return false;
    }
    overlayWindow.show();
    overlayWindow.setAlwaysOnTop(true, "screen-saver");
    return true;
  }
  createOverlayWindow();
  return true;
}

function setOverlayClickThrough(enabled) {
  overlayClickThrough = !!enabled;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (overlayClickThrough) {
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      overlayWindow.setIgnoreMouseEvents(false);
      overlayWindow.focus();
    }
  }
  return overlayClickThrough;
}

function startBackend() {
  const userData = app.getPath("userData");
  const dataPath = path.join(userData, "missions.json");
  const logPath = resolveLogPath();

  console.log("Data:", dataPath);
  console.log("Log :", logPath || "(not found – pick via UI or set SC_GAME_LOG)");
  console.log("Config:", configPath());

  const { app: expressApp, startWatching } = createServer({
    userDataPath: userData,
    dataPath,
    logPath,
  });

  serverHandle = expressApp.listen(PORT, "127.0.0.1", () => {
    console.log(`API + UI on http://127.0.0.1:${PORT}/`);
  });

  ipcMain.handle("pick-log-file", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select Star Citizen Game.log",
      filters: [
        { name: "Log files", extensions: ["log", "txt"] },
        { name: "All files", extensions: ["*"] },
      ],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const p = result.filePaths[0];
    saveAppConfig({ logPath: p });
    startWatching(p);
    return p;
  });

  ipcMain.handle("get-default-log", () => resolveLogPath());
  ipcMain.handle("get-saved-log", () => {
    const cfg = loadAppConfig();
    return cfg.logPath || resolveLogPath();
  });
  ipcMain.handle("overlay-toggle", () => toggleOverlay());
  ipcMain.handle("overlay-show", () => {
    createOverlayWindow();
    return true;
  });
  ipcMain.handle("overlay-hide", () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
    return false;
  });
  ipcMain.handle("overlay-click-through", (_e, enabled) =>
    setOverlayClickThrough(enabled)
  );
  ipcMain.handle("overlay-get-click-through", () => overlayClickThrough);

  ipcMain.handle("overlay-is-visible", () =>
    !!(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible())
  );

  /**
   * Capture screen as PNG data URL for OCR.
   * Always takes a fresh thumbnail; hides overlay during capture.
   */
  ipcMain.handle("capture-screen", async (_e, options = {}) => {
    const maxWidth = options.maxWidth || 1920;
    const maxHeight = options.maxHeight || 1080;

    let overlayWasVisible = false;
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
      overlayWasVisible = true;
      overlayWindow.hide();
      await new Promise((r) => setTimeout(r, 120));
    }

    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: maxWidth, height: maxHeight },
        fetchWindowIcons: false,
      });
      if (!sources.length) {
        throw new Error("No screen sources available");
      }
      let source = sources[0];
      const primary = screen.getPrimaryDisplay();
      const match = sources.find(
        (s) =>
          s.display_id &&
          String(s.display_id) === String(primary.id)
      );
      if (match) source = match;
      if (options.displayId) {
        const byId = sources.find(
          (s) => String(s.display_id) === String(options.displayId)
        );
        if (byId) source = byId;
      }
      const img = source.thumbnail;
      if (!img || img.isEmpty()) {
        throw new Error("Empty screen thumbnail – try increasing capture size");
      }
      let out = img;
      if (options.crop && options.crop.width > 0) {
        const size = img.getSize();
        const c = options.crop;
        const x = Math.max(0, Math.floor((c.x || 0) * size.width));
        const y = Math.max(0, Math.floor((c.y || 0) * size.height));
        const w = Math.min(size.width - x, Math.floor((c.width || 1) * size.width));
        const h = Math.min(size.height - y, Math.floor((c.height || 1) * size.height));
        if (w > 10 && h > 10) {
          out = img.crop({ x, y, width: w, height: h });
        }
      }
      return {
        dataUrl: out.toDataURL(),
        width: out.getSize().width,
        height: out.getSize().height,
        sourceName: source.name,
        capturedAt: Date.now(),
      };
    } finally {
      if (overlayWasVisible && overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.showInactive();
      }
    }
  });
}

app.whenReady().then(() => {
  startBackend();
  createMainWindow();

  try {
    globalShortcut.register("CommandOrControl+Shift+O", () => {
      const vis = toggleOverlay();
      console.log("[overlay]", vis ? "shown" : "hidden");
    });
    globalShortcut.register("CommandOrControl+Shift+P", () => {
      const next = !overlayClickThrough;
      setOverlayClickThrough(next);
      console.log("[overlay] click-through:", next);
    });
  } catch (e) {
    console.warn("globalShortcut failed:", e.message);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (serverHandle) {
    try {
      serverHandle.close();
    } catch (_) {}
  }
  if (process.platform !== "darwin") app.quit();
});
