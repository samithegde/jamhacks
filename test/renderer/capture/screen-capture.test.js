/** @vitest-environment happy-dom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenCaptureService } from "../../../src/renderer/capture/screen-capture.js";

function makeMockStream() {
  const track = { stop: vi.fn() };
  return {
    getTracks: () => [track],
    _track: track,
  };
}

function installVideoDimensions(video, width, height) {
  Object.defineProperty(video, "videoWidth", {
    configurable: true,
    get: () => width,
  });
  Object.defineProperty(video, "videoHeight", {
    configurable: true,
    get: () => height,
  });
}

describe("ScreenCaptureService", () => {
  let service;
  let listScreenSources;
  let getUserMedia;
  let createdVideos;
  let originalCreateElement;

  beforeEach(() => {
    service = new ScreenCaptureService();
    createdVideos = [];
    originalCreateElement = document.createElement.bind(document);

    listScreenSources = vi.fn().mockResolvedValue([
      { id: "screen:0:0", name: "Entire screen" },
    ]);
    window.capture = { listScreenSources };

    getUserMedia = vi.fn().mockImplementation(async () => makeMockStream());
    navigator.mediaDevices = { getUserMedia };

    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      const element = originalCreateElement(tagName);

      if (tagName === "video") {
        createdVideos.push(element);
        Object.defineProperty(element, "srcObject", {
          configurable: true,
          get() {
            return element._srcObject ?? null;
          },
          set(value) {
            element._srcObject = value;
          },
        });
        element.play = vi.fn(async () => {
          installVideoDimensions(element, 1920, 1080);
        });
      }

      if (tagName === "canvas") {
        element.getContext = vi.fn(() => ({
          drawImage: vi.fn(),
        }));
        element.toDataURL = vi.fn(
          (_mimeType, quality) => `data:image/jpeg;base64,frame-${quality}`
        );
      }

      return element;
    });
  });

  afterEach(() => {
    service.stop();
    vi.restoreAllMocks();
    delete window.capture;
  });

  it("delegates listSources to the preload bridge", async () => {
    const sources = await service.listSources({ types: ["screen"] });

    expect(listScreenSources).toHaveBeenCalledWith({ types: ["screen"] });
    expect(sources).toHaveLength(1);
  });

  it("starts capture with an explicit source id", async () => {
    const status = await service.start({ sourceId: "screen:1:0" });

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: "screen:1:0",
        },
      },
    });
    expect(status).toEqual({
      running: true,
      sourceId: "screen:1:0",
      sourceName: null,
      width: 1920,
      height: 1080,
    });
  });

  it("selects the first screen source when none is provided", async () => {
    const status = await service.start();

    expect(listScreenSources).toHaveBeenCalledWith({ types: ["screen"] });
    expect(status.sourceId).toBe("screen:0:0");
    expect(status.sourceName).toBe("Entire screen");
  });

  it("throws when no screen sources are available", async () => {
    listScreenSources.mockResolvedValue([]);

    await expect(service.start()).rejects.toThrow(
      "No screen sources available."
    );
  });

  it("returns the current status when start is called twice", async () => {
    await service.start({ sourceId: "screen:0:0" });
    getUserMedia.mockClear();

    const status = await service.start({ sourceId: "screen:9:9" });

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(status.running).toBe(true);
    expect(status.sourceId).toBe("screen:0:0");
  });

  it("captures a jpeg frame from the active video stream", async () => {
    await service.start({ sourceId: "screen:0:0" });
    service.sourceName = "Main display";

    const frame = service.captureFrame({ quality: 0.65 });

    expect(frame).toMatchObject({
      width: 1920,
      height: 1080,
      sourceId: "screen:0:0",
      sourceName: "Main display",
      dataUrl: "data:image/jpeg;base64,frame-0.65",
    });
    expect(frame.timestamp).toEqual(expect.any(Number));
  });

  it("returns null when captureFrame is called before start", () => {
    expect(service.captureFrame()).toBeNull();
  });

  it("waits for video dimensions before captureFrameAsync succeeds", async () => {
    await service.start({ sourceId: "screen:0:0" });

    const video = createdVideos.at(-1);
    installVideoDimensions(video, 0, 0);

    const pending = service.captureFrameAsync({ timeoutMs: 200 });
    setTimeout(() => installVideoDimensions(video, 1280, 720), 60);

    const frame = await pending;

    expect(frame).toMatchObject({
      width: 1280,
      height: 720,
    });
  });

  it("returns null from captureFrameAsync when video never becomes ready", async () => {
    await service.start({ sourceId: "screen:0:0" });

    const video = createdVideos.at(-1);
    installVideoDimensions(video, 0, 0);

    const frame = await service.captureFrameAsync({ timeoutMs: 120 });

    expect(frame).toBeNull();
  });

  it("stops tracks and resets capture state", async () => {
    const stream = makeMockStream();
    getUserMedia.mockResolvedValue(stream);

    await service.start({ sourceId: "screen:0:0" });
    service.stop();

    expect(stream._track.stop).toHaveBeenCalled();
    expect(service.getStatus()).toEqual({
      running: false,
      sourceId: "screen:0:0",
      sourceName: null,
      width: null,
      height: null,
    });
  });
});
