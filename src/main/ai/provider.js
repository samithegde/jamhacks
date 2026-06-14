const gemini = require("../gemini/service");
const ollama = require("../ollama/service");
const tutor = require("./tutor");
const { isInteractiveWidget } = require("./learning-widget-schema");

function useGeminiModel() {
  const raw =
    process.env.USE_GEMINI_MODEL?.trim() ||
    process.env.USE_GEMENI_MODEL?.trim();

  if (raw === undefined || raw === "") return true;
  const normalized = raw.toLowerCase();
  return normalized !== "false" && normalized !== "0" && normalized !== "no";
}

function getActiveProvider() {
  return useGeminiModel() ? "gemini" : "ollama";
}

function chat(history, options) {
  return useGeminiModel()
    ? gemini.chat(history, options)
    : ollama.chat(history, options);
}

function chatStep(goal, lastActionDescription, screenshotBase64, options) {
  return useGeminiModel()
    ? gemini.chatStep(goal, lastActionDescription, screenshotBase64, options)
    : ollama.chatStep(goal, lastActionDescription, screenshotBase64, options);
}

function planRetrieval(userMessage, history, options) {
  return useGeminiModel()
    ? gemini.planRetrieval(userMessage, history, options)
    : ollama.planRetrieval(userMessage, history, options);
}

async function generateTutorWidget(history, { recipe } = {}) {
  const { widget, model, retrieval, implProvider, degraded } = await tutor.generateLearningWidget({
    history,
    recipe,
    useGemini: useGeminiModel(),
  });

  const explanation = isInteractiveWidget(widget)
    ? String(
        widget.explanation ?? widget.spokenSummary ?? widget.title ?? "",
      ).trim()
    : String(widget.explanation ?? "").trim();

  return {
    explanation,
    plan: [],
    widget,
    model,
    retrieval,
    implProvider: implProvider ?? null,
    degraded: degraded ?? false,
  };
}

module.exports = {
  chat,
  chatStep,
  planRetrieval,
  generateTutorWidget,
  useGeminiModel,
  getActiveProvider,
};
