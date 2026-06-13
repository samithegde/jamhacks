const DEFAULT_MODEL = "eleven_multilingual_v2";
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";

function getApiKey() {
  return process.env.ELEVENLABS_API_KEY?.trim() || null;
}

function getVoiceId() {
  return process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE_ID;
}

function getModel() {
  return process.env.ELEVENLABS_MODEL?.trim() || DEFAULT_MODEL;
}

async function createSpeech(text) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not configured. Add it to your .env file.");
  }

  const cleanText = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!cleanText) {
    throw new Error("Text is required for ElevenLabs speech.");
  }

  const voiceId = getVoiceId();
  const url = `${ELEVENLABS_API_BASE}/text-to-speech/${encodeURIComponent(
    voiceId
  )}?output_format=mp3_44100_128`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: cleanText,
      model_id: getModel(),
    }),
  });

  if (!response.ok) {
    let message = `ElevenLabs request failed (${response.status})`;
    try {
      const payload = await response.json();
      message = payload?.detail?.message || payload?.message || message;
    } catch {
      // ElevenLabs can return non-JSON errors; keep the status message.
    }
    throw new Error(message);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  return {
    mimeType: response.headers.get("content-type") || "audio/mpeg",
    base64: audio.toString("base64"),
  };
}

module.exports = { createSpeech };
