const { z } = require("zod");
const { normalizeDiagramCode } = require("../../shared/mermaid-normalize");

// --- Classic branch (backward-compatible) ---

const classicWidgetSchema = z.object({
  widgetType: z.literal("classic").default("classic"),
  explanation: z
    .string()
    .describe("Full spoken and chat-visible educational answer. Use diagramCode for Mermaid, not fenced blocks here."),
  diagramCode: z
    .string()
    .optional()
    .default("")
    .describe("Raw Mermaid.js syntax without markdown fences when a diagram clarifies the concept."),
  widgetSummary: z
    .string()
    .optional()
    .default("")
    .describe(
      "Brief overlay caption (1-2 sentences) when diagramCode is set. Do not repeat the full explanation.",
    ),
});

// --- Interactive design plan (stage 1 — Gemini) ---

const designPlanSchema = z.object({
  objective: z.string().describe("What the learner should practice or explore."),
  userFlow: z.array(z.string()).default([]).describe("Ordered interaction steps."),
  stateKeys: z
    .record(z.string())
    .default({})
    .describe("State key to brief type/description map."),
  uiSections: z.array(z.string()).default([]).describe("Layout sections for the widget."),
  contentOutline: z
    .string()
    .describe("Quiz items, concepts, or playground behavior — no HTML."),
  fallbackExplanation: z
    .string()
    .optional()
    .describe("Short spoken summary if widget implementation fails."),
});

const interactiveWidgetPlanSchema = z.object({
  widgetType: z.enum(["interactive-quiz", "code-playground", "concept-graph"]),
  explanation: z
    .string()
    .describe("Full spoken and chat-visible educational answer before the interactive widget."),
  title: z.string().describe("Panel header text."),
  spokenSummary: z
    .string()
    .optional()
    .describe("Optional shorter TTS override; defaults to explanation when omitted."),
  designPlan: designPlanSchema,
});

// --- Interactive blueprint branch (stage 2 — Groq/Ollama) ---

const interactionSchema = z.object({
  elementSelector: z.string().describe("CSS selector for the interactive element within htmlLayout."),
  eventType: z.string().describe("DOM event type, e.g. 'click', 'change'."),
  mutationLogic: z.string().describe("JS body (state, event) => void that mutates state keys."),
});

const stateBindingSchema = z.object({
  stateKey: z.string().describe("Key in initialState to watch."),
  selector: z.string().describe("CSS selector for the target element within htmlLayout."),
  attr: z.enum(["textContent", "hidden", "class"]).describe("DOM property to update."),
});

const interactiveWidgetSchema = z.object({
  widgetType: z.enum(["interactive-quiz", "code-playground", "concept-graph"]),
  explanation: z
    .string()
    .optional()
    .default("")
    .describe("Full spoken and chat-visible educational answer from the planning stage."),
  title: z.string().describe("Panel header text."),
  spokenSummary: z.string().optional().describe("Optional shorter TTS override."),
  htmlLayout: z.string().describe("Semantic markup with data-action and data-state-key hooks."),
  scopedCss: z.string().optional().default("").describe("Widget-local CSS, no @import or external url()."),
  initialState: z.record(z.unknown()).describe("Initial state object; keys referenced by stateBindings."),
  mutationLogic: z
    .string()
    .optional()
    .describe("JS body (state, action, event) => void for data-action delegation."),
  interactions: z.array(interactionSchema).default([]),
  stateBindings: z.array(stateBindingSchema).default([]),
});

// --- Discriminated unions ---

const learningWidgetPlanSchema = z.discriminatedUnion("widgetType", [
  classicWidgetSchema,
  interactiveWidgetPlanSchema,
]);

const learningWidgetSchema = z.discriminatedUnion("widgetType", [
  classicWidgetSchema,
  interactiveWidgetSchema,
]);

// --- Sanitizers ---

function sanitizeHtmlLayout(html) {
  if (/<script[\s>]/i.test(html)) {
    throw new Error("htmlLayout contains forbidden <script> tag");
  }
  if (/\bon\w+\s*=/i.test(html)) {
    throw new Error("htmlLayout contains inline event handler");
  }
  if (/javascript:/i.test(html)) {
    throw new Error("htmlLayout contains javascript: URL");
  }
}

