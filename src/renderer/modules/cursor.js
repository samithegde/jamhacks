import { renderMarkdown } from "./markdown.js";
import { announceAccessibilityMessage } from "./accessibility.js";

const DEFAULTS = {
  x: window.innerWidth / 2,
  y: window.innerHeight / 2,
  visible: false,
  animate: true,
  duration: 250,
};

const WIDGET_WIDTH_ESTIMATE = 280;
const WIDGET_HEIGHT_ESTIMATE = 90;

export function initVirtualCursor() {
  const cursor = document.getElementById("ai-cursor");
  const widget = document.getElementById("ai-step-widget");
  const widgetBadge = document.getElementById("ai-step-widget-badge");
  const widgetText = document.getElementById("ai-step-widget-text");
  if (!cursor) return;

  const promptControls = document.getElementById("ai-prompt-controls");
  const nextBtn = document.getElementById("ai-next-btn");
  const cancelBtn = document.getElementById("ai-cancel-btn");

  let state = { ...DEFAULTS };
  let revealTimer = null;

  function applyPosition(x, y, animate, duration) {
    cursor.style.transition = animate
      ? `left ${duration}ms ease, top ${duration}ms ease`
      : "none";
    cursor.style.left = `${x}px`;
    cursor.style.top = `${y}px`;
  }

  function render() {
    cursor.classList.toggle("hidden", !state.visible);
    applyPosition(state.x, state.y, false, 0);
  }

  function clearRevealTimer() {
    if (revealTimer) {
      clearTimeout(revealTimer);
      revealTimer = null;
    }
  }

  function hideStepWidget() {
    if (!widget) return;
    widget.classList.add("hidden");
    widget.classList.remove("is-entering", "is-left", "is-above");
    if (widgetBadge) widgetBadge.textContent = "";
    if (widgetText) widgetText.innerHTML = "";
    clearRevealTimer();
  }

  function positionStepWidget(x, y) {
    if (!widget) return;

    const controlsVisible =
      promptControls && !promptControls.classList.contains("hidden");
    const placeLeft = x + WIDGET_WIDTH_ESTIMATE + 40 > window.innerWidth;
    const placeAbove =
      controlsVisible ||
      y + WIDGET_HEIGHT_ESTIMATE + 40 > window.innerHeight;

    widget.classList.toggle("is-left", placeLeft);
    widget.classList.toggle("is-above", placeAbove);
  }

  function showStepWidget(text, options = {}) {
    if (!widget || !widgetText) return;

    const content = String(text ?? "").trim();
    if (!content) {
      hideStepWidget();
      return;
    }

    const stepIndex = Number(options.stepIndex);
    const stepTotal = Number(options.stepTotal);

    widgetText.innerHTML = renderMarkdown(content);

    if (widgetBadge) {
      if (Number.isFinite(stepIndex) && stepIndex > 0) {
        widgetBadge.textContent = Number.isFinite(stepTotal) && stepTotal > 0
          ? `Step ${stepIndex} of ${stepTotal}`
          : `Step ${stepIndex}`;
      } else {
        widgetBadge.textContent = "Pointing at";
      }
    }

    positionStepWidget(state.x, state.y);
    widget.classList.remove("hidden", "is-entering");
    void widget.offsetWidth;
    widget.classList.add("is-entering");
  }

  function moveTo(payload = {}) {
    state = {
      ...state,
      x: Number(payload.x ?? state.x),
      y: Number(payload.y ?? state.y),
      visible: payload.visible ?? state.visible,
    };

    applyPosition(
      state.x,
      state.y,
      Boolean(payload.animate),
      Number(payload.duration ?? DEFAULTS.duration)
    );

    if (payload.visible === false) {
      state.visible = false;
      cursor.classList.add("hidden");
      hideStepWidget();
      return;
    }

    const pointerText = String(payload.description ?? payload.label ?? "").trim();
    const shouldShow =
      payload.visible === true || state.visible || Boolean(pointerText);

    if (shouldShow) {
      state.visible = true;
      cursor.classList.remove("hidden");
    }

    if (payload.label && state.visible) {
      announceAccessibilityMessage(payload.label);
      const revealDelay = payload.animate
        ? Number(payload.duration ?? DEFAULTS.duration)
        : 0;

      clearRevealTimer();
      revealTimer = setTimeout(() => {
        revealTimer = null;
        showStepWidget(pointerText, {
          stepIndex: payload.stepIndex,
          stepTotal: payload.stepTotal,
        });
      }, revealDelay);
    } else if (!pointerText) {
      hideStepWidget();
    }
  }

  window.aiTools?.onCursorMove((payload) => moveTo(payload));
  window.aiTools?.onCursorVisibility(({ visible }) => {
    state.visible = visible;
    cursor.classList.toggle("hidden", !visible);
    if (!visible) hideStepWidget();
  });

  if (promptControls && nextBtn) {
    window.aiTools?.onNextButtonShow(() => {
      promptControls.style.left = `${state.x - 40}px`;
      promptControls.style.top = `${state.y + 28}px`;
      promptControls.classList.remove("hidden");
      if (widget && !widget.classList.contains("hidden")) {
        positionStepWidget(state.x, state.y);
      }
    });

    window.aiTools?.onNextButtonHide(() => {
      promptControls.classList.add("hidden");
      if (widget && !widget.classList.contains("hidden")) {
        positionStepWidget(state.x, state.y);
      }
    });

    nextBtn.addEventListener("click", () => {
      promptControls.classList.add("hidden");
      window.aiTools?.emitNextClicked();
    });

    cancelBtn?.addEventListener("click", () => {
      promptControls.classList.add("hidden");
      window.aiTools?.emitPromptCancelled();
    });
  }

  window.addEventListener("resize", () => {
    state.x = clamp(state.x, 0, window.innerWidth);
    state.y = clamp(state.y, 0, window.innerHeight);
    applyPosition(state.x, state.y, false, 0);
    if (widget && !widget.classList.contains("hidden")) {
      positionStepWidget(state.x, state.y);
    }
  });

  render();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
