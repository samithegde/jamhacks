import { describe, expect, it } from "vitest";
import {
  pickScreenSourceByDisplayId,
  serializeDesktopCapturerSource,
} from "../../../src/main/capture/screen-capture.js";

function makeRawSource(overrides = {}) {
  return {
    id: "screen:0:0",
    name: "Entire screen",
    display_id: "2528732444",
    appIcon: { toDataURL: () => "data:image/png;base64,icon" },
    thumbnail: { toDataURL: () => "data:image/png;base64,thumb" },
    ...overrides,
  };
}

describe("serializeDesktopCapturerSource", () => {
  it("maps desktopCapturer sources to serializable objects", () => {
    expect(serializeDesktopCapturerSource(makeRawSource())).toEqual({
      id: "screen:0:0",
      name: "Entire screen",
      displayId: "2528732444",
      appIcon: "data:image/png;base64,icon",
      thumbnail: "data:image/png;base64,thumb",
    });
  });

  it("returns null appIcon when the source has no icon", () => {
    const serialized = serializeDesktopCapturerSource(
      makeRawSource({ appIcon: null })
    );

    expect(serialized.appIcon).toBeNull();
  });
});

describe("pickScreenSourceByDisplayId", () => {
  const sources = [
    serializeDesktopCapturerSource(
      makeRawSource({ id: "screen:0:0", display_id: "111" })
    ),
    serializeDesktopCapturerSource(
      makeRawSource({ id: "screen:1:0", display_id: "222", name: "Display 2" })
    ),
  ];

  it("finds a source by display id", () => {
    expect(pickScreenSourceByDisplayId(sources, "222")).toMatchObject({
      id: "screen:1:0",
      name: "Display 2",
      displayId: "222",
    });
  });

  it("coerces display ids to strings before matching", () => {
    const numericSources = [
      serializeDesktopCapturerSource(
        makeRawSource({ id: "screen:0:0", display_id: 42 })
      ),
    ];

    expect(pickScreenSourceByDisplayId(numericSources, 42)?.id).toBe(
      "screen:0:0"
    );
  });

  it("falls back to the first source when display id is missing", () => {
    expect(pickScreenSourceByDisplayId(sources, "missing")?.id).toBe(
      "screen:0:0"
    );
  });

  it("returns null when no sources exist", () => {
    expect(pickScreenSourceByDisplayId([], "111")).toBeNull();
  });
});
