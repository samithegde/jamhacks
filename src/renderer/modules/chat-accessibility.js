const DEFAULT_PREFERENCES = {
  largeText: false,
  audio: false,
  magnify: false,
  screenReader: false,
  voiceControl: false,
  highContrast: false,
};

export function initChatAccessibility() {
  applyPreferences(DEFAULT_PREFERENCES);

  window.aiTools?.onAccessibilityPreferencesChanged?.((preferences) => {
    applyPreferences(preferences);
  });

  window.aiTools?.getAccessibilityPreferences?.()
    .then((preferences) => applyPreferences(preferences))
    .catch((error) => {
      console.error("Failed to load chat accessibility preferences:", error);
    });

  window.addEventListener("assistant-accessibility-preferences", (event) => {
    applyPreferences(event.detail);
  });
}

function normalizePreferences(preferences = {}) {
  return {
    largeText: Boolean(preferences.largeText),
    audio: Boolean(preferences.audio),
    magnify: Boolean(preferences.magnify),
    screenReader: Boolean(preferences.screenReader),
    voiceControl: Boolean(preferences.voiceControl),
    highContrast: Boolean(preferences.highContrast),
  };
}

function applyPreferences(preferences = {}) {
  const normalized = normalizePreferences(preferences);

  document.body.classList.toggle(
    "chat-accessibility-large-text",
    normalized.largeText
  );
  document.body.classList.toggle(
    "chat-accessibility-high-contrast",
    normalized.highContrast
  );
  document.body.classList.toggle("chat-accessibility-audio", normalized.audio);
  document.body.classList.toggle("chat-accessibility-magnify", normalized.magnify);
  document.body.classList.toggle(
    "chat-accessibility-screen-reader",
    normalized.screenReader
  );
  document.body.classList.toggle(
    "chat-accessibility-voice-control",
    normalized.voiceControl
  );
}
