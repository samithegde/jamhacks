const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain } = require("electron");
const { createWindows, toggleChatWindow, showChatWindow, cleanupWindows, showDashboardWindow, DASHBOARD_ENABLED } = require("./window");
const { registerIpcHandlers } = require("./ipc");
const { restoreWindowsTaskbar } = require("./utils/taskbar");
const { configureCaptureSession } = require("./capture/session");
const { closeMongoConnection } = require("./mongodb/chat-history");

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

  // 16x16 white circle icon (base64 png) as a fallback tray icon.
  const icon = nativeImage
    .createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAUVBMVEUAAAD///////////////////////////////////////////////////////////////+ZmZmampqfn5+YmJihoaGhoaGAgIC+vr6UlJSEhIS7u7u5ubmWlpbDw8PW1tba2tq3t7fGxsaXl5evr6+qqqp6SGXAAAAAAXRSTlMAQObYZgAAAFpJREFUGNNVz1kSgCAIBNCW3f//Z1fR0QzA5hRtnQwA+4KEm9UiEAu1fHTYvM6v3lN0ptYxYWSmpuQkMHSppfowx0lGdU4mS7S2mQ5srbx5Nm0vP1QoUd8KBFWAvwBz7wV3m1XQ8wAAAABJRU5ErkJggg=="
    )
    .resize({ width: 16, height: 16 });

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
  createWindows();
  createTray();

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
  closeMongoConnection().catch(() => {});
});
