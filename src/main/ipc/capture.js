const {
  listScreenSources,
  getScreenSourceByDisplayId,
} = require("../capture/screen-capture");
const {
  pushAudioChunk,
  drainAudioChunks,
  getAudioBufferStats,
  clearAudioBuffer,
} = require("../capture/audio-buffer-store");

function registerCaptureIpc(ipcMain) {
  ipcMain.handle("capture:list-screen-sources", async (_event, options) => {
    return listScreenSources(options);
  });

  ipcMain.handle("capture:get-screen-source", async (_event, displayId) => {
    return getScreenSourceByDisplayId(displayId);
  });

  ipcMain.on("capture:push-audio-chunk", (_event, chunk) => {
    pushAudioChunk(chunk);
  });

  ipcMain.handle("capture:drain-audio-chunks", (_event, max) => {
    return drainAudioChunks(max);
  });

  ipcMain.handle("capture:get-audio-buffer-stats", () => {
    return getAudioBufferStats();
  });

  ipcMain.handle("capture:clear-audio-buffer", () => {
    clearAudioBuffer();
    return { ok: true };
  });
}

module.exports = { registerCaptureIpc };
