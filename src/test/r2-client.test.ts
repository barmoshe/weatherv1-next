// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "WEATHER_WORKSPACE_DIR",
  "WEATHER_RUNTIME_DIR",
  "R2_SYNC_ENABLED",
  "R2_GATEWAY_URL",
  "R2_TENANT_ID",
  "R2_APP_USERNAME",
  "R2_APP_PASSWORD",
] as const;

let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let tempDir: string;
let originalFetch: typeof globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

async function importClient() {
  vi.resetModules();
  const config = await import("@/server/runtime/config");
  config.resetRuntimeConfigForTests();
  return await import("@/server/sync/r2/client");
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weatherv1-r2-client-"));
  originalEnv = {};
  for (const k of ENV_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.WEATHER_RUNTIME_DIR = tempDir;
  process.env.R2_SYNC_ENABLED = "1";
  process.env.R2_GATEWAY_URL = "https://gateway.example/";
  process.env.R2_TENANT_ID = "tenant-x";
  process.env.R2_APP_USERNAME = "user";
  process.env.R2_APP_PASSWORD = "pw";

  originalFetch = globalThis.fetch;
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = originalEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function expectedAuth(): string {
  return `Basic ${Buffer.from("user:pw").toString("base64")}`;
}

describe("r2-client config helpers", () => {
  it("r2Configured() reports true when all env vars are present", async () => {
    const { r2Configured } = await importClient();
    expect(r2Configured()).toBe(true);
  });

  it("r2Configured() reports false when R2_SYNC_ENABLED is unset", async () => {
    delete process.env.R2_SYNC_ENABLED;
    const { r2Configured } = await importClient();
    expect(r2Configured()).toBe(false);
  });

  it("r2Configured() reports false when password is missing", async () => {
    delete process.env.R2_APP_PASSWORD;
    const { r2Configured } = await importClient();
    expect(r2Configured()).toBe(false);
  });

  it("tenantKey() prepends tenants/<tenantId>/", async () => {
    const { tenantKey } = await importClient();
    expect(tenantKey("catalog/catalog.json")).toBe("tenants/tenant-x/catalog/catalog.json");
  });

  it("tenantKey() strips leading slashes", async () => {
    const { tenantKey } = await importClient();
    expect(tenantKey("/videos/abc.mp4")).toBe("tenants/tenant-x/videos/abc.mp4");
  });
});

describe("headR2Object", () => {
  it("returns metadata on 200", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: {
          etag: '"abc-etag"',
          "content-length": "1234",
          "last-modified": "Wed, 21 Oct 2026 07:28:00 GMT",
        },
      }),
    );
    const { headR2Object } = await importClient();
    const result = await headR2Object("tenants/tenant-x/catalog/catalog.json");

    expect(result).toEqual({
      etag: "abc-etag",
      size: 1234,
      updatedAt: new Date("Wed, 21 Oct 2026 07:28:00 GMT").toISOString(),
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://gateway.example/v1/objects?key=tenants%2Ftenant-x%2Fcatalog%2Fcatalog.json",
    );
    expect((init as RequestInit).method).toBe("HEAD");
    expect((init as RequestInit).headers).toMatchObject({ authorization: expectedAuth() });
  });

  it("returns null on 404", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const { headR2Object } = await importClient();
    expect(await headR2Object("missing")).toBeNull();
  });

  it("throws on non-404 error status", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const { headR2Object } = await importClient();
    await expect(headR2Object("k")).rejects.toThrow(/HTTP 500/);
  });
});

