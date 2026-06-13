const { hideChatWindow } = require("../window");

function registerWindowIpc(ipcMain) {
  ipcMain.handle("window:hide-chat", () => {
    hideChatWindow();
    return { ok: true };
  });
}

module.exports = { registerWindowIpc };
