// Electron main process for VPR Chat desktop wrapper.
// - Loads the live published web app (always latest deploy)
// - Manual updates via a custom JSON manifest hosted on Lovable Cloud
// - Auto-starts on system boot (configurable)
// - Frameless window, encrypted Remember Me credentials, screen-share picker
const {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  nativeImage,
  safeStorage,
  desktopCapturer,
  session,
} = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const { spawn } = require("child_process");
const crypto = require("crypto");
const os = require("os");

const APP_URL = "https://vprchat.lovable.app";
const CREDS_FILE = path.join(app.getPath("userData"), "vpr-remember.bin");

// --- Manual Updater (custom JSON manifest on Lovable Cloud) ---------------
// Flow:
//   1. Renderer calls vpr:updater-check → main fetches MANIFEST_URL.
//   2. If manifest.version > app.getVersion(), state becomes "available".
//   3. Renderer calls vpr:updater-download → we stream the .exe to a temp
//      file, emitting progress events. On completion, optionally verify
//      sha256, then state becomes "downloaded".
//   4. Renderer calls vpr:updater-install → we spawn the installer detached
//      and quit the app. The NSIS installer overwrites the old files and
//      relaunches VPR Chat on success.
const MANIFEST_URL =
  "https://qwgurzgtmrgzpywpugbb.supabase.co/storage/v1/object/public/desktop-updates/latest.json";

let _updaterState = {
  status: "idle", // idle | checking | not-available | available | downloading | downloaded | error
  error: null,
  version: app.getVersion(),
  newVersion: null,
  downloadUrl: null,
  sha256: null,
  progress: 0, // 0..1
  downloadedPath: null,
};

function broadcastUpdater() {
  try {
    BrowserWindow.getAllWindows().forEach((w) => {
      w.webContents.send("vpr:updater-state", _updaterState);
    });
  } catch { /* noop */ }
}

function setStatus(patch) {
  _updaterState = { ..._updaterState, ...patch };
  broadcastUpdater();
}

// Compare semver-ish strings: "1.2.10" > "1.2.9".
function isNewer(remote, local) {
  if (!remote || !local) return false;
  const a = String(remote).split(".").map((n) => parseInt(n, 10) || 0);
  const b = String(local).split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "cache-control": "no-cache" } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          httpsGetJson(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Manifest fetch failed (${res.statusCode})`));
          res.resume();
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error("Manifest is not valid JSON"));
          }
        });
      })
      .on("error", reject);
  });
}

function downloadToFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const doRequest = (currentUrl) => {
      https
        .get(currentUrl, (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            doRequest(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed (${res.statusCode})`));
            res.resume();
            return;
          }
          const total = parseInt(res.headers["content-length"] || "0", 10);
          let received = 0;
          const file = fs.createWriteStream(destPath);
          const hash = crypto.createHash("sha256");
          res.on("data", (chunk) => {
            received += chunk.length;
            hash.update(chunk);
            if (total > 0) onProgress(received / total);
          });
          res.pipe(file);
          file.on("finish", () => {
            file.close(() => resolve({ sha256: hash.digest("hex"), bytes: received }));
          });
          file.on("error", (err) => {
            try { fs.unlinkSync(destPath); } catch { /* noop */ }
            reject(err);
          });
        })
        .on("error", reject);
    };
    doRequest(url);
  });
}

// --- Autostart on login ---------------------------------------------------
function setAutoLaunch(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: false,
    path: process.execPath,
  });
}
if (!app.getLoginItemSettings().openAtLogin) {
  setAutoLaunch(true);
}

// --- Single instance lock -------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;

// --- Screen-share picker bridge -------------------------------------------
let _pendingSelectedSourceId = null;

ipcMain.handle("vpr:get-screen-sources", async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 200 },
      fetchWindowIcons: true,
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith("screen:") ? "screen" : "window",
      thumbnailDataUrl: s.thumbnail?.toDataURL?.() || null,
      appIconDataUrl: s.appIcon?.toDataURL?.() || null,
      displayId: s.display_id || null,
    }));
  } catch (err) {
    console.error("[screen-share] getSources failed", err);
    return [];
  }
});

ipcMain.handle("vpr:set-screen-source", (_e, sourceId) => {
  _pendingSelectedSourceId = typeof sourceId === "string" ? sourceId : null;
  return true;
});

function registerDisplayMediaHandler(targetSession) {
  try {
    targetSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 1, height: 1 },
        });
        let chosen = null;
        if (_pendingSelectedSourceId) {
          chosen = sources.find((s) => s.id === _pendingSelectedSourceId) || null;
        }
        if (!chosen) chosen = sources.find((s) => s.id.startsWith("screen:")) || sources[0] || null;
        _pendingSelectedSourceId = null;
        if (!chosen) {
          callback({});
          return;
        }
        callback({ video: chosen, audio: "loopback" });
      } catch (err) {
        console.error("[screen-share] handler failed", err);
        callback({});
      }
    }, { useSystemPicker: false });
  } catch (err) {
    console.warn("[screen-share] setDisplayMediaRequestHandler unavailable:", err?.message || err);
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, "..", "build", "icon.png");
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    title: "VPR Chat",
    icon,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#0A0E14",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  registerDisplayMediaHandler(mainWindow.webContents.session);

  mainWindow.loadURL(APP_URL);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  const sendState = () => {
    if (!mainWindow) return;
    mainWindow.webContents.send("vpr:window-state", {
      maximized: mainWindow.isMaximized(),
    });
  };
  mainWindow.on("maximize", sendState);
  mainWindow.on("unmaximize", sendState);
}

