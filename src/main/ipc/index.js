const { registerAiToolsIpc } = require("./ai-tools");
const { registerCaptureIpc } = require("./capture");
const { registerChatIpc } = require("./chat");
const { registerChatHistoryIpc } = require("./chat-history");
const { registerWhisperIpc } = require("./whisper");
const { registerWindowIpc } = require("./window");
const { registerDashboardIpc } = require("./dashboard");
const { registerElevenLabsIpc } = require("./elevenlabs");
const { registerRagIpc } = require("./rag");
const { registerLocalizationIpc } = require("./localization");

function registerIpcHandlers(ipcMain) {
  registerAiToolsIpc(ipcMain);
  registerCaptureIpc(ipcMain);
  registerChatIpc(ipcMain);
  registerChatHistoryIpc(ipcMain);
  registerWhisperIpc(ipcMain);
  registerWindowIpc(ipcMain);
  registerDashboardIpc(ipcMain);
  registerElevenLabsIpc(ipcMain);
  registerRagIpc(ipcMain);
  registerLocalizationIpc(ipcMain);
}

module.exports = { registerIpcHandlers };
