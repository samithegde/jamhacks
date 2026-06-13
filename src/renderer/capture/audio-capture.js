import { AudioRingBuffer } from "./audio-ring-buffer.js";

export class AudioCaptureService {
  constructor() {
    this.ringBuffer = new AudioRingBuffer();
    this.stream = null;
    this.audioContext = null;
    this.workletNode = null;
    this.sourceNode = null;
    this.deviceId = null;
    this.running = false;
  }

  async listInputDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "audioinput")
      .map((device) => ({
        deviceId: device.deviceId,
        label: device.label || "Microphone",
        groupId: device.groupId,
      }));
  }

  async start(options = {}) {
    if (this.running) {
      return this.getStatus();
    }

    this.deviceId = options.deviceId ?? null;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: this.deviceId ? { exact: this.deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: options.channelCount ?? 2,
      },
      video: false,
    });

    this.audioContext = new AudioContext({
      sampleRate: options.sampleRate,
    });

    const workletUrl = new URL(
      "./pcm-capture-processor.worklet.js",
      import.meta.url
    );
    await this.audioContext.audioWorklet.addModule(workletUrl);

    this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(
      this.audioContext,
      "pcm-capture-processor"
    );

    this.workletNode.port.onmessage = (event) => {
      if (event.data?.type !== "chunk") return;

      const chunk = {
        timestamp: Date.now(),
        sampleRate: event.data.sampleRate,
        channelCount: event.data.channelCount,
        frameSize: event.data.frameSize,
        sampleCount: event.data.samples.length,
        samples: event.data.samples,
      };

      this.ringBuffer.push(chunk);
      window.capture?.pushAudioChunk({
        timestamp: chunk.timestamp,
        sampleRate: chunk.sampleRate,
        channelCount: chunk.channelCount,
        frameSize: chunk.frameSize,
        sampleCount: chunk.sampleCount,
        samples: chunk.samples.slice(),
      });
    };

    this.sourceNode.connect(this.workletNode);
    this.running = true;

    return this.getStatus();
  }

  stop() {
    this.workletNode?.disconnect();
    this.sourceNode?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.audioContext?.close();

    this.workletNode = null;
    this.sourceNode = null;
    this.stream = null;
    this.audioContext = null;
    this.running = false;
  }

  drainLocalChunks(max) {
    return this.ringBuffer.drain(max);
  }

  getLocalStats() {
    return this.ringBuffer.getStats();
  }

  getStatus() {
    const track = this.stream?.getAudioTracks?.()[0];
    const settings = track?.getSettings?.() ?? {};

    return {
      running: this.running,
      deviceId: settings.deviceId ?? this.deviceId,
      sampleRate: this.audioContext?.sampleRate ?? settings.sampleRate ?? null,
      channelCount: settings.channelCount ?? null,
      local: this.getLocalStats(),
    };
  }
}
