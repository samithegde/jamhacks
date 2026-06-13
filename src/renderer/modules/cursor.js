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
const SCREEN_EDGE_PADDING = 8;
const CURSOR_OFFSET_X = 28;
const PROMPT_CONTROLS_OFFSET_X = 40;
const PROMPT_CONTROLS_OFFSET_Y = 28;
const NEXT_CLICK_RADIUS = 10;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getCursorVisualMargin() {
  const magnify = document.body.classList.contains("accessibility-magnify");
  return {
    left: magnify ? 26 : 16,
    top: magnify ? 16 : 12,
    right: magnify ? 38 : 30,
    bottom: magnify ? 38 : 30,
  };
}

function getWidgetMaxWidth() {
  if (document.body.classList.contains("accessibility-large-text")) return 380;
  if (document.body.classList.contains("accessibility-magnify")) return 360;
  return WIDGET_WIDTH_ESTIMATE;
}

function clampCursorPosition(x, y) {
  const margin = getCursorVisualMargin();
  const pad = SCREEN_EDGE_PADDING;
  const minX = margin.left + pad;
  const maxX = Math.max(minX, window.innerWidth - margin.right - pad);
  const minY = margin.top + pad;
  const maxY = Math.max(minY, window.innerHeight - margin.bottom - pad);
  return {
    x: clamp(x, minX, maxX),
    y: clamp(y, minY, maxY),
  };
}

function getOverflowCorrection(rect) {
  const pad = SCREEN_EDGE_PADDING;
  let dx = 0;
  let dy = 0;

  if (rect.left < pad) {
    dx = pad - rect.left;
  } else if (rect.right > window.innerWidth - pad) {
    dx = window.innerWidth - pad - rect.right;
  }

  if (rect.top < pad) {
    dy = pad - rect.top;
  } else if (rect.bottom > window.innerHeight - pad) {
    dy = window.innerHeight - pad - rect.bottom;
  }

  return { dx, dy };
}

