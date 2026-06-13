import { beforeEach, describe, expect, it } from "vitest";

const {
  pushAudioChunk,
  drainAudioChunks,
  getAudioBufferStats,
  clearAudioBuffer,
} = await import("../../../src/main/capture/audio-buffer-store.js");

function makeChunk(index, sampleCount = 2048) {
  return {
    timestamp: 1_000 + index,
    sampleRate: 48_000,
    channelCount: 2,
    frameSize: 2048,
    sampleCount,
    samples: new Float32Array(sampleCount),
  };
}

describe("audio-buffer-store", () => {
  beforeEach(() => {
    clearAudioBuffer();
  });

  it("tracks pushed chunks and sample totals", () => {
    pushAudioChunk(makeChunk(0, 100));
    pushAudioChunk(makeChunk(1, 200));

    expect(getAudioBufferStats()).toEqual({
      chunkCount: 2,
      sampleCount: 300,
      latest: expect.objectContaining({ sampleCount: 200 }),
    });
  });

  it("drains all chunks when under the max limit", () => {
    pushAudioChunk(makeChunk(0));
    pushAudioChunk(makeChunk(1));

    const drained = drainAudioChunks();

    expect(drained).toHaveLength(2);
    expect(getAudioBufferStats().chunkCount).toBe(0);
  });

  it("drains only the requested number of chunks", () => {
    pushAudioChunk(makeChunk(0));
    pushAudioChunk(makeChunk(1));
    pushAudioChunk(makeChunk(2));

    const drained = drainAudioChunks(2);

    expect(drained).toHaveLength(2);
    expect(getAudioBufferStats()).toEqual({
      chunkCount: 1,
      sampleCount: 2048,
      latest: expect.objectContaining({ timestamp: 1_002 }),
    });
  });

  it("drops the oldest chunks after 120 pushes", () => {
    for (let index = 0; index < 121; index += 1) {
      pushAudioChunk(makeChunk(index, 10));
    }

    const stats = getAudioBufferStats();

    expect(stats.chunkCount).toBe(120);
    expect(stats.sampleCount).toBe(120 * 10);
    expect(stats.latest).toMatchObject({ timestamp: 1_120 });
  });

  it("clears the buffer", () => {
    pushAudioChunk(makeChunk(0));

    clearAudioBuffer();

    expect(getAudioBufferStats()).toEqual({
      chunkCount: 0,
      sampleCount: 0,
      latest: null,
    });
  });
});
