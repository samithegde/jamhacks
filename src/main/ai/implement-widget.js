const { buildRecipeBlock } = require("../gemini/service");
const {
  buildInteractiveWidgetImplementationInstructions,
  resolveGroqInteractiveImplementationSchema,
} = require("./learning-widget-schema");

const WIDGET_IMPLEMENTATION_SYSTEM_PROMPT =
  "You implement interactive learning widgets from a Gemini-authored design plan." +
  " Respond with structured JSON only." +
  "\n\n" +
  "Output fields and runtime contract:\n" +
  buildInteractiveWidgetImplementationInstructions() +
  "\n\n" +
  "Follow the Gemini widget instructions closely. Keep the widget self-contained and accessible.";

function buildImplementationMessages({
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
  const recipeBlock = buildRecipeBlock(recipe, { mode: "tutor" });
  const contextBlock = screenContext
    ? `\n\n[SCREEN CONTEXT]\n${screenContext}`
    : "";
  const geminiPlanBlock = geminiPlanText
    ? `\n\n[GEMINI PLAN RESPONSE]\n${String(geminiPlanText).trim()}\n`
    : "";

  const geminiWidgetInstructions = JSON.stringify(
    {
      widgetType,
      title,
      explanation: explanation ? String(explanation).trim() : undefined,
      spokenSummary: spokenSummary ? String(spokenSummary).trim() : undefined,
      designPlan,
    },
    null,
    2,
  );

  return {
    systemPrompt: `${WIDGET_IMPLEMENTATION_SYSTEM_PROMPT}${recipeBlock}`,
    userPrompt:
      `${contextBlock}${geminiPlanBlock}\n` +
      `[USER QUERY]\n${userPrompt}\n\n` +
      `[GEMINI WIDGET INSTRUCTIONS]\n${geminiWidgetInstructions}\n\n` +
      "Implement the interactive widget JSON with widgetTitle, htmlLayout, scopedCss, initialState, and mutationLogic.",
  };
}

function resolveImplementationSchema() {
  return resolveGroqInteractiveImplementationSchema();
}
module.exports = {
  WIDGET_IMPLEMENTATION_SYSTEM_PROMPT,
  buildImplementationMessages,
  resolveImplementationSchema,
};
