const {
  buildRecipeBlock,
  resolveSystemPrompt,
  normalizePlanItem,
  TUTOR_PLAN_RETRIEVAL_SYSTEM_PROMPT,
} = require("../gemini/service");
const { parseJsonFromModelText } = require("../ai/parse-model-json");
const {
  buildImplementationMessages,
  resolveImplementationSchema,
} = require("../ai/implement-widget");

const DEFAULT_MODEL = "llama3.3";
const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const SCREENSHOT_OMITTED_NOTE =
  "[Screenshot attached — not sent to Ollama. On-screen pointing is refined by Moondream after planning.]";

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    explanation: { type: "string" },
    plan: {
      type: "array",
      items: {
        type: "object",
        properties: {
          action: { type: "string" },
          bbox: { type: "array", items: { type: "integer" } },
          x: { type: "integer" },
          y: { type: "integer" },
          w: { type: "integer" },
          h: { type: "integer" },
          description: { type: "string" },
          label: { type: "string" },
          isFinal: { type: "boolean" },
        },
        required: ["action", "description"],
      },
    },
  },
  required: ["explanation", "plan"],
};

const PLAN_RETRIEVAL_JSON_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string" },
    ragQuery: { type: "string" },
    needsOnScreenGuidance: { type: "boolean" },
    targetApp: { type: "string" },
  },
  required: ["intent", "ragQuery", "needsOnScreenGuidance"],
};

const PLAN_RETRIEVAL_SYSTEM_PROMPT =
  "You are an intent parser for a screen-navigation assistant called Clarity. " +
  "Given the user's latest message and conversation history, produce a JSON object with: " +
  "intent (concise statement of what the user wants to accomplish), " +
  "ragQuery (an optimized search query for a how-to knowledge base — rephrase the request as a question), " +
  "needsOnScreenGuidance (true when the user needs step-by-step UI navigation; false for greetings or pure Q&A), " +
  "targetApp (the application the user is working in if detectable, otherwise omit).";

const STEP_SYSTEM_PROMPT =
  "You are a screen-navigation assistant mid-task. " +
  "The user's original goal and the last action taken are provided as text only (no screenshot). " +
  "Return the SINGLE next action to take based on workflow context, " +
  "or an empty plan array if the task is fully complete or cannot proceed. " +
  "Return bbox as [ymin, xmin, ymax, xmax] on a 0-1000 scale for the next target. " +
  "Set isFinal=true on the plan item when it is the last action the user must take. " +
  "The explanation field should be a brief internal note (not spoken). " +
  "Never return more than one plan item.";

