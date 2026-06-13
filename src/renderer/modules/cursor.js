const DEFAULTS = {
  x: window.innerWidth / 2,
  y: window.innerHeight / 2,
  visible: true,
  animate: true,
  duration: 250,
};

export function initVirtualCursor() {
  const cursor = document.getElementById("ai-cursor");
  if (!cursor) return;

  let state = { ...DEFAULTS };

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
      cursor.classList.add("hidden");
    } else {
      cursor.classList.remove("hidden");
      state.visible = true;
    }
  }

  window.aiTools?.onCursorMove((payload) => moveTo(payload));
  window.aiTools?.onCursorVisibility(({ visible }) => {
    state.visible = visible;
    cursor.classList.toggle("hidden", !visible);
  });

  window.addEventListener("resize", () => {
    state.x = clamp(state.x, 0, window.innerWidth);
    state.y = clamp(state.y, 0, window.innerHeight);
    applyPosition(state.x, state.y, false, 0);
  });

  render();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
