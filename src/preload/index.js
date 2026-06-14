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
  step: (payload) => ipcRenderer.invoke("chat:step", payload),
  refine: (payload) => ipcRenderer.invoke("chat:refine", payload),
  onRagStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("chat:rag-status", handler);
    return () => ipcRenderer.removeListener("chat:rag-status", handler);
  },
});

contextBridge.exposeInMainWorld("chatTelemetry", {
  status: () => ipcRenderer.invoke("telemetry:chat:status"),
  summary: (payload) => ipcRenderer.invoke("telemetry:chat:summary", payload),
  recent: (payload) => ipcRenderer.invoke("telemetry:chat:recent", payload),
  activityRecent: (payload) =>
    ipcRenderer.invoke("telemetry:chat:activity:recent", payload),
  recordActivity: (payload) =>
    ipcRenderer.invoke("telemetry:chat:activity:record", payload),
  onActivity: (callback) => {
    const handler = (_event, entry) => callback(entry);
    ipcRenderer.on("telemetry:chat:activity", handler);
    return () => ipcRenderer.removeListener("telemetry:chat:activity", handler);
  },
});

contextBridge.exposeInMainWorld("localization", {
  isSomEnabled: () => ipcRenderer.invoke("localization:som-enabled"),
  discoverMarks: () => ipcRenderer.invoke("ui-marks:discover"),
  ocrCrop: (payload) => ipcRenderer.invoke("localization:ocr-crop", payload),
  moondreamPoint: (payload) =>
    ipcRenderer.invoke("localization:moondream-point", payload),
  moondreamDetect: (payload) =>
    ipcRenderer.invoke("localization:moondream-detect", payload),
});

contextBridge.exposeInMainWorld("chatHistory", {
  list: (payload) => ipcRenderer.invoke("chat-history:list", payload),
  save: (payload) => ipcRenderer.invoke("chat-history:save", payload),
  clear: (payload) => ipcRenderer.invoke("chat-history:clear", payload),
  status: () => ipcRenderer.invoke("chat-history:status"),
});

contextBridge.exposeInMainWorld("ragKb", {
  status: () => ipcRenderer.invoke("rag:status"),
  search: (payload) => ipcRenderer.invoke("rag:search", payload),
});

contextBridge.exposeInMainWorld("chatWindow", {
  hide: () => ipcRenderer.invoke("window:hide-chat"),
  minimize: () => ipcRenderer.invoke("window:minimize-chat"),
  resizeTo: (width, height) =>
    ipcRenderer.invoke("window:resize-chat", { width, height }),
  setTasksDrawerOpen: (open) =>
    ipcRenderer.invoke("window:set-chat-tasks-drawer", Boolean(open)),
  capturePage: () => ipcRenderer.invoke("window:capture-page"),
});

contextBridge.exposeInMainWorld("overlayControl", {
  setClickThrough: (passThrough) =>
    ipcRenderer.invoke("window:set-click-through", passThrough),
});

contextBridge.exposeInMainWorld("minichat", {
  restore: () => ipcRenderer.invoke("window:restore-chat"),
  captionInset: process.platform === "win32" ? 31 : 0,
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
  setAnnotations: (items) => ipcRenderer.invoke("annotations:set", items),
  clearAnnotations: () => ipcRenderer.invoke("annotations:clear"),
  replayAnnotations: () => ipcRenderer.invoke("annotations:replay"),
  showNextButton: (payload) => ipcRenderer.invoke("ai-tools:show-next-button", payload),
  hideNextButton: () => ipcRenderer.invoke("ai-tools:hide-next-button"),
  showCompleteButton: () => ipcRenderer.invoke("ai-tools:show-complete-button"),
  emitNextClicked: () => ipcRenderer.send("ai-tools:next-clicked"),
  emitCompleteClicked: () => ipcRenderer.send("ai-tools:complete-clicked"),
  emitPromptCancelled: () => ipcRenderer.send("ai-tools:prompt-cancelled"),
  onNextButtonShow: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("ai:next-button:show", handler);
    return () => ipcRenderer.removeListener("ai:next-button:show", handler);
  },
  onNextButtonHide: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("ai:next-button:hide", handler);
    return () => ipcRenderer.removeListener("ai:next-button:hide", handler);
  },
  onCompleteButtonShow: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("ai:complete-button:show", handler);
    return () => ipcRenderer.removeListener("ai:complete-button:show", handler);
  },
  onNextClicked: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("ai:next:clicked", handler);
    return () => ipcRenderer.removeListener("ai:next:clicked", handler);
  },
  onPromptCancelled: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("ai:prompt:cancelled", handler);
    return () => ipcRenderer.removeListener("ai:prompt:cancelled", handler);
  },
  onCompleteClicked: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("ai:complete:clicked", handler);
    return () => ipcRenderer.removeListener("ai:complete:clicked", handler);
  },
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
  showLearningWidget: (payload) =>
    ipcRenderer.invoke("ai-tools:learning-widget-show", payload),
  hideLearningWidget: () => ipcRenderer.invoke("ai-tools:learning-widget-hide"),
  onLearningWidgetShow: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("ai:learning-widget:show", handler);
    return () => ipcRenderer.removeListener("ai:learning-widget:show", handler);
  },
  onLearningWidgetHide: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("ai:learning-widget:hide", handler);
    return () => ipcRenderer.removeListener("ai:learning-widget:hide", handler);
  },
  onAccessibilityPreferencesChanged: (callback) => {
    const handler = (_event, preferences) => callback(preferences);
    ipcRenderer.on("accessibility:preferences-changed", handler);
    return () =>
      ipcRenderer.removeListener("accessibility:preferences-changed", handler);
  },
});
