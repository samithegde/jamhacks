const {
  clearChatHistory,
  getChatHistoryStatus,
  listChatMessages,
  saveChatMessage,
} = require("../mongodb/chat-history");

function registerChatHistoryIpc(ipcMain) {
  ipcMain.handle("chat-history:list", async (_event, payload) => {
    try {
      return await listChatMessages(payload);
    } catch (error) {
      console.warn("chat-history:list failed:", error.message);
      throw error;
    }
  });

  ipcMain.handle("chat-history:save", async (_event, payload) => {
    try {
      return await saveChatMessage(payload);
    } catch (error) {
      console.warn("chat-history:save failed:", error.message);
      throw error;
    }
  });

  ipcMain.handle("chat-history:clear", async (_event, payload) => {
    try {
      return await clearChatHistory(payload);
    } catch (error) {
      console.warn("chat-history:clear failed:", error.message);
      throw error;
    }
  });

  ipcMain.handle("chat-history:status", async () => {
    return getChatHistoryStatus();
  });
}

module.exports = { registerChatHistoryIpc };
