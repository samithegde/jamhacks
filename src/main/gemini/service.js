const { parseBboxArray } = require("../../shared/localization-coords");
const {
  buildNavigationStepUserText,
  buildRecipeBlock,
  buildNavigationSystemAddon,
} = require("../ai/step-context");

const DEFAULT_MODEL = "gemini-2.5-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_TIMEOUT_MS = 90_000;
const WIDGET_GEMINI_TIMEOUT_MS = 120_000;
const GEMINI_MAX_RETRIES = 3;
const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

function getGeminiTimeoutMs(kind = "default") {
  const raw = process.env.GEMINI_REQUEST_TIMEOUT_MS?.trim();
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return kind === "widget" ? WIDGET_GEMINI_TIMEOUT_MS : DEFAULT_GEMINI_TIMEOUT_MS;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getGeminiErrorMessage(payload, status) {
  return (
    payload?.error?.message ||
    payload?.error ||
    `Gemini API error (${status})`
  );
}

function isRetryableGeminiFailure(response, payload) {
  const message = String(getGeminiErrorMessage(payload, response?.status)).toLowerCase();
  if (
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("resource exhausted")
  ) {
    return false;
  }

  if (RETRYABLE_HTTP_STATUSES.has(response?.status)) return true;

  return (
    message.includes("authentication backend unavailable") ||
    message.includes("service unavailable") ||
    message.includes("overloaded") ||
    message.includes("internal error")
  );
}

function isRetryableGeminiNetworkError(error) {
  if (!error || error.name === "AbortError") return false;
  const message = String(error.message || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("socket") ||
    message.includes("authentication backend unavailable")
  );
}

async function fetchGemini(url, options, timeoutMs = DEFAULT_GEMINI_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Gemini request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function requestGemini(url, options, timeoutMs = DEFAULT_GEMINI_TIMEOUT_MS) {
  let lastError = new Error("Gemini request failed.");

  for (let attempt = 0; attempt < GEMINI_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchGemini(url, options, timeoutMs);
      const payload = await response.json().catch(() => ({}));

      if (response.ok) return payload;

      const message = getGeminiErrorMessage(payload, response.status);
      lastError = new Error(message);

      if (!isRetryableGeminiFailure(response, payload) || attempt === GEMINI_MAX_RETRIES - 1) {
        throw lastError;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === GEMINI_MAX_RETRIES - 1 || !isRetryableGeminiNetworkError(lastError)) {
        throw lastError;
      }
    }

    await sleep(500 * (attempt + 1));
  }

  throw lastError;
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    explanation: {
      type: "STRING",
      description:
        "A clean, concise spoken answer. One sentence for guidance; may be longer for general Q&A when plan is empty.",
    },
    plan: {
      type: "ARRAY",
      description:
        "Ordered on-screen actions. Return [] when no pointer or highlight is needed — most conversational, factual, or status-only replies should use an empty plan.",
      items: {
        type: "OBJECT",
        properties: {
          action: {
            type: "STRING",
            description:
              "The action type. Use 'cursor' for pointer guidance and 'highlight' for rectangular emphasis.",
          },
          bbox: {
            type: "ARRAY",
            description:
              "Normalized bounding box [ymin, xmin, ymax, xmax] on 0-1000 scale. Required for cursor/highlight when plan is non-empty.",
            items: { type: "INTEGER" },
          },
          x: {
            type: "INTEGER",
            description:
              "Legacy fallback absolute X coordinate in display pixels.",
          },
          y: {
            type: "INTEGER",
            description:
              "Legacy fallback absolute Y coordinate in display pixels.",
          },
          w: {
            type: "INTEGER",
            description:
              "Width in pixels. Required only when action is 'highlight' and bbox is omitted.",
          },
          h: {
            type: "INTEGER",
            description:
              "Height in pixels. Required only when action is 'highlight' and bbox is omitted.",
          },
          description: {
            type: "STRING",
            description:
              "What the cursor is pointing at — shown in the widget beside the pointer. Supports markdown (bold, lists, code, links).",
          },
          label: {
            type: "STRING",
            description: "Legacy alias for description.",
          },
          isFinal: {
            type: "BOOLEAN",
            description:
              "True when this is the last on-screen action for the user's goal. The user will see a Complete button instead of advancing by clicking the target area.",
          },
        },
        required: ["action", "description"],
      },
    },
  },
  required: ["explanation", "plan"],
};

