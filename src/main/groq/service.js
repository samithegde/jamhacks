const { parseJsonFromModelText } = require("../ai/parse-model-json");
const {
  buildImplementationMessages,
  resolveImplementationSchema,
} = require("../ai/implement-widget");

const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const KNOWN_GROQ_MODELS = new Set([
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "llama-3.1-70b-versatile",
  "llama3-70b-8192",
  "llama3-8b-8192",
  "mixtral-8x7b-32768",
  "gemma2-9b-it",
]);
const GROQ_API_BASE = "https://api.groq.com/openai/v1";
const DEFAULT_GROQ_TIMEOUT_MS = 120_000;

function getApiKey() {
  return process.env.GROQ_API_KEY?.trim() || "";
}

function getModel() {
  const configured = process.env.GROQ_MODEL?.trim() || "";
  if (!configured) return DEFAULT_MODEL;
  if (KNOWN_GROQ_MODELS.has(configured)) return configured;
  console.warn(
    `[groq] Unknown GROQ_MODEL "${configured}" — falling back to ${DEFAULT_MODEL}. ` +
      "See https://console.groq.com/docs/models",
  );
  return DEFAULT_MODEL;
}

function isConfigured() {
  return Boolean(getApiKey());
}

function getGroqTimeoutMs() {
  const raw = process.env.GROQ_REQUEST_TIMEOUT_MS?.trim();
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_GROQ_TIMEOUT_MS;
}

async function fetchGroq(url, options, timeoutMs = DEFAULT_GROQ_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Groq request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function generateStructuredChat({ systemPrompt, messages, schemaDescription }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured. Add it to your .env file.");
  }

  const model = getModel();
  const url = `${GROQ_API_BASE}/chat/completions`;

  const schemaHint = schemaDescription
    ? `\n\nRequired JSON schema:\n${JSON.stringify(schemaDescription, null, 2)}`
    : "";

  const response = await fetchGroq(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              systemPrompt +
              "\n\nReturn ONLY a single valid JSON object matching the required schema. " +
              "Do not use markdown code fences or any text outside the JSON object." +
              schemaHint,
          },
          ...messages,
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    },
    getGroqTimeoutMs(),
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.error ||
      `Groq API error (${response.status})`;
    throw new Error(message);
  }

  const text = String(payload?.choices?.[0]?.message?.content || "").trim();
  if (!text) {
    throw new Error("Groq returned an empty response.");
  }

  const { parsed } = parseJsonFromModelText(text, { label: "Groq" });
  return { object: parsed, model, text };
}

async function implementInteractiveWidget({
  designPlan,
  widgetType,
  title,
  explanation,
  spokenSummary,
  recipe,
  userPrompt,
  screenContext,
  geminiPlanText,
} = {}) {
  const messages = buildImplementationMessages({
    designPlan,
    widgetType,
    title,
    explanation,
    spokenSummary,
    recipe,
    userPrompt,
    screenContext,
    geminiPlanText,
  });

  const result = await generateStructuredChat({
    systemPrompt: messages.systemPrompt,
    messages: [{ role: "user", content: messages.userPrompt }],
    schemaDescription: resolveImplementationSchema(),
  });

  return result;
}

module.exports = {
  getApiKey,
  getModel,
  isConfigured,
  generateStructuredChat,
  implementInteractiveWidget,
};
