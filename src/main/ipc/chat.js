const { chat, chatStep, planRetrieval, refineCoordinate } = require("../gemini/service");
const { retrieve } = require("../rag/retrieve");
const { resolveCollection } = require("../rag/collections");
const { getStats } = require("../rag/store");

// Holds the recipe for the active hybrid loop session so chatStep can reuse it.
let sessionRecipe = null;

function isRagEnabled() {
  return process.env.RAG_ENABLED !== "false";
}

async function buildRecipe(userText, history) {
  if (!isRagEnabled() || !userText) return null;

  try {
    const stats = getStats();
    if (stats.totalChunks === 0) return null;

    const plan = await planRetrieval(userText, history);
    const collection = resolveCollection(plan.targetApp);
    const topK = Number(process.env.RAG_TOP_K) || 5;
    const chunks = await retrieve(plan.ragQuery, { topK, collection });

    if (!chunks.length) return null;

    return {
      intent: plan.intent,
      ragQuery: plan.ragQuery,
      needsOnScreenGuidance: plan.needsOnScreenGuidance,
      chunks,
    };
  } catch (err) {
    console.error("[RAG] retrieval failed:", err.message);
    return null;
  }
}

function registerChatIpc(ipcMain) {
  ipcMain.handle("chat:send", async (_event, payload) => {
    const history = payload?.history;
    if (!Array.isArray(history) || !history.length) {
      throw new Error("Chat history is required.");
    }

    const lastUser = [...history].reverse().find((m) => m.sender === "user");
    const userText = lastUser?.text || "";

    const recipe = await buildRecipe(userText, history);
    sessionRecipe = recipe;

    return chat(history, { recipe });
  });

  ipcMain.handle("chat:step", async (_event, payload) => {
    const { goal, lastAction, screenshotBase64 } = payload ?? {};
    if (!goal) {
      throw new Error("goal is required.");
    }

    return chatStep(goal, lastAction ?? "", screenshotBase64 ?? null, {
      recipe: sessionRecipe,
    });
  });

  ipcMain.handle("chat:refine", async (_event, payload) => {
    const { description, croppedBase64, cropW, cropH } = payload ?? {};
    if (!description || !croppedBase64) {
      throw new Error("description and croppedBase64 are required.");
    }

    return refineCoordinate({ description, croppedBase64, cropW, cropH });
  });
}

module.exports = { registerChatIpc };
