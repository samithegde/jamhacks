const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("capture", {
  listScreenSources: (options) =>
    ipcRenderer.invoke("capture:list-screen-sources", options),
  getScreenSource: (displayId) =>
    ipcRenderer.invoke("capture:get-screen-source", displayId),
  pushAudioChunk: (chunk) => ipcRenderer.send("capture:push-audio-chunk", chunk),
  drainAudioChunks: (max) =>
    ipcRenderer.invoke("capture:drain-audio-chunks", max),
  getAudioBufferStats: () =>
    ipcRenderer.invoke("capture:get-audio-buffer-stats"),
  clearAudioBuffer: () => ipcRenderer.invoke("capture:clear-audio-buffer"),
});

contextBridge.exposeInMainWorld("whisper", {
  transcribe: (payload) => ipcRenderer.invoke("whisper:transcribe", payload),
});

contextBridge.exposeInMainWorld("geminiChat", {
  send: (payload) => ipcRenderer.invoke("chat:send", payload),
});

contextBridge.exposeInMainWorld("chatWindow", {
  hide: () => ipcRenderer.invoke("window:hide-chat"),
  minimize: () => ipcRenderer.invoke("window:minimize-chat"),
});

contextBridge.exposeInMainWorld("minichat", {
  restore: () => ipcRenderer.invoke("window:restore-chat"),
});

contextBridge.exposeInMainWorld("dashboard", {
  getOverlayStatus: () => ipcRenderer.invoke("get-overlay-status"),
  showOverlay: () => ipcRenderer.invoke("show-overlay"),
  hideOverlay: () => ipcRenderer.invoke("hide-overlay"),
  showChat: () => ipcRenderer.invoke("show-chat"),
  quitApp: () => ipcRenderer.invoke("quit-app"),
  getDisplays: () => ipcRenderer.invoke("get-displays"),
  getAccessibilityPreferences: () =>
    ipcRenderer.invoke("accessibility:get-preferences"),
  setAccessibilityPreferences: (preferences) =>
    ipcRenderer.invoke("accessibility:set-preferences", preferences),
  minimizeWindow: () => ipcRenderer.invoke("minimize-window"),
  closeWindow: () => ipcRenderer.invoke("close-window"),
  minimizeDashboard: () => ipcRenderer.invoke("minimize-window"),
  closeDashboard: () => ipcRenderer.invoke("close-window"),
  onOverlayStateChanged: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("overlay-state-changed", handler);
    return () => ipcRenderer.removeListener("overlay-state-changed", handler);
  },
  onAccessibilityPreferencesChanged: (callback) => {
    const handler = (_event, preferences) => callback(preferences);
    ipcRenderer.on("accessibility-preferences-changed", handler);
    return () =>
      ipcRenderer.removeListener("accessibility-preferences-changed", handler);
  },
});

contextBridge.exposeInMainWorld("aiTools", {
  ensureOverlay: () => ipcRenderer.invoke("show-overlay"),
  getAccessibilityPreferences: () =>
    ipcRenderer.invoke("accessibility:get-preferences"),
  speakAccessibility: (text) => ipcRenderer.invoke("elevenlabs:speak", { text }),
  moveCursor: (payload) => ipcRenderer.invoke("ai-tools:cursor-move", payload),
  setCursorVisible: (visible) =>
    ipcRenderer.invoke("ai-tools:cursor-set-visible", visible),
  highlightRect: (payload) =>
    ipcRenderer.invoke("ai-tools:highlighter-rect", payload),
  highlightCircle: (payload) =>
    ipcRenderer.invoke("ai-tools:highlighter-circle", payload),
  highlightStroke: (payload) =>
    ipcRenderer.invoke("ai-tools:highlighter-stroke", payload),
  clearHighlights: () => ipcRenderer.invoke("ai-tools:highlighter-clear"),
  onCursorMove: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("ai:cursor:move", handler);
    return () => ipcRenderer.removeListener("ai:cursor:move", handler);
  },
  onCursorVisibility: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("ai:cursor:visibility", handler);
    return () => ipcRenderer.removeListener("ai:cursor:visibility", handler);
  },
  onHighlightRect: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("ai:highlighter:rect", handler);
    return () => ipcRenderer.removeListener("ai:highlighter:rect", handler);
  },
  onHighlightCircle: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("ai:highlighter:circle", handler);
    return () => ipcRenderer.removeListener("ai:highlighter:circle", handler);
  },
  onHighlightStroke: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("ai:highlighter:stroke", handler);
    return () => ipcRenderer.removeListener("ai:highlighter:stroke", handler);
  },
  onHighlightClear: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("ai:highlighter:clear", handler);
    return () => ipcRenderer.removeListener("ai:highlighter:clear", handler);
  },
  onAccessibilityPreferencesChanged: (callback) => {
    const handler = (_event, preferences) => callback(preferences);
    ipcRenderer.on("accessibility:preferences-changed", handler);
    return () =>
      ipcRenderer.removeListener("accessibility:preferences-changed", handler);
  },
});