describe("getR2Text / putR2Text", () => {
  it("getR2Text returns body + etag", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("hello", { status: 200, headers: { etag: '"e1"' } }),
    );
    const { getR2Text } = await importClient();
    const result = await getR2Text("k");
    expect(result).toEqual({ text: "hello", etag: "e1" });
  });

  it("getR2Text throws with error message from body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "denied" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );
    const { getR2Text } = await importClient();
    await expect(getR2Text("k")).rejects.toThrow(/denied/);
  });

  it("putR2Text PUTs the body with JSON content-type", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ etag: '"new-etag"' }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { putR2Text } = await importClient();
    const result = await putR2Text("catalog/catalog.json", '{"x":1}');

    expect(result).toEqual({ etag: "new-etag" });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).method).toBe("PUT");
    expect((init as RequestInit).body).toBe('{"x":1}');
    expect((init as RequestInit).headers).toMatchObject({
      authorization: expectedAuth(),
      "content-type": "application/json; charset=utf-8",
    });
  });

  it("putR2Text refuses keys under outputs/ (defense-in-depth)", async () => {
    const { putR2Text } = await importClient();
    await expect(putR2Text("tenants/t/outputs/job-1/forecast.mp4", "x")).rejects.toThrow(
      /refusing to upload to outputs\//,
    );
    await expect(putR2Text("outputs/x", "x")).rejects.toThrow(/refusing to upload to outputs\//);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("uploadR2File", () => {
  function makeFile(size: number): string {
    const filePath = path.join(tempDir, `f-${size}.bin`);
    fs.writeFileSync(filePath, Buffer.alloc(size));
    return filePath;
  }

  it("refuses uploads to outputs/ prefix", async () => {
    const { uploadR2File } = await importClient();
    const filePath = makeFile(16);
    await expect(
      uploadR2File("tenants/t/outputs/job-1/forecast.mp4", filePath, "video/mp4"),
    ).rejects.toThrow(/refusing to upload to outputs\//);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a single PUT for files at or below the 90 MB threshold", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ etag: '"single"' }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { uploadR2File } = await importClient();
    const filePath = makeFile(1024);

    const onProgress = vi.fn();
    const result = await uploadR2File("videos/abc/clip.mp4", filePath, "video/mp4", onProgress);

    expect(result).toEqual({ etag: "single", size: 1024 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/v1/objects?key=");
    expect((init as RequestInit).method).toBe("PUT");
    expect((init as RequestInit).headers).toMatchObject({
      "content-type": "video/mp4",
      "content-length": "1024",
    });
    expect(onProgress).toHaveBeenCalledWith(0, 1024);
    expect(onProgress).toHaveBeenLastCalledWith(1024, 1024);
  });

  // Multipart tests reuse one 91 MB fixture — the threshold is hardcoded at
  // 90 MB in client.ts so anything smaller takes the single-PUT path.
  describe("multipart (>90 MB)", () => {
    const size = 91 * 1024 * 1024;
    let bigFile: string;
    let multipartDir: string;

    beforeAll(() => {
      multipartDir = fs.mkdtempSync(path.join(os.tmpdir(), "weatherv1-r2-multipart-"));
      bigFile = path.join(multipartDir, "big.bin");
      fs.writeFileSync(bigFile, Buffer.alloc(size));
    });

    afterAll(() => {
      fs.rmSync(multipartDir, { recursive: true, force: true });
    });

    it("uploads in 12 parts and completes", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ uploadId: "upload-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      for (let i = 1; i <= 12; i++) {
        fetchMock.mockResolvedValueOnce(
          new Response(JSON.stringify({ etag: `part-${i}` }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ etag: '"final-etag"' }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const { uploadR2File } = await importClient();
      const result = await uploadR2File("videos/big/clip.mp4", bigFile, "video/mp4");
      expect(result.size).toBe(size);
      expect(result.etag).toBe("final-etag");

      expect(fetchMock).toHaveBeenCalledTimes(14);

      const [initUrl, initInit] = fetchMock.mock.calls[0]!;
      expect(initUrl).toContain("/v1/multipart?");
      expect(initUrl).toContain("contentType=video%2Fmp4");
      expect((initInit as RequestInit).method).toBe("POST");

      const [partUrl, partInit] = fetchMock.mock.calls[1]!;
      expect(partUrl).toContain("/v1/multipart?");
      expect(partUrl).toContain("uploadId=upload-1");
      expect(partUrl).toContain("partNumber=1");
      expect((partInit as RequestInit).method).toBe("PUT");

      const [completeUrl, completeInit] = fetchMock.mock.calls[13]!;
      expect(completeUrl).toContain("/v1/multipart/complete?");
      expect(completeUrl).toContain("uploadId=upload-1");
      expect((completeInit as RequestInit).method).toBe("POST");
      const completeBody = JSON.parse(String((completeInit as RequestInit).body));
      expect(completeBody.parts).toHaveLength(12);
      expect(completeBody.parts[0]).toEqual({ partNumber: 1, etag: "part-1" });
      expect(completeBody.parts[11]).toEqual({ partNumber: 12, etag: "part-12" });
    });

    it("aborts the multipart upload on a part failure", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ uploadId: "upload-bad" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "part rejected" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      );
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

      const { uploadR2File } = await importClient();
      await expect(uploadR2File("videos/big/clip.mp4", bigFile, "video/mp4")).rejects.toThrow(
        /part rejected/,
      );

      expect(fetchMock).toHaveBeenCalledTimes(3);
      const [abortUrl, abortInit] = fetchMock.mock.calls[2]!;
      expect(abortUrl).toContain("/v1/multipart?");
      expect(abortUrl).toContain("uploadId=upload-bad");
      expect((abortInit as RequestInit).method).toBe("DELETE");
    });
  });
});

describe("downloadR2File", () => {
  it("streams the response body to disk", async () => {
    const body = Buffer.from("hello world");
    fetchMock.mockResolvedValueOnce(
      new Response(body, {
        status: 200,
        headers: {
          etag: '"dl"',
          "content-length": String(body.length),
        },
      }),
    );

    const { downloadR2File } = await importClient();
    const target = path.join(tempDir, "subdir", "out.bin");
    const result = await downloadR2File("k", target);

    expect(fs.readFileSync(target)).toEqual(body);
    expect(result.etag).toBe("dl");
    expect(result.size).toBe(body.length);
  });

  it("throws on non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "gone" }), {
        status: 410,
        headers: { "content-type": "application/json" },
      }),
    );
    const { downloadR2File } = await importClient();
    await expect(downloadR2File("k", path.join(tempDir, "x.bin"))).rejects.toThrow(/gone/);
  });
});

describe("deleteR2Object", () => {
  it("treats 404 as success", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const { deleteR2Object } = await importClient();
    await expect(deleteR2Object("k")).resolves.toBeUndefined();
  });

  it("throws on other error statuses", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "nope" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    const { deleteR2Object } = await importClient();
    await expect(deleteR2Object("k")).rejects.toThrow(/nope/);
  });

  it("calls DELETE with auth header", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { deleteR2Object } = await importClient();
    await deleteR2Object("k");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/v1/objects?key=k");
    expect((init as RequestInit).method).toBe("DELETE");
    expect((init as RequestInit).headers).toMatchObject({ authorization: expectedAuth() });
  });
});

describe("getR2Stream", () => {
  it("returns null on 404", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const { getR2Stream } = await importClient();
    expect(await getR2Stream("k")).toBeNull();
  });

  it("returns stream + headers on 200", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("body", {
        status: 200,
        headers: {
          etag: '"s"',
          "content-type": "video/mp4",
          "content-length": "4",
        },
      }),
    );
    const { getR2Stream } = await importClient();
    const result = await getR2Stream("k");
    expect(result).not.toBeNull();
    expect(result!.etag).toBe("s");
    expect(result!.contentType).toBe("video/mp4");
    expect(result!.contentLength).toBe(4);
  });
});
