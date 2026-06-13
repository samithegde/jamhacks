const { chat, chatStep, refineCoordinate } = require("../gemini/service");

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

  ipcMain.handle("chat:refine", async (_event, payload) => {
    const { description, croppedBase64, cropW, cropH } = payload ?? {};
    if (!description || !croppedBase64) {
      throw new Error("description and croppedBase64 are required.");
    }

    return refineCoordinate({ description, croppedBase64, cropW, cropH });
  });
}

module.exports = { registerChatIpc };
