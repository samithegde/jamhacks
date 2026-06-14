import { renderMarkdown, enhanceMermaidDiagrams, prepareMermaidNode } from "./markdown.js";
import { normalizeDiagramCode } from "./mermaid-normalize.js";
import { mountBlueprintWidget, teardownBlueprintWidget } from "./widget-runtime.js";

let widgetEl = null;
let explanationEl = null;
let diagramWrapEl = null;
let mermaidEl = null;
let closeButton = null;
let blueprintHostEl = null;
let badgeEl = null;
let headerEl = null;
let dragState = null;

const INTERACTIVE_WIDGET_TYPES = new Set(["interactive-quiz", "code-playground", "concept-graph"]);

function isInteractiveWidget(widget) {
  return INTERACTIVE_WIDGET_TYPES.has(widget?.widgetType);
}

function hideClassicSlots() {
  if (explanationEl) {
    explanationEl.innerHTML = "";
    explanationEl.classList.add("hidden");
  }
  if (diagramWrapEl) diagramWrapEl.classList.add("hidden");
}

function showClassicSlots() {
  if (explanationEl) explanationEl.classList.remove("hidden");
}

function resetWidgetPosition() {
  if (!widgetEl) return;
  stopWidgetDrag();
  widgetEl.classList.remove("is-positioned", "is-dragging");
  widgetEl.style.left = "";
  widgetEl.style.top = "";
  widgetEl.style.right = "";
  widgetEl.style.bottom = "";
}

function clampWidgetPosition(left, top) {
  const width = widgetEl.offsetWidth;
  const height = widgetEl.offsetHeight;
  const maxLeft = Math.max(0, window.innerWidth - width);
  const maxTop = Math.max(0, window.innerHeight - height);
  return {
    left: Math.min(Math.max(0, left), maxLeft),
    top: Math.min(Math.max(0, top), maxTop),
  };
}

function anchorWidgetPosition() {
  const rect = widgetEl.getBoundingClientRect();
  widgetEl.classList.add("is-positioned");
  widgetEl.style.right = "auto";
  widgetEl.style.bottom = "auto";
  widgetEl.style.left = `${rect.left}px`;
  widgetEl.style.top = `${rect.top}px`;
}

function moveWidget(clientX, clientY) {
  if (!dragState) return;
  const { left, top } = clampWidgetPosition(
    clientX - dragState.offsetX,
    clientY - dragState.offsetY
  );
  widgetEl.style.left = `${left}px`;
  widgetEl.style.top = `${top}px`;
}

function onWidgetDragMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  event.preventDefault();
  moveWidget(event.clientX, event.clientY);
}

function stopWidgetDrag(event) {
  if (!dragState) return;
  if (event && event.pointerId !== dragState.pointerId) return;
  dragState = null;
  widgetEl?.classList.remove("is-dragging");
  document.body.classList.remove("ai-learning-widget-dragging");
  window.removeEventListener("pointermove", onWidgetDragMove);
  window.removeEventListener("pointerup", stopWidgetDrag);
  window.removeEventListener("pointercancel", stopWidgetDrag);
}

function initLearningWidgetDrag() {
  if (!headerEl || !widgetEl) return;

  headerEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest(".ai-learning-widget__close")) return;

    event.preventDefault();
    widgetEl.classList.remove("is-entering");

    const rect = widgetEl.getBoundingClientRect();
    if (!widgetEl.classList.contains("is-positioned")) {
      anchorWidgetPosition();
    }

    dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };

    widgetEl.classList.add("is-dragging");
    document.body.classList.add("ai-learning-widget-dragging");
    headerEl.setPointerCapture?.(event.pointerId);

    window.addEventListener("pointermove", onWidgetDragMove);
    window.addEventListener("pointerup", stopWidgetDrag);
    window.addEventListener("pointercancel", stopWidgetDrag);
  });
}

function hideLearningWidgetPanel() {
  if (!widgetEl) return;
  resetWidgetPosition();
  widgetEl.classList.add("hidden");
  widgetEl.classList.remove("is-entering");
  if (explanationEl) explanationEl.innerHTML = "";
  if (mermaidEl) {
    mermaidEl.textContent = "";
    mermaidEl.removeAttribute("data-processed");
  }
  if (diagramWrapEl) diagramWrapEl.classList.add("hidden");
  if (blueprintHostEl) blueprintHostEl.classList.add("hidden");
  teardownBlueprintWidget();
  if (badgeEl) badgeEl.textContent = "Tutor";
}

async function showLearningWidgetPanel(payload = {}) {
  if (!widgetEl) return;

  if (isInteractiveWidget(payload)) {
    hideClassicSlots();
    teardownBlueprintWidget();
    if (blueprintHostEl) {
      blueprintHostEl.classList.remove("hidden");
      mountBlueprintWidget(blueprintHostEl, payload);
    }
    if (badgeEl) badgeEl.textContent = payload.title || payload.widgetType;
  } else {
    if (blueprintHostEl) blueprintHostEl.classList.add("hidden");
    teardownBlueprintWidget();
    showClassicSlots();
    if (badgeEl) badgeEl.textContent = "Tutor";

    const explanation = String(payload.explanation || "").trim();
    const widgetSummary = String(payload.widgetSummary || "").trim();
    const diagramCode = normalizeDiagramCode(String(payload.diagramCode || "").trim());

    if (explanationEl) {
      if (diagramCode) {
        if (widgetSummary) {
          explanationEl.innerHTML = renderMarkdown(widgetSummary);
          explanationEl.classList.remove("hidden");
        } else {
          explanationEl.innerHTML = "";
          explanationEl.classList.add("hidden");
        }
      } else if (explanation) {
        explanationEl.innerHTML = renderMarkdown(explanation);
        explanationEl.classList.remove("hidden");
      } else {
        explanationEl.innerHTML = "";
        explanationEl.classList.add("hidden");
      }
    }

    if (mermaidEl && diagramWrapEl) {
      mermaidEl.textContent = "";
      mermaidEl.removeAttribute("data-processed");
      mermaidEl.removeAttribute("data-mermaid-encoded");
      if (diagramCode) {
        prepareMermaidNode(mermaidEl, diagramCode);
        diagramWrapEl.classList.remove("hidden");
        await enhanceMermaidDiagrams(diagramWrapEl);
      } else {
        diagramWrapEl.classList.add("hidden");
      }
    }
  }

  widgetEl.classList.remove("hidden", "is-entering");
  void widgetEl.offsetWidth;
  widgetEl.classList.add("is-entering");
}

export function initLearningWidget() {
  widgetEl = document.getElementById("ai-learning-widget");
  explanationEl = document.getElementById("ai-learning-widget-explanation");
  diagramWrapEl = document.getElementById("ai-learning-widget-diagram");
  mermaidEl = document.getElementById("ai-learning-widget-mermaid");
  closeButton = document.getElementById("ai-learning-widget-close");
  blueprintHostEl = document.getElementById("ai-learning-widget-blueprint-host");
  badgeEl = widgetEl?.querySelector(".ai-learning-widget__badge") ?? null;
  headerEl = widgetEl?.querySelector(".ai-learning-widget__header") ?? null;

  initLearningWidgetDrag();

  closeButton?.addEventListener("click", () => {
    void window.aiTools?.hideLearningWidget?.();
  });

  window.aiTools?.onLearningWidgetShow?.((payload) => {
    void showLearningWidgetPanel(payload);
  });

  window.aiTools?.onLearningWidgetHide?.(() => {
    hideLearningWidgetPanel();
  });
}

export { showLearningWidgetPanel, hideLearningWidgetPanel };
