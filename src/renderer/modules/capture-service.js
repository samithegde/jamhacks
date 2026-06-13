import { AudioCaptureService } from "../capture/audio-capture.js";
import { ScreenCaptureService } from "../capture/screen-capture.js";

let audioCapture = null;
let screenCapture = null;

export function getCaptureServices() {
  if (!audioCapture) {
    audioCapture = new AudioCaptureService();
  }

  if (!screenCapture) {
    screenCapture = new ScreenCaptureService();
  }

  return { audioCapture, screenCapture };
}

export function initCaptureServices() {
  const services = getCaptureServices();
  window.__clarityCapture = services;
  return services;
}
