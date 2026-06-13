const { createSpeech } = require("../elevenlabs/service");

function registerElevenLabsIpc(ipcMain) {
  ipcMain.handle("elevenlabs:speak", async (_event, payload) => {
    return createSpeech(payload?.text);
  });
}

module.exports = { registerElevenLabsIpc };
