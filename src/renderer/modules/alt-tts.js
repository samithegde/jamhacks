let currentAudio = null;
let badge = null;
// Prevents Alt keyup from double-firing when mouseup already triggered speech
let ignoreNextAltKeyup = false;

export function initAltTts() {
  badge = document.createElement("div");
  badge.className = "alt-tts-badge hidden";
  badge.setAttribute("role", "status");
  badge.setAttribute("aria-live", "polite");
  badge.innerHTML =
    '<span class="material-symbols-outlined" aria-hidden="true">volume_up</span>Reading…';
  document.body.appendChild(badge);

  // Hold Alt + drag to select with mouse → speak on release
  document.addEventListener("mouseup", (e) => {
    if (!e.altKey) return;
    const text = window.getSelection()?.toString().trim();
    if (!text) return;
    ignoreNextAltKeyup = true;
    speakText(text);
  });

  // Press Alt with text already selected (keyboard selection) → speak
  // Press Alt while speaking → stop
  document.addEventListener("keyup", (e) => {
    if (e.key !== "Alt") return;

    if (ignoreNextAltKeyup) {
      ignoreNextAltKeyup = false;
      return;
    }

    if (currentAudio) {
      stopSpeech();
      return;
    }

    const text = window.getSelection()?.toString().trim();
    if (text) speakText(text);
  });
}

function stopSpeech() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  window.speechSynthesis?.cancel?.();
  badge?.classList.add("hidden");
}

async function speakText(text) {
  stopSpeech();
  badge?.classList.remove("hidden");

  try {
    const result = await window.aiTools?.speakAccessibility(text);
    if (!result?.base64) throw new Error("No audio data");

    const audio = new Audio(
      `data:${result.mimeType || "audio/mpeg"};base64,${result.base64}`
    );
    currentAudio = audio;
    audio.onended = () => {
      if (currentAudio === audio) {
        currentAudio = null;
        badge?.classList.add("hidden");
      }
    };
    await audio.play();
  } catch {
    badge?.classList.add("hidden");
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.rate = 0.95;
      window.speechSynthesis.speak(utt);
    }
  }
}
