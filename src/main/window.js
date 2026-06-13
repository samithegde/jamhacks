const { BrowserWindow, screen } = require("electron");
const path = require("path");
const { getWorkAreaBounds } = require("./utils/display");

const CHAT_WIDTH = 420;
const CHAT_HEIGHT = 650;
const CHAT_MARGIN = 24;
const MINI_CHAT_SIZE = 56;
const MINI_CHAT_MARGIN = 24;
const DASHBOARD_ENABLED = true;

let overlayWindows = [];
let chatWindow = null;
let miniChatWindow = null;
let dashboardWindow = null;

function getOverlayWindows() {
  return overlayWindows.filter((win) => win && !win.isDestroyed());
}

function keepWindowOffTaskbar(window) {
  if (!window || window.isDestroyed()) return;
  window.setSkipTaskbar(true);
}

function getChatBounds() {
  const workArea = getWorkAreaBounds();
  return {
    x: workArea.x + workArea.width - CHAT_WIDTH - CHAT_MARGIN,
    y: workArea.y + workArea.height - CHAT_HEIGHT - CHAT_MARGIN,
    width: CHAT_WIDTH,
    height: CHAT_HEIGHT,
  };
}

function getMiniChatBounds() {
  const workArea = getWorkAreaBounds();
  return {
    x: workArea.x + workArea.width - MINI_CHAT_SIZE - MINI_CHAT_MARGIN,
    y: workArea.y + workArea.height - MINI_CHAT_SIZE - MINI_CHAT_MARGIN,
    width: MINI_CHAT_SIZE,
    height: MINI_CHAT_SIZE,
  };
}

