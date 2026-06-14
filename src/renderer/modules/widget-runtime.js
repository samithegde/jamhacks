import DOMPurify from "../vendor/purify.es.mjs";
import blueprintTailwindCss from "../vendor/widget-blueprint-tailwind.css.js";

const VIEWPORT_ID = "widget-runtime-viewport";

const BLUEPRINT_ALLOWED_TAGS = [
  "div", "span", "p", "section", "article", "aside", "header", "footer",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "button", "input", "label", "select", "option", "textarea",
  "strong", "em", "b", "i", "u", "s", "del", "br", "hr",
  "table", "thead", "tbody", "tr", "th", "td",
  "pre", "code",
  "form", "fieldset", "legend",
];

const BLUEPRINT_ALLOWED_ATTR = [
  "class", "id", "type", "value", "placeholder", "disabled", "checked",
  "data-state-key", "data-bind", "data-action", "data-id", "aria-label", "aria-hidden",
  "for", "name", "rows", "cols", "min", "max", "step",
];

const FORBIDDEN_LOGIC_RE =
  /\b(?:import|fetch|eval|Function|window|document|globalThis|process)\b/;

let activeListeners = [];
let activeShadow = null;

function getViewport(shadowRoot) {
  return shadowRoot.querySelector(`#${VIEWPORT_ID}`) || shadowRoot;
}

function getBindingKey(el) {
  return el.getAttribute("data-bind") || el.getAttribute("data-state-key");
}

export function applyStateBindings(shadowRoot, state, stateBindings) {
  for (const binding of stateBindings || []) {
    const el = shadowRoot.querySelector(binding.selector);
    if (!el) continue;
    const value = state[binding.stateKey];
    if (binding.attr === "textContent") {
      el.textContent = value != null ? String(value) : "";
    } else if (binding.attr === "hidden") {
      el.hidden = Boolean(value);
    } else if (binding.attr === "class") {
      el.className = String(value ?? "");
    }
  }
}

export function applyDataStateBindings(shadowRoot, state) {
  const viewport = getViewport(shadowRoot);
  for (const el of viewport.querySelectorAll("[data-bind], [data-state-key]")) {
    const key = getBindingKey(el);
    if (!key || !Object.prototype.hasOwnProperty.call(state, key)) continue;
    const value = state[key];
    if (typeof value === "boolean") {
      el.hidden = !value;
    } else {
      el.textContent = value != null ? String(value) : "";
    }
  }
}

function sanitizeCss(css) {
  return (css || "")
    .replace(/@import[^;]*;/gi, "")
    .replace(/behavior\s*:[^;]+;/gi, "")
    .replace(/-moz-binding\s*:[^;]+;/gi, "");
}

function buildStateMachineSandbox(mutationLogic) {
  if (FORBIDDEN_LOGIC_RE.test(mutationLogic)) {
    console.warn("[widget-runtime] Blocked forbidden keyword in mutationLogic");
    return null;
  }
  try {
    // eslint-disable-next-line no-new-func
    return new Function(
      "state",
      "action",
      "event",
      `with (state) {\n${mutationLogic}\n}\nreturn state;`,
    );
  } catch (err) {
    console.warn("[widget-runtime] Failed to compile mutationLogic:", err);
    return null;
  }
}

function buildInteractionSandbox(mutationLogic) {
  if (FORBIDDEN_LOGIC_RE.test(mutationLogic)) {
    console.warn("[widget-runtime] Blocked forbidden keyword in mutationLogic");
    return null;
  }
  try {
    // eslint-disable-next-line no-new-func
    return new Function(
      "state",
      "event",
      `with (state) {\n${mutationLogic}\n}\nreturn state;`,
    );
  } catch (err) {
    console.warn("[widget-runtime] Failed to compile interaction mutationLogic:", err);
    return null;
  }
}

function syncDataViews(shadowPortal, activeState, stateBindings) {
  applyDataStateBindings(shadowPortal, activeState);
  applyStateBindings(shadowPortal, activeState, stateBindings);
}

function bindInteractiveHooks(shadowPortal, activeState, mutationLogic, stateBindings) {
  const runner = buildStateMachineSandbox(mutationLogic);
  if (!runner) return;

  const viewport = getViewport(shadowPortal);

  const dispatchAction = (actionIdentifier, event) => {
    try {
      const nextState = runner(activeState, actionIdentifier, event);
      if (nextState && typeof nextState === "object") {
        Object.assign(activeState, nextState);
      }
      syncDataViews(shadowPortal, activeState, stateBindings);
    } catch (err) {
      console.warn("[widget-runtime] Widget interaction loop encountered a runtime error:", err);
    }
  };

  for (const el of viewport.querySelectorAll("[data-action]")) {
    const action = el.getAttribute("data-action");
    if (!action) continue;

    const handler = (event) => dispatchAction(action, event);
    el.addEventListener("click", handler);
    el.addEventListener("change", handler);
    activeListeners.push({ el, type: "click", handler });
    activeListeners.push({ el, type: "change", handler });
  }
}

function wireLegacyInteractions(shadowPortal, activeState, interactions, stateBindings) {
  for (const interaction of interactions || []) {
    const runner = buildInteractionSandbox(interaction.mutationLogic);
    if (!runner) continue;

    const el = shadowPortal.querySelector(interaction.elementSelector);
    if (!el) {
      console.warn(`[widget-runtime] Selector not found: ${interaction.elementSelector}`);
      continue;
    }

    const handler = (event) => {
      try {
        const nextState = runner(activeState, event);
        if (nextState && typeof nextState === "object") {
          Object.assign(activeState, nextState);
        }
        syncDataViews(shadowPortal, activeState, stateBindings);
      } catch (err) {
        console.warn("[widget-runtime] Interaction handler error:", err);
      }
    };

    el.addEventListener(interaction.eventType, handler);
    activeListeners.push({ el, type: interaction.eventType, handler });
  }
}

export function mountBlueprintWidget(hostEl, payload) {
  teardownBlueprintWidget();

  const shadowPortal =
    hostEl.shadowRoot || hostEl.attachShadow({ mode: "open" });
  activeShadow = shadowPortal;

  const safeCss = sanitizeCss(payload.scopedCss);
  const safeHtml = DOMPurify.sanitize(payload.htmlLayout || "", {
    ALLOWED_TAGS: BLUEPRINT_ALLOWED_TAGS,
    ALLOWED_ATTR: BLUEPRINT_ALLOWED_ATTR,
    FORBID_CONTENTS: ["script", "style"],
  });

  shadowPortal.innerHTML =
    `<style>${blueprintTailwindCss}</style>` +
    (safeCss ? `<style>${safeCss}</style>` : "") +
    `<div id="${VIEWPORT_ID}">${safeHtml}</div>`;

  const activeState = { ...(payload.initialState || {}) };

  if (payload.mutationLogic) {
    bindInteractiveHooks(shadowPortal, activeState, payload.mutationLogic, payload.stateBindings);
  }

  wireLegacyInteractions(shadowPortal, activeState, payload.interactions, payload.stateBindings);

  syncDataViews(shadowPortal, activeState, payload.stateBindings);
}

export function teardownBlueprintWidget() {
  for (const { el, type, handler } of activeListeners) {
    try {
      el.removeEventListener(type, handler);
    } catch {
      // element may already be detached
    }
  }
  activeListeners = [];
  activeShadow = null;
}
