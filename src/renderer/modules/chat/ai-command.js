import {
  bboxPercentToCss,
  mapBBoxCenterToScreen,
  mapCropPointToScreen,
  mapCropBboxToScreen,
} from "../../../shared/localization-coords.mjs";
import { getCaptureServices } from "../capture-service.js";
import { cropBase64Image } from "../context-crop.js";
import { MAX_HYBRID_STEPS, NEXT_STEP_CLICK_RADIUS } from "./constants.js";
import { captureScreenBase64 } from "./attachments.js";
import {
  beginPromptLoop,
  cancelPrompt,
  delay,
  resetPromptLoopState,
  waitForCompleteClick,
  waitForNextClick,
} from "./prompt-loop.js";
import { messages, promptLoopCancelled, PromptCancelledError } from "./state.js";
import { speakExplanation } from "./voice.js";

const TUTOR_MODE_STORAGE_KEY = "clarity:tutor-mode";

function isTutorModeEnabled() {
  try {
    return localStorage.getItem(TUTOR_MODE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function getBboxScreenDimensions() {
  return { width: window.screen.width, height: window.screen.height };
}

export function resolveStepBBox(step) {
  const description = String(step?.description ?? step?.label ?? "").trim();
  const action = String(step?.action ?? "cursor").toLowerCase();
  const { width: screenW, height: screenH } = getBboxScreenDimensions();
  const cssBox = bboxPercentToCss(step?.bbox, screenW, screenH);

  if (!cssBox) {
    const x = Number(step?.x);
    const y = Number(step?.y);
    if (![x, y].every(Number.isFinite)) return null;

    return {
      ...step,
      coarseMethod: "legacy",
      markBBox: step?.w && step?.h
        ? { x: step.x, y: step.y, w: step.w, h: step.h }
        : { x: step.x, y: step.y, w: 1, h: 1 },
    };
  }

  const markBBox = { x: cssBox.x, y: cssBox.y, w: cssBox.w, h: cssBox.h };
  const centerX = Math.round(cssBox.x + cssBox.w / 2);
  const centerY = Math.round(cssBox.y + cssBox.h / 2);

  if (action === "highlight") {
    return {
      ...step,
      x: cssBox.x,
      y: cssBox.y,
      w: cssBox.w,
      h: cssBox.h,
      markBBox,
      description,
      label: description,
      coarseMethod: "bbox",
    };
  }

  return {
    ...step,
    x: centerX,
    y: centerY,
    w: cssBox.w,
    h: cssBox.h,
    markBBox,
    description,
    label: description,
    coarseMethod: "bbox",
  };
}

export function extractTargetText(description = "") {
  const text = String(description ?? "").trim();
  const quoted = text.match(/["'`](.+?)["'`]/);
  if (quoted?.[1]) return quoted[1].trim();

  const withoutMarkdown = text
    .replace(/[*_`#>\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const nounish = withoutMarkdown.match(/\b(?:button|link|menu|tab|field|input|option|item)\s+(.+)$/i);
  return (nounish?.[1] || withoutMarkdown).slice(0, 80);
}

export function logLocalization(methods = {}) {
  console.info("[localization]", {
    coarseMethod: methods.coarseMethod || "legacy",
    refineMethod: methods.refineMethod || "skipped",
  });
}

export async function askGemini() {
  if (!window.geminiChat?.send) {
    throw new Error("Gemini bridge unavailable. Restart the app after preload updates.");
  }

  const history = messages
    .filter((msg) => msg.sender === "user" || (msg.sender === "system" && msg.rawResponse))
    .map(({ text, sender, attachments, rawResponse }) => ({
      text: sender === "system" && rawResponse ? rawResponse : text,
      sender,
      attachments: attachments?.map(({ name, mimeType, base64, textContent }) => ({
        name,
        mimeType,
        base64,
        textContent,
      })),
    }));

  return window.geminiChat.send({
    history,
    mode: isTutorModeEnabled() ? "tutor" : "navigation",
  });
}

export async function refineStepCoordinates(step) {
  const base64 = await captureScreenBase64();
  if (!base64) return step;

  const anchor = step.markBBox || {
    x: step.x,
    y: step.y,
    w: step.w || 1,
    h: step.h || 1,
  };

  try {
    const crop = await cropBase64Image(base64, anchor);
    const targetText = extractTargetText(step.description || step.label || "");
    let refineMethod = "coarse-fallback";

    if (targetText && window.localization?.ocrCrop) {
      const ocr = await window.localization.ocrCrop({
        croppedBase64: crop.croppedBase64,
        targetText,
      });

      if (ocr?.fastPath && Number.isFinite(ocr.fastPath.x) && Number.isFinite(ocr.fastPath.y)) {
        const mapped = mapCropPointToScreen(ocr.fastPath, crop, step);
        if (mapped) {
          logLocalization({ coarseMethod: step.coarseMethod, refineMethod: "ocr" });
          return mapped;
        }
      }
    }

    if (window.localization?.moondreamDetect && step.action === "highlight") {
      const detected = await window.localization.moondreamDetect({
        croppedBase64: crop.croppedBase64,
        cropW: crop.cropW,
        cropH: crop.cropH,
        targetElement: step.description || step.label || "target element",
      });

      if (detected && Number.isFinite(detected.w) && Number.isFinite(detected.h)) {
        const mapped = mapCropBboxToScreen(detected, crop, step);
        if (mapped) {
          logLocalization({
            coarseMethod: step.coarseMethod,
            refineMethod: detected.method || "moondream-detect",
          });
          return mapped;
        }
      }
    }

    if (window.localization?.moondreamPoint) {
      const moondream = await window.localization.moondreamPoint({
        croppedBase64: crop.croppedBase64,
        cropW: crop.cropW,
        cropH: crop.cropH,
        targetElement: step.description || step.label || "clickable target",
      });

      if (moondream && Number.isFinite(moondream.x) && Number.isFinite(moondream.y)) {
        const mapped = mapCropPointToScreen(moondream, crop, step);
        if (mapped) {
          logLocalization({
            coarseMethod: step.coarseMethod,
            refineMethod: moondream.method || "moondream-point",
          });
          return mapped;
        }
      }
    }

    logLocalization({ coarseMethod: step.coarseMethod, refineMethod });
    return mapBBoxCenterToScreen(step);
  } catch {
    logLocalization({ coarseMethod: step.coarseMethod, refineMethod: "skipped" });
    return mapBBoxCenterToScreen(step);
  }
}

export async function executeSingleStep(step, stepMeta) {
  const pointerText = step.description || step.label;

  if (step.action === "cursor") {
    await window.aiTools.moveCursor({
      x: step.x,
      y: step.y,
      description: pointerText,
      label: pointerText,
      animate: true,
      duration: 350,
      ...stepMeta,
    });
    return;
  }

  if (step.action === "highlight") {
    const centerX = step.x + Math.round(step.w / 2);
    const centerY = step.y + Math.round(step.h / 2);

    await window.aiTools.moveCursor({
      x: centerX,
      y: centerY,
      description: pointerText,
      label: pointerText,
      animate: true,
      duration: 350,
      ...stepMeta,
    });
    await window.aiTools.clearHighlights();
    await window.aiTools.highlightRect({
      x: step.x,
      y: step.y,
      width: step.w,
      height: step.h,
    });
  }
}

export function getStepClickTarget(step) {
  if (step?.action === "highlight") {
    return {
      x: step.x + Math.round((step.w || 0) / 2),
      y: step.y + Math.round((step.h || 0) / 2),
    };
  }

  return {
    x: step?.x,
    y: step?.y,
  };
}

async function executeHybridLoop(goal, firstStep) {
  if (!firstStep || !window.aiTools) return;

  beginPromptLoop();

  await window.aiTools.ensureOverlay?.();
  await window.aiTools.setCursorVisible(true);
  await window.aiTools.clearHighlights();

  let currentStep = firstStep;
  let stepNumber = 1;
  let prefetchedCapture = null;
  const completedActions = [];

  try {
    while (currentStep && stepNumber <= MAX_HYBRID_STEPS && !promptLoopCancelled) {
      const resolvedStep = resolveStepBBox(currentStep);
      if (!resolvedStep) {
        logLocalization({ coarseMethod: "unresolved", refineMethod: "skipped" });
        break;
      }
      const refinedStep = await refineStepCoordinates(resolvedStep);
      await executeSingleStep(refinedStep, { stepIndex: stepNumber });
      completedActions.push({
        stepNumber,
        description: currentStep.description || currentStep.label || "",
        action: currentStep.action || "cursor",
      });
      if (promptLoopCancelled) break;

      prefetchedCapture = captureScreenBase64();

      const isLastStep = Boolean(currentStep.isFinal);

      if (isLastStep) {
        await window.aiTools.showCompleteButton();

        try {
          await waitForCompleteClick();
        } catch (error) {
          if (error instanceof PromptCancelledError) break;
          throw error;
        }

        break;
      }

      await window.aiTools.showNextButton({
        ...getStepClickTarget(refinedStep),
        radius: NEXT_STEP_CLICK_RADIUS,
      });

      try {
        await waitForNextClick();
      } catch (error) {
        if (error instanceof PromptCancelledError) break;
        throw error;
      }

      if (promptLoopCancelled) break;

      const screenshotBase64 = prefetchedCapture
        ? await prefetchedCapture
        : await captureScreenBase64();
      prefetchedCapture = null;

      const response = await window.geminiChat.step({
        goal,
        lastAction: currentStep.description || currentStep.label || "",
        completedActions,
        screenshotBase64,
      });

      const nextPlan = Array.isArray(response?.plan) ? response.plan : [];
      currentStep = nextPlan[0] ?? null;
      stepNumber += 1;

      if (!currentStep) {
        await window.aiTools.showCompleteButton();

        try {
          await waitForCompleteClick();
        } catch (error) {
          if (error instanceof PromptCancelledError) break;
          throw error;
        }

        break;
      }
    }
  } finally {
    prefetchedCapture = null;
    resetPromptLoopState();
    await window.aiTools.hideNextButton();
    await window.aiTools.clearHighlights();
    await delay(600);
    await window.aiTools.setCursorVisible(false);
  }
}

export async function handleAiCommand(text) {
  try {
    const commandReply = await runCommand(text);
    if (commandReply) return { text: commandReply };

    const response = await askGemini();
    const explanation = (response?.explanation || "").trim();
    const plan = Array.isArray(response?.plan) ? response.plan : [];

    if (!explanation) {
      throw new Error("Gemini returned an empty explanation.");
    }

    speakExplanation(explanation);

    const firstStep = plan[0] ?? null;
    if (firstStep) {
      await executeHybridLoop(text, firstStep);
    }

    const retrieval = response?.retrieval;
    const via =
      retrieval?.retrievalSource === "context7"
        ? "Context7"
        : retrieval?.retrievalSource === "web"
          ? "Web"
          : "";
    const sourceNote =
      retrieval?.sources?.length
        ? `\n\n*Sources${via ? ` (${via})` : ""}: ${retrieval.sources.join(", ")}*`
        : "";

    return {
      text: explanation + sourceNote,
      plan,
      rawResponse: response?.text || JSON.stringify({ explanation, plan }),
    };
  } catch (error) {
    return { text: `AI error: ${error.message}` };
  }
}

export async function runCommand(text) {
  const parts = text.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase();

  if (command === "/cursor" && parts.length >= 3) {
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    const label = parts.slice(3).join(" ").trim();
    if (Number.isFinite(x) && Number.isFinite(y)) {
      await window.aiTools.ensureOverlay?.();
      await window.aiTools.setCursorVisible(true);
      await window.aiTools.moveCursor({
        x,
        y,
        label: label || "Move here",
        animate: true,
        duration: 350,
      });
      setTimeout(() => {
        window.aiTools.setCursorVisible(false);
      }, 4000);
      return label ? `Moved AI cursor: ${label}` : "Moved AI cursor.";
    }
  }

  if (command === "/highlight" && parts.length >= 5) {
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    const width = Number(parts[3]);
    const height = Number(parts[4]);
    if ([x, y, width, height].every(Number.isFinite)) {
      await window.aiTools.ensureOverlay?.();
      await window.aiTools.highlightRect({ x, y, width, height });
      return "Added highlight.";
    }
  }

  if (command === "/clear") {
    await window.aiTools.clearHighlights();
    await window.aiTools.clearAnnotations?.();
    return "Cleared highlights.";
  }

  if (command === "/cancel") {
    if (cancelPrompt()) {
      return "Cancelled guided prompt.";
    }
    return "No active prompt to cancel.";
  }

  const { audioCapture, screenCapture } = getCaptureServices();

  if (command === "/mic" && parts[1] === "start") {
    const status = await audioCapture.start();
    return `Mic capture running at ${status.sampleRate}Hz (${status.channelCount}ch).`;
  }

  if (command === "/mic" && parts[1] === "stop") {
    audioCapture.stop();
    await window.capture.clearAudioBuffer();
    return "Mic capture stopped.";
  }

  if (command === "/mic" && parts[1] === "stats") {
    const local = audioCapture.getLocalStats();
    const main = await window.capture.getAudioBufferStats();
    return `Mic chunks local=${local.chunkCount}, main=${main.chunkCount}, samples=${main.sampleCount}.`;
  }

  if (command === "/ai" && parts[1] === "stats") {
    if (!window.chatTelemetry?.summary) {
      return "Chat telemetry bridge unavailable. Restart the app.";
    }
    const summary = await window.chatTelemetry.summary();
    const lines = [
      `Telemetry ${summary.enabled ? "enabled" : "disabled"} (last ${Math.round(summary.windowMs / 60000)}m)`,
      `Events: ${summary.totalEvents}`,
      `chat.send: ${summary.chatSend.count} calls, ${summary.chatSend.successCount} ok, ${summary.chatSend.errorCount} errors, avg ${summary.chatSend.avgMs}ms, p95 ${summary.chatSend.p95Ms}ms`,
      `chat.step: ${summary.chatStep.count} calls, ${summary.chatStep.successCount} ok, ${summary.chatStep.errorCount} errors, avg ${summary.chatStep.avgMs}ms, p95 ${summary.chatStep.p95Ms}ms`,
    ];
    const providers = Object.entries(summary.providers || {});
    if (providers.length) {
      lines.push(
        `Providers: ${providers.map(([name, count]) => `${name}=${count}`).join(", ")}`,
      );
    }
    const models = Object.entries(summary.models || {});
    if (models.length) {
      lines.push(
        `Models: ${models.map(([name, count]) => `${name}=${count}`).join(", ")}`,
      );
    }
    if (summary.recentErrors?.length) {
      lines.push(
        `Recent errors: ${summary.recentErrors
          .map((entry) => `${entry.event} (${entry.error})`)
          .join(" | ")}`,
      );
    }
    return lines.join("\n");
  }

  if (command === "/screens") {
    const sources = await screenCapture.listSources({ types: ["screen"] });
    if (!sources.length) return "No screens found.";
    return sources
      .map((source, index) => `${index}: ${source.name} (${source.id})`)
      .join(" | ");
  }

  if (command === "/screen" && parts[1] === "start") {
    const sources = await screenCapture.listSources({ types: ["screen"] });
    const index = Number(parts[2] ?? 0);
    const source = sources[index];
    if (!source) return "Screen source not found.";

    const status = await screenCapture.start({ sourceId: source.id });
    return `Screen capture started: ${status.sourceName ?? source.name}.`;
  }

  if (command === "/screen" && parts[1] === "stop") {
    screenCapture.stop();
    return "Screen capture stopped.";
  }

  if (command === "/screen" && parts[1] === "frame") {
    const frame = screenCapture.captureFrame();
    if (!frame) return "No screen frame available.";
    return `Captured ${frame.width}x${frame.height} frame.`;
  }

  return null;
}
