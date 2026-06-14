/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";

describe("renderer module graph", () => {
  it("imports markdown without Node built-in modules", async () => {
    const mod = await import("../../src/renderer/modules/markdown.js");
    expect(typeof mod.renderMarkdown).toBe("function");
    expect(typeof mod.enhanceMermaidDiagrams).toBe("function");
  });

  it("imports mermaid-normalize as browser ESM", async () => {
    const mod = await import("../../src/renderer/modules/mermaid-normalize.js");
    expect(typeof mod.normalizeDiagramCode).toBe("function");
    expect(mod.normalizeDiagramCode("graph TD\n  A-->B")).toContain("A-->B");
  });
});
