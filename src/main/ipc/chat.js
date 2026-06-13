const { chat } = require("../gemini/service");

function registerChatIpc(ipcMain) {
  ipcMain.handle("chat:send", async (_event, payload) => {
    const history = payload?.history;
    if (!Array.isArray(history) || !history.length) {
      throw new Error("Chat history is required.");
    }

    return chat(history);
  });
}

module.exports = { registerChatIpc };
