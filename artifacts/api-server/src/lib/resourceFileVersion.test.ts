import { describe, expect, it } from "vitest";
import { nextResourceFileVersion } from "./resourceFileVersion";

describe("nextResourceFileVersion", () => {
  it("starts replacement history at v2 and advances repeated replacements", () => {
    expect(nextResourceFileVersion(null)).toBe("2");
    expect(nextResourceFileVersion("2")).toBe("3");
    expect(nextResourceFileVersion("3")).toBe("4");
  });

  it("preserves supported legacy prefixes and safely normalises other labels", () => {
    expect(nextResourceFileVersion("v1")).toBe("v2");
    expect(nextResourceFileVersion(" v9 ")).toBe("v10");
    expect(nextResourceFileVersion("approved-copy")).toBe("2");
  });
});