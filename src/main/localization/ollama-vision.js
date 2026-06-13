const {
  buildMicroGridPrompt,
  parseGridNumberFromResponse,
} = require("../../shared/micro-grid");

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "llama3.2-vision";
const REQUEST_TIMEOUT_MS = 45_000;

function getOllamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function getOllamaVisionModel() {
  return process.env.OLLAMA_VISION_MODEL || DEFAULT_MODEL;
}

function isOllamaEnabled() {
  return process.env.OLLAMA_ENABLED !== "false";
}

async function identifyMicroGridNumber({ imageBase64, targetElement } = {}) {
  if (!isOllamaEnabled()) {
    return null;
  }

  if (!imageBase64) {
    throw new Error("imageBase64 is required.");
  }

  const response = await fetch(`${getOllamaBaseUrl()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: getOllamaVisionModel(),
      messages: [
        {
          role: "user",
          content: buildMicroGridPrompt(targetElement),
          images: [imageBase64],
        },
      ],
      stream: false,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload?.error || `Ollama vision error (${response.status})`,
    );
  }

  const text = payload?.message?.content ?? "";
  return parseGridNumberFromResponse(text);
}

module.exports = {
  identifyMicroGridNumber,
  isOllamaEnabled,
  getOllamaBaseUrl,
  getOllamaVisionModel,
};
