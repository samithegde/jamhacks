const {
  clearChatHistory,
  listChatMessages,
  saveChatMessage,
} = require("../mongodb/chat-history");

function registerChatHistoryIpc(ipcMain) {
  ipcMain.handle("chat-history:list", async (_event, payload) => {
    return listChatMessages(payload);
  });

  ipcMain.handle("chat-history:save", async (_event, payload) => {
    return saveChatMessage(payload);
  });

  ipcMain.handle("chat-history:clear", async (_event, payload) => {
    return clearChatHistory(payload);
  });
}

module.exports = { registerChatHistoryIpc };
