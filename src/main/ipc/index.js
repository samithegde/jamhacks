const { registerAiToolsIpc } = require("./ai-tools");
const { registerCaptureIpc } = require("./capture");
const { registerChatIpc } = require("./chat");
const { registerWhisperIpc } = require("./whisper");
const { registerWindowIpc } = require("./window");

function registerIpcHandlers(ipcMain) {
  registerAiToolsIpc(ipcMain);
  registerCaptureIpc(ipcMain);
  registerChatIpc(ipcMain);
  registerWhisperIpc(ipcMain);
  registerWindowIpc(ipcMain);
}

module.exports = { registerIpcHandlers };