function sanitizeScopedCss(css) {
  if (!css) return;
  if (/@import/i.test(css)) {
    throw new Error("scopedCss contains forbidden @import");
  }
  if (/url\s*\(\s*(?:https?:|\/\/)/i.test(css)) {
    throw new Error("scopedCss contains external url()");
  }
  if (/behavior\s*:|-moz-binding/i.test(css)) {
    throw new Error("scopedCss contains forbidden CSS property");
  }
}

const FORBIDDEN_SELECTOR_RE = /^(?:html|body|:root)$/i;
const DEEP_COMBINATOR_RE = /\/deep\//i;

function validateElementSelector(selector) {
  if (FORBIDDEN_SELECTOR_RE.test(selector.trim())) {
    throw new Error(`Forbidden element selector: ${selector}`);
  }
  if (DEEP_COMBINATOR_RE.test(selector)) {
    throw new Error(`Forbidden /deep/ combinator in selector: ${selector}`);
  }
}

const FORBIDDEN_LOGIC_RE =
  /\b(?:import|fetch|eval|Function|window|document|globalThis|process)\b/;

function validateMutationLogic(logic) {
  if (FORBIDDEN_LOGIC_RE.test(logic)) {
    throw new Error("mutationLogic contains forbidden keyword");
  }
}

// --- Helpers ---

const INTERACTIVE_WIDGET_TYPES = new Set(["interactive-quiz", "code-playground", "concept-graph"]);

function isInteractiveWidget(widget) {
  return INTERACTIVE_WIDGET_TYPES.has(widget?.widgetType);
}

function isInteractiveWidgetPlan(widget) {
  return isInteractiveWidget(widget) && widget?.designPlan && !widget?.htmlLayout;
}

const INTERACTIVE_INTENT_RE =
  /\b(quiz|flash\s*cards?|self[- ]?test|practice|playground|drag|connect|interactive|test me|test my|test\s+me\s+on|quiz me|multiple choice|fill in the blank)\b/i;

function userWantsInteractiveWidget(prompt) {
  return INTERACTIVE_INTENT_RE.test(String(prompt || ""));
}

const DESIGN_PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    objective: { type: "string" },
    userFlow: { type: "array", items: { type: "string" } },
    stateKeys: { type: "object", additionalProperties: { type: "string" } },
    uiSections: { type: "array", items: { type: "string" } },
    contentOutline: { type: "string" },
    fallbackExplanation: { type: "string" },
  },
  required: ["objective", "contentOutline"],
};

const INTERACTIVE_WIDGET_JSON_SCHEMA = {
  type: "object",
  properties: {
    widgetTitle: { type: "string" },
    htmlLayout: {
      type: "string",
      description:
        "Clean HTML structure using utility classes (like Tailwind). Use data-action attributes for user events (e.g., <button data-action='increment'>+1</button>).",
    },
    scopedCss: {
      type: "string",
      description:
        "Isolated CSS rules targeting widget structural components. Avoid globally bleeding selectors.",
    },
    initialState: {
      type: "object",
      description:
        "Key-value map containing variables tracking the UI's interactive parameters (e.g., { counter: 0, trackingHistory: [] }).",
    },
    mutationLogic: {
      type: "string",
      description:
        "Vanilla JavaScript function block evaluating state changes. Modifies local keys based on the passed action string.",
    },
  },
  required: ["widgetTitle", "htmlLayout", "scopedCss", "initialState", "mutationLogic"],
};

const OLLAMA_INTERACTIVE_WIDGET_JSON_SCHEMA = INTERACTIVE_WIDGET_JSON_SCHEMA;

const OLLAMA_CLASSIC_WIDGET_JSON_SCHEMA = {
  type: "object",
  properties: {
    widgetType: { type: "string", enum: ["classic"] },
    explanation: {
      type: "string",
      description: "Full spoken and chat-visible educational answer.",
    },
    diagramCode: {
      type: "string",
      description: "Optional raw Mermaid syntax without markdown fences.",
    },
    widgetSummary: {
      type: "string",
      description:
        "Brief overlay caption when diagramCode is set; do not repeat the full explanation.",
    },
  },
  required: ["widgetType", "explanation"],
};