const SYSTEM_PROMPT =
  "Your name is Clarity. You help users understand and navigate what's on their screen." +
  "Each user message may include a screenshot for context." +
  "Respond only with JSON matching the schema: explanation is the spoken reply; plan is an optional ordered list of on-screen actions." +
  "IMPORTANT: Default to plan=[]. Only add plan items when the user explicitly needs visual guidance — e.g. 'show me where', 'click', 'find', 'highlight', 'how do I open', or a multi-step UI walkthrough." +
  "Use plan=[] for greetings, general questions, definitions, summaries, confirmations, troubleshooting advice that does not require pointing, and any reply that can be fully understood from speech alone." +
  "When plan is non-empty, each item must include bbox as [ymin, xmin, ymax, xmax] on a 0-1000 scale relative to the screenshot, tightly framing the target UI element." +
  "For cursor guidance, use action='cursor' with bbox and description." +
  "For highlight emphasis, use action='highlight' with bbox and description." +
  "Each description explains what the pointer is targeting and appears in the on-screen widget beside the cursor." +
  "Descriptions may use markdown for the widget (bold, lists, inline code)." +
  "Set isFinal=true on the last plan item when the user only needs one more on-screen action to finish the goal.";

const TUTOR_SYSTEM_PROMPT =
  "Your name is Clarity in Tutor Mode — a patient study companion, not a task executor." +
  "Each user message may include a screenshot for context." +
  "Respond only with JSON matching the schema: explanation is the spoken reply; plan must always be []." +
  "When explaining concepts, ground answers in retrieved study material when provided." +
  "Include a markdown fenced code block with language mermaid inside explanation when a diagram clarifies the concept (flowcharts, cycles, hierarchies, processes)." +
  "Do not add on-screen pointer or highlight actions in tutor mode — explanations and diagrams belong in the learning widget only." +
  "Ask a brief check-for-understanding question at the end of explanation when appropriate." +
  "Descriptions may use markdown for the on-screen widget (bold, lists, inline code).";

const TUTOR_PLAN_RETRIEVAL_SYSTEM_PROMPT =
  "You are an intent parser for Clarity in Tutor Mode. " +
  "Given the user's latest message and conversation history, produce a JSON object with: " +
  "intent (concise statement of what the user wants to learn), " +
  "ragQuery (optimized search query for study materials — rephrase as a study question), " +
  "needsOnScreenGuidance (true when the user references something visible on screen — 'this', 'here', 'on my screen', 'in this diagram'; false for abstract concept questions), " +
  "targetApp (omit unless the user is clearly asking about a specific app's UI).";

const { parseJsonFromModelText } = require("../ai/parse-model-json");
const {
  GEMINI_INTERACTIVE_WIDGET_SCHEMA: INTERACTIVE_WIDGET_GEMINI_SCHEMA,
  GEMINI_LEARNING_WIDGET_PLAN_SCHEMA: LEARNING_WIDGET_SCHEMA,
  extractLastUserPrompt,
  userWantsInteractiveWidget,
} = require("../ai/learning-widget-schema");

const PLAN_RETRIEVAL_SCHEMA = {
  type: "OBJECT",
  properties: {
    intent: {
      type: "STRING",
      description: "Concise statement of what the user wants to accomplish.",
    },
    requiresRag: {
      type: "BOOLEAN",
      description:
        "True when the user needs external knowledge from documents (policies, wikis, how-to guides). False for pure UI navigation like clicking buttons or highlighting elements.",
    },
    query: {
      type: "STRING",
      description:
        "Summarized search query for retrieval when requiresRag is true; empty string otherwise.",
    },
    ragQuery: {
      type: "STRING",
      description:
        "Optimized search query for the knowledge base — more specific than the user's words.",
    },
    needsOnScreenGuidance: {
      type: "BOOLEAN",
      description:
        "True when the user needs step-by-step UI navigation; false for pure Q&A or conversational replies.",
    },
    targetApp: {
      type: "STRING",
      description:
        "The application the user is working in, if identifiable (e.g. 'Google Docs', 'Figma', 'VS Code').",
    },
    retrievalSource: {
      type: "STRING",
      description:
        "Where to fetch knowledge when requiresRag is true: 'context7' for library/framework/API documentation (React, Figma, npm packages); 'web' for policies, wikis, company docs, or general factual lookup.",
    },
    libraryName: {
      type: "STRING",
      description:
        "When retrievalSource is 'context7', the library or product name to search (e.g. 'react', 'figma', 'next.js'). Omit for web search.",
    },
  },
  required: ["intent", "requiresRag", "query", "needsOnScreenGuidance", "retrievalSource"],
};

