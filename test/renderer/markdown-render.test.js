/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/renderer/modules/markdown.js";

describe("mermaid markdown pipeline", () => {
  it("extracts standard fenced mermaid before marked runs", () => {
    const html = renderMarkdown(
      "Before\n\n```mermaid\ngraph TD\n  A-->B\n```\n\nAfter",
    );
    expect(html).toContain('class="mermaid"');
    expect(html).toContain("data-mermaid-encoded");
    expect(html).not.toContain("```");
    expect(html).not.toContain("<pre>");
  });

  it("extracts mermaid when graph starts on same line as fence tag", () => {
    const html = renderMarkdown(
      "Before\n\n```mermaid graph TD\n  A-->B\n```\n\nAfter",
    );
    expect(html).toContain('class="mermaid"');
    expect(html).toContain("data-mermaid-encoded");
    expect(html).not.toContain("<pre>");
  });
});