const OLLAMA_INTERACTIVE_PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    widgetType: {
      type: "string",
      enum: ["interactive-quiz", "code-playground", "concept-graph"],
    },
    explanation: {
      type: "string",
      description: "Full spoken and chat-visible educational answer.",
    },
    widgetTitle: { type: "string" },
    spokenSummary: { type: "string" },
    designPlan: DESIGN_PLAN_JSON_SCHEMA,
  },
  required: ["widgetType", "widgetTitle", "explanation", "designPlan"],
};

const OLLAMA_LEARNING_WIDGET_PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    widgetType: {
      type: "string",
      enum: ["classic", "interactive-quiz", "code-playground", "concept-graph"],
    },
    explanation: { type: "string" },
    diagramCode: { type: "string" },
    widgetTitle: { type: "string" },
    spokenSummary: { type: "string" },
    designPlan: DESIGN_PLAN_JSON_SCHEMA,
  },
  required: ["widgetType"],
};

function resolveOllamaLearningWidgetPlanSchema() {
  return OLLAMA_LEARNING_WIDGET_PLAN_JSON_SCHEMA;
}

function resolveOllamaInteractiveWidgetSchema() {
  return OLLAMA_INTERACTIVE_WIDGET_JSON_SCHEMA;
}

function resolveOllamaInteractiveImplementationSchema() {
  return OLLAMA_INTERACTIVE_WIDGET_JSON_SCHEMA;
}

function resolveGroqInteractiveImplementationSchema() {
  return INTERACTIVE_WIDGET_JSON_SCHEMA;
}

function buildInteractiveWidgetImplementationInstructions() {
  const { htmlLayout, scopedCss, initialState, mutationLogic } =
    INTERACTIVE_WIDGET_JSON_SCHEMA.properties;

  return [
    "- widgetTitle: panel header matching the Gemini design plan title.",
    `- htmlLayout: ${htmlLayout.description} Use data-bind (or data-state-key) on values that reflect state. HTML mounts in an isolated shadow DOM viewport.`,
    `- scopedCss: ${scopedCss.description}`,
    `- initialState: ${initialState.description} Keys must align with designPlan.stateKeys.`,
    `- mutationLogic: ${mutationLogic.description} Branch on the action string from data-action attributes. Runtime executes logic inside with(state).`,
    "- Security: no fetch, eval, window, document, import, Function, globalThis, or process.",
  ].join("\n");
}

const GEMINI_DESIGN_PLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    objective: { type: "STRING" },
    userFlow: { type: "ARRAY", items: { type: "STRING" } },
    stateKeys: {
      type: "OBJECT",
      description: "State key to brief type/description.",
    },
    uiSections: { type: "ARRAY", items: { type: "STRING" } },
    contentOutline: {
      type: "STRING",
      description: "Quiz items, concepts, or playground behavior — no HTML.",
    },
    fallbackExplanation: {
      type: "STRING",
      description: "Short spoken summary if widget implementation fails.",
    },
  },
  required: ["objective", "contentOutline"],
};

const GEMINI_INTERACTIVE_WIDGET_SCHEMA = {
  type: "OBJECT",
  properties: {
    widgetTitle: { type: "STRING" },
    htmlLayout: {
      type: "STRING",
      description: INTERACTIVE_WIDGET_JSON_SCHEMA.properties.htmlLayout.description,
    },
    scopedCss: {
      type: "STRING",
      description: INTERACTIVE_WIDGET_JSON_SCHEMA.properties.scopedCss.description,
    },
    initialState: {
      type: "OBJECT",
      description: INTERACTIVE_WIDGET_JSON_SCHEMA.properties.initialState.description,
    },
    mutationLogic: {
      type: "STRING",
      description: INTERACTIVE_WIDGET_JSON_SCHEMA.properties.mutationLogic.description,
    },
  },
  required: ["widgetTitle", "htmlLayout", "scopedCss", "initialState", "mutationLogic"],
};

