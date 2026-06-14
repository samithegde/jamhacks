/** @vitest-environment happy-dom */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  mountBlueprintWidget,
  teardownBlueprintWidget,
  applyStateBindings,
  applyDataStateBindings,
} from "../../src/renderer/modules/widget-runtime.js";

// happy-dom supports attachShadow; mock DOMPurify to pass HTML through as-is
vi.mock("../../src/renderer/vendor/purify.es.mjs", () => ({
  default: {
    sanitize: (html) => html,
    addHook: () => {},
  },
}));

vi.mock("../../src/renderer/vendor/widget-blueprint-tailwind.css.js", () => ({
  default: ".flex{display:flex}",
}));

function makeHost() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host;
}

describe("widget-runtime", () => {
  let host;

  beforeEach(() => {
    host = makeHost();
  });

  afterEach(() => {
    teardownBlueprintWidget();
    host?.remove();
  });

  it("mounts blueprint and injects HTML into shadow DOM", () => {
    mountBlueprintWidget(host, {
      htmlLayout: '<div id="root"><p id="msg">hello</p></div>',
      scopedCss: "",
      initialState: {},
      interactions: [],
      stateBindings: [],
    });

    const shadow = host.shadowRoot;
    expect(shadow).not.toBeNull();
    expect(shadow.querySelector("#msg")).not.toBeNull();
    expect(shadow.querySelector("#msg").textContent).toBe("hello");
  });

  it("injects Tailwind CSS and scoped CSS into shadow DOM", () => {
    mountBlueprintWidget(host, {
      htmlLayout: '<div class="flex"><p id="msg">hello</p></div>',
      scopedCss: ".custom { color: red; }",
      initialState: {},
      interactions: [],
      stateBindings: [],
    });

    const styles = host.shadowRoot.querySelectorAll("style");
    expect(styles.length).toBe(2);
    expect(styles[0].textContent).toContain(".flex{display:flex}");
    expect(styles[1].textContent).toContain(".custom { color: red; }");
  });

  it("applies initialState via stateBindings on mount", () => {
    mountBlueprintWidget(host, {
      htmlLayout: '<div><span id="score">0</span></div>',
      scopedCss: "",
      initialState: { score: 42 },
      interactions: [],
      stateBindings: [{ stateKey: "score", selector: "#score", attr: "textContent" }],
    });

    expect(host.shadowRoot.querySelector("#score").textContent).toBe("42");
  });

  it("wires click interaction and updates stateBindings", () => {
    mountBlueprintWidget(host, {
      htmlLayout: '<div><span id="count">0</span><button id="inc">+</button></div>',
      scopedCss: "",
      initialState: { count: 0 },
      interactions: [
        {
          elementSelector: "#inc",
          eventType: "click",
          mutationLogic: "state.count += 1;",
        },
      ],
      stateBindings: [{ stateKey: "count", selector: "#count", attr: "textContent" }],
    });

    const shadow = host.shadowRoot;
    expect(shadow.querySelector("#count").textContent).toBe("0");

    shadow.querySelector("#inc").dispatchEvent(new Event("click"));
    expect(shadow.querySelector("#count").textContent).toBe("1");

    shadow.querySelector("#inc").dispatchEvent(new Event("click"));
    expect(shadow.querySelector("#count").textContent).toBe("2");
  });

  it("hides element when stateBinding attr is 'hidden' and value is true", () => {
    mountBlueprintWidget(host, {
      htmlLayout: '<div><p id="hint">hint text</p></div>',
      scopedCss: "",
      initialState: { showHint: true },
      interactions: [],
      stateBindings: [{ stateKey: "showHint", selector: "#hint", attr: "hidden" }],
    });

    expect(host.shadowRoot.querySelector("#hint").hidden).toBe(true);
  });

  it("sets className via stateBinding attr 'class'", () => {
    mountBlueprintWidget(host, {
      htmlLayout: '<div><span id="label">text</span></div>',
      scopedCss: "",
      initialState: { labelClass: "active" },
      interactions: [],
      stateBindings: [{ stateKey: "labelClass", selector: "#label", attr: "class" }],
    });

    expect(host.shadowRoot.querySelector("#label").className).toBe("active");
  });

  it("teardown removes event listeners", () => {
    mountBlueprintWidget(host, {
      htmlLayout: '<div><span id="c">0</span><button id="b">click</button></div>',
      scopedCss: "",
      initialState: { c: 0 },
      interactions: [
        { elementSelector: "#b", eventType: "click", mutationLogic: "state.c += 1;" },
      ],
      stateBindings: [{ stateKey: "c", selector: "#c", attr: "textContent" }],
    });

    const shadow = host.shadowRoot;
    shadow.querySelector("#b").dispatchEvent(new Event("click"));
    expect(shadow.querySelector("#c").textContent).toBe("1");

    teardownBlueprintWidget();

    shadow.querySelector("#b").dispatchEvent(new Event("click"));
    // Counter should not increment after teardown
    expect(shadow.querySelector("#c").textContent).toBe("1");
  });

  it("remounting calls teardown first (no double listeners)", () => {
    const payload = {
      htmlLayout: '<div><span id="n">0</span><button id="b">+</button></div>',
      scopedCss: "",
      initialState: { n: 0 },
      interactions: [
        { elementSelector: "#b", eventType: "click", mutationLogic: "state.n += 1;" },
      ],
      stateBindings: [{ stateKey: "n", selector: "#n", attr: "textContent" }],
    };

    mountBlueprintWidget(host, payload);
    // Remount on a new host to test teardown of prior listeners
    const host2 = makeHost();
    mountBlueprintWidget(host2, payload);

    // Click on host2's button — should increment only once
    host2.shadowRoot.querySelector("#b").dispatchEvent(new Event("click"));
    expect(host2.shadowRoot.querySelector("#n").textContent).toBe("1");

    host2.remove();
  });

  it("ignores interaction with missing selector (no throw)", () => {
    expect(() =>
      mountBlueprintWidget(host, {
        htmlLayout: "<div></div>",
        scopedCss: "",
        initialState: {},
        interactions: [
          { elementSelector: "#nonexistent", eventType: "click", mutationLogic: "" },
        ],
        stateBindings: [],
      }),
    ).not.toThrow();
  });

  it("skips mutationLogic with forbidden keyword", () => {
    mountBlueprintWidget(host, {
      htmlLayout: '<div><button id="evil">x</button><span id="s">0</span></div>',
      scopedCss: "",
      initialState: { s: 0 },
      interactions: [
        { elementSelector: "#evil", eventType: "click", mutationLogic: "window.alert(1);" },
      ],
      stateBindings: [{ stateKey: "s", selector: "#s", attr: "textContent" }],
    });

    // Click should be silently skipped — no throw, no state change
    host.shadowRoot.querySelector("#evil").dispatchEvent(new Event("click"));
    expect(host.shadowRoot.querySelector("#s").textContent).toBe("0");
  });

  it("wires data-action mutationLogic and updates data-state-key bindings", () => {
    mountBlueprintWidget(host, {
      htmlLayout:
        '<div><span data-state-key="count">0</span><button data-action="increment">+</button></div>',
      scopedCss: "",
      initialState: { count: 0 },
      mutationLogic: "if (action === 'increment') state.count += 1;",
      interactions: [],
      stateBindings: [],
    });

    const shadow = host.shadowRoot;
    expect(shadow.querySelector("#widget-runtime-viewport")).not.toBeNull();
    expect(shadow.querySelector("[data-state-key='count']").textContent).toBe("0");

    shadow.querySelector("[data-action='increment']").dispatchEvent(new Event("click"));
    expect(shadow.querySelector("[data-state-key='count']").textContent).toBe("1");
  });

  it("wires data-action mutationLogic and updates data-bind hooks", () => {
    mountBlueprintWidget(host, {
      htmlLayout:
        '<div><span data-bind="score">0</span><button data-action="add">+</button></div>',
      scopedCss: "",
      initialState: { score: 0 },
      mutationLogic: "if (action === 'add') state.score += 1;",
      interactions: [],
      stateBindings: [],
    });

    const shadow = host.shadowRoot;
    expect(shadow.querySelector("[data-bind='score']").textContent).toBe("0");

    shadow.querySelector("[data-action='add']").dispatchEvent(new Event("click"));
    expect(shadow.querySelector("[data-bind='score']").textContent).toBe("1");
  });

  it("applyStateBindings handles missing selector gracefully", () => {
    const div = document.createElement("div");
    div.attachShadow({ mode: "open" });
    expect(() =>
      applyStateBindings(div.shadowRoot, { val: "x" }, [
        { stateKey: "val", selector: "#missing", attr: "textContent" },
      ]),
    ).not.toThrow();
  });
});
