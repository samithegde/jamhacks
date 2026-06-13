export class AudioRingBuffer {
  constructor(maxChunks = 64) {
    this.maxChunks = maxChunks;
    this.chunks = [];
  }

  push(chunk) {
    this.chunks.push(chunk);
    if (this.chunks.length > this.maxChunks) {
      this.chunks.splice(0, this.chunks.length - this.maxChunks);
    }
  }

  drain(max = this.maxChunks) {
    if (this.chunks.length <= max) {
      const drained = this.chunks;
      this.chunks = [];
      return drained;
    }

    const drained = this.chunks.slice(0, max);
    this.chunks = this.chunks.slice(max);
    return drained;
  }

  getStats() {
    const sampleCount = this.chunks.reduce(
      (total, chunk) => total + (chunk.sampleCount ?? 0),
      0
    );

    return {
      chunkCount: this.chunks.length,
      sampleCount,
      latest: this.chunks.at(-1) ?? null,
    };
  }

  clear() {
    this.chunks = [];
  }
}
