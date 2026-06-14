const { BrowserWindow } = require("electron");
const {
  hideChatWindow,
  minimizeChatWindow,
  resizeChatWindow,
  restoreChatWindow,
  setChatTasksDrawerOpen,
  getChatWindow,
} = require("../window");

function registerWindowIpc(ipcMain) {
  ipcMain.handle("window:capture-page", async () => {
    const win = getChatWindow();
    if (!win || win.isDestroyed()) return null;
    try {
      const img = await win.webContents.capturePage();
      return img.toDataURL();
    } catch {
      return null;
    }
  });

  // Per-element mouse passthrough: renderer calls this on mouseenter/mouseleave
  // of interactive overlay elements so the rest of the screen stays click-through.
  ipcMain.handle("window:set-click-through", (_event, passThrough) => {
    const win = BrowserWindow.fromWebContents(_event.sender);
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(Boolean(passThrough), { forward: Boolean(passThrough) });
    }
    return { ok: true };
  });

  ipcMain.handle("window:hide-chat", () => {
    hideChatWindow();
    return { ok: true };
  });

  ipcMain.handle("window:minimize-chat", () => {
    minimizeChatWindow();
    return { ok: true };
  });

  ipcMain.handle("window:restore-chat", () => {
    restoreChatWindow();
    return { ok: true };
  });

  ipcMain.handle("window:resize-chat", (_event, size) => {
    resizeChatWindow(size);
    return { ok: true };
  });

  ipcMain.handle("window:set-chat-tasks-drawer", (_event, open) => {
    setChatTasksDrawerOpen(open);
    return { ok: true };
  });
}

module.exports = { registerWindowIpc };