const PLAN_RETRIEVAL_SYSTEM_PROMPT =
  "You are an intent router for a screen-navigation assistant called Clarity. " +
  "Given the user's latest message and conversation history, produce JSON with: " +
  "intent (concise statement of what the user wants), " +
  "requiresRag (true when external knowledge is needed; false for pure UI actions like 'Click Submit'), " +
  "query (optimized retrieval query when requiresRag is true; empty when false), " +
  "ragQuery (same as query), " +
  "needsOnScreenGuidance (true when step-by-step UI navigation is needed), " +
  "targetApp (application if detectable), " +
  "retrievalSource ('context7' for library/framework/API docs — React, Next.js, Figma API, npm packages; 'web' for company policies, HR wikis, general facts, or anything not in a code library), " +
  "libraryName (required when retrievalSource is 'context7' — e.g. 'react', 'figma', 'google docs'). " +
  "Examples: 'Click Submit' → requiresRag false; 'How do I use React useEffect?' → requiresRag true, retrievalSource context7, libraryName react; 'Fill form using vacation policy' → requiresRag true, retrievalSource web.";

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

function getRouterModel() {
  return (
    process.env.RAG_ROUTER_MODEL?.trim() ||
    process.env.GEMINI_MODEL?.trim() ||
    process.env.GEMENI_MODEL?.trim() ||
    "gemini-2.0-flash-lite"
  );
}