const GEMINI_LEARNING_WIDGET_PLAN_SCHEMA = {
  anyOf: [
    {
      type: "OBJECT",
      properties: {
        widgetType: {
          type: "STRING",
          enum: ["classic"],
          description: "Explanatory answer with optional Mermaid diagram.",
        },
        explanation: {
          type: "STRING",
          description: "Classic: full spoken and chat-visible educational answer.",
        },
        diagramCode: {
          type: "STRING",
          description: "Classic: raw Mermaid syntax without markdown fences.",
        },
        widgetSummary: {
          type: "STRING",
          description:
            "Classic: brief overlay caption when diagramCode is set; do not repeat explanation.",
        },
      },
      required: ["widgetType", "explanation"],
    },
    {
      type: "OBJECT",
      properties: {
        widgetType: {
          type: "STRING",
          enum: ["interactive-quiz", "code-playground", "concept-graph"],
          description: "Hands-on practice widget — design plan only, no implementation code.",
        },
        widgetTitle: {
          type: "STRING",
          description: "Interactive: panel header text.",
        },
        explanation: {
          type: "STRING",
          description:
            "Interactive: full spoken and chat-visible educational answer before the widget.",
        },
        spokenSummary: {
          type: "STRING",
          description: "Interactive: optional shorter TTS override.",
        },
        designPlan: GEMINI_DESIGN_PLAN_SCHEMA,
      },
      required: ["widgetType", "widgetTitle", "explanation", "designPlan"],
    },
  ],
};

// Legacy alias — stage 1 plan schema
const GEMINI_LEARNING_WIDGET_SCHEMA = GEMINI_LEARNING_WIDGET_PLAN_SCHEMA;

function normalizeGeminiInteractiveWidget(raw) {
  return {
    widgetType: String(raw.widgetType || "interactive-quiz"),
    title: String(raw.widgetTitle || raw.title || "").trim(),
    htmlLayout: String(raw.htmlLayout || ""),
    scopedCss: String(raw.scopedCss || ""),
    initialState: raw.initialState && typeof raw.initialState === "object" ? raw.initialState : {},
    mutationLogic: String(raw.mutationLogic || ""),
    interactions: [],
    stateBindings: [],
  };
}

function normalizeInteractivePlanRaw(raw) {
  const coerced = { ...raw };
  if (isInteractiveWidget(coerced) && !coerced.title && coerced.widgetTitle) {
    coerced.title = String(coerced.widgetTitle);
  }
  if (coerced.explanation) {
    coerced.explanation = String(coerced.explanation).trim();
  }
  if (coerced.designPlan && typeof coerced.designPlan === "object") {
    coerced.designPlan = {
      objective: String(coerced.designPlan.objective || "").trim(),
      userFlow: Array.isArray(coerced.designPlan.userFlow)
        ? coerced.designPlan.userFlow.map((s) => String(s))
        : [],
      stateKeys:
        coerced.designPlan.stateKeys && typeof coerced.designPlan.stateKeys === "object"
          ? coerced.designPlan.stateKeys
          : {},
      uiSections: Array.isArray(coerced.designPlan.uiSections)
        ? coerced.designPlan.uiSections.map((s) => String(s))
        : [],
      contentOutline: String(coerced.designPlan.contentOutline || "").trim(),
      fallbackExplanation: coerced.designPlan.fallbackExplanation
        ? String(coerced.designPlan.fallbackExplanation).trim()
        : undefined,
    };
  }
  return coerced;
}

function isGeminiInteractiveWidgetPayload(raw) {
  if (!raw || typeof raw !== "object") return false;
  const hasTitle = raw.widgetTitle || raw.title;
  return Boolean(hasTitle && raw.mutationLogic && raw.htmlLayout);
}

function isGeminiInteractivePlanPayload(raw) {
  if (!raw || typeof raw !== "object") return false;
  return Boolean(
    isInteractiveWidget(raw) &&
      raw.designPlan &&
      typeof raw.designPlan === "object" &&
      !raw.htmlLayout,
  );
}

// --- Parsers ---

function parseInteractiveWidget(data) {
  sanitizeHtmlLayout(data.htmlLayout || "");
  sanitizeScopedCss(data.scopedCss);

  if (data.mutationLogic) {
    validateMutationLogic(data.mutationLogic);
  }

  for (const interaction of data.interactions || []) {
    validateElementSelector(interaction.elementSelector);
    validateMutationLogic(interaction.mutationLogic);
  }
  for (const binding of data.stateBindings || []) {
    validateElementSelector(binding.selector);
  }
  return data;
}

function coerceLearningWidgetRaw(raw) {
  if (!raw || typeof raw !== "object") return raw;

  const coerced = { ...raw };
  if (!coerced.widgetType) {
    coerced.widgetType = "classic";
  }
  if (isInteractiveWidget(coerced) && !coerced.title && coerced.widgetTitle) {
    coerced.title = String(coerced.widgetTitle);
  }
  return coerced;
}

