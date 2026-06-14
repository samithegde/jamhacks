const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, globalShortcut } = require("electron");
const { createWindows, toggleChatWindow, showChatWindow, cleanupWindows, showDashboardWindow, DASHBOARD_ENABLED } = require("./window");
const { registerIpcHandlers } = require("./ipc");
const { restoreWindowsTaskbar } = require("./utils/taskbar");
const { configureCaptureSession } = require("./capture/session");
const { closeMongoConnection } = require("./mongodb/chat-history");
const { logMoondreamStartupStatus } = require("./localization/moondream-service");

function loadEnvFile() {
  const envPath = path.join(__dirname, "../../.env");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();
registerIpcHandlers(ipcMain);
let tray = null;
let isQuitting = false;

function createTray() {
  if (tray) return tray;

  const iconPath = path.join(__dirname, "../renderer/assets/clarityicon.png");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip("Clarity");

  const menuItems = [];

  if (DASHBOARD_ENABLED) {
    menuItems.push({ label: "Dashboard", click: () => showDashboardWindow() });
  }

  menuItems.push(
    { label: "Toggle Chat", click: () => toggleChatWindow() },
    { label: "Show Chat", click: () => showChatWindow() },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        cleanupWindows();
        app.quit();
      },
    }
  );

  const menu = Menu.buildFromTemplate(menuItems);

  tray.setContextMenu(menu);
  tray.on("double-click", () => toggleChatWindow());
  return tray;
}

app.whenReady().then(async () => {
  app.setAppUserModelId("com.clarity.overlay");
  app.dock?.hide?.();
  configureCaptureSession();
  await restoreWindowsTaskbar();
  await logMoondreamStartupStatus();
  createWindows();
  createTray();

  globalShortcut.register("CommandOrControl+Alt+C", () => toggleChatWindow());

  if (DASHBOARD_ENABLED) {
    showDashboardWindow();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindows();
      createTray();
      if (DASHBOARD_ENABLED) {
        showDashboardWindow();
      }
    }
  });
});

app.on("window-all-closed", (event) => {
  if (!isQuitting) {
    // Tray app: stay alive without taskbar window.
    event.preventDefault();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  cleanupWindows();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  closeMongoConnection().catch(() => {});
});