// --- IPC: window controls -------------------------------------------------
ipcMain.handle("vpr:minimize", () => mainWindow?.minimize());
ipcMain.handle("vpr:maximize-toggle", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle("vpr:close", () => mainWindow?.close());
ipcMain.handle("vpr:is-maximized", () => !!mainWindow?.isMaximized());

// --- IPC: autostart toggle ------------------------------------------------
ipcMain.handle("vpr:get-autostart", () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle("vpr:set-autostart", (_e, enabled) => {
  setAutoLaunch(!!enabled);
  return app.getLoginItemSettings().openAtLogin;
});

// --- IPC: Remember Me credentials (encrypted on disk) ---------------------
ipcMain.handle("vpr:save-credentials", (_e, payload) => {
  try {
    const json = JSON.stringify(payload || {});
    if (safeStorage.isEncryptionAvailable()) {
      const enc = safeStorage.encryptString(json);
      fs.writeFileSync(CREDS_FILE, enc);
    } else {
      fs.writeFileSync(CREDS_FILE, Buffer.from(json, "utf8").toString("base64"));
    }
    return true;
  } catch (err) {
    console.error("[creds] save failed", err);
    return false;
  }
});
ipcMain.handle("vpr:load-credentials", () => {
  try {
    if (!fs.existsSync(CREDS_FILE)) return null;
    const buf = fs.readFileSync(CREDS_FILE);
    if (safeStorage.isEncryptionAvailable()) {
      return JSON.parse(safeStorage.decryptString(buf));
    }
    return JSON.parse(Buffer.from(buf.toString("utf8"), "base64").toString("utf8"));
  } catch (err) {
    console.error("[creds] load failed", err);
    return null;
  }
});
ipcMain.handle("vpr:clear-credentials", () => {
  try {
    if (fs.existsSync(CREDS_FILE)) fs.unlinkSync(CREDS_FILE);
    return true;
  } catch {
    return false;
  }
});

// --- IPC: Manual updater --------------------------------------------------
ipcMain.handle("vpr:updater-get-state", () => _updaterState);

ipcMain.handle("vpr:updater-check", async () => {
  setStatus({ status: "checking", error: null, progress: 0 });
  try {
    const manifest = await httpsGetJson(MANIFEST_URL);
    const remoteVersion = String(manifest.version || "").trim();
    const url = String(manifest.url || "").trim();
    const sha = manifest.sha256 ? String(manifest.sha256).toLowerCase() : null;

    if (!remoteVersion || !url) {
      setStatus({ status: "error", error: "Manifest is missing version or url" });
      return _updaterState;
    }
    if (!isNewer(remoteVersion, app.getVersion())) {
      setStatus({
        status: "not-available",
        newVersion: null,
        downloadUrl: null,
        sha256: null,
      });
      return _updaterState;
    }
    setStatus({
      status: "available",
      newVersion: remoteVersion,
      downloadUrl: url,
      sha256: sha,
      error: null,
    });
  } catch (err) {
    setStatus({ status: "error", error: String(err?.message || err) });
  }
  return _updaterState;
});

ipcMain.handle("vpr:updater-download", async () => {
  if (!_updaterState.downloadUrl) {
    setStatus({ status: "error", error: "No download URL — check for updates first." });
    return _updaterState;
  }
  if (process.platform !== "win32") {
    setStatus({
      status: "error",
      error: "Auto-install is only supported on Windows. Please download the latest version manually.",
    });
    return _updaterState;
  }
  setStatus({ status: "downloading", progress: 0, error: null });
  try {
    const fileName = `VPR-Chat-Setup-${_updaterState.newVersion || "latest"}.exe`;
    const destPath = path.join(os.tmpdir(), fileName);
    // Clean any stale copy
    try { fs.unlinkSync(destPath); } catch { /* noop */ }

    const { sha256 } = await downloadToFile(
      _updaterState.downloadUrl,
      destPath,
      (p) => setStatus({ progress: Math.min(0.999, p) })
    );

    if (_updaterState.sha256 && sha256 !== _updaterState.sha256) {
      try { fs.unlinkSync(destPath); } catch { /* noop */ }
      setStatus({
        status: "error",
        error: "Downloaded file failed integrity check (sha256 mismatch).",
      });
      return _updaterState;
    }

    setStatus({ status: "downloaded", progress: 1, downloadedPath: destPath });
  } catch (err) {
    setStatus({ status: "error", error: String(err?.message || err) });
  }
  return _updaterState;
});

ipcMain.handle("vpr:updater-install", () => {
  if (_updaterState.status !== "downloaded" || !_updaterState.downloadedPath) return false;
  try {
    // Spawn installer detached so it survives our quit.
    // NSIS silent flag /S keeps UI minimal; remove to show installer wizard.
    const child = spawn(_updaterState.downloadedPath, ["/S"], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.unref();
    setTimeout(() => app.quit(), 250);
    return true;
  } catch (err) {
    console.error("[updater] install failed:", err);
    setStatus({ status: "error", error: String(err?.message || err) });
    return false;
  }
});

ipcMain.handle("vpr:get-app-version", () => app.getVersion());

// --- App lifecycle --------------------------------------------------------
app.whenReady().then(() => {
  registerDisplayMediaHandler(session.defaultSession);
  createWindow();
});

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
