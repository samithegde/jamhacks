const { transcribe } = require("../whisper/service");
const { getProxyUrl, transcribeViaProxy } = require("../groq/proxy");

function registerWhisperIpc(ipcMain) {
  ipcMain.handle("whisper:transcribe", async (_event, payload) => {
    const samples = payload?.samples;
    const sampleRate = Number(payload?.sampleRate);

    if (!Array.isArray(samples) || !samples.length) {
      throw new Error("No audio samples provided.");
    }

    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new Error("Invalid sample rate.");
    }

    if (getProxyUrl()) {
      const text = await transcribeViaProxy(samples, sampleRate);
      return { text, provider: "groq-proxy" };
    }

    const text = await transcribe(samples, sampleRate);
    return { text, provider: "local-whisper" };
  });
}

module.exports = { registerWhisperIpc };