function parseClassicWidget(parsed) {
  return {
    widgetType: "classic",
    explanation: String(parsed.explanation || "").trim(),
    diagramCode: normalizeDiagramCode(parsed.diagramCode || ""),
    widgetSummary: String(parsed.widgetSummary || "").trim(),
  };
}

function coerceInteractivePlanFromRaw(raw) {
  const coerced = coerceLearningWidgetRaw(raw);
  if (!isInteractiveWidget(coerced)) return coerced;

  if (coerced.title || coerced.widgetTitle) {
    coerced.title = String(coerced.title || coerced.widgetTitle).trim();
  }

  const existingPlan =
    coerced.designPlan && typeof coerced.designPlan === "object" ? coerced.designPlan : {};
  const explanation = String(coerced.explanation || coerced.spokenSummary || "").trim();
  const title = String(coerced.title || coerced.widgetTitle || "Practice").trim();

  coerced.explanation = explanation;
  coerced.title = title;
  coerced.widgetTitle = title;
  coerced.designPlan = {
    objective: String(existingPlan.objective || explanation.slice(0, 240) || "Practice the concept").trim(),
    userFlow: Array.isArray(existingPlan.userFlow)
      ? existingPlan.userFlow.map((step) => String(step))
      : ["Read prompt", "Interact", "Check result"],
    stateKeys:
      existingPlan.stateKeys && typeof existingPlan.stateKeys === "object"
        ? existingPlan.stateKeys
        : { step: "number", score: "number" },
    uiSections: Array.isArray(existingPlan.uiSections)
      ? existingPlan.uiSections.map((section) => String(section))
      : ["header", "content", "controls"],
    contentOutline: String(existingPlan.contentOutline || explanation || "Interactive practice items").trim(),
    fallbackExplanation: existingPlan.fallbackExplanation
      ? String(existingPlan.fallbackExplanation).trim()
      : coerced.spokenSummary || explanation.slice(0, 500) || undefined,
  };

  return normalizeInteractivePlanRaw(coerced);
}

