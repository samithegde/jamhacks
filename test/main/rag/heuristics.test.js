import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  routeIntentHeuristic,
  inferRetrievalSource,
} = require("../../../src/main/rag/heuristics.js");

describe("routeIntentHeuristic", () => {
  it("skips RAG for pure UI commands", () => {
    const result = routeIntentHeuristic("Click the Submit button");
    expect(result.skip).toBe(true);
    expect(result.plan.requiresRag).toBe(false);
  });

  it("routes policy questions to web search", () => {
    const result = routeIntentHeuristic("Fill out the form using the policy document");
    expect(result.skip).toBe(true);
    expect(result.plan.requiresRag).toBe(true);
    expect(result.plan.retrievalSource).toBe("web");
  });

  it("routes library questions to Context7", () => {
    const result = routeIntentHeuristic("How do I use React useEffect with async data?");
    expect(result.skip).toBe(true);
    expect(result.plan.requiresRag).toBe(true);
    expect(result.plan.retrievalSource).toBe("context7");
    expect(result.plan.libraryName).toMatch(/react/i);
  });

  it("routes how-to app questions to web search with on-screen guidance", () => {
    const result = routeIntentHeuristic("how do i cad a 3d cube in onshape");
    expect(result.skip).toBe(true);
    expect(result.plan.requiresRag).toBe(true);
    expect(result.plan.needsOnScreenGuidance).toBe(true);
    expect(result.plan.retrievalSource).toBe("web");
  });

  it("defers to LLM router for ambiguous messages", () => {
    const result = routeIntentHeuristic("Help me finish this task");
    expect(result.skip).toBe(false);
  });
});

describe("inferRetrievalSource", () => {
  it("prefers context7 for framework keywords", () => {
    expect(inferRetrievalSource("Show me the Next.js middleware API")).toBe("context7");
  });

  it("prefers web for policy keywords", () => {
    expect(inferRetrievalSource("What does our vacation policy say?")).toBe("web");
  });
});

describe("normalizeRetrievalPlan", () => {
  const { normalizeRetrievalPlan } = require("../../../src/main/gemini/service.js");

  it("clears query when requiresRag is false", () => {
    const plan = normalizeRetrievalPlan(
      {
        intent: "Click Submit",
        requiresRag: false,
        query: "ignored",
        retrievalSource: "web",
      },
      "Click Submit",
    );
    expect(plan.requiresRag).toBe(false);
    expect(plan.query).toBe("");
  });

  it("preserves retrievalSource and libraryName", () => {
    const plan = normalizeRetrievalPlan(
      {
        intent: "React hooks",
        requiresRag: true,
        query: "useEffect cleanup",
        retrievalSource: "context7",
        libraryName: "react",
      },
      "How do I use useEffect?",
    );
    expect(plan.retrievalSource).toBe("context7");
    expect(plan.libraryName).toBe("react");
  });
});
