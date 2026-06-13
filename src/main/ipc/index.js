const { registerAiToolsIpc } = require("./ai-tools");
const { registerCaptureIpc } = require("./capture");
const { registerWhisperIpc } = require("./whisper");
const { registerWindowIpc } = require("./window");

function registerIpcHandlers(ipcMain) {
  registerAiToolsIpc(ipcMain);
  registerCaptureIpc(ipcMain);
  registerWhisperIpc(ipcMain);
  registerWindowIpc(ipcMain);
}

module.exports = { registerIpcHandlers };
