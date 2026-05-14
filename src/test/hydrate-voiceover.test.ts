import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockR2Configured = vi.fn();
const mockTenantKey = vi.fn((relative: string) => `tenants/test/${relative}`);
const mockDownloadR2File = vi.fn();

vi.mock("@/server/sync/r2/client", () => ({
  r2Configured: () => mockR2Configured(),
  tenantKey: (relative: string) => mockTenantKey(relative),
  downloadR2File: (...args: unknown[]) => mockDownloadR2File(...args),
}));

import { hydrateVoiceoverFromR2 } from "@/server/sync/r2/hydrate-voiceover";

describe("hydrateVoiceoverFromR2", () => {
  let tmp: string;
  let localPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weatherv1-vo-"));
    localPath = path.join(tmp, "abc123.mp3");
    mockR2Configured.mockReturnValue(true);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("skips download when local file is non-empty", async () => {
    fs.writeFileSync(localPath, Buffer.alloc(8, 1));
    await hydrateVoiceoverFromR2("job1", "abc123.mp3", localPath);
    expect(mockDownloadR2File).not.toHaveBeenCalled();
  });

  it("downloads when file is missing", async () => {
    await hydrateVoiceoverFromR2("job1", "ignored/path/abc123.mp3", localPath);
    expect(mockTenantKey).toHaveBeenCalledWith("voiceovers/job1/abc123.mp3");
    expect(mockDownloadR2File).toHaveBeenCalledWith("tenants/test/voiceovers/job1/abc123.mp3", localPath);
  });

  it("downloads when file is zero bytes", async () => {
    fs.writeFileSync(localPath, Buffer.alloc(0));
    await hydrateVoiceoverFromR2("job1", "abc123.mp3", localPath);
    expect(mockDownloadR2File).toHaveBeenCalledTimes(1);
  });

  it("no-ops when R2 is not configured", async () => {
    mockR2Configured.mockReturnValue(false);
    await hydrateVoiceoverFromR2("job1", "abc123.mp3", localPath);
    expect(mockDownloadR2File).not.toHaveBeenCalled();
  });

  it("throws clear message on R2 404", async () => {
    const err = { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } };
    mockDownloadR2File.mockRejectedValue(err);
    await expect(hydrateVoiceoverFromR2("j99", "x.mp3", localPath)).rejects.toThrow(
      /Voiceover missing in cloud \(R2 404\) for job j99/,
    );
  });

  it("wraps other transport errors", async () => {
    mockDownloadR2File.mockRejectedValue(new Error("socket hang up"));
    await expect(hydrateVoiceoverFromR2("j1", "a.mp3", localPath)).rejects.toThrow(
      /Voiceover download failed for job j1: socket hang up/,
    );
  });
});
