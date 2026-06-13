export class ScreenCaptureService {
  constructor() {
    this.stream = null;
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.sourceId = null;
    this.sourceName = null;
    this.running = false;
  }

  async listSources(options) {
    return window.capture.listScreenSources(options);
  }

  async start(options = {}) {
    if (this.running) {
      return this.getStatus();
    }

    let sourceId = options.sourceId ?? null;

    if (!sourceId) {
      const sources = await this.listSources({ types: ["screen"] });
      if (!sources.length) {
        throw new Error("No screen sources available.");
      }
      sourceId = sources[0].id;
      this.sourceName = sources[0].name;
    }

    this.sourceId = sourceId;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId,
        },
      },
    });

    this.video = document.createElement("video");
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();

    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.running = true;

    return this.getStatus();
  }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.stream = null;
    this.running = false;
  }

  async waitForVideoReady(timeoutMs = 3000) {
    if (!this.video) return false;

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.video.videoWidth > 0 && this.video.videoHeight > 0) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return this.video.videoWidth > 0 && this.video.videoHeight > 0;
  }

  captureFrame(options = {}) {
    if (!this.running || !this.video || !this.ctx) {
      return null;
    }

    const width = options.width ?? this.video.videoWidth;
    const height = options.height ?? this.video.videoHeight;

    if (!width || !height) {
      return null;
    }

    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx.drawImage(this.video, 0, 0, width, height);

    return {
      timestamp: Date.now(),
      width,
      height,
      sourceId: this.sourceId,
      sourceName: this.sourceName,
      dataUrl: this.canvas.toDataURL("image/jpeg", options.quality ?? 0.72),
    };
  }

  async captureFrameAsync(options = {}) {
    if (!this.running) {
      return null;
    }

    const ready = await this.waitForVideoReady(options.timeoutMs);
    if (!ready) {
      return null;
    }

    return this.captureFrame(options);
  }

  getStatus() {
    return {
      running: this.running,
      sourceId: this.sourceId,
      sourceName: this.sourceName,
      width: this.video?.videoWidth ?? null,
      height: this.video?.videoHeight ?? null,
    };
  }
}
