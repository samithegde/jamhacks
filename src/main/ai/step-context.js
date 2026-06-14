function normalizeCompletedActions(actions) {
  if (!Array.isArray(actions)) return [];

  return actions
    .map((entry, index) => {
      const stepNumber = Number(entry?.stepNumber);
      const description = String(entry?.description ?? entry?.label ?? "").trim();
      const action = String(entry?.action ?? "cursor").trim() || "cursor";

      if (!description) return null;

      return {
        stepNumber: Number.isFinite(stepNumber) && stepNumber > 0 ? stepNumber : index + 1,
        description,
        action,
      };
    })
    .filter(Boolean);
}

function formatCompletedStepsBlock(actions) {
  const normalized = normalizeCompletedActions(actions);
  if (!normalized.length) return "";

  const lines = normalized.map(
    ({ stepNumber, description, action }) =>
      `${stepNumber}. [${action}] ${description}`,
  );

  return `Steps completed so far:\n${lines.join("\n")}`;
}

function buildRecipeBlock(recipe, { mode } = {}) {
  if (!recipe?.chunks?.length) return "";

  const sections = recipe.chunks
    .map((chunk) => `[Source: ${chunk.source}]\n${chunk.text}`)
    .join("\n\n---\n\n");

  if (mode === "tutor") {
    return (
      "\n\n[STUDY KNOWLEDGE BASE]\n" +
      sections +
      "\n\n[INSTRUCTION] The knowledge base above contains study material. " +
      "Ground your answer in these sources when relevant. " +
      "For classic widgets, use diagramCode for Mermaid when it helps and widgetSummary for a short overlay caption. " +
      "For quiz, practice, test-me, knowledge checks, or hands-on requests, use an interactive widgetType with widgetTitle and designPlan build directions only — never HTML, CSS, or JS. Groq implements the widget from designPlan."
    );
  }

  const needsGuidance = recipe.needsOnScreenGuidance !== false;
  const instruction = needsGuidance
    ? "The excerpts above were retrieved from live documentation or web sources. " +
      "Use them for workflow order and terminology. " +
      "The user needs on-screen UI guidance — combine excerpts with the screenshot to choose the next concrete click. " +
      "Brief or high-level excerpts (for example video blurbs) still justify guiding through standard app workflows visible on screen. " +
      "Do not claim the sources lack steps; return the first actionable UI target instead."
    : "The excerpts above were retrieved from live documentation or web sources. " +
      "Use them to answer accurately. When building a UI plan, follow steps described in the sources — do not invent steps not supported by the retrieved content.";

  return `\n\n[EXTERNAL KNOWLEDGE]\n${sections}\n\n[INSTRUCTION] ${instruction}`;
}

function buildNavigationSystemAddon(recipe) {
  if (!recipe?.needsOnScreenGuidance) return "";

  return (
    " NAVIGATION MODE: The user wants step-by-step help in the application on screen. " +
    "Return a non-empty plan with the first actionable UI step (bbox from the screenshot). " +
    "Use retrieved sources for workflow order; use the screenshot for where to click. " +
    "CAD and 3D apps typically follow sketch, draw, then extrude workflows when creating solids. " +
    "Do not respond with plan=[] and do not tell the user that sources lack specific steps. " +
    "Only use plan=[] if the goal is already complete on screen."
  );
}

function buildNavigationStepUserText({ goal, lastAction, completedActions, recipe } = {}) {
  const goalText = String(goal ?? "").trim();
  const lastActionText = String(lastAction ?? "").trim();
  const completedBlock = formatCompletedStepsBlock(completedActions);
  const recipeBlock = buildRecipeBlock(recipe, { mode: "navigation" });

  const sections = [];

  if (recipeBlock) sections.push(recipeBlock);
  if (goalText) sections.push(`Original goal: ${goalText}`);
  if (completedBlock) sections.push(completedBlock);
  if (lastActionText) sections.push(`Last action completed: ${lastActionText}`);

  sections.push("What is the single next step? Return empty plan if done.");

  return sections.join("\n\n");
}

module.exports = {
  normalizeCompletedActions,
  formatCompletedStepsBlock,
  buildRecipeBlock,
  buildNavigationSystemAddon,
  buildNavigationStepUserText,
};
