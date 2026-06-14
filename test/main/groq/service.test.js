import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

describe("groq service", () => {
  let groq;

  beforeEach(() => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "test-key";
    process.env.GROQ_MODEL = "llama-3.3-70b-versatile";
    groq = require("../../../src/main/groq/service.js");
  });

  afterEach(() => {
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_MODEL;
    vi.unstubAllGlobals();
  });

  it("isConfigured returns false without API key", () => {
    delete process.env.GROQ_API_KEY;
    vi.resetModules();
    groq = require("../../../src/main/groq/service.js");
    expect(groq.isConfigured()).toBe(false);
  });

  it("implementInteractiveWidget parses valid JSON from Groq", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                widgetTitle: "Quiz",
                htmlLayout: '<button data-action="next">Next</button>',
                scopedCss: ".btn {}",
                initialState: { step: 0 },
                mutationLogic: "if (action === 'next') state.step += 1;",
              }),
            },
          },
        ],
      }),
    }));

    const result = await groq.implementInteractiveWidget({
      designPlan: {
        objective: "Practice",
        contentOutline: "One question",
      },
      widgetType: "interactive-quiz",
      title: "Quiz",
      userPrompt: "Quiz me",
    });

    expect(result.object.widgetTitle).toBe("Quiz");
    expect(result.model).toBe("llama-3.3-70b-versatile");
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it("throws when Groq API returns an error", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: "Rate limit exceeded" } }),
    }));

    await expect(
      groq.implementInteractiveWidget({
        designPlan: { objective: "Practice", contentOutline: "Q1" },
        widgetType: "interactive-quiz",
        title: "Quiz",
        userPrompt: "Quiz me",
      }),
    ).rejects.toThrow(/Rate limit exceeded/);
  });

  it("throws when API key is missing", async () => {
    delete process.env.GROQ_API_KEY;
    vi.resetModules();
    groq = require("../../../src/main/groq/service.js");

    await expect(
      groq.implementInteractiveWidget({
        designPlan: { objective: "Practice", contentOutline: "Q1" },
        widgetType: "interactive-quiz",
        title: "Quiz",
        userPrompt: "Quiz me",
      }),
    ).rejects.toThrow(/GROQ_API_KEY/);
  });
});
