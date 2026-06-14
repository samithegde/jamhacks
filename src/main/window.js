const { BrowserWindow, screen } = require("electron");
const path = require("path");
const { getWorkAreaBounds } = require("./utils/display");
const { setNoRedirectionBitmap } = require("./utils/win32-chrome");

const CHAT_WIDTH = 420;
const CHAT_HEIGHT = 650;
const CHAT_MIN_WIDTH = 340;
const CHAT_MIN_HEIGHT = 420;
const CHAT_TASKS_TAB_GUTTER = 30;
const CHAT_TASKS_DRAWER_WIDTH = 292;
const CHAT_MARGIN = 24;
const MINI_CHAT_SIZE = 56;
const MINI_CHAT_MARGIN = 24;
const WIN32_CAPTION_INSET = process.platform === "win32" ? 31 : 0;
const DASHBOARD_ENABLED = true;

let overlayWindows = [];
let chatWindow = null;
let miniChatWindow = null;
let dashboardWindow = null;
let chatTasksDrawerOpen = false;
let overlayAccessibilityPreferences = {
  largeText: false,
  audio: false,
  magnify: false,
  screenReader: false,
  voiceControl: false,
  highContrast: false,
};

function getOverlayWindows() {
  return overlayWindows.filter((win) => win && !win.isDestroyed());
}

function keepWindowOffTaskbar(window) {
  if (!window || window.isDestroyed()) return;
  window.setSkipTaskbar(true);
}

function applyAssistantContentProtection(win) {
  if (!win || win.isDestroyed()) return;
  win.setContentProtection(true);
}

function getChatBounds() {
  const workArea = getWorkAreaBounds();
  const chatWindowWidth = CHAT_WIDTH + CHAT_TASKS_TAB_GUTTER;

  return {
    x: workArea.x + workArea.width - chatWindowWidth - CHAT_MARGIN,
    y: workArea.y + workArea.height - CHAT_HEIGHT - CHAT_MARGIN,
    width: chatWindowWidth,
    height: CHAT_HEIGHT,
  };
}

function getChatExtraWidth() {
  return chatTasksDrawerOpen ? CHAT_TASKS_DRAWER_WIDTH : CHAT_TASKS_TAB_GUTTER;
}

function getMiniChatBounds() {
  const workArea = getWorkAreaBounds();
  const totalHeight = MINI_CHAT_SIZE + WIN32_CAPTION_INSET;
  return {
    x: workArea.x + workArea.width - MINI_CHAT_SIZE - MINI_CHAT_MARGIN,
    y:
      workArea.y +
      workArea.height -
      totalHeight -
      MINI_CHAT_MARGIN,
    width: MINI_CHAT_SIZE,
    height: totalHeight,
  };
}

function createMiniChatCircleShape(diameter, offsetY = 0) {
  const radius = diameter / 2;
  const centerX = diameter / 2;
  const rects = [];

  for (let row = 0; row < diameter; row += 1) {
    const y = offsetY + row;
    const dy = row - radius + 0.5;
    const halfWidth = Math.sqrt(Math.max(0, radius * radius - dy * dy));
    const x = Math.max(0, Math.floor(centerX - halfWidth));
    const width = Math.min(diameter - x, Math.ceil(2 * halfWidth));
    if (width > 0) {
      rects.push({ x, y, width, height: 1 });
    }
  }

  return rects;
}

function applyMiniChatShape(win) {
  if (process.platform !== "win32" || !win || win.isDestroyed()) return;
  win.setShape(createMiniChatCircleShape(MINI_CHAT_SIZE, WIN32_CAPTION_INSET));
}

function getOverlayBoundsForDisplay(display) {
  const { x, y, width, height } = display.bounds;
  if (!WIN32_CAPTION_INSET) {
    return { x, y, width, height };
  }
  return {
    x,
    y: y - WIN32_CAPTION_INSET,
    width,
    height: height + WIN32_CAPTION_INSET,
  };
}

async function applyOverlayWindowChrome(win) {
  if (!win || win.isDestroyed()) return;
  win.setTitle("");
  await setNoRedirectionBitmap(win);
}

async function showOverlayWindow(win) {
  if (!win || win.isDestroyed()) return;
  await applyOverlayWindowChrome(win);
  if (!win.isVisible()) {
    win.showInactive();
    await applyOverlayWindowChrome(win);
  }
  keepWindowOffTaskbar(win);
}

function hideOverlayWindowsOnly() {
  for (const win of getOverlayWindows()) {
    if (!win.isDestroyed() && win.isVisible()) {
      win.hide();
    }
  }
}

