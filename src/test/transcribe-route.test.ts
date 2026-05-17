// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertDesktopAuth: vi.fn(),
  transcribeAudio: vi.fn(),
  upsertJob: vi.fn(),
  persistTranscriptionUsageEstimate: vi.fn(),
  updatePlanBundle: vi.fn(),
  uploadRuntimeFile: vi.fn(),
  mapProviderError: vi.fn(),
}));

vi.mock("@/server/runtime/auth", () => ({
  assertDesktopAuth: (req: unknown) => mocks.assertDesktopAuth(req),
}));
vi.mock("@/server/pipeline/picker", () => ({
  transcribeAudio: mocks.transcribeAudio,
}));
vi.mock("@/server/jobs/store", () => ({
  upsertJob: mocks.upsertJob,
}));
vi.mock("@/server/jobs/usage-persist", () => ({
  persistTranscriptionUsageEstimate: mocks.persistTranscriptionUsageEstimate,
}));
vi.mock("@/server/jobs/plan-bundle", () => ({
  updatePlanBundle: mocks.updatePlanBundle,
}));
vi.mock("@/server/sync/r2/service", () => ({
  uploadRuntimeFile: mocks.uploadRuntimeFile,
}));
vi.mock("@/server/providers/errors", () => ({
  mapProviderError: mocks.mapProviderError,
}));

const ENV_KEYS = ["WEATHER_WORKSPACE_DIR", "WEATHER_RUNTIME_DIR"] as const;
let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let tempDir: string;

async function importRoute() {
  vi.resetModules();
  const config = await import("@/server/runtime/config");
  config.resetRuntimeConfigForTests();
  return await import("@/app/api/transcribe/route");
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weatherv1-transcribe-"));
  originalEnv = {};
  for (const k of ENV_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.WEATHER_RUNTIME_DIR = tempDir;

  vi.resetAllMocks();
  mocks.assertDesktopAuth.mockReturnValue(null);
  mocks.updatePlanBundle.mockResolvedValue(undefined);
  mocks.uploadRuntimeFile.mockResolvedValue(undefined);
  mocks.mapProviderError.mockReturnValue(null);
  mocks.transcribeAudio.mockResolvedValue({
    text: "hello",
    segments: [{ start: 0, end: 1, text: "hello" }],
    duration: 1,
    transcription_model: "whisper-1",
    billed_audio_sec: 1,
  });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = originalEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function multipartRequest(filename: string, contents: string): Promise<Request> {
  const form = new FormData();
  form.append("audio", new File([contents], filename, { type: "audio/mpeg" }));
  return new Request("http://localhost/api/transcribe", {
    method: "POST",
    body: form,
  });
}

describe("/api/transcribe", () => {
  it("returns 401 when auth denies", async () => {
    const { NextResponse } = await import("next/server");
    mocks.assertDesktopAuth.mockReturnValueOnce(
      NextResponse.json({ success: false }, { status: 401 }),
    );
    const { POST } = await importRoute();
    const res = await POST(jsonRequest({}) as never);
    expect(res.status).toBe(401);
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
  });

  it("returns 400 when desktop_file_path is missing from JSON body", async () => {
    const { POST } = await importRoute();
    const res = await POST(jsonRequest({}) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/audio file/);
  });

  it("returns 400 when multipart has no audio part", async () => {
    const { POST } = await importRoute();
    const empty = new FormData();
    const req = new Request("http://localhost/api/transcribe", { method: "POST", body: empty });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("desktop path: copies source file and runs the pipeline", async () => {
    const sourceFile = path.join(tempDir, "source.mp3");
    fs.writeFileSync(sourceFile, Buffer.from("audio-bytes"));

    const { POST } = await importRoute();
    const res = await POST(jsonRequest({ desktop_file_path: sourceFile }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.transcript).toBe("hello");
    expect(body.duration).toBe(1);
    expect(body.filename).toMatch(/\.mp3$/);

    // A copy should now exist under uploadsDir.
    const uploadsDir = path.join(tempDir, "uploads");
    const copied = fs.readdirSync(uploadsDir);
    expect(copied).toHaveLength(1);

    expect(mocks.upsertJob).toHaveBeenCalledWith(
      expect.objectContaining({ status: "draft", job_id: body.job_id }),
    );
    expect(mocks.persistTranscriptionUsageEstimate).toHaveBeenCalledWith(
      body.job_id,
      expect.objectContaining({ billed_audio_sec: 1, transcription_model: "whisper-1" }),
    );
    expect(mocks.updatePlanBundle).toHaveBeenCalledWith(
      body.job_id,
      expect.objectContaining({
        audio_filename: body.filename,
        duration_sec: 1,
        transcript: "hello",
      }),
    );
    // Fire-and-forget mirror upload.
    expect(mocks.uploadRuntimeFile).toHaveBeenCalledWith(
      `voiceovers/${body.job_id}/${body.filename}`,
      expect.any(String),
    );
  });

  it("multipart path: writes the uploaded blob and runs the pipeline", async () => {
    const { POST } = await importRoute();
    const req = await multipartRequest("clip.mp3", "xx");
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.filename).toMatch(/\.mp3$/);
    const uploadsDir = path.join(tempDir, "uploads");
    expect(fs.readdirSync(uploadsDir)).toHaveLength(1);
  });

  it("swallows R2 mirror upload errors (fire-and-forget)", async () => {
    mocks.uploadRuntimeFile.mockRejectedValueOnce(new Error("r2 down"));
    const source = path.join(tempDir, "source.mp3");
    fs.writeFileSync(source, Buffer.from("x"));

    const { POST } = await importRoute();
    const res = await POST(jsonRequest({ desktop_file_path: source }) as never);
    expect(res.status).toBe(200);
    // Allow the unhandled .catch to fire.
    await new Promise((r) => setTimeout(r, 10));
  });

  it("returns 500 when transcription fails", async () => {
    mocks.transcribeAudio.mockRejectedValueOnce(new Error("whisper bad"));
    const source = path.join(tempDir, "source.mp3");
    fs.writeFileSync(source, Buffer.from("x"));

    const { POST } = await importRoute();
    const res = await POST(jsonRequest({ desktop_file_path: source }) as never);
    expect(res.status).toBe(500);
  });

  it("maps provider errors when available", async () => {
    mocks.transcribeAudio.mockRejectedValueOnce(new Error("rate limited"));
    mocks.mapProviderError.mockReturnValueOnce({
      body: { error: "rate limited", code: "rate_limit" },
      status: 429,
    });
    const source = path.join(tempDir, "source.mp3");
    fs.writeFileSync(source, Buffer.from("x"));

    const { POST } = await importRoute();
    const res = await POST(jsonRequest({ desktop_file_path: source }) as never);
    expect(res.status).toBe(429);
  });
});