function normalizeRetrievalPlan(parsed, userMessage) {
  const requiresRag = Boolean(parsed?.requiresRag);
  const query = String(parsed?.query || parsed?.ragQuery || "").trim();
  const rawSource = String(parsed?.retrievalSource || "").trim().toLowerCase();
  const retrievalSource = rawSource === "context7" ? "context7" : "web";
  const libraryName = String(parsed?.libraryName || parsed?.targetApp || "").trim() || undefined;

  return {
    intent: String(parsed?.intent || userMessage).trim(),
    requiresRag,
    query: requiresRag ? query || userMessage : "",
    ragQuery: requiresRag ? query || userMessage : "",
    needsOnScreenGuidance: parsed?.needsOnScreenGuidance !== false,
    targetApp: parsed?.targetApp || undefined,
    retrievalSource: requiresRag ? retrievalSource : undefined,
    libraryName: requiresRag && retrievalSource === "context7" ? libraryName : undefined,
  };
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

const WIDGET_HISTORY_MAX_TURNS = 6;
const WIDGET_HISTORY_MAX_TEXT = 2000;
const WIDGET_SCREEN_CONTEXT_MAX = 1500;

function toGeminiWidgetContents(history, { screenContext } = {}) {
  const turns = history
    .filter(messageHasContent)
    .map((msg) => {
      const text = String(msg.text || "").trim().slice(0, WIDGET_HISTORY_MAX_TEXT);
      if (!text) return null;
      return {
        role: msg.sender === "user" ? "user" : "model",
        parts: [{ text }],
      };
    })
    .filter(Boolean)
    .slice(-WIDGET_HISTORY_MAX_TURNS);

  const context = String(screenContext || "").trim().slice(0, WIDGET_SCREEN_CONTEXT_MAX);
  if (context) {
    const last = turns[turns.length - 1];
    if (last?.role === "user") {
      last.parts.push({ text: `\n[SCREEN CONTEXT]\n${context}` });
    } else {
      turns.push({
        role: "user",
        parts: [{ text: `[SCREEN CONTEXT]\n${context}` }],
      });
    }
  }

  return turns;
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
  const rawAction = String(item?.action ?? "")
    .trim()
    .toLowerCase();
  const action =
    rawAction || (item?.w != null && item?.h != null ? "highlight" : "cursor");
  const description = String(item?.description ?? item?.label ?? "").trim();
  const isFinal = Boolean(item?.isFinal);
  const bbox = parseBboxArray(item?.bbox);

  if (!["cursor", "highlight"].includes(action)) {
    return null;
  }

  if (!description) {
    return null;
  }

  if (bbox) {
    return { action, bbox, label: description, description, isFinal };
  }

  const x = Math.round(Number(item?.x));
  const y = Math.round(Number(item?.y));
  if (![x, y].every(Number.isFinite)) {
    return null;
  }

  if (action === "cursor") {
    return { action, x, y, label: description, description, isFinal };
  }

  const w = Math.round(Number(item?.w));
  const h = Math.round(Number(item?.h));
  if (![w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
    return null;
  }

  return { action, x, y, w, h, label: description, description, isFinal };
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

function resolveSystemPrompt(mode, recipe) {
  const base = mode === "tutor" ? TUTOR_SYSTEM_PROMPT : SYSTEM_PROMPT;
  if (mode !== "tutor") {
    return base + buildNavigationSystemAddon(recipe);
  }
  return base;
}

function resolveStepSystemPrompt(mode) {
  if (mode === "tutor") {
    return (
      "You are Clarity in Tutor Mode mid-lesson. " +
      "The user's original study question and the last highlight action are provided. " +
      "Look at the new screenshot and return the SINGLE next highlight if the user still needs on-screen emphasis, " +
      "or an empty plan array if the concept is fully explained. " +
      "Prefer action='highlight' with bbox on a 0-1000 scale. " +
      "The explanation field is a brief internal note (not spoken). " +
      "Never return more than one plan item."
    );
  }

  return STEP_SYSTEM_PROMPT;
}

async function chat(history, { recipe, mode } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Add it to your .env file.",
    );
  }

  const contents = toGeminiContents(history);
  if (!contents.length) {
    throw new Error("No messages to send.");
  }

  const model = getModel();
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`;
  const systemPrompt = resolveSystemPrompt(mode, recipe) + buildRecipeBlock(recipe, { mode });

  const payload = await requestGemini(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  const text = extractText(payload);
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  const structured = parseStructuredResponse(text);

  const retrieval = recipe
    ? {
        ragQuery: recipe.ragQuery,
        retrievalSource: recipe.retrievalSource,
        sources: [...new Set(recipe.chunks.map((c) => c.source))],
      }
    : null;

  return { ...structured, model, retrieval };
}

const STEP_SYSTEM_PROMPT =
  "You are a screen-navigation assistant mid-task. " +
  "The user's original goal, a numbered list of completed steps, and the last action taken may be provided. " +
  "Look at the new screenshot as the primary signal and return the SINGLE next action to take, " +
  "or an empty plan array if the task is fully complete or cannot proceed. " +
  "Do not repeat steps already listed as completed unless the screenshot shows they failed. " +
  "Return bbox as [ymin, xmin, ymax, xmax] on a 0-1000 scale for the next target. " +
  "Set isFinal=true on the plan item when it is the last action the user must take. " +
  "The explanation field should be a brief internal note (not spoken). " +
  "Never return more than one plan item.";

async function chatStep(
  goal,
  lastActionDescription,
  screenshotBase64,
  { recipe, mode, completedActions } = {},
) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Add it to your .env file.",
    );
  }

  const userText = buildNavigationStepUserText({
    goal,
    lastAction: lastActionDescription,
    completedActions: mode === "tutor" ? [] : completedActions,
    recipe,
  });

  const contents = [
    {
      role: "user",
      parts: [
        { text: userText },
        ...(screenshotBase64
          ? [{ inlineData: { mimeType: "image/jpeg", data: screenshotBase64 } }]
          : []),
      ],
    },
  ];

  const model = getModel();
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`;

  const payload = await requestGemini(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: resolveStepSystemPrompt(mode) }],
      },
      contents,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  const text = extractText(payload);
  if (!text) {
    throw new Error("Gemini step returned an empty response.");
  }

  const structured = parseStructuredResponse(text);
  return { ...structured, model };
}

