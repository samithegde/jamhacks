const DEFAULT_PREFERENCES = {
  largeText: false,
  audio: false,
  magnify: false,
  screenReader: false,
  voiceControl: false,
  highContrast: false,
};

let preferences = { ...DEFAULT_PREFERENCES };
let recognition = null;
let audioContext = null;
let magnifierAnimationFrame = null;
let magnifierMoveHandler = null;
let magnifierStream = null;
let magnifierVideoEl = null;
let magnifierCursorX = 0;
let magnifierCursorY = 0;

const MAGNIFIER_SIZE = 200;
const MAGNIFIER_ZOOM = 2.5;
let currentSpeechAudio = null;

export function initAccessibilityOverlay() {
  applyPreferences(preferences);

  window.aiTools?.onAccessibilityPreferencesChanged?.((nextPreferences) => {
    setPreferences(nextPreferences);
  });

  window.aiTools?.getAccessibilityPreferences?.()
    .then((nextPreferences) => {
      setPreferences(nextPreferences);
    })
    .catch((error) => {
      console.error("Failed to load accessibility preferences:", error);
    });

  window.addEventListener("overlay-accessibility-preferences", (event) => {
    setPreferences(event.detail);
  });
}

export function getAccessibilityPreferences() {
  return { ...preferences };
}

export async function announceAccessibilityMessage(message) {
  playAudioCue(660);
  if (!preferences.screenReader) return;
  const text = String(message ?? "").replace(/\s+/g, " ").trim();
  if (!text) return;

  try {
    await playElevenLabsSpeech(text);
    return;
  } catch (error) {
    console.warn("ElevenLabs accessibility speech failed:", error);
  }

  playBrowserSpeech(text);
}

async function playElevenLabsSpeech(text) {
  if (!window.aiTools?.speakAccessibility) {
    throw new Error("ElevenLabs speech bridge is unavailable.");
  }

  stopCurrentSpeechAudio();
  window.speechSynthesis?.cancel?.();

  const audio = await window.aiTools.speakAccessibility(text);
  if (!audio?.base64) {
    throw new Error("ElevenLabs returned no audio.");
  }

  const mimeType = audio.mimeType || "audio/mpeg";
  currentSpeechAudio = new Audio(`data:${mimeType};base64,${audio.base64}`);
  currentSpeechAudio.onended = () => {
    currentSpeechAudio = null;
  };
  await currentSpeechAudio.play();
}

function playBrowserSpeech(text) {
  if (!("speechSynthesis" in window)) return;

  stopCurrentSpeechAudio();
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function stopCurrentSpeechAudio() {
  if (!currentSpeechAudio) return;
  currentSpeechAudio.pause();
  currentSpeechAudio.currentTime = 0;
  currentSpeechAudio = null;
}

export function playAudioCue(frequency = 520) {
  if (!preferences.audio) return;

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  audioContext ??= new AudioContext();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.12);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.13);
}

function normalizePreferences(nextPreferences = {}) {
  return {
    largeText: Boolean(nextPreferences.largeText),
    audio: Boolean(nextPreferences.audio),
    magnify: Boolean(nextPreferences.magnify),
    screenReader: Boolean(nextPreferences.screenReader),
    voiceControl: Boolean(nextPreferences.voiceControl),
    highContrast: Boolean(nextPreferences.highContrast),
  };
}

function setPreferences(nextPreferences = {}) {
  preferences = normalizePreferences(nextPreferences);
  applyPreferences(preferences);
}

function applyPreferences(nextPreferences) {
  document.body.classList.toggle(
    "accessibility-large-text",
    nextPreferences.largeText
  );
  document.body.classList.toggle("accessibility-audio", nextPreferences.audio);
  document.body.classList.toggle("accessibility-magnify", nextPreferences.magnify);
  document.body.classList.toggle(
    "accessibility-high-contrast",
    nextPreferences.highContrast
  );
  document.body.classList.toggle(
    "accessibility-screen-reader",
    nextPreferences.screenReader
  );
  document.body.classList.toggle(
    "accessibility-voice-control",
    nextPreferences.voiceControl
  );

  updateStatus(nextPreferences);
  updateMagnifier(nextPreferences.magnify);
  updateVoiceControl(nextPreferences.voiceControl);
}

function updateStatus(nextPreferences) {
  const status = document.getElementById("accessibility-status");
  if (!status) return;

  const labels = [
    nextPreferences.largeText && "Large text",
    nextPreferences.audio && "Audio cues",
    nextPreferences.magnify && "Magnify",
    nextPreferences.screenReader && "Screen reader",
    nextPreferences.voiceControl && "Voice control",
    nextPreferences.highContrast && "High contrast",
  ].filter(Boolean);

  status.textContent = labels.length
    ? `Accessibility: ${labels.join(", ")}`
    : "";
  status.classList.toggle("hidden", labels.length === 0);
}

