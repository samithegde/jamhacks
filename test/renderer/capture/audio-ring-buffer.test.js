/** @vitest-environment happy-dom */

import { beforeEach, describe, expect, it } from "vitest";
import { AudioRingBuffer } from "../../../src/renderer/capture/audio-ring-buffer.js";

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

describe("AudioRingBuffer", () => {
  let buffer;

  beforeEach(() => {
    buffer = new AudioRingBuffer(3);
  });

  it("tracks chunk and sample counts", () => {
    buffer.push(makeChunk(0, 100));
    buffer.push(makeChunk(1, 50));

    expect(buffer.getStats()).toEqual({
      chunkCount: 2,
      sampleCount: 150,
      latest: expect.objectContaining({ sampleCount: 50 }),
    });
  });

  it("drains all chunks when under the max limit", () => {
    buffer.push(makeChunk(0));
    buffer.push(makeChunk(1));

    const drained = buffer.drain();

    expect(drained).toHaveLength(2);
    expect(buffer.getStats().chunkCount).toBe(0);
  });

  it("drains only the requested number of chunks", () => {
    buffer.push(makeChunk(0));
    buffer.push(makeChunk(1));
    buffer.push(makeChunk(2));

    const drained = buffer.drain(2);

    expect(drained).toHaveLength(2);
    expect(buffer.getStats().chunkCount).toBe(1);
  });

  it("drops the oldest chunks once maxChunks is exceeded", () => {
    buffer.push(makeChunk(0, 10));
    buffer.push(makeChunk(1, 10));
    buffer.push(makeChunk(2, 10));
    buffer.push(makeChunk(3, 10));

    const stats = buffer.getStats();

    expect(stats.chunkCount).toBe(3);
    expect(stats.sampleCount).toBe(30);
    expect(stats.latest).toMatchObject({ timestamp: 1_003 });
  });

  it("clears buffered chunks", () => {
    buffer.push(makeChunk(0));

    buffer.clear();

    expect(buffer.getStats()).toEqual({
      chunkCount: 0,
      sampleCount: 0,
      latest: null,
    });
  });
});
