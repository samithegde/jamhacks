import { describe, expect, it } from "vitest";

const { toGeminiWidgetContents } = require("../../../src/main/gemini/service.js");

describe("toGeminiWidgetContents", () => {
  it("omits screenshot attachments and uses display text only", () => {
    const contents = toGeminiWidgetContents([
      {
        sender: "user",
        text: "Explain photosynthesis",
        attachments: [
          {
            name: "screen.png",
            mimeType: "image/png",
            base64: "aGVsbG8=",
          },
        ],
      },
      {
        sender: "system",
        text: "Short answer",
        rawResponse: '{"widgetType":"classic","explanation":"ignored blob"}',
      },
    ]);

    expect(contents).toHaveLength(2);
    expect(contents[0].parts[0].text).toBe("Explain photosynthesis");
    expect(contents[1].parts[0].text).toBe("Short answer");
    expect(JSON.stringify(contents)).not.toContain("base64");
  });

  it("appends screen context to the latest user turn", () => {
    const contents = toGeminiWidgetContents(
      [{ sender: "user", text: "Quiz me" }],
      { screenContext: "User is reading a biology PDF." },
    );

    expect(contents[0].parts.some((part) => part.text.includes("biology PDF"))).toBe(true);
  });
});
