import { describe, expect, it } from "vitest";
import { normalizeDiagramCode } from "../../src/shared/mermaid-normalize.js";

describe("mermaid label sanitization", () => {
  it("quotes round labels containing commas or ampersands", () => {
    const normalized = normalizeDiagramCode(
      `graph TD
    D --> E(Reveals Periodic Law & Properties)
    H1 --> H2(e.g., Alkali Metals, Halogens, Noble Gases)`,
    );

    expect(normalized).toContain('E("Reveals Periodic Law & Properties")');
    expect(normalized).toContain('H2("e.g., Alkali Metals, Halogens, Noble Gases")');
  });
});