function createOverlayWindowForDisplay(display) {
  const overlayBounds = getOverlayBoundsForDisplay(display);
  const overlayWin = new BrowserWindow({
    ...overlayBounds,
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
    ...(process.platform === "win32"
      ? { thickFrame: false, backgroundMaterial: "none" }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  overlayWin.setMenu(null);
  overlayWin.setMenuBarVisibility(false);
  overlayWin.setTitle("");

  keepWindowOffTaskbar(overlayWin);
  applyAssistantContentProtection(overlayWin);
  overlayWin.setAlwaysOnTop(true, "screen-saver");
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.loadFile(path.join(__dirname, "../renderer/overlay/index.html"));

  overlayWin.displayId = display.id;
  overlayWin.displayBounds = { ...display.bounds };

  overlayWin.webContents.once("did-finish-load", () => {
    broadcastOverlayAccessibilityPreferences();
  });

  overlayWin.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
  });

  overlayWin.on("show", () => {
    applyOverlayWindowChrome(overlayWin);
  });

  overlayWin.once("ready-to-show", async () => {
    await applyOverlayWindowChrome(overlayWin);
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
    minWidth: CHAT_MIN_WIDTH + getChatExtraWidth(),
    minHeight: CHAT_MIN_HEIGHT,
    show: false,
    transparent: true,
    frame: false,
    resizable: true,
    movable: true,
    focusable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    ...(process.platform === "win32" ? { thickFrame: true, roundedCorners: true } : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  chatWindow.setMenu(null);
  chatWindow.setTitle("");
  chatWindow.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
  });
  chatWindow.setAlwaysOnTop(true, "screen-saver", 1);
  chatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  keepWindowOffTaskbar(chatWindow);
  applyAssistantContentProtection(chatWindow);
  chatWindow.loadFile(path.join(__dirname, "../renderer/pages/chat.html"));

  chatWindow.webContents.once("did-finish-load", () => {
    broadcastAssistantAccessibilityPreferences();
  });

  chatWindow.once("ready-to-show", () => {
    chatWindow.show();
    keepWindowOffTaskbar(chatWindow);
  });

  chatWindow.on("focus", () => keepWindowOffTaskbar(chatWindow));
  chatWindow.on("closed", () => {
    chatWindow = null;
    chatTasksDrawerOpen = false;
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
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    autoHideMenuBar: true,
    backgroundColor: "#00000000",
    ...(process.platform === "win32"
      ? {
          type: "toolbar",
          thickFrame: false,
          roundedCorners: true,
          backgroundMaterial: "none",
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  miniChatWindow.setMenu(null);
  miniChatWindow.setMenuBarVisibility(false);
  miniChatWindow.setAlwaysOnTop(true, "screen-saver", 2);
  miniChatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  keepWindowOffTaskbar(miniChatWindow);
  applyAssistantContentProtection(miniChatWindow);
  miniChatWindow.loadFile(path.join(__dirname, "../renderer/pages/minichat.html"));

  miniChatWindow.webContents.once("did-finish-load", () => {
    broadcastAssistantAccessibilityPreferences();
  });

  miniChatWindow.once("ready-to-show", () => {
    keepWindowOffTaskbar(miniChatWindow);
    applyMiniChatShape(miniChatWindow);
  });

  miniChatWindow.on("closed", () => {
    miniChatWindow = null;
  });

  return miniChatWindow;
}

function repositionMiniChatWindow() {
  const win = getMiniChatWindow();
  if (!win) return;
  win.setBounds(getMiniChatBounds());
  applyMiniChatShape(win);
}

function showMiniChatWindow() {
  const win = getMiniChatWindow() ?? createMiniChatWindow();
  repositionMiniChatWindow();
  win.showInactive();
  keepWindowOffTaskbar(win);
  applyMiniChatShape(win);
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

function resizeChatWindow(size = {}) {
  const win = getChatWindow();
  if (!win) return;

  const minWidth = CHAT_MIN_WIDTH + getChatExtraWidth();
  const width = Math.max(
    minWidth,
    Math.round(Number(size.width) || 0)
  );
  const height = Math.max(CHAT_MIN_HEIGHT, Math.round(Number(size.height) || 0));
  win.setMinimumSize(minWidth, CHAT_MIN_HEIGHT);
  win.setSize(width, height);
}

function setChatTasksDrawerOpen(open) {
  const win = getChatWindow();
  if (!win) return;

  const nextOpen = Boolean(open);
  if (chatTasksDrawerOpen === nextOpen) return;

  const bounds = win.getBounds();
  const currentExtraWidth = getChatExtraWidth();
  const panelWidth = Math.max(CHAT_MIN_WIDTH, bounds.width - currentExtraWidth);
  chatTasksDrawerOpen = nextOpen;

  const nextExtraWidth = getChatExtraWidth();
  const nextWidth = panelWidth + nextExtraWidth;
  const right = bounds.x + bounds.width;

  win.setMinimumSize(CHAT_MIN_WIDTH + nextExtraWidth, CHAT_MIN_HEIGHT);
  win.setBounds({
    x: right - nextWidth,
    y: bounds.y,
    width: nextWidth,
    height: bounds.height,
  });
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
    width: 1200,
    height: 800,
    show: false,
    frame: true,
    resizable: true,
    focusable: true,
    alwaysOnTop: false,
    icon: path.join(__dirname, "../renderer/assets/clarityicon.png"),
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

function hasEnabledAccessibilityPreference(preferences = overlayAccessibilityPreferences) {
  return Object.values(preferences).some(Boolean);
}

function broadcastOverlayAccessibilityPreferences() {
  const payload = { ...overlayAccessibilityPreferences };
  const script = getOverlayAccessibilityApplyScript(payload);

  for (const win of getOverlayWindows()) {
    if (win.isDestroyed()) continue;

    win.webContents.send("accessibility:preferences-changed", payload);

    if (!win.webContents.isLoading()) {
      win.webContents.executeJavaScript(script, true).catch(() => {});
    }
  }
}

function getAssistantWindows() {
  return [chatWindow, miniChatWindow].filter((win) => win && !win.isDestroyed());
}

function broadcastAssistantAccessibilityPreferences() {
  const payload = { ...overlayAccessibilityPreferences };
  const script = getAssistantAccessibilityApplyScript(payload);

  for (const win of getAssistantWindows()) {
    win.webContents.send("accessibility:preferences-changed", payload);

    if (!win.webContents.isLoading()) {
      win.webContents.executeJavaScript(script, true).catch(() => {});
    }
  }
}

function broadcastAccessibilityPreferences() {
  broadcastOverlayAccessibilityPreferences();
  broadcastAssistantAccessibilityPreferences();
}

function getAssistantAccessibilityApplyScript(payload) {
  return `
    (() => {
      const preferences = ${JSON.stringify(payload)};
      document.body.classList.toggle("chat-accessibility-large-text", Boolean(preferences.largeText));
      document.body.classList.toggle("chat-accessibility-high-contrast", Boolean(preferences.highContrast));
      document.body.classList.toggle("chat-accessibility-audio", Boolean(preferences.audio));
      document.body.classList.toggle("chat-accessibility-screen-reader", Boolean(preferences.screenReader));
      document.body.classList.toggle("chat-accessibility-voice-control", Boolean(preferences.voiceControl));
      document.body.classList.toggle("chat-accessibility-magnify", Boolean(preferences.magnify));
      window.dispatchEvent(new CustomEvent("assistant-accessibility-preferences", { detail: preferences }));
    })();
  `;
}

function getOverlayAccessibilityApplyScript(payload) {
  const css = `
    .overlay-accessibility-direct-status {
      position: fixed;
      left: 16px;
      bottom: 16px;
      z-index: 2147483647;
      padding: 10px 12px;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.9);
      border: 3px solid #facc15;
      color: #fff;
      font: 800 14px/1.25 system-ui, -apple-system, sans-serif;
      pointer-events: none;
    }
    .overlay-accessibility-direct-status.hidden {
      display: none;
    }
    .overlay-accessibility-direct-contrast {
      position: fixed;
      inset: 0;
      z-index: 2147483644;
      opacity: 0;
      border: 5px solid #facc15;
      background: rgba(0, 0, 0, 0.22);
      box-shadow: inset 0 0 0 3px rgba(255, 255, 255, 0.45);
      pointer-events: none;
    }
    .overlay-accessibility-direct-contrast.is-active {
      opacity: 1;
    }
    .overlay-accessibility-direct-magnifier {
      position: fixed;
      left: 50%;
      top: 50%;
      z-index: 2147483646;
      width: 200px;
      height: 200px;
      border-radius: 999px;
      display: none;
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.88);
      border: 3px solid rgba(250, 204, 21, 0.9);
      background: rgba(255,255,255,0.04);
      box-shadow: 0 0 0 1px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.3);
      pointer-events: none;
      transition: opacity 160ms ease, transform 160ms ease;
    }
    .overlay-accessibility-direct-magnifier.is-active {
      display: block;
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
  `;

  return `
    (() => {
      const preferences = ${JSON.stringify(payload)};
      const styleText = ${JSON.stringify(css)};
      let style = document.getElementById("overlay-accessibility-direct-style");
      if (!style) {
        style = document.createElement("style");
        style.id = "overlay-accessibility-direct-style";
        document.head.appendChild(style);
      }
      style.textContent = styleText;

      const ensure = (id, className) => {
        let element = document.getElementById(id);
        if (!element) {
          element = document.createElement("div");
          element.id = id;
          element.className = className;
          document.body.appendChild(element);
        }
        return element;
      };

      const contrast = ensure("overlay-accessibility-direct-contrast", "overlay-accessibility-direct-contrast");
      const magnifier = ensure("overlay-accessibility-direct-magnifier", "overlay-accessibility-direct-magnifier");
      const status = ensure("overlay-accessibility-direct-status", "overlay-accessibility-direct-status hidden");

      document.body.classList.toggle("accessibility-large-text", Boolean(preferences.largeText));
      document.body.classList.toggle("accessibility-audio", Boolean(preferences.audio));
      document.body.classList.toggle("accessibility-magnify", Boolean(preferences.magnify));
      document.body.classList.toggle("accessibility-screen-reader", Boolean(preferences.screenReader));
      document.body.classList.toggle("accessibility-voice-control", Boolean(preferences.voiceControl));
      document.body.classList.toggle("accessibility-high-contrast", Boolean(preferences.highContrast));

      contrast.classList.toggle("is-active", Boolean(preferences.highContrast));
      magnifier.classList.toggle("is-active", Boolean(preferences.magnify));

      if (!window._overlayMagnifierTracker) {
        window._overlayMagnifierTracker = (e) => {
          const m = document.getElementById("overlay-accessibility-direct-magnifier");
          if (m) {
            m.style.left = e.clientX + "px";
            m.style.top = e.clientY + "px";
          }
        };
        window.addEventListener("pointermove", window._overlayMagnifierTracker);
      }

      const labels = [
        preferences.largeText && "Large text",
        preferences.audio && "Audio cues",
        preferences.magnify && "Magnify",
        preferences.screenReader && "Screen reader",
        preferences.voiceControl && "Voice control",
        preferences.highContrast && "High contrast",
      ].filter(Boolean);
      status.textContent = labels.length ? "Overlay accessibility: " + labels.join(", ") : "";
      status.classList.toggle("hidden", labels.length === 0);

      window.dispatchEvent(new CustomEvent("overlay-accessibility-preferences", { detail: preferences }));
    })();
  `;
}

function setOverlayAccessibilityPreferences(preferences = {}) {
  overlayAccessibilityPreferences = {
    ...overlayAccessibilityPreferences,
    largeText: Boolean(preferences.largeText),
    audio: Boolean(preferences.audio),
    magnify: Boolean(preferences.magnify),
    screenReader: Boolean(preferences.screenReader),
    voiceControl: Boolean(preferences.voiceControl),
    highContrast: Boolean(preferences.highContrast),
  };

  if (hasEnabledAccessibilityPreference()) {
    showOverlay();
  }

  broadcastAccessibilityPreferences();
  return { ...overlayAccessibilityPreferences };
}

function getOverlayAccessibilityPreferences() {
  return { ...overlayAccessibilityPreferences };
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
  if (WIN32_CAPTION_INSET && Number.isFinite(local.y)) {
    local.y += WIN32_CAPTION_INSET;
  }
  return local;
}

async function sendOverlayPointAction(channel, payload = {}) {
  await showOverlay();

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

function setOverlaysInteractive(interactive) {
  for (const win of getOverlayWindows()) {
    if (!win.isDestroyed()) {
      win.setIgnoreMouseEvents(!interactive, { forward: !interactive });
      applyOverlayWindowChrome(win);
    }
  }
}

function sendToOverlays(channel, payload) {
  for (const win of getOverlayWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload ?? {});
    }
  }
}

function notifyDashboard(channel, payload) {
  const win = getDashboardWindow();
  if (win) {
    win.webContents.send(channel, payload);
  }
}

async function showOverlay() {
  if (getOverlayWindows().length === 0) {
    createOverlayWindows();
  }
  const updatedWins = getOverlayWindows();
  for (const win of updatedWins) {
    if (!win.isDestroyed()) {
      win.setAlwaysOnTop(true, "screen-saver", 1);
      win.showInactive();
      win.moveTop?.();
    }
  }
  broadcastOverlayAccessibilityPreferences();
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
  createOverlayWindows();

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
  resizeChatWindow,
  setChatTasksDrawerOpen,
  toggleChatWindow,
  sendToRenderer,
  sendOverlayPointAction,
  setOverlaysInteractive,
  sendToOverlays,
  setOverlayAccessibilityPreferences,
  getOverlayAccessibilityPreferences,
  DASHBOARD_ENABLED,
  createDashboardWindow,
  getDashboardWindow,
  showDashboardWindow,
  hideDashboardWindow,
  closeDashboardWindow,
  notifyDashboard,
  showOverlay,
  hideOverlay,
  hideOverlayWindowsOnly,
  minimizeDashboard,
  closeDashboard,
};
