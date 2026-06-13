const {
  listScreenSources,
  getScreenSourceByDisplayId,
} = require("../capture/screen-capture");
const {
  drainAudioChunks,
  getAudioBufferStats,
  clearAudioBuffer,
} = require("../capture/audio-buffer-store");

const captureTools = {
  listScreenSources,
  getScreenSourceByDisplayId,
  drainAudioChunks,
  getAudioBufferStats,
  clearAudioBuffer,
};

module.exports = { captureTools };