function updateVoiceControl(enabled) {
  const status = document.getElementById("accessibility-status");

  if (!enabled) {
    stopRecognition();
    return;
  }

  const Recognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    if (status) status.textContent = `${status.textContent} (voice unavailable)`;
    return;
  }

  if (recognition) return;

  recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.onresult = (event) => {
    const latest = event.results[event.results.length - 1];
    const transcript = latest?.[0]?.transcript?.toLowerCase().trim() ?? "";
    handleVoiceCommand(transcript);
  };

  recognition.onend = () => {
    if (preferences.voiceControl) {
      try {
        recognition.start();
      } catch {
        // SpeechRecognition can throw if the browser is already starting it.
      }
    }
  };

  try {
    recognition.start();
  } catch {
    if (status) status.textContent = `${status.textContent} (voice starting)`;
  }
}

async function startMagnifierCapture() {
  if (magnifierStream || !window.capture?.listScreenSources) return;

  try {
    const sources = await window.capture.listScreenSources({ types: ["screen"] });
    if (!sources?.length) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sources[0].id,
          maxFrameRate: 30,
        },
      },
    });

    magnifierStream = stream;
    magnifierVideoEl = document.createElement("video");
    magnifierVideoEl.muted = true;
    magnifierVideoEl.autoplay = true;
    magnifierVideoEl.playsInline = true;
    magnifierVideoEl.style.cssText =
      "position:absolute;visibility:hidden;pointer-events:none;width:1px;height:1px;";
    magnifierVideoEl.srcObject = stream;
    document.body.appendChild(magnifierVideoEl);
    await magnifierVideoEl.play();
  } catch (err) {
    console.warn("[magnifier] screen capture failed:", err);
  }
}

function stopMagnifierCapture() {
  magnifierStream?.getTracks().forEach((t) => t.stop());
  magnifierStream = null;
  magnifierVideoEl?.remove();
  magnifierVideoEl = null;
}

function renderMagnifierFrame() {
  const canvas = document.getElementById("accessibility-magnifier-canvas");
  const video = magnifierVideoEl;

  if (canvas && video?.videoWidth) {
    const scaleX = video.videoWidth / window.screen.width;
    const scaleY = video.videoHeight / window.screen.height;
    const cropW = (MAGNIFIER_SIZE / MAGNIFIER_ZOOM) * scaleX;
    const cropH = (MAGNIFIER_SIZE / MAGNIFIER_ZOOM) * scaleY;
    const srcX = Math.max(0, Math.min(magnifierCursorX * scaleX - cropW / 2, video.videoWidth - cropW));
    const srcY = Math.max(0, Math.min(magnifierCursorY * scaleY - cropH / 2, video.videoHeight - cropH));

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(MAGNIFIER_SIZE / 2, MAGNIFIER_SIZE / 2, MAGNIFIER_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(video, srcX, srcY, cropW, cropH, 0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE);
    ctx.restore();
  }

  magnifierAnimationFrame = requestAnimationFrame(renderMagnifierFrame);
}

function updateMagnifier(enabled) {
  const magnifier = document.getElementById("accessibility-magnifier");
  if (!magnifier) return;

  magnifier.classList.toggle("is-active", enabled);

  if (magnifierAnimationFrame) {
    cancelAnimationFrame(magnifierAnimationFrame);
    magnifierAnimationFrame = null;
  }
  if (magnifierMoveHandler) {
    window.removeEventListener("pointermove", magnifierMoveHandler);
    magnifierMoveHandler = null;
  }

  if (!enabled) {
    stopMagnifierCapture();
    return;
  }

  const canvas = document.getElementById("accessibility-magnifier-canvas");
  if (canvas) {
    canvas.width = MAGNIFIER_SIZE;
    canvas.height = MAGNIFIER_SIZE;
  }

  magnifierCursorX = window.innerWidth / 2;
  magnifierCursorY = window.innerHeight / 2;
  magnifier.style.left = `${magnifierCursorX}px`;
  magnifier.style.top = `${magnifierCursorY}px`;

  startMagnifierCapture();
  renderMagnifierFrame();

  magnifierMoveHandler = (e) => {
    magnifierCursorX = e.clientX;
    magnifierCursorY = e.clientY;
    magnifier.style.left = `${e.clientX}px`;
    magnifier.style.top = `${e.clientY}px`;
  };
  window.addEventListener("pointermove", magnifierMoveHandler);
}

function stopRecognition() {
  if (!recognition) return;
  const current = recognition;
  recognition = null;
  current.onend = null;
  current.stop();
}

function handleVoiceCommand(command) {
  if (!command) return;
  playAudioCue(780);

  if (command.includes("clear")) {
    window.aiTools?.clearHighlights?.();
  }

  if (command.includes("hide cursor") || command.includes("stop cursor")) {
    window.aiTools?.setCursorVisible?.(false);
  }
}
