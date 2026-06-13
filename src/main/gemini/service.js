const DEFAULT_MODEL = "gemini-2.5-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    explanation: {
      type: "STRING",
      description: "A clean, concise 1-sentence vocal instruction.",
    },
    plan: {
      type: "ARRAY",
      description: "A set of sequential actions to execute on the screen.",
      items: {
        type: "OBJECT",
        properties: {
          x: {
            type: "INTEGER",
            description:
              "The exact absolute X coordinate of the top-left corner of the item.",
          },
          y: {
            type: "INTEGER",
            description:
              "The exact absolute Y coordinate of the top-left corner of the item.",
          },
          w: {
            type: "INTEGER",
            description: "The width of the item in pixels.",
          },
          h: {
            type: "INTEGER",
            description: "The height of the item in pixels.",
          },
          label: {
            type: "STRING",
            description: "The short description or name of the button.",
          },
        },
        required: ["x", "y", "w", "h", "label"],
      },
    },
  },
  required: ["explanation", "plan"],
};

const SYSTEM_PROMPT =
  "Your name is Clarity. You help users learn by guiding them through what's on their screen." +
  "Each user message may include a screenshot. Use it to locate UI elements and return pixel-accurate bounding boxes." +
  "Respond only with JSON matching the schema: explanation is one spoken sentence; plan is an ordered list of screen targets (x, y, w, h, label)." +
  "Use an empty plan when no on-screen guidance is needed.";

function getApiKey() {
  return (
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GEMENI_API_KEY?.trim() ||
    null
  );
}

function getModel() {
  return (
    process.env.GEMINI_MODEL?.trim() ||
    process.env.GEMENI_MODEL?.trim() ||
    DEFAULT_MODEL
  );
}

function toGeminiParts(msg) {
  const parts = [];

  if (msg?.text) {
    parts.push({ text: String(msg.text) });
  }

  for (const attachment of msg?.attachments || []) {
    if (attachment?.textContent) {
      const label = attachment.name ? `[File: ${attachment.name}]\n` : "";
      parts.push({ text: `${label}${attachment.textContent}` });
      continue;
    }

    if (attachment?.base64 && attachment?.mimeType) {
      parts.push({
        inlineData: {
          mimeType: attachment.mimeType,
          data: attachment.base64,
        },
      });
    }
  }

  return parts;
}

function messageHasContent(msg) {
  if (!msg || (msg.sender !== "user" && msg.sender !== "system")) return false;
  return Boolean(msg.text) || Boolean(msg.attachments?.length);
}

function toGeminiContents(history) {
  return history
    .filter(messageHasContent)
    .map((msg) => ({
      role: msg.sender === "user" ? "user" : "model",
      parts: toGeminiParts(msg),
    }))
    .filter((entry) => entry.parts.length > 0);
}

function extractText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function normalizePlanItem(item) {
  const x = Math.round(Number(item?.x));
  const y = Math.round(Number(item?.y));
  const w = Math.round(Number(item?.w));
  const h = Math.round(Number(item?.h));
  const label = String(item?.label ?? "").trim();

  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
    return null;
  }

  return { x, y, w, h, label };
}

function parseStructuredResponse(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini returned invalid JSON.");
  }

  if (typeof parsed?.explanation !== "string" || !parsed.explanation.trim()) {
    throw new Error("Gemini response missing explanation.");
  }

  if (!Array.isArray(parsed.plan)) {
    throw new Error("Gemini response missing plan.");
  }

  const plan = parsed.plan
    .map(normalizePlanItem)
    .filter((item) => item !== null);

  return {
    explanation: parsed.explanation.trim(),
    plan,
    text,
  };
}

async function chat(history) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured. Add it to your .env file.");
  }

  const contents = toGeminiContents(history);
  if (!contents.length) {
    throw new Error("No messages to send.");
  }

  const model = getModel();
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.error ||
      `Gemini API error (${response.status})`;
    throw new Error(message);
  }

  const text = extractText(payload);
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  const structured = parseStructuredResponse(text);
  return { ...structured, model };
}

module.exports = {
  chat,
  getApiKey,
  getModel,
  RESPONSE_SCHEMA,
};