function parseLearningWidgetPlan(raw) {
  if (isGeminiInteractiveWidgetPayload(raw)) {
    return parseInteractiveWidget(
      normalizeGeminiInteractiveWidget({
        ...raw,
        widgetType: raw.widgetType || "interactive-quiz",
      }),
    );
  }

  if (isGeminiInteractivePlanPayload(raw)) {
    const normalized = normalizeInteractivePlanRaw(raw);
    const parsed = learningWidgetPlanSchema.safeParse(normalized);
    if (!parsed.success) {
      throw new Error(
        `Invalid learning widget plan: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      );
    }
    return parsed.data;
  }

  const coerced = coerceLearningWidgetRaw(raw);
  if (isInteractiveWidget(coerced)) {
    const normalized = coerceInteractivePlanFromRaw(coerced);
    const parsed = learningWidgetPlanSchema.safeParse(normalized);
    if (!parsed.success) {
      throw new Error(
        `Invalid learning widget plan: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      );
    }
    return parsed.data;
  }

  const parsed = learningWidgetPlanSchema.safeParse(coerced);
  if (!parsed.success) {
    throw new Error(
      `Invalid learning widget plan: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }

  if (parsed.data.widgetType === "classic") {
    return parseClassicWidget(parsed.data);
  }

  return parsed.data;
}

function parseLearningWidget(raw) {
  if (isGeminiInteractiveWidgetPayload(raw)) {
    return parseInteractiveWidget(normalizeGeminiInteractiveWidget(raw));
  }

  if (isGeminiInteractivePlanPayload(raw)) {
    return parseLearningWidgetPlan(raw);
  }

  const coerced = coerceLearningWidgetRaw(raw);

  const parsed = learningWidgetSchema.safeParse(coerced);
  if (!parsed.success) {
    // Try plan schema for interactive plans without blueprint fields
    const planParsed = learningWidgetPlanSchema.safeParse(coerced);
    if (planParsed.success) {
      if (planParsed.data.widgetType === "classic") {
        return parseClassicWidget(planParsed.data);
      }
      return planParsed.data;
    }

    throw new Error(
      `Invalid learning widget: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }

  if (isInteractiveWidget(parsed.data)) {
    return parseInteractiveWidget(parsed.data);
  }

  return parseClassicWidget(parsed.data);
}

function mergeInteractiveWidget(plan, implementation) {
  const impl = implementation && typeof implementation === "object" ? implementation : {};
  const merged = {
    widgetType: plan.widgetType,
    title: String(plan.title || impl.widgetTitle || "").trim(),
    explanation: String(plan.explanation || plan.spokenSummary || "").trim(),
    spokenSummary: plan.spokenSummary,
    htmlLayout: String(impl.htmlLayout || ""),
    scopedCss: String(impl.scopedCss || ""),
    initialState:
      impl.initialState && typeof impl.initialState === "object" ? impl.initialState : {},
    mutationLogic: String(impl.mutationLogic || ""),
    interactions: [],
    stateBindings: [],
  };

  return parseInteractiveWidget(merged);
}

function buildClassicFallbackFromPlan(plan) {
  const fallback =
    plan?.explanation ||
    plan?.designPlan?.fallbackExplanation ||
    plan?.spokenSummary ||
    plan?.title ||
    plan?.designPlan?.objective ||
    "";

  return {
    widgetType: "classic",
    explanation: String(fallback).trim(),
    diagramCode: "",
  };
}

function extractDiagramFromExplanation(explanation) {
  const text = String(explanation || "");
  const match = /```\s*mermaid\b\s*([\s\S]*?)```/i.exec(text);
  if (!match) {
    return { diagramCode: "", explanation: text.trim() };
  }

  const diagramCode = normalizeDiagramCode(match[1]);
  const cleaned = text
    .replace(/```\s*mermaid\b\s*[\s\S]*?```/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { diagramCode, explanation: cleaned };
}

function buildScreenContext(history = []) {
  const lines = [];

  for (const msg of history) {
    if (msg?.sender !== "user" && msg?.sender !== "system") continue;

    const text = String(msg?.text || "").trim();
    if (text) {
      lines.push(`${msg.sender}: ${text.slice(0, 500)}`);
    }

    for (const attachment of msg?.attachments || []) {
      if (attachment?.contextOnly && attachment?.mimeType?.startsWith("image/")) {
        lines.push("[Screenshot attached for on-screen context.]");
      }
      if (attachment?.textContent) {
        lines.push(`[Attachment ${attachment.name}]: ${String(attachment.textContent).slice(0, 400)}`);
      }
    }
  }

  return lines.join("\n").trim();
}

function extractLastUserPrompt(history = []) {
  const lastUser = [...history].reverse().find((msg) => msg?.sender === "user");
  return String(lastUser?.text || "").trim();
}

module.exports = {
  learningWidgetSchema,
  learningWidgetPlanSchema,
  classicWidgetSchema,
  interactiveWidgetSchema,
  interactiveWidgetPlanSchema,
  designPlanSchema,
  parseLearningWidget,
  parseLearningWidgetPlan,
  parseInteractiveWidget,
  mergeInteractiveWidget,
  buildClassicFallbackFromPlan,
  normalizeGeminiInteractiveWidget,
  isInteractiveWidget,
  isInteractiveWidgetPlan,
  isGeminiInteractiveWidgetPayload,
  isGeminiInteractivePlanPayload,
  userWantsInteractiveWidget,
  resolveOllamaLearningWidgetPlanSchema,
  resolveOllamaInteractiveWidgetSchema,
  resolveOllamaInteractiveImplementationSchema,
  resolveGroqInteractiveImplementationSchema,
  buildInteractiveWidgetImplementationInstructions,
  INTERACTIVE_WIDGET_JSON_SCHEMA,
  GEMINI_INTERACTIVE_WIDGET_SCHEMA,
  GEMINI_LEARNING_WIDGET_SCHEMA,
  GEMINI_LEARNING_WIDGET_PLAN_SCHEMA,
  OLLAMA_CLASSIC_WIDGET_JSON_SCHEMA,
  OLLAMA_INTERACTIVE_WIDGET_JSON_SCHEMA,
  OLLAMA_INTERACTIVE_PLAN_JSON_SCHEMA,
  OLLAMA_LEARNING_WIDGET_PLAN_JSON_SCHEMA,
  extractDiagramFromExplanation,
  buildScreenContext,
  extractLastUserPrompt,
};
