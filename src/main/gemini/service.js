const DEFAULT_MODEL = "gemini-2.5-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

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
          markId: {
            type: "INTEGER",
            description:
              "The numbered Set-of-Mark box that best matches the target. Prefer this over raw coordinates when a mark catalog is provided.",
          },
          x: {
            type: "INTEGER",
            description:
              "Legacy fallback absolute X coordinate in display pixels when no mark catalog is available.",
          },
          y: {
            type: "INTEGER",
            description:
              "Legacy fallback absolute Y coordinate in display pixels when no mark catalog is available.",
          },
          w: {
            type: "INTEGER",
            description:
              "Width in pixels. Required only when action is 'highlight'.",
          },
          h: {
            type: "INTEGER",
            description:
              "Height in pixels. Required only when action is 'highlight'.",
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
  "When a MARK CATALOG is provided, the screenshot contains numbered boxes. Pick the markId whose numbered box best matches the target. Do not invent coordinates." +
  "When no MARK CATALOG is provided, legacy x/y coordinates are allowed." +
  "For cursor guidance, use action='cursor' with markId and description." +
  "For highlight emphasis, use action='highlight' with markId and description." +
  "Each description explains what the pointer is targeting and appears in the on-screen widget beside the cursor." +
  "Descriptions may use markdown for the widget (bold, lists, inline code)." +
  "Set isFinal=true on the last plan item when the user only needs one more on-screen action to finish the goal.";

const PLAN_RETRIEVAL_SCHEMA = {
  type: "OBJECT",
  properties: {
    intent: {
      type: "STRING",
      description: "Concise statement of what the user wants to accomplish.",
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
  const rawAction = String(item?.action ?? "")
    .trim()
    .toLowerCase();
  const action =
    rawAction || (item?.w != null && item?.h != null ? "highlight" : "cursor");
  const markId = Math.round(Number(item?.markId));
  const x = Math.round(Number(item?.x));
  const y = Math.round(Number(item?.y));
  const description = String(item?.description ?? item?.label ?? "").trim();
  const isFinal = Boolean(item?.isFinal);

  if (!["cursor", "highlight"].includes(action)) {
    return null;
  }

  if (!description) {
    return null;
  }

  if (Number.isFinite(markId) && markId > 0) {
    return { action, markId, label: description, description, isFinal };
  }

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

function buildRecipeBlock(recipe) {
  if (!recipe?.chunks?.length) return "";

  const sections = recipe.chunks
    .map((chunk) => `[Source: ${chunk.source}]\n${chunk.text}`)
    .join("\n\n---\n\n");

  return (
    "\n\n[WORKFLOW KNOWLEDGE BASE]\n" +
    sections +
    "\n\n[INSTRUCTION] The knowledge base above contains step-by-step recipes. " +
    "When building your plan, locate the SPECIFIC UI elements named in the recipe (menus, buttons, shortcuts). " +
    "Follow the recipe steps — do not guess workflow steps not described in the recipe."
  );
}

function buildMarkCatalogBlock(marks = []) {
  if (!Array.isArray(marks) || !marks.length) return "";

  const lines = marks.slice(0, 80).map((mark) => {
    const label = String(mark.label || mark.controlType || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    const box = `(${Math.round(Number(mark.x))},${Math.round(Number(mark.y))},${Math.round(Number(mark.w))}x${Math.round(Number(mark.h))})`;
    return `${mark.id}: ${label || "unlabeled"} ${box}`;
  });

  return (
    "\n\n[MARK CATALOG]\n" +
    lines.join("\n") +
    "\n\n[MARK INSTRUCTION] The screenshot is annotated with these numbered boxes. " +
    "For any cursor or highlight plan item, return the matching markId. " +
    "Do not invent x/y coordinates when a markId is available."
  );
}

function appendMarkCatalogToLastUserContent(contents, marks) {
  const block = buildMarkCatalogBlock(marks);
  if (!block) return contents;

  const nextContents = contents.map((content) => ({
    ...content,
    parts: [...content.parts],
  }));
  const lastUser = [...nextContents]
    .reverse()
    .find((entry) => entry.role === "user");
  if (lastUser) {
    lastUser.parts.push({ text: block });
  }

  return nextContents;
}

async function chat(history, { recipe, marks } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Add it to your .env file.",
    );
  }

  const contents = appendMarkCatalogToLastUserContent(
    toGeminiContents(history),
    marks,
  );
  if (!contents.length) {
    throw new Error("No messages to send.");
  }

  const model = getModel();
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`;
  const systemPrompt = SYSTEM_PROMPT + buildRecipeBlock(recipe);

  const response = await fetch(url, {
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

  const retrieval = recipe
    ? {
        ragQuery: recipe.ragQuery,
        sources: [...new Set(recipe.chunks.map((c) => c.source))],
      }
    : null;

  return { ...structured, model, retrieval };
}

const STEP_SYSTEM_PROMPT =
  "You are a screen-navigation assistant mid-task. " +
  "The user's original goal and the last action taken are provided. " +
  "Look at the new screenshot and return the SINGLE next action to take, " +
  "or an empty plan array if the task is fully complete or cannot proceed. " +
  "When a MARK CATALOG is provided, return markId for the numbered box that best matches the next target. " +
  "Do not invent coordinates when a markId is available. " +
  "Set isFinal=true on the plan item when it is the last action the user must take. " +
  "The explanation field should be a brief internal note (not spoken). " +
  "Never return more than one plan item.";

async function chatStep(
  goal,
  lastActionDescription,
  screenshotBase64,
  { recipe, marks } = {},
) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Add it to your .env file.",
    );
  }

  let userText =
    `Original goal: ${goal}\n` +
    `Last action completed: ${lastActionDescription}\n` +
    `What is the single next step? Return empty plan if done.`;

  if (recipe?.chunks?.length) {
    const recipeSummary = recipe.chunks.map((c) => c.text).join("\n\n");
    userText = `[Workflow recipe]\n${recipeSummary}\n\n${userText}`;
  }

  userText += buildMarkCatalogBlock(marks);

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

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: STEP_SYSTEM_PROMPT }],
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
      `Gemini step error (${response.status})`;
    throw new Error(message);
  }

  const text = extractText(payload);
  if (!text) {
    throw new Error("Gemini step returned an empty response.");
  }

  const structured = parseStructuredResponse(text);
  return { ...structured, model };
}

async function planRetrieval(userMessage, history) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  // Build a short recent history for context (text-only, no screenshots)
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
        parts: [{ text: PLAN_RETRIEVAL_SYSTEM_PROMPT }],
      },
      contents,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: PLAN_RETRIEVAL_SCHEMA,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload?.error?.message || `Gemini plan error (${response.status})`,
    );
  }

  const text = extractText(payload);
  try {
    return JSON.parse(text);
  } catch {
    return {
      intent: userMessage,
      ragQuery: userMessage,
      needsOnScreenGuidance: true,
    };
  }
}

const REFINE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    x: { type: "INTEGER", description: "X pixel coordinate of the element center within the cropped image" },
    y: { type: "INTEGER", description: "Y pixel coordinate of the element center within the cropped image" },
  },
  required: ["x", "y"],
};

const REFINE_SYSTEM_PROMPT =
  "You are a pixel-accurate UI element locator. " +
  "You will receive a cropped screenshot and a description of a UI element. " +
  "Return the EXACT center pixel coordinates of that element within THIS CROPPED IMAGE. " +
  "Coordinates must be integers within the image bounds. " +
  "If the element is partially cut off, return the visible center.";

async function refineCoordinate({ description, croppedBase64, cropW, cropH }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const model = getModel();
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: REFINE_SYSTEM_PROMPT }] },
      contents: [{
        role: "user",
        parts: [
          {
            text: `Find the exact center pixel of: "${description}"\nCropped image is ${cropW}x${cropH} pixels. Return coordinates within this crop only.`,
          },
          { inlineData: { mimeType: "image/jpeg", data: croppedBase64 } },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: REFINE_RESPONSE_SCHEMA,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Gemini refine error (${response.status})`);
  }

  const text = extractText(payload);
  if (!text) throw new Error("Gemini refine returned empty response.");

  const parsed = JSON.parse(text);
  const x = Math.round(Number(parsed.x));
  const y = Math.round(Number(parsed.y));

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Gemini refine returned invalid coordinates.");
  }

  return { x, y };
}

module.exports = {
  chat,
  chatStep,
  planRetrieval,
  refineCoordinate,
  getApiKey,
  getModel,
  RESPONSE_SCHEMA,
};
