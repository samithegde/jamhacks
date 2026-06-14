const { buildRecipeBlock } = require("../gemini/service");
const {
  parseLearningWidgetPlan,
  mergeInteractiveWidget,
  buildClassicFallbackFromPlan,
  isInteractiveWidget,
  isInteractiveWidgetPlan,
  buildScreenContext,
  extractLastUserPrompt,
  userWantsInteractiveWidget,
} = require("./learning-widget-schema");

const TUTOR_WIDGET_SYSTEM_PROMPT =
  "Your name is Clarity in Tutor Mode — a patient study companion." +
  " Respond with structured JSON only." +
  "\n\n" +
  "Always set widgetType to choose the widget shape:" +
  "\n" +
  "- classic: explanatory answers and optional Mermaid diagrams. Fields: explanation (full spoken and chat answer), diagramCode (raw Mermaid syntax, no markdown fences), widgetSummary (optional brief overlay caption when diagramCode is set — 1-2 sentences, not a copy of explanation)." +
  "\n" +
  "- interactive-quiz, code-playground, or concept-graph: hands-on widgets. Fields: explanation (full spoken and chat answer), widgetTitle, spokenSummary (optional shorter TTS), and designPlan." +
  "\n" +
  "For interactive types, always include a full explanation plus designPlan — no HTML, CSS, or JavaScript." +
  " designPlan fields: objective, userFlow, stateKeys, uiSections, contentOutline, fallbackExplanation." +
  " The designPlan is the widget-building script passed to the implementation model; explanation is the learner-facing answer in chat." +
  "\n\n" +
  "Prefer classic for pure explanations; prefer an interactive widgetType when practice, quizzing, or exploration helps learning." +
  " Ground answers in retrieved study material when provided." +
  " Ask a brief check-for-understanding question at the end when appropriate.";

const INTERACTIVE_PREFERENCE_HINT =
  " The user asked for practice or quizzing — prefer an interactive widgetType.";

function buildTutorWidgetSystemPrompt(userPrompt) {
  let prompt = TUTOR_WIDGET_SYSTEM_PROMPT;
  if (userWantsInteractiveWidget(userPrompt)) {
    prompt += INTERACTIVE_PREFERENCE_HINT;
  }
  return prompt;
}

function buildRetrievalMeta(recipe) {
  if (!recipe?.chunks?.length) return null;
  return {
    ragQuery: recipe.ragQuery,
    retrievalSource: recipe.retrievalSource,
    sources: [...new Set(recipe.chunks.map((chunk) => chunk.source))],
  };
}

function validateParsedWidget(widget) {
  if (isInteractiveWidget(widget)) {
    if (widget.htmlLayout) {
      if (!widget.title) {
        throw new Error("Model returned an empty widgetTitle for interactive widget.");
      }
      if (!widget.mutationLogic) {
        throw new Error("Model returned empty mutationLogic for interactive widget.");
      }
      return;
    }

    if (isInteractiveWidgetPlan(widget)) {
      if (!widget.title) {
        throw new Error("Model returned an empty widgetTitle for interactive widget plan.");
      }
      if (!widget.explanation) {
        throw new Error("Model returned an empty explanation for interactive widget plan.");
      }
      if (!widget.designPlan?.objective) {
        throw new Error("Model returned an empty designPlan.objective.");
      }
      return;
    }

    throw new Error("Interactive widget is missing blueprint or design plan.");
  }

  if (!widget.explanation) {
    throw new Error("Model returned an empty explanation.");
  }
}

async function implementInteractiveWidgetWithGroq(args) {
  const groqService = require("../groq/service");

  if (!groqService.isConfigured()) {
    throw new Error(
      "GROQ_API_KEY is not configured. Interactive tutor widgets require Groq for implementation.",
    );
  }

  const implArgs = {
    designPlan: args.plan.designPlan,
    widgetType: args.plan.widgetType,
    title: args.plan.title,
    explanation: args.plan.explanation,
    spokenSummary: args.plan.spokenSummary,
    recipe: args.recipe,
    userPrompt: args.userPrompt,
    screenContext: args.screenContext,
    geminiPlanText: args.geminiPlanText,
  };

  const result = await groqService.implementInteractiveWidget(implArgs);
  return { ...result, implProvider: "groq" };
}

async function generateLearningWidget({ userPrompt, screenContext, recipe, history, useGemini } = {}) {
  const prompt = userPrompt || extractLastUserPrompt(history);
  if (!prompt) {
    throw new Error("User prompt is required for tutor widget generation.");
  }

  if (!useGemini) {
    throw new Error(
      "Tutor mode requires Gemini for widget planning. Set USE_GEMINI_MODEL=true or enable Gemini.",
    );
  }

  const context = screenContext || buildScreenContext(history);
  const systemPrompt = buildTutorWidgetSystemPrompt(prompt);
  const geminiService = require("../gemini/service");

  const planResult = await geminiService.generateLearningWidget(history, {
    recipe,
    systemPrompt,
    screenContext: context,
  });

  const plan = parseLearningWidgetPlan(planResult.object);
  validateParsedWidget(plan);

  const retrieval = planResult.retrieval ?? buildRetrievalMeta(recipe);

  if (!isInteractiveWidget(plan)) {
    return {
      widget: plan,
      model: planResult.model,
      retrieval,
    };
  }

  if (!isInteractiveWidgetPlan(plan)) {
    return {
      widget: plan,
      model: planResult.model,
      retrieval,
      implProvider: "gemini",
    };
  }

  try {
    const implResult = await implementInteractiveWidgetWithGroq({
      plan,
      recipe,
      userPrompt: prompt,
      screenContext: context,
      geminiPlanText: planResult.text,
    });

    const widget = mergeInteractiveWidget(plan, implResult.object);
    validateParsedWidget(widget);

    return {
      widget,
      model: `${planResult.model}+${implResult.model}`,
      retrieval,
      implProvider: implResult.implProvider,
    };
  } catch (err) {
    console.warn("[tutor] Widget implementation failed, using classic fallback:", err.message);
    const widget = buildClassicFallbackFromPlan(plan);
    validateParsedWidget(widget);

    return {
      widget,
      model: planResult.model,
      retrieval,
      implProvider: null,
      degraded: true,
    };
  }
}

module.exports = {
  TUTOR_WIDGET_SYSTEM_PROMPT,
  generateLearningWidget,
  buildTutorWidgetSystemPrompt,
  validateParsedWidget,
  implementInteractiveWidgetWithGroq,
};
