const { BrowserWindow, screen } = require("electron");
const path = require("path");
const { getWorkAreaBounds } = require("./utils/display");

const CHAT_WIDTH = 420;
const CHAT_HEIGHT = 650;
const CHAT_MARGIN = 24;

let overlayWindows = [];
let chatWindow = null;
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
    transparent: false,
    frame: false,
    resizable: false,
    movable: true,
    focusable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    hasShadow: false,
    backgroundColor: "#0f172a",
    ...(process.platform === "win32" ? { thickFrame: false, roundedCorners: false } : {}),
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
  chatWindow.loadFile(path.join(__dirname, "../../chat.html"));

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

function showChatWindow() {
  const win = getChatWindow() ?? createChatWindow();
  win.show();
  win.focus();
  keepWindowOffTaskbar(win);
  return win;
}

function hideChatWindow() {
  const win = getChatWindow();
  if (!win) return;
  win.hide();
}

function toggleChatWindow() {
  const win = getChatWindow() ?? createChatWindow();
  if (win.isVisible()) {
    hideChatWindow();
  } else {
    showChatWindow();
  }
}

function createDashboardWindow() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.focus();
    return dashboardWindow;
  }

  dashboardWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    frame: false,
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
  dashboardWindow.loadFile(path.join(__dirname, "../../dashboard.html"));

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
  const win = getDashboardWindow() ?? createDashboardWindow();
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
    win.webContents.send(channel, payload);
  }
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

function createWindows() {
  createChatWindow();

  screen.on("display-added", rebuildOverlayWindows);
  screen.on("display-removed", rebuildOverlayWindows);
  screen.on("display-metrics-changed", rebuildOverlayWindows);
}

function cleanupWindows() {
  screen.removeListener("display-added", rebuildOverlayWindows);
  screen.removeListener("display-removed", rebuildOverlayWindows);
  screen.removeListener("display-metrics-changed", rebuildOverlayWindows);
  closeOverlayWindows();
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
  toggleChatWindow,
  sendToRenderer,
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
