const {
  chat,
  chatStep,
  planRetrieval,
  generateTutorWidget,
  getActiveProvider,
} = require("../ai/provider");
const { retrieve, getProviderStatus } = require("../rag/retrieve");
const { routeIntentHeuristic } = require("../rag/heuristics");
const { resolveCollection, resolveTutorCollection } = require("../rag/collections");
const { getStats } = require("../rag/store");
const { getChatWindow } = require("../window");
const { recordChatEvent } = require("../telemetry/chat-telemetry");
const {
  startSession,
  recordActivity,
  summarizePlan,
  truncate,
} = require("../telemetry/chat-activity-log");

let sessionRecipe = null;
let sessionMode = null;
let activitySessionId = null;

function isRagEnabled() {
  return process.env.RAG_ENABLED !== "false";
}

function emitRagStatus(phase, extra = {}) {
  const chatWin = getChatWindow();
  if (!chatWin || chatWin.isDestroyed()) return;
  chatWin.webContents.send("chat:rag-status", { phase, ...extra });
}

async function buildRecipe(userText, history, { mode, sessionId, onPhase } = {}) {
  if (!isRagEnabled() || !userText) {
    recordActivity({
      sessionId,
      phase: "rag.retrieve",
      message: "RAG skipped (disabled or empty query).",
    });
    return null;
  }

  const providers = getProviderStatus();
  const hasRemote = providers.context7 || providers.webSearch;

  let stats;
  try {
    stats = await getStats();
  } catch {
    stats = { totalChunks: 0 };
  }
  const hasLocal = stats.totalChunks > 0;

  if (!hasRemote && !hasLocal) {
    recordActivity({
      sessionId,
      phase: "rag.retrieve",
      message: "RAG skipped (no remote providers or local knowledge base).",
    });
    console.warn("[RAG] No remote providers or local knowledge base configured");
    return null;
  }

  try {
    recordActivity({
      sessionId,
      phase: "rag.intent",
      message: "Parsing user intent for retrieval...",
    });

    let plan;
    if (hasRemote) {
      const heuristic = routeIntentHeuristic(userText);
      if (heuristic.skip) {
        plan = heuristic.plan;
      } else {
        onPhase?.("routing");
        emitRagStatus("routing");
        plan = await planRetrieval(userText, history, { mode });
      }
    } else {
      plan = await planRetrieval(userText, history, { mode });
    }

    recordActivity({
      sessionId,
      phase: "rag.intent",
      message: `Intent: ${truncate(plan.intent, 160)}`,
      detail: {
        ragQuery: plan.ragQuery || plan.query,
        needsOnScreenGuidance: plan.needsOnScreenGuidance,
        targetApp: plan.targetApp || null,
        retrievalSource: plan.retrievalSource || null,
        raw: JSON.stringify(plan, null, 2),
      },
    });

    if (!plan.requiresRag) {
      onPhase?.("idle");
      emitRagStatus("idle");
      return null;
    }

    const ragQuery = (plan.query || plan.ragQuery || "").trim();
    if (!ragQuery) {
      onPhase?.("idle");
      emitRagStatus("idle");
      return null;
    }

    onPhase?.("searching");
    emitRagStatus("searching", {
      source: plan.retrievalSource || (hasRemote ? "web" : "local"),
    });

    const collection =
      mode === "tutor"
        ? resolveTutorCollection(plan.targetApp)
        : resolveCollection(plan.targetApp);
    const topK = Number(process.env.RAG_TOP_K) || 5;

    let chunks = [];
    if (hasRemote) {
      chunks = await retrieve(plan, { topK, collection });
    }
    if (!chunks.length && hasLocal) {
      chunks = await retrieve(ragQuery, { topK, collection });
    }

    onPhase?.("idle");
    emitRagStatus("idle");

    if (!chunks.length && mode === "tutor" && collection === "study") {
      const fallbackChunks = await retrieve(ragQuery, { topK });
      if (fallbackChunks.length) {
        recordActivity({
          sessionId,
          phase: "rag.retrieve",
          message: `Retrieved ${fallbackChunks.length} fallback chunks.`,
          detail: {
            collection: "default",
            sources: [...new Set(fallbackChunks.map((chunk) => chunk.source))],
          },
        });
        return {
          intent: plan.intent,
          ragQuery,
          retrievalSource: plan.retrievalSource,
          needsOnScreenGuidance: plan.needsOnScreenGuidance,
          chunks: fallbackChunks,
        };
      }
    }

    if (!chunks.length) {
      recordActivity({
        sessionId,
        phase: "rag.retrieve",
        message: "No matching knowledge base chunks found.",
        detail: { collection, ragQuery },
      });
      return null;
    }

    recordActivity({
      sessionId,
      phase: "rag.retrieve",
      message: `Retrieved ${chunks.length} chunks${collection ? ` from ${collection}` : ""}.`,
      detail: {
        collection,
        sources: [...new Set(chunks.map((chunk) => chunk.source))],
        previews: chunks.slice(0, 3).map((chunk) => truncate(chunk.text, 120)),
      },
    });

    return {
      intent: plan.intent,
      ragQuery,
      retrievalSource: plan.retrievalSource,
      needsOnScreenGuidance: plan.needsOnScreenGuidance,
      chunks,
    };
  } catch (err) {
    emitRagStatus("idle");
    console.error("[RAG] retrieval failed:", err.message);
    recordActivity({
      sessionId,
      phase: "error",
      level: "error",
      message: `RAG failed: ${err.message}`,
    });
    return null;
  }
}



function historyHasScreenshot(history) {

  return history.some((message) =>

    message.attachments?.some((attachment) =>

      attachment?.mimeType?.startsWith("image/"),

    ),

  );

}



