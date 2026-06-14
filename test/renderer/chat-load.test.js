/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";

describe("chat module loads", () => {
  it("imports chat.js without error", async () => {
    const mod = await import("../../src/renderer/modules/chat.js");
    expect(typeof mod.initChat).toBe("function");
  });

  it("imports markdown.js without error", async () => {
    const mod = await import("../../src/renderer/modules/markdown.js");
    expect(typeof mod.renderMarkdown).toBe("function");
  });
});