function createOverlayWindowForDisplay(display) {
  const overlayWin = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    enableLargerThanScreen: true,
    hasShadow: false,
    focusable: false,
    movable: false,
    resizable: false,
    autoHideMenuBar: true,
    backgroundColor: "#00000000",
    ...(process.platform === "win32" ? { type: "toolbar", thickFrame: false } : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  keepWindowOffTaskbar(overlayWin);
  overlayWin.setAlwaysOnTop(true, "screen-saver");
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.loadFile(path.join(__dirname, "../renderer/overlay/index.html"));

  overlayWin.displayId = display.id;
  overlayWin.displayBounds = { ...display.bounds };

  overlayWin.once("ready-to-show", () => {
    overlayWin.showInactive();
  });

  return overlayWin;
}

function createOverlayWindows() {
  const displays = screen.getAllDisplays();
  overlayWindows = displays.map(createOverlayWindowForDisplay);
  return overlayWindows;
}

function closeOverlayWindows() {
  for (const win of overlayWindows) {
    if (win && !win.isDestroyed()) {
      win.close();
    }
  }
  overlayWindows = [];
}

function rebuildOverlayWindows() {
  closeOverlayWindows();
  createOverlayWindows();
}

function createChatWindow() {
  const chatBounds = getChatBounds();
  chatWindow = new BrowserWindow({
    ...chatBounds,
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    focusable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    ...(process.platform === "win32" ? { thickFrame: false, roundedCorners: true } : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  chatWindow.setMenu(null);
  chatWindow.setAlwaysOnTop(true, "screen-saver", 1);
  chatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  keepWindowOffTaskbar(chatWindow);
  chatWindow.loadFile(path.join(__dirname, "../renderer/pages/chat.html"));

  chatWindow.once("ready-to-show", () => {
    chatWindow.show();
    keepWindowOffTaskbar(chatWindow);
  });

  chatWindow.on("focus", () => keepWindowOffTaskbar(chatWindow));
  chatWindow.on("closed", () => {
    chatWindow = null;
  });

  return chatWindow;
}

function getChatWindow() {
  return chatWindow && !chatWindow.isDestroyed() ? chatWindow : null;
}

function getMiniChatWindow() {
  return miniChatWindow && !miniChatWindow.isDestroyed() ? miniChatWindow : null;
}

function createMiniChatWindow() {
  const miniBounds = getMiniChatBounds();
  miniChatWindow = new BrowserWindow({
    ...miniBounds,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    autoHideMenuBar: true,
    backgroundColor: "#00000000",
    ...(process.platform === "win32" ? { thickFrame: false } : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  miniChatWindow.setMenu(null);
  miniChatWindow.setAlwaysOnTop(true, "screen-saver", 2);
  miniChatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  keepWindowOffTaskbar(miniChatWindow);
  miniChatWindow.loadFile(path.join(__dirname, "../renderer/pages/minichat.html"));

  miniChatWindow.once("ready-to-show", () => {
    keepWindowOffTaskbar(miniChatWindow);
  });

  miniChatWindow.on("focus", () => keepWindowOffTaskbar(miniChatWindow));
  miniChatWindow.on("closed", () => {
    miniChatWindow = null;
  });

  return miniChatWindow;
}

function repositionMiniChatWindow() {
  const win = getMiniChatWindow();
  if (!win) return;
  win.setBounds(getMiniChatBounds());
}

function showMiniChatWindow() {
  const win = getMiniChatWindow() ?? createMiniChatWindow();
  repositionMiniChatWindow();
  win.showInactive();
  keepWindowOffTaskbar(win);
  return win;
}

function hideMiniChatWindow() {
  const win = getMiniChatWindow();
  if (!win) return;
  win.hide();
}

function showChatWindow() {
  hideMiniChatWindow();
  const win = getChatWindow() ?? createChatWindow();
  win.show();
  win.focus();
  keepWindowOffTaskbar(win);
  return win;
}

function hideChatWindow() {
  const win = getChatWindow();
  if (win) {
    win.hide();
  }
  hideMiniChatWindow();
}

function minimizeChatWindow() {
  const win = getChatWindow();
  if (win) {
    win.hide();
  }
  showMiniChatWindow();
}

function restoreChatWindow() {
  showChatWindow();
}

function toggleChatWindow() {
  const win = getChatWindow() ?? createChatWindow();
  const miniWin = getMiniChatWindow();

  if (win.isVisible()) {
    minimizeChatWindow();
    return;
  }

  if (miniWin?.isVisible()) {
    restoreChatWindow();
    return;
  }

  showChatWindow();
}

function createDashboardWindow() {
  if (!DASHBOARD_ENABLED) return null;

  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.focus();
    return dashboardWindow;
  }

  dashboardWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    frame: true,
    resizable: true,
    focusable: true,
    alwaysOnTop: false,
    fullscreen: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  dashboardWindow.setMenu(null);
  dashboardWindow.loadFile(path.join(__dirname, "../renderer/pages/dashboard.html"));

  dashboardWindow.once("ready-to-show", () => {
    dashboardWindow.show();
  });

  dashboardWindow.on("closed", () => {
    dashboardWindow = null;
  });

  return dashboardWindow;
}

function getDashboardWindow() {
  return dashboardWindow && !dashboardWindow.isDestroyed() ? dashboardWindow : null;
}

function showDashboardWindow() {
  if (!DASHBOARD_ENABLED) return null;

  const win = getDashboardWindow() ?? createDashboardWindow();
  if (!win) return null;
  win.show();
  win.focus();
  return win;
}

function hideDashboardWindow() {
  const win = getDashboardWindow();
  if (!win) return;
  win.hide();
}

function closeDashboardWindow() {
  const win = getDashboardWindow();
  if (!win) return;
  win.close();
}

function sendToRenderer(channel, payload) {
  for (const win of getOverlayWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

function findDisplayForPoint(x, y) {
  return screen.getAllDisplays().find((display) => {
    const bounds = display.bounds;
    return (
      x >= bounds.x &&
      x < bounds.x + bounds.width &&
      y >= bounds.y &&
      y < bounds.y + bounds.height
    );
  });
}

function getOverlayForDisplay(displayId) {
  return getOverlayWindows().find((win) => win.displayId === displayId);
}

function toDisplayLocalCoords(bounds, payload) {
  const local = { ...payload };
  if (Number.isFinite(local.x)) local.x -= bounds.x;
  if (Number.isFinite(local.y)) local.y -= bounds.y;
  return local;
}

function sendOverlayPointAction(channel, payload = {}) {
  const x = Number(payload.x);
  const y = Number(payload.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    sendToRenderer(channel, payload);
    return;
  }

  const display = findDisplayForPoint(x, y) ?? screen.getPrimaryDisplay();
  const overlay = getOverlayForDisplay(display.id);
  if (!overlay || overlay.isDestroyed()) return;

  overlay.webContents.send(
    channel,
    toDisplayLocalCoords(display.bounds, payload)
  );
}

function notifyDashboard(channel, payload) {
  const win = getDashboardWindow();
  if (win) {
    win.webContents.send(channel, payload);
  }
}

function showOverlay() {
  const wins = getOverlayWindows();
  if (wins.length === 0) {
    createOverlayWindows();
  }
  const updatedWins = getOverlayWindows();
  for (const win of updatedWins) {
    if (!win.isDestroyed()) {
      win.showInactive();
    }
  }
}

function hideOverlay() {
  closeOverlayWindows();
}

function repositionWindows() {
  const chatWin = getChatWindow();
  if (chatWin?.isVisible()) {
    chatWin.setBounds(getChatBounds());
  }

  repositionMiniChatWindow();
}

function handleDisplayChange() {
  rebuildOverlayWindows();
  repositionWindows();
}

function createWindows() {
  createChatWindow();
  showOverlay();

  screen.on("display-added", handleDisplayChange);
  screen.on("display-removed", handleDisplayChange);
  screen.on("display-metrics-changed", handleDisplayChange);
}

function cleanupWindows() {
  screen.removeListener("display-added", handleDisplayChange);
  screen.removeListener("display-removed", handleDisplayChange);
  screen.removeListener("display-metrics-changed", handleDisplayChange);
  closeOverlayWindows();
  if (miniChatWindow && !miniChatWindow.isDestroyed()) {
    miniChatWindow.close();
  }
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.close();
  }
}

function minimizeDashboard() {
  const win = getDashboardWindow();
  if (win && !win.isDestroyed()) {
    win.minimize();
  }
}

function closeDashboard() {
  const win = getDashboardWindow();
  if (win && !win.isDestroyed()) {
    win.close();
  }
  dashboardWindow = null;
}

module.exports = {
  createWindows,
  cleanupWindows,
  getOverlayWindows,
  getChatWindow,
  showChatWindow,
  hideChatWindow,
  minimizeChatWindow,
  restoreChatWindow,
  toggleChatWindow,
  sendToRenderer,
  sendOverlayPointAction,
  DASHBOARD_ENABLED,
  createDashboardWindow,
  getDashboardWindow,
  showDashboardWindow,
  hideDashboardWindow,
  closeDashboardWindow,
  notifyDashboard,
  showOverlay,
  hideOverlay,
  minimizeDashboard,
  closeDashboard,
};
