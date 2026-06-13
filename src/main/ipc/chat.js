const { chat, chatStep } = require("../gemini/service");

function registerChatIpc(ipcMain) {
  ipcMain.handle("chat:send", async (_event, payload) => {
    const history = payload?.history;
    if (!Array.isArray(history) || !history.length) {
      throw new Error("Chat history is required.");
    }

    return chat(history);
  });

  ipcMain.handle("chat:step", async (_event, payload) => {
    const { goal, lastAction, screenshotBase64 } = payload ?? {};
    if (!goal) {
      throw new Error("goal is required.");
    }

    return chatStep(goal, lastAction ?? "", screenshotBase64 ?? null);
  });
}

module.exports = { registerChatIpc };
