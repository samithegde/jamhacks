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

function updateMagnifier(enabled) {
  const magnifier = document.getElementById("accessibility-magnifier");
  if (!magnifier) return;

  magnifier.classList.toggle("is-active", enabled);

  if (!enabled) {
    if (magnifierAnimationFrame) {
      cancelAnimationFrame(magnifierAnimationFrame);
      magnifierAnimationFrame = null;
    }
    return;
  }

  const move = () => {
    const time = Date.now() / 1200;
    const x = window.innerWidth / 2 + Math.cos(time) * Math.min(120, window.innerWidth * 0.12);
    const y = window.innerHeight / 2 + Math.sin(time * 0.85) * Math.min(80, window.innerHeight * 0.1);
    magnifier.style.left = `${x}px`;
    magnifier.style.top = `${y}px`;
    magnifierAnimationFrame = requestAnimationFrame(move);
  };

  if (!magnifierAnimationFrame) move();
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
