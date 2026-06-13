const {
  sendToRenderer,
  sendOverlayPointAction,
  setOverlaysInteractive,
  sendToOverlays,
  getOverlayWindows,
  getChatWindow,
  showOverlay,
  hideOverlayWindowsOnly,
} = require("../window");

function setOverlayInteractivity(interactive) {
  if (typeof setOverlaysInteractive === "function") {
    setOverlaysInteractive(interactive);
    return;
  }

  for (const win of getOverlayWindows()) {
    if (!win.isDestroyed()) {
      win.setIgnoreMouseEvents(!interactive, { forward: !interactive });
    }
  }
}

function registerAiToolsIpc(ipcMain) {
  ipcMain.handle("ai-tools:cursor-move", async (_event, payload) => {
    sendToRenderer("ai:cursor:visibility", { visible: false });
    await sendOverlayPointAction("ai:cursor:move", { ...payload, visible: true });
    return { ok: true };
  });

  ipcMain.handle("ai-tools:cursor-set-visible", async (_event, visible) => {
    const isVisible = Boolean(visible);
    sendToRenderer("ai:cursor:visibility", { visible: isVisible });
    if (isVisible) {
      await showOverlay();
    } else {
      hideOverlayWindowsOnly();
    }
    return { ok: true };
  });

  ipcMain.handle("ai-tools:highlighter-rect", async (_event, payload) => {
    await sendOverlayPointAction("ai:highlighter:rect", payload);
    return { ok: true };
  });

  ipcMain.handle("ai-tools:highlighter-circle", async (_event, payload) => {
    await sendOverlayPointAction("ai:highlighter:circle", payload);
    return { ok: true };
  });

  ipcMain.handle("ai-tools:highlighter-stroke", async (_event, payload) => {
    await sendOverlayPointAction("ai:highlighter:stroke", payload);
    return { ok: true };
  });

  ipcMain.handle("ai-tools:highlighter-clear", () => {
    sendToRenderer("ai:highlighter:clear");
    return { ok: true };
  });

  ipcMain.handle("ai-tools:show-next-button", async (_event, payload = {}) => {
    await showOverlay();
    setOverlayInteractivity(true);
    await sendOverlayPointAction("ai:next-button:show", payload);
    return { ok: true };
  });

  ipcMain.handle("ai-tools:hide-next-button", () => {
    setOverlayInteractivity(false);
    sendToOverlays("ai:next-button:hide");
    return { ok: true };
  });

  ipcMain.handle("ai-tools:show-complete-button", async () => {
    await showOverlay();
    setOverlaysInteractive(true);
    sendToOverlays("ai:complete-button:show");
    return { ok: true };
  });

  ipcMain.on("ai-tools:next-clicked", () => {
    setOverlayInteractivity(false);
    const chatWin = getChatWindow();
    if (chatWin && !chatWin.isDestroyed()) {
      chatWin.webContents.send("ai:next:clicked");
    }
  });

  ipcMain.on("ai-tools:prompt-cancelled", () => {
    setOverlayInteractivity(false);
    sendToOverlays("ai:next-button:hide");
    const chatWin = getChatWindow();
    if (chatWin && !chatWin.isDestroyed()) {
      chatWin.webContents.send("ai:prompt:cancelled");
    }
  });

  ipcMain.on("ai-tools:complete-clicked", () => {
    setOverlaysInteractive(false);
    sendToOverlays("ai:next-button:hide");
    const chatWin = getChatWindow();
    if (chatWin && !chatWin.isDestroyed()) {
      chatWin.webContents.send("ai:complete:clicked");
    }
  });
}

module.exports = { registerAiToolsIpc };
