class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._frameSize = 2048;
    this._pending = [];
    this._channelCount = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) {
      return true;
    }

    this._channelCount = input.length;
    const frameLength = input[0].length;

    for (let i = 0; i < frameLength; i += 1) {
      for (let channel = 0; channel < input.length; channel += 1) {
        this._pending.push(input[channel][i]);
      }

      if (this._pending.length >= this._frameSize * this._channelCount) {
        this._flush();
      }
    }

    return true;
  }

  _flush() {
    const frameSamples = this._frameSize * this._channelCount;
    const interleaved = new Float32Array(this._pending.splice(0, frameSamples));

    this.port.postMessage(
      {
        type: "chunk",
        samples: interleaved,
        channelCount: this._channelCount,
        frameSize: this._frameSize,
        sampleRate: sampleRate,
      },
      [interleaved.buffer]
    );
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