function logModelResponse(sessionId, result, { phase = "model.response" } = {}) {

  const planSummary = summarizePlan(result.plan);

  const planMessage = planSummary.length

    ? `${planSummary.length} on-screen action(s): ${planSummary

        .map((step) => `${step.action} "${step.description}"`)

        .join(" → ")}`

    : "No on-screen actions planned (speech-only reply).";



  recordActivity({

    sessionId,

    phase,

    message: `${truncate(result.explanation, 220)} | ${planMessage}`,

    detail: {

      model: result.model,

      plan: planSummary,

      retrieval: result.retrieval || null,

      widgetType: result.widget?.widgetType ?? null,

      implProvider: result.implProvider ?? null,

      degraded: result.degraded ?? false,

      raw:
        result.text ||
        JSON.stringify(
          {
            explanation: result.explanation,
            plan: result.plan,
            widget: result.widget ?? null,
          },
          null,
          2,
        ),

    },

  });

}



function registerChatIpc(ipcMain) {

  ipcMain.handle("chat:send", async (_event, payload) => {

    const startedAt = Date.now();

    const history = payload?.history;

    if (!Array.isArray(history) || !history.length) {

      throw new Error("Chat history is required.");

    }



    const mode = payload?.mode === "tutor" ? "tutor" : "navigation";

    sessionMode = mode;



    const lastUser = [...history].reverse().find((m) => m.sender === "user");

    const userText = lastUser?.text || "";

    const provider = getActiveProvider();



    activitySessionId = startSession({ userText, mode, provider });



    const ragStartedAt = Date.now();

    const recipe = await buildRecipe(userText, history, {

      mode,

      sessionId: activitySessionId,

    });

    const ragDurationMs = Date.now() - ragStartedAt;

    sessionRecipe = recipe;



    const hasScreenshot = historyHasScreenshot(history);
    const visionNote =
      provider === "ollama" && hasScreenshot
        ? " (text-only; screenshot omitted, Moondream localizes later)"
        : hasScreenshot
          ? " and screenshot"
          : "";

    recordActivity({

      sessionId: activitySessionId,

      phase: "model.request",

      message: `Calling ${provider} with ${history.length} history message(s)${visionNote}.`,

      detail: {

        provider,

        mode,

        ragChunks: recipe?.chunks?.length ?? 0,

        needsOnScreenGuidance: recipe?.needsOnScreenGuidance ?? null,

      },

    });



    try {

      const result =
        mode === "tutor"
          ? await generateTutorWidget(history, { recipe })
          : await chat(history, { recipe, mode });

      logModelResponse(activitySessionId, result);



      recordChatEvent({

        event: "chat.send",

        success: true,

        provider,

        model: result.model,

        mode,

        durationMs: Date.now() - startedAt,

        meta: {

          historyLength: history.length,

          userTextLength: userText.length,

          planLength: result.plan?.length ?? 0,

          explanationLength: result.explanation?.length ?? 0,

          ragChunks: recipe?.chunks?.length ?? 0,

          ragDurationMs,

          hasScreenshot: historyHasScreenshot(history),

        },

      });



      return { ...result, activitySessionId };

    } catch (error) {

      recordActivity({

        sessionId: activitySessionId,

        phase: "error",

        level: "error",

        message: `Model request failed: ${error.message}`,

        detail: error.rawResponse ? { raw: error.rawResponse } : null,

      });



      recordChatEvent({

        event: "chat.send",

        success: false,

        provider,

        mode,

        durationMs: Date.now() - startedAt,

        error: error.message,

        meta: {

          historyLength: history.length,

          userTextLength: userText.length,

          ragChunks: recipe?.chunks?.length ?? 0,

          ragDurationMs,

          hasScreenshot: historyHasScreenshot(history),

        },

      });

      throw error;

    }

  });



  ipcMain.handle("chat:step", async (_event, payload) => {

    const startedAt = Date.now();

    const { goal, lastAction, screenshotBase64, activitySessionId: payloadSessionId } =

      payload ?? {};

    if (!goal) {

      throw new Error("goal is required.");

    }



    const mode = payload?.mode === "tutor" ? "tutor" : sessionMode || "navigation";

    const sessionId = payloadSessionId || activitySessionId;

    const provider = getActiveProvider();



    recordActivity({

      sessionId,

      phase: "model.request",

      message: `Planning next step after "${truncate(lastAction || "previous action", 100)}".`,

      detail: {

        goal: truncate(goal, 160),

        hasScreenshot: Boolean(screenshotBase64),

        provider,

        mode,

      },

    });



    try {

      const result = await chatStep(goal, lastAction ?? "", screenshotBase64 ?? null, {

        recipe: sessionRecipe,

        mode,

      });



      logModelResponse(sessionId, result, { phase: "model.step" });



      recordChatEvent({

        event: "chat.step",

        success: true,

        provider,

        model: result.model,

        mode,

        durationMs: Date.now() - startedAt,

        meta: {

          goalLength: goal.length,

          lastActionLength: String(lastAction || "").length,

          planLength: result.plan?.length ?? 0,

          hasScreenshot: Boolean(screenshotBase64),

        },

      });



      return { ...result, activitySessionId: sessionId };

    } catch (error) {

      recordActivity({

        sessionId,

        phase: "error",

        level: "error",

        message: `Step planning failed: ${error.message}`,

      });



      recordChatEvent({

        event: "chat.step",

        success: false,

        provider,

        mode,

        durationMs: Date.now() - startedAt,

        error: error.message,

        meta: {

          goalLength: goal.length,

          lastActionLength: String(lastAction || "").length,

          hasScreenshot: Boolean(screenshotBase64),

        },

      });

      throw error;

    }

  });

}

module.exports = { registerChatIpc, buildRecipe };
