import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isLoadableOrigin } = require("../../electron/window-utils.cjs") as {
  isLoadableOrigin: (origin: unknown) => boolean;
};

describe("electron window origin guard", () => {
  it("rejects missing or empty origins before BrowserWindow.loadURL", () => {
    expect(isLoadableOrigin(null)).toBe(false);
    expect(isLoadableOrigin(undefined)).toBe(false);
    expect(isLoadableOrigin("")).toBe(false);
    expect(isLoadableOrigin("   ")).toBe(false);
  });

  it("only allows the fixed loopback HTTP origin with a port", () => {
    expect(isLoadableOrigin("http://127.0.0.1:3765")).toBe(true);
    expect(isLoadableOrigin("http://localhost:3765")).toBe(false);
    expect(isLoadableOrigin("https://127.0.0.1:3765")).toBe(false);
    expect(isLoadableOrigin("http://127.0.0.1")).toBe(false);
  });
});
