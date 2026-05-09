const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
/** @type {AbortController | null} */
let streamAbort = null;

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function chatsPath() {
  return path.join(app.getPath("userData"), "chats.json");
}

function genId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

async function readSettings() {
  try {
    const raw = await fs.readFile(settingsPath(), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeSettings(data) {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(data, null, 2), "utf8");
}

async function readChats() {
  try {
    const raw = await fs.readFile(chatsPath(), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeChats(data) {
  await fs.mkdir(path.dirname(chatsPath()), { recursive: true });
  await fs.writeFile(chatsPath(), JSON.stringify(data, null, 2), "utf8");
}

function themeBackgroundHex(theme) {
  return theme === "dark" ? "#000000" : "#ffffff";
}

function applyWindowThemeBackground(theme) {
  const hex = themeBackgroundHex(theme);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(hex);
  }
}

function resolveWindowIcon() {
  if (app.isPackaged) return undefined;
  const p = path.join(__dirname, "..", "build", "icon.png");
  return fsSync.existsSync(p) ? p : undefined;
}

async function createWindow() {
  const startupSettings = await readSettings();
  const backgroundColor = themeBackgroundHex(startupSettings.theme === "dark" ? "dark" : "light");

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor,
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  const distHtml = path.join(__dirname, "..", "dist", "index.html");
  const useVite = !app.isPackaged && process.env.ELECTRON_DEV === "1";
  if (useVite) {
    mainWindow.loadURL("http://127.0.0.1:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(distHtml);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

ipcMain.handle("settings:get", async () => readSettings());

ipcMain.handle("settings:set", async (_e, partial) => {
  const cur = await readSettings();
  const next = { ...cur, ...partial };
  await writeSettings(next);
  if (Object.prototype.hasOwnProperty.call(partial, "theme")) {
    applyWindowThemeBackground(partial.theme === "dark" ? "dark" : "light");
  }
  return next;
});

ipcMain.handle("window:setThemeBackground", async (_e, theme) => {
  applyWindowThemeBackground(theme === "dark" ? "dark" : "light");
  return true;
});

ipcMain.handle("chats:get", async () => {
  const data = await readChats();
  if (!data || !Array.isArray(data.sessions) || data.sessions.length === 0) {
    const id = genId();
    return {
      version: 1,
      sessions: [{ id, title: "新对话", messages: [], updatedAt: Date.now() }],
      activeSessionId: id,
    };
  }
  return data;
});

ipcMain.handle("chats:set", async (_e, payload) => {
  await writeChats(payload);
  return true;
});

ipcMain.handle("chat:abort", async () => {
  streamAbort?.abort();
  streamAbort = null;
  return true;
});

ipcMain.handle("chat:start", async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, error: "no-window" };

  streamAbort?.abort();
  streamAbort = new AbortController();
  const signal = streamAbort.signal;

  const { url, headers, body } = payload;

  void (async () => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        win.webContents.send("chat:error", {
          message: `HTTP ${res.status}: ${errText.slice(0, 2000)}`,
        });
        return;
      }

      if (!res.body) {
        win.webContents.send("chat:error", { message: "Empty response body" });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let carry = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        carry += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = carry.indexOf("\n")) >= 0) {
          const line = carry.slice(0, idx).trimEnd();
          carry = carry.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trimStart();
          if (data === "[DONE]") {
            win.webContents.send("chat:done", {});
            return;
          }
          try {
            const json = JSON.parse(data);
            const choice = json.choices?.[0];
            const delta = choice?.delta;
            const content = delta?.content;
            if (typeof content === "string" && content.length) {
              win.webContents.send("chat:chunk", { text: content });
            }
            const reasoning = delta?.reasoning_content;
            if (typeof reasoning === "string" && reasoning.length) {
              win.webContents.send("chat:reasoning", { text: reasoning });
            }
          } catch {
            /* ignore malformed sse json */
          }
        }
      }

      win.webContents.send("chat:done", {});
    } catch (e) {
      if (signal.aborted || e?.name === "AbortError") {
        win.webContents.send("chat:aborted", {});
      } else {
        win.webContents.send("chat:error", {
          message: e?.message ? String(e.message) : String(e),
        });
      }
    }
  })();

  return { ok: true };
});

app.whenReady().then(async () => {
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