export function initVirtualCursor() {
  const cursor = document.getElementById("ai-cursor");
  const widget = document.getElementById("ai-step-widget");
  const widgetBadge = document.getElementById("ai-step-widget-badge");
  const widgetText = document.getElementById("ai-step-widget-text");
  if (!cursor) return;

  const promptControls = document.getElementById("ai-prompt-controls");
  const completeBtn = document.getElementById("ai-complete-btn");
  const cancelBtn = document.getElementById("ai-cancel-btn");

  let state = { ...DEFAULTS };
  let revealTimer = null;
  let nextClickTarget = null;

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

  function updateWidgetPlacement(x, y) {
    if (!widget) return;

    const controlsVisible =
      promptControls && !promptControls.classList.contains("hidden");
    const widgetWidth = getWidgetMaxWidth();
    const widgetHeight = widget.classList.contains("hidden")
      ? WIDGET_HEIGHT_ESTIMATE
      : Math.max(widget.offsetHeight, WIDGET_HEIGHT_ESTIMATE);
    const pad = SCREEN_EDGE_PADDING + CURSOR_OFFSET_X;

    const placeLeft = x + widgetWidth + pad > window.innerWidth;
    const placeAbove =
      controlsVisible ||
      y + widgetHeight + pad > window.innerHeight;

    widget.classList.toggle("is-left", placeLeft);
    widget.classList.toggle("is-above", placeAbove);
  }

  function positionPromptControls(x, y) {
    if (!promptControls) return;

    const defaultLeft = x - PROMPT_CONTROLS_OFFSET_X;
    const defaultTop = y + PROMPT_CONTROLS_OFFSET_Y;

    promptControls.style.left = `${defaultLeft}px`;
    promptControls.style.top = `${defaultTop}px`;

    const { dx, dy } = getOverflowCorrection(
      promptControls.getBoundingClientRect()
    );
    if (dx || dy) {
      promptControls.style.left = `${defaultLeft + dx}px`;
      promptControls.style.top = `${defaultTop + dy}px`;
    }
  }

  function constrainLayout({ animate = false, duration = 0 } = {}) {
    let { x, y } = clampCursorPosition(state.x, state.y);

    applyPosition(x, y, animate, duration);

    if (widget && !widget.classList.contains("hidden")) {
      updateWidgetPlacement(x, y);
      void widget.offsetHeight;

      let overflow = getOverflowCorrection(widget.getBoundingClientRect());
      if (overflow.dx || overflow.dy) {
        ({ x, y } = clampCursorPosition(x + overflow.dx, y + overflow.dy));
        applyPosition(x, y, false, 0);
        updateWidgetPlacement(x, y);
        void widget.offsetHeight;
        overflow = getOverflowCorrection(widget.getBoundingClientRect());
      }

      if (overflow.dx || overflow.dy) {
        widget.classList.toggle("is-left", !widget.classList.contains("is-left"));
        void widget.offsetHeight;
        overflow = getOverflowCorrection(widget.getBoundingClientRect());
        if (overflow.dx || overflow.dy) {
          ({ x, y } = clampCursorPosition(x + overflow.dx, y + overflow.dy));
          applyPosition(x, y, false, 0);
        }
      }
    }

    if (promptControls && !promptControls.classList.contains("hidden")) {
      positionPromptControls(x, y);

      if (widget && !widget.classList.contains("hidden")) {
        updateWidgetPlacement(x, y);
        void widget.offsetHeight;
        const overflow = getOverflowCorrection(widget.getBoundingClientRect());
        if (overflow.dx || overflow.dy) {
          ({ x, y } = clampCursorPosition(x + overflow.dx, y + overflow.dy));
          applyPosition(x, y, false, 0);
          updateWidgetPlacement(x, y);
        }
      }
    }

    state.x = x;
    state.y = y;
    return { x, y };
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

    widget.classList.remove("hidden", "is-entering");
    void widget.offsetWidth;
    widget.classList.add("is-entering");
    constrainLayout();
  }

  function moveTo(payload = {}) {
    state = {
      ...state,
      x: Number(payload.x ?? state.x),
      y: Number(payload.y ?? state.y),
      visible: payload.visible ?? state.visible,
    };

    const animate = Boolean(payload.animate);
    const duration = Number(payload.duration ?? DEFAULTS.duration);
    constrainLayout({ animate, duration });

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

  if (promptControls) {
    function clearNextClickTarget() {
      nextClickTarget = null;
    }

    function getNextClickTarget(payload = {}) {
      const x = Number(payload.x ?? state.x);
      const y = Number(payload.y ?? state.y);
      const radius = Number(payload.radius ?? NEXT_CLICK_RADIUS);

      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

      return {
        x,
        y,
        radius: Number.isFinite(radius) && radius > 0
          ? radius
          : NEXT_CLICK_RADIUS,
      };
    }

    function showNextMode(payload = {}) {
      nextClickTarget = getNextClickTarget(payload);
      completeBtn?.classList.add("hidden");
      promptControls.classList.add("hidden");
      constrainLayout();
    }

    function showCompleteMode() {
      clearNextClickTarget();
      completeBtn?.classList.remove("hidden");
      promptControls.classList.remove("hidden");
      constrainLayout();
    }

    function hidePromptControls() {
      clearNextClickTarget();
      promptControls.classList.add("hidden");
      completeBtn?.classList.add("hidden");
      if (widget && !widget.classList.contains("hidden")) {
        constrainLayout();
      }
    }

    window.aiTools?.onNextButtonShow((payload) => {
      showNextMode(payload);
    });

    window.aiTools?.onCompleteButtonShow(() => {
      showCompleteMode();
    });

    window.aiTools?.onNextButtonHide(() => {
      hidePromptControls();
    });

    completeBtn?.addEventListener("click", () => {
      hidePromptControls();
      window.aiTools?.emitCompleteClicked();
    });

    cancelBtn?.addEventListener("click", () => {
      hidePromptControls();
      window.aiTools?.emitPromptCancelled();
    });

    document.addEventListener("click", (event) => {
      if (!nextClickTarget) return;
      if (event.target?.closest?.("#ai-cancel-btn, #ai-complete-btn")) return;

      const dx = event.clientX - nextClickTarget.x;
      const dy = event.clientY - nextClickTarget.y;
      if (Math.hypot(dx, dy) > nextClickTarget.radius) return;

      hidePromptControls();
      window.aiTools?.emitNextClicked();
    });
  }

  window.addEventListener("resize", () => {
    constrainLayout();
  });

  window.aiTools?.onAccessibilityPreferencesChanged?.(() => {
    if (state.visible) {
      constrainLayout();
    }
  });

  render();
}
