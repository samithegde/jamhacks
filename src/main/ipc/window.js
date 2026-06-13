const {
  hideChatWindow,
  minimizeChatWindow,
  resizeChatWindow,
  restoreChatWindow,
} = require("../window");

function registerWindowIpc(ipcMain) {
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
}

module.exports = { registerWindowIpc };
