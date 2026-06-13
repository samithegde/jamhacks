let transcriberPromise = null;

async function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      const { pipeline, env } = await import("@xenova/transformers");

      // Cache model locally after first download.
      env.allowLocalModels = true;
      env.useBrowserCache = false;

      return pipeline(
        "automatic-speech-recognition",
        "Xenova/whisper-tiny.en"
      );
    })();
  }

  return transcriberPromise;
}

async function transcribe(samples, sampleRate) {
  const asr = await getTranscriber();
  const input = Float32Array.from(samples);

  const result = await asr(input, {
    sampling_rate: sampleRate,
    chunk_length_s: 20,
    stride_length_s: 5,
    return_timestamps: false,
  });

  return (result?.text ?? "").trim();
}

module.exports = {
  transcribe,
};
