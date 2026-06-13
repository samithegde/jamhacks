const MAX_CHUNKS = 120;

let chunks = [];

function pushAudioChunk(chunk) {
  chunks.push(chunk);
  if (chunks.length > MAX_CHUNKS) {
    chunks.splice(0, chunks.length - MAX_CHUNKS);
  }
}

function drainAudioChunks(max = MAX_CHUNKS) {
  if (chunks.length <= max) {
    const drained = chunks;
    chunks = [];
    return drained;
  }

  const drained = chunks.slice(0, max);
  chunks = chunks.slice(max);
  return drained;
}

function getAudioBufferStats() {
  const sampleCount = chunks.reduce(
    (total, chunk) => total + (chunk.sampleCount ?? 0),
    0
  );

  return {
    chunkCount: chunks.length,
    sampleCount,
    latest: chunks.at(-1) ?? null,
  };
}

function clearAudioBuffer() {
  chunks = [];
}

module.exports = {
  pushAudioChunk,
  drainAudioChunks,
  getAudioBufferStats,
  clearAudioBuffer,
};
