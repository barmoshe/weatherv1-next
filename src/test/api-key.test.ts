import { describe, expect, it } from "vitest";
import { apiKeyHint, apiKeyKind, apiKeyKindWarningHe, cleanApiKey } from "@/shared/api-key";
import { invalidKeyMessageHe, mapProviderError } from "@/server/providers/errors";
import { LlmProviderError } from "@/server/providers/llm";
import { translateAnthropicError } from "@/server/providers/llm/anthropic";

const KEY = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd";

describe("cleanApiKey", () => {
  it("drops RTL marks, zero-width spaces, line breaks and wrapping quotes", () => {
    expect(cleanApiKey(`‏"${KEY}"​\n`)).toBe(KEY);
    expect(cleanApiKey(` ${KEY.slice(0, 20)}\n${KEY.slice(20)} `)).toBe(KEY);
  });
  it("keeps a clean key as is and empties nothing", () => {
    expect(cleanApiKey(KEY)).toBe(KEY);
    expect(cleanApiKey("")).toBe("");
    expect(cleanApiKey(undefined)).toBe("");
  });
});

describe("apiKeyKind", () => {
  it("tells an API key from a subscription token, an admin key and an OpenAI key", () => {
    expect(apiKeyKind(KEY)).toBe("api");
    expect(apiKeyKind("sk-ant-oat01-xyz")).toBe("oauth");
    expect(apiKeyKind("sk-ant-admin01-xyz")).toBe("admin");
    expect(apiKeyKind("sk-proj-abc")).toBe("openai");
    expect(apiKeyKind("hello")).toBe("unknown");
    expect(apiKeyKind("")).toBe("empty");
  });
  it("warns in Hebrew only for keys that are not API keys", () => {
    expect(apiKeyKindWarningHe("api")).toBeNull();
    expect(apiKeyKindWarningHe("oauth")).toMatch(/מנוי/);
  });
});

describe("apiKeyHint", () => {
  it("shows the prefix and the last four characters, like the Console", () => {
    expect(apiKeyHint(KEY)).toBe("sk-ant-api03…AbCd");
  });
  it("shows only the last four of anything that is not a known key", () => {
    expect(apiKeyHint("MyBankPassword2026!xyzQ")).toBe("…");
    expect(apiKeyHint("MyVeryLongSitePassword2026xyzQ")).toBe("…xyzQ");
  });
});

describe("invalid key errors", () => {
  it("say which saved key Anthropic rejected (401)", () => {
    const err = translateAnthropicError(Object.assign(new Error("invalid x-api-key"), { status: 401 }), "sk-ant-api03…AbCd");
    expect(err.code).toBe("llm_invalid_key");
    expect(err.extra.reason).toBe("rejected");
    const mapped = mapProviderError(err);
    expect(mapped?.body.error_reason).toBe("rejected");
    expect(mapped?.body.error).toContain("sk-ant-api03…AbCd");
    expect(mapped?.body.details).toContain("invalid x-api-key");
  });
  it("tell a missing key apart from a rejected one", () => {
    const err = new LlmProviderError("no key", "llm_invalid_key", "anthropic", undefined, { reason: "missing" });
    expect(mapProviderError(err)?.body.error).toBe(invalidKeyMessageHe("missing"));
    expect(invalidKeyMessageHe("missing")).not.toBe(invalidKeyMessageHe("rejected"));
  });
  it("map 403 to a permission message", () => {
    const err = translateAnthropicError(Object.assign(new Error("permission"), { status: 403 }));
    expect(err.extra.reason).toBe("forbidden");
    expect(mapProviderError(err)?.body.error).toMatch(/הרשאה/);
  });
});