function getBaseUrl() {
  return (process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
}

function getModel() {
  return process.env.OLLAMA_MODEL?.trim() || DEFAULT_MODEL;
}

function messageHasContent(msg) {
  if (!msg || (msg.sender !== "user" && msg.sender !== "system")) return false;
  return Boolean(msg.text) || Boolean(msg.attachments?.length);
}

function toOllamaMessage(msg) {
  let content = msg?.text ? String(msg.text) : "";

  for (const attachment of msg?.attachments || []) {
    if (attachment?.textContent) {
      const label = attachment.name ? `[File: ${attachment.name}]\n` : "";
      content = content
        ? `${content}\n\n${label}${attachment.textContent}`
        : `${label}${attachment.textContent}`;
      continue;
    }

    if (attachment?.base64 && attachment?.mimeType?.startsWith("image/")) {
      content = content
        ? `${content}\n\n${SCREENSHOT_OMITTED_NOTE}`
        : SCREENSHOT_OMITTED_NOTE;
    }
  }

  return {
    role: msg.sender === "user" ? "user" : "assistant",
    content: content.trim(),
  };
}

function toOllamaMessages(history) {
  return history
    .filter(messageHasContent)
    .map(toOllamaMessage)
    .filter((entry) => entry.content);
}

function parseStructuredResponse(text) {
  const { parsed, text: normalizedText } = parseJsonFromModelText(text);

  if (typeof parsed?.explanation !== "string" || !parsed.explanation.trim()) {
    throw new Error("Ollama response missing explanation.");
  }

  const plan = Array.isArray(parsed.plan)
    ? parsed.plan.map(normalizePlanItem).filter((item) => item !== null)
    : [];

  return {
    explanation: parsed.explanation.trim(),
    plan,
    text: normalizedText,
  };
}

function resolveStepSystemPrompt(mode) {
  if (mode === "tutor") {
    return (
      "You are Clarity in Tutor Mode mid-lesson. " +
      "The user's original study question and the last highlight action are provided as text only (no screenshot). " +
      "Return the SINGLE next highlight if the user still needs on-screen emphasis, " +
      "or an empty plan array if the concept is fully explained. " +
      "Prefer action='highlight' with bbox on a 0-1000 scale. " +
      "The explanation field is a brief internal note (not spoken). " +
      "Never return more than one plan item."
    );
  }

  return STEP_SYSTEM_PROMPT;
}

function formatOllamaError(rawMessage, model) {
  const message = String(rawMessage || "Unknown Ollama error");
  const lower = message.toLowerCase();

  if (lower.includes("not found") && lower.includes("model")) {
    return (
      `Ollama model "${model}" is not installed. Run: ollama pull ${model}`
    );
  }

  if (lower.includes("mllama") || lower.includes("unknown model architecture")) {
    return (
      `Ollama cannot load vision model "${model}" (mllama architecture). ` +
      "Update Ollama to the latest version, then run: " +
      `ollama pull ${model}`
    );
  }

  return message;
}

async function listInstalledModels() {
  const url = `${getBaseUrl()}/api/tags`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Ollama tags error (${response.status})`);
  }

  const payload = await response.json().catch(() => ({}));
  return (payload?.models || [])
    .map((entry) => String(entry?.name || "").trim())
    .filter(Boolean);
}

function modelIsInstalled(modelName, installedModels) {
  const target = modelName.trim();
  return installedModels.some(
    (name) => name === target || name.startsWith(`${target}:`),
  );
}

async function verifyModelReady() {
  const model = getModel();
  let installedModels;

  try {
    installedModels = await listInstalledModels();
  } catch (err) {
    console.warn(
      `[LLM] Could not reach Ollama at ${getBaseUrl()}: ${err.message}`,
    );
    return;
  }

  if (!modelIsInstalled(model, installedModels)) {
    console.warn(
      `[LLM] Ollama model "${model}" is not installed. Run: ollama pull ${model}`,
    );
    return;
  }

  console.log(`[LLM] Ollama model "${model}" is available.`);
}

const OLLAMA_JSON_SUFFIX =
  " Return ONLY a single valid JSON object matching the required schema. " +
  "Do not use markdown code fences or any text outside the JSON object.";

const OLLAMA_TEXT_ONLY_SUFFIX =
  " IMPORTANT: You cannot see the user's screen in this pass (text-only). " +
  "Screenshots are omitted; Moondream handles on-screen localization after your plan. " +
  "Default to plan=[] for conversational replies. " +
  "When UI guidance is needed, name targets clearly in plan descriptions and use bbox estimates.";

async function generateChat({ systemPrompt, messages, schema, textOnly = true }) {
  const model = getModel();
  const url = `${getBaseUrl()}/api/chat`;
  const suffix = (textOnly ? OLLAMA_TEXT_ONLY_SUFFIX : "") + OLLAMA_JSON_SUFFIX;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: systemPrompt + suffix,
        },
        ...messages,
      ],
      format: schema,
      stream: false,
      options: {
        temperature: 0.2,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const raw =
      payload?.error ||
      payload?.message ||
      `Ollama API error (${response.status})`;
    throw new Error(formatOllamaError(raw, model));
  }

  const text = String(payload?.message?.content || "").trim();
  if (!text) {
    throw new Error("Ollama returned an empty response.");
  }

  return { text, model };
}

async function chat(history, { recipe, mode } = {}) {
  const messages = toOllamaMessages(history);
  if (!messages.length) {
    throw new Error("No messages to send.");
  }

  const systemPrompt =
    resolveSystemPrompt(mode) + buildRecipeBlock(recipe, { mode });
  const { text, model } = await generateChat({
    systemPrompt,
    messages,
    schema: RESPONSE_JSON_SCHEMA,
  });

  let structured;
  try {
    structured = parseStructuredResponse(text);
  } catch (error) {
    error.rawResponse = text;
    throw error;
  }

  const retrieval = recipe
    ? {
        ragQuery: recipe.ragQuery,
        sources: [...new Set(recipe.chunks.map((c) => c.source))],
      }
    : null;

  return { ...structured, model, retrieval };
}

async function chatStep(
  goal,
  lastActionDescription,
  _screenshotBase64,
  { recipe, mode } = {},
) {
  let userText =
    `Original goal: ${goal}\n` +
    `Last action completed: ${lastActionDescription}\n` +
    `What is the single next step? Return empty plan if done.\n` +
    SCREENSHOT_OMITTED_NOTE;

  if (recipe?.chunks?.length) {
    const recipeSummary = recipe.chunks.map((c) => c.text).join("\n\n");
    userText = `[Workflow recipe]\n${recipeSummary}\n\n${userText}`;
  }

  const userMessage = {
    role: "user",
    content: userText,
  };

  const { text, model } = await generateChat({
    systemPrompt: resolveStepSystemPrompt(mode),
    messages: [userMessage],
    schema: RESPONSE_JSON_SCHEMA,
  });

  try {
    return { ...parseStructuredResponse(text), model };
  } catch (error) {
    error.rawResponse = text;
    throw error;
  }
}

async function planRetrieval(userMessage, history, { mode } = {}) {
  const recentMessages = history
    .filter(
      (m) => m.sender === "user" || (m.sender === "system" && m.rawResponse),
    )
    .slice(-6)
    .map((m) => ({
      role: m.sender === "user" ? "user" : "assistant",
      content: m.text || "",
    }))
    .filter((entry) => entry.content);

  const messages = [
    ...recentMessages,
    { role: "user", content: `Latest user message: ${userMessage}` },
  ];

  const retrievalPrompt =
    mode === "tutor"
      ? TUTOR_PLAN_RETRIEVAL_SYSTEM_PROMPT
      : PLAN_RETRIEVAL_SYSTEM_PROMPT;

  const { text } = await generateChat({
    systemPrompt: retrievalPrompt,
    messages,
    schema: PLAN_RETRIEVAL_JSON_SCHEMA,
  });

  try {
    return parseJsonFromModelText(text, { label: "Ollama plan parser" }).parsed;
  } catch {
    return {
      intent: userMessage,
      ragQuery: userMessage,
      needsOnScreenGuidance: true,
    };
  }
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

  const { text, model } = await generateChat({
    systemPrompt: messages.systemPrompt,
    messages: [{ role: "user", content: messages.userPrompt }],
    schema: resolveImplementationSchema(),
    textOnly: false,
  });

  const { parsed } = parseJsonFromModelText(text, { label: "Ollama widget implementer" });
  return { object: parsed, model, text };
}

module.exports = {
  chat,
  chatStep,
  planRetrieval,
  implementInteractiveWidget,
  getModel,
  getBaseUrl,
  verifyModelReady,
};
