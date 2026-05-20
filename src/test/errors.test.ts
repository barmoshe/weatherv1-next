import { describe, it, expect } from "vitest";
import { toUiError, uiErrorToClipboard } from "@/shared/errors";

describe("toUiError", () => {
  it("returns the fallback when input is null/undefined", () => {
    expect(toUiError(null, "boom").message).toBe("boom");
    expect(toUiError(undefined, "boom").message).toBe("boom");
  });

  it("uses an Error instance's message", () => {
    const err = toUiError(new Error("network down"));
    expect(err.message).toBe("network down");
    expect(err.code).toBeUndefined();
  });

  it("treats a string input as the message", () => {
    expect(toUiError("plain message").message).toBe("plain message");
  });

  it("unpacks a server error envelope (mapProviderError shape)", () => {
    const body = {
      success: false,
      error: "אזל המאגר",
      error_code: "llm_quota_exceeded",
      provider: "openai",
      console_url: "https://platform.openai.com/account/billing",
    };
    const err = toUiError(body);
    expect(err.message).toBe("אזל המאגר");
    expect(err.code).toBe("llm_quota_exceeded");
    expect(err.provider).toBe("openai");
    expect(err.consoleUrl).toContain("openai.com");
  });

  it("unpacks a job-status shape (failed_step + failed_at)", () => {
    const body = {
      error: "ffmpeg crashed",
      error_code: "render_ffmpeg_failed",
      failed_step: "render",
      failed_at: "2026-05-20T12:00:00.000Z",
    };
    const err = toUiError(body);
    expect(err.step).toBe("render");
    expect(err.at).toBe("2026-05-20T12:00:00.000Z");
    expect(err.code).toBe("render_ffmpeg_failed");
  });

  it("falls back to the fallback when no fields map", () => {
    const err = toUiError({}, "fallback");
    expect(err.message).toBe("fallback");
  });
});

describe("uiErrorToClipboard", () => {
  it("includes message, code, step, and console url", () => {
    const out = uiErrorToClipboard({
      message: "boom",
      code: "render_ffmpeg_failed",
      step: "render",
      consoleUrl: "https://example.com",
    });
    expect(out).toContain("boom");
    expect(out).toContain("code=render_ffmpeg_failed");
    expect(out).toContain("step=render");
    expect(out).toContain("https://example.com");
  });

  it("only returns the message when no metadata is present", () => {
    expect(uiErrorToClipboard({ message: "just the message" })).toBe("just the message");
  });
});
