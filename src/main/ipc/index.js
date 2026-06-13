const { registerAiToolsIpc } = require("./ai-tools");
const { registerCaptureIpc } = require("./capture");
const { registerWhisperIpc } = require("./whisper");
const { registerWindowIpc } = require("./window");
const { registerDashboardIpc } = require("./dashboard");

function registerIpcHandlers(ipcMain) {
  registerAiToolsIpc(ipcMain);
  registerCaptureIpc(ipcMain);
  registerWhisperIpc(ipcMain);
  registerWindowIpc(ipcMain);
  registerDashboardIpc(ipcMain);
}

module.exports = { registerIpcHandlers };