async function generateLearningWidget(history, { recipe, systemPrompt, screenContext } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Add it to your .env file.",
    );
  }

  const contents = toGeminiWidgetContents(history, { screenContext }).map((entry) => ({
    role: entry.role,
    parts: [...entry.parts],
  }));

  if (!contents.length) {
    throw new Error("No messages to send.");
  }

  const lastEntry = contents[contents.length - 1];
  const userPrompt = extractLastUserPrompt(history);
  const wantsInteractive = userWantsInteractiveWidget(userPrompt);
  let planNudge =
    "\n\nYou are the widget planner only. Select widgetType. " +
    "For classic, return explanation (full answer), optional diagramCode (raw Mermaid), and widgetSummary (brief overlay caption when diagramCode is set — not a duplicate of explanation). " +
    "For interactive types, return widgetTitle, a full explanation, and designPlan build directions only — never htmlLayout, scopedCss, initialState, mutationLogic, or other implementation code. " +
    "designPlan must include objective, contentOutline, userFlow, stateKeys, and uiSections describing how Groq should build the widget.";
  if (wantsInteractive) {
    planNudge +=
      "\n\nThe user asked for practice, quizzing, or knowledge testing — you MUST use an interactive widgetType " +
      "(interactive-quiz, code-playground, or concept-graph) with a full explanation and complete designPlan " +
      "(objective, contentOutline, userFlow, stateKeys, uiSections). Do not use classic. " +
      "Put quiz questions, answer choices, and interaction steps in designPlan.contentOutline.";
  }
  if (lastEntry.role === "user") {
    lastEntry.parts.push({ text: planNudge });
  } else {
    contents.push({
      role: "user",
      parts: [{ text: planNudge }],
    });
  }

  const model = getModel();
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`;
  const instruction =
    String(systemPrompt || "").trim() + buildRecipeBlock(recipe, { mode: "tutor" });

  const payload = await requestGemini(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: instruction }],
        },
        contents,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: LEARNING_WIDGET_SCHEMA,
        },
      }),
    },
    getGeminiTimeoutMs("widget"),
  );

  const text = extractText(payload);
  if (!text) {
    throw new Error("Gemini returned an empty tutor widget response.");
  }

  const { parsed } = parseJsonFromModelText(text, { label: "Gemini tutor widget" });

  const retrieval = recipe?.chunks?.length
    ? {
        ragQuery: recipe.ragQuery,
        retrievalSource: recipe.retrievalSource,
        sources: [...new Set(recipe.chunks.map((chunk) => chunk.source))],
      }
    : null;

  return { object: parsed, model, retrieval, text };
}

async function planRetrieval(userMessage, history, { mode } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const recentContents = history
    .filter(
      (m) => m.sender === "user" || (m.sender === "system" && m.rawResponse),
    )
    .slice(-6)
    .map((m) => ({
      role: m.sender === "user" ? "user" : "model",
      parts: [{ text: m.text || "" }],
    }))
    .filter((e) => e.parts[0].text);

  const contents = [
    ...recentContents,
    { role: "user", parts: [{ text: `Latest user message: ${userMessage}` }] },
  ];

  const model = getRouterModel();
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`;

  const retrievalPrompt =
    mode === "tutor" ? TUTOR_PLAN_RETRIEVAL_SYSTEM_PROMPT : PLAN_RETRIEVAL_SYSTEM_PROMPT;

  const payload = await requestGemini(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: retrievalPrompt }],
      },
      contents,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: PLAN_RETRIEVAL_SCHEMA,
      },
    }),
  });

  const text = extractText(payload);
  try {
    return normalizeRetrievalPlan(JSON.parse(text), userMessage);
  } catch {
    return normalizeRetrievalPlan(
      {
        intent: userMessage,
        requiresRag: false,
        query: "",
        needsOnScreenGuidance: true,
      },
      userMessage,
    );
  }
}

module.exports = {
  chat,
  chatStep,
  generateLearningWidget,
  planRetrieval,
  normalizePlanItem,
  normalizeRetrievalPlan,
  getApiKey,
  getModel,
  getRouterModel,
  RESPONSE_SCHEMA,
  LEARNING_WIDGET_SCHEMA,
  INTERACTIVE_WIDGET_GEMINI_SCHEMA,
  TUTOR_SYSTEM_PROMPT,
  TUTOR_PLAN_RETRIEVAL_SYSTEM_PROMPT,
  resolveSystemPrompt,
  buildRecipeBlock,
  toGeminiWidgetContents,
};
