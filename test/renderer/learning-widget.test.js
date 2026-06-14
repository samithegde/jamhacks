/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { showLearningWidgetPanel } from "../../src/renderer/modules/learning-widget.js";

describe("learning-widget classic panel", () => {
  it("shows widgetSummary instead of full explanation when diagramCode is set", async () => {
    document.body.innerHTML = `
      <div id="ai-learning-widget" class="ai-learning-widget hidden">
        <div class="ai-learning-widget__card">
          <div id="ai-learning-widget-explanation" class="ai-learning-widget__explanation"></div>
          <div id="ai-learning-widget-diagram" class="ai-learning-widget__diagram hidden">
            <div id="ai-learning-widget-mermaid" class="mermaid"></div>
          </div>
          <div id="ai-learning-widget-blueprint-host" class="ai-learning-widget__blueprint hidden"></div>
        </div>
      </div>
    `;

    const { initLearningWidget } = await import("../../src/renderer/modules/learning-widget.js");
    initLearningWidget();

    await showLearningWidgetPanel({
      widgetType: "classic",
      explanation: "Long full explanation that should stay in chat only.",
      widgetSummary: "Concept map of the periodic table structure.",
      diagramCode: "graph TD\n  A[Start] --> B[End]",
    });

    const explanationEl = document.getElementById("ai-learning-widget-explanation");
    const diagramEl = document.getElementById("ai-learning-widget-diagram");
    const mermaidEl = document.getElementById("ai-learning-widget-mermaid");

    expect(explanationEl.textContent).toContain("Concept map");
    expect(explanationEl.textContent).not.toContain("Long full explanation");
    expect(diagramEl.classList.contains("hidden")).toBe(false);
    expect(mermaidEl.textContent || mermaidEl.innerHTML).not.toBe("");
  });
});
