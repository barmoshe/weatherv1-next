// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertDesktopAuth: vi.fn(),
  pushCatalogToR2: vi.fn(),
  pullFullStateFromR2: vi.fn(),
  replaceRemoteCatalog: vi.fn(),
  materializeVideo: vi.fn(),
  retryR2Sync: vi.fn(),
  getR2SyncStatus: vi.fn(),
  pullCatalogFromR2IfLocalEmpty: vi.fn(),
  reviveDeadMirrorOps: vi.fn(),
  kickMirrorQueue: vi.fn(),
}));

vi.mock("@/server/runtime/auth", () => ({
  assertDesktopAuth: (req: unknown) => mocks.assertDesktopAuth(req),
}));

// Re-export the real conflict error so handlers can `instanceof` it.
vi.mock("@/server/sync/r2/service", () => {
  class R2CatalogConflictError extends Error {
    constructor(message = "remote catalog changed") {
      super(message);
      this.name = "R2CatalogConflictError";
    }
  }
  return {
    R2CatalogConflictError,
    pushCatalogToR2: mocks.pushCatalogToR2,
    pullFullStateFromR2: mocks.pullFullStateFromR2,
    replaceRemoteCatalog: mocks.replaceRemoteCatalog,
    materializeVideo: mocks.materializeVideo,
    retryR2Sync: mocks.retryR2Sync,
    getR2SyncStatus: mocks.getR2SyncStatus,
    pullCatalogFromR2IfLocalEmpty: mocks.pullCatalogFromR2IfLocalEmpty,
  };
});

vi.mock("@/server/sync/r2/mirror-queue", () => ({
  reviveDeadMirrorOps: mocks.reviveDeadMirrorOps,
  kickMirrorQueue: mocks.kickMirrorQueue,
}));

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  // Default: auth allows.
  mocks.assertDesktopAuth.mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function authDenied() {
  const { NextResponse } = require("next/server") as typeof import("next/server");
  return NextResponse.json({ success: false, error: "Unauthorized desktop request" }, { status: 401 });
}

function postRequest(url: string, body: unknown = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(url: string): Request {
  return new Request(url, { method: "GET" });
}

const fakeStatus = {
  enabled: true,
  ready: true,
  counts: { local: 1, cloudOnly: 0, syncing: 0, error: 0 },
};

describe("/api/sync/r2/push", () => {
  it("returns 401 when auth denies", async () => {
    mocks.assertDesktopAuth.mockReturnValueOnce(authDenied());
    const { POST } = await import("@/app/api/sync/r2/push/route");
    const res = await POST(postRequest("http://localhost/api/sync/r2/push") as never);
    expect(res.status).toBe(401);
    expect(mocks.pushCatalogToR2).not.toHaveBeenCalled();
  });

  it("returns 200 + r2 status on success", async () => {
    mocks.pushCatalogToR2.mockResolvedValueOnce(fakeStatus);
    const { POST } = await import("@/app/api/sync/r2/push/route");
    const res = await POST(postRequest("http://localhost/api/sync/r2/push") as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, r2: fakeStatus });
  });

  it("returns 409 on R2CatalogConflictError", async () => {
    const { R2CatalogConflictError } = await import("@/server/sync/r2/service");
    mocks.pushCatalogToR2.mockRejectedValueOnce(new R2CatalogConflictError());
    const { POST } = await import("@/app/api/sync/r2/push/route");
    const res = await POST(postRequest("http://localhost/api/sync/r2/push") as never);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/remote catalog changed/);
  });

  it("returns 500 on generic errors", async () => {
    mocks.pushCatalogToR2.mockRejectedValueOnce(new Error("boom"));
    const { POST } = await import("@/app/api/sync/r2/push/route");
    const res = await POST(postRequest("http://localhost/api/sync/r2/push") as never);
    expect(res.status).toBe(500);
  });
});

describe("/api/sync/r2/pull", () => {
  it("returns 401 when auth denies", async () => {
    mocks.assertDesktopAuth.mockReturnValueOnce(authDenied());
    const { POST } = await import("@/app/api/sync/r2/pull/route");
    const res = await POST(postRequest("http://localhost/api/sync/r2/pull") as never);
    expect(res.status).toBe(401);
  });

  it("returns 200 with r2 status on success", async () => {
    mocks.pullFullStateFromR2.mockResolvedValueOnce(fakeStatus);
    const { POST } = await import("@/app/api/sync/r2/pull/route");
    const res = await POST(postRequest("http://localhost/api/sync/r2/pull") as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, r2: fakeStatus });
  });

  it("returns 500 on failure", async () => {
    mocks.pullFullStateFromR2.mockRejectedValueOnce(new Error("network"));
    const { POST } = await import("@/app/api/sync/r2/pull/route");
    const res = await POST(postRequest("http://localhost/api/sync/r2/pull") as never);
    expect(res.status).toBe(500);
  });
});

describe("/api/sync/r2/materialize", () => {
  it("returns 401 when auth denies", async () => {
    mocks.assertDesktopAuth.mockReturnValueOnce(authDenied());
    const { POST } = await import("@/app/api/sync/r2/materialize/route");
    const res = await POST(
      postRequest("http://localhost/api/sync/r2/materialize", { video_id: "v" }) as never,
    );
    expect(res.status).toBe(401);
    expect(mocks.materializeVideo).not.toHaveBeenCalled();
  });

  it("returns 400 when video_id is missing", async () => {
    const { POST } = await import("@/app/api/sync/r2/materialize/route");
    const res = await POST(postRequest("http://localhost/api/sync/r2/materialize", {}) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/video_id/);
    expect(mocks.materializeVideo).not.toHaveBeenCalled();
  });

  it("returns 200 with the materialized video on success", async () => {
    mocks.materializeVideo.mockResolvedValueOnce({ id: "vid-1", filename: "x.mp4" });
    const { POST } = await import("@/app/api/sync/r2/materialize/route");
    const res = await POST(
      postRequest("http://localhost/api/sync/r2/materialize", { video_id: "vid-1" }) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, video: { id: "vid-1" } });
    expect(mocks.materializeVideo).toHaveBeenCalledWith("vid-1");
  });

  it("returns 500 on service failure", async () => {
    mocks.materializeVideo.mockRejectedValueOnce(new Error("nope"));
    const { POST } = await import("@/app/api/sync/r2/materialize/route");
    const res = await POST(
      postRequest("http://localhost/api/sync/r2/materialize", { video_id: "vid-1" }) as never,
    );
    expect(res.status).toBe(500);
  });
});

describe("/api/sync/r2/retry", () => {
  it("returns 401 when auth denies", async () => {
    mocks.assertDesktopAuth.mockReturnValueOnce(authDenied());
    const { POST } = await import("@/app/api/sync/r2/retry/route");
    const res = await POST(postRequest("http://localhost/api/sync/r2/retry") as never);
    expect(res.status).toBe(401);
  });

  it("revives dead mirror ops, kicks queue, then retries (no video_id)", async () => {
    mocks.reviveDeadMirrorOps.mockResolvedValueOnce(2);
    mocks.retryR2Sync.mockResolvedValueOnce(fakeStatus);

    const { POST } = await import("@/app/api/sync/r2/retry/route");
    const res = await POST(postRequest("http://localhost/api/sync/r2/retry", {}) as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      r2: fakeStatus,
      mirror_revived: 2,
    });
    expect(mocks.kickMirrorQueue).toHaveBeenCalledTimes(1);
    expect(mocks.retryR2Sync).toHaveBeenCalledWith(undefined);
  });

  it("forwards video_id to retryR2Sync when provided", async () => {
    mocks.reviveDeadMirrorOps.mockResolvedValueOnce(0);
    mocks.retryR2Sync.mockResolvedValueOnce(fakeStatus);

    const { POST } = await import("@/app/api/sync/r2/retry/route");
    await POST(postRequest("http://localhost/api/sync/r2/retry", { video_id: "vid-9" }) as never);
    expect(mocks.retryR2Sync).toHaveBeenCalledWith("vid-9");
  });

  it("returns 409 on conflict", async () => {
    const { R2CatalogConflictError } = await import("@/server/sync/r2/service");
    mocks.reviveDeadMirrorOps.mockResolvedValueOnce(0);
    mocks.retryR2Sync.mockRejectedValueOnce(new R2CatalogConflictError());
    const { POST } = await import("@/app/api/sync/r2/retry/route");
    const res = await POST(postRequest("http://localhost/api/sync/r2/retry") as never);
    expect(res.status).toBe(409);
  });
});

describe("/api/sync/r2/replace-remote", () => {
  it("returns 401 when auth denies", async () => {
    mocks.assertDesktopAuth.mockReturnValueOnce(authDenied());
    const { POST } = await import("@/app/api/sync/r2/replace-remote/route");
    const res = await POST(postRequest("http://localhost/api/sync/r2/replace-remote") as never);
    expect(res.status).toBe(401);
  });

  it("returns 200 with r2 status on success", async () => {
    mocks.replaceRemoteCatalog.mockResolvedValueOnce(fakeStatus);
    const { POST } = await import("@/app/api/sync/r2/replace-remote/route");
    const res = await POST(postRequest("http://localhost/api/sync/r2/replace-remote") as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, r2: fakeStatus });
  });

  it("returns 500 on failure", async () => {
    mocks.replaceRemoteCatalog.mockRejectedValueOnce(new Error("boom"));
    const { POST } = await import("@/app/api/sync/r2/replace-remote/route");
    const res = await POST(postRequest("http://localhost/api/sync/r2/replace-remote") as never);
    expect(res.status).toBe(500);
  });
});

describe("/api/sync/r2/status", () => {
  it("returns 401 when auth denies", async () => {
    mocks.assertDesktopAuth.mockReturnValueOnce(authDenied());
    const { GET } = await import("@/app/api/sync/r2/status/route");
    const res = await GET(getRequest("http://localhost/api/sync/r2/status") as never);
    expect(res.status).toBe(401);
    expect(mocks.pullCatalogFromR2IfLocalEmpty).not.toHaveBeenCalled();
  });

  it("calls pullCatalogFromR2IfLocalEmpty before reading status", async () => {
    let pullCalledBeforeStatus = false;
    mocks.pullCatalogFromR2IfLocalEmpty.mockImplementationOnce(async () => {
      pullCalledBeforeStatus = !mocks.getR2SyncStatus.mock.calls.length;
    });
    mocks.getR2SyncStatus.mockResolvedValueOnce(fakeStatus);

    const { GET } = await import("@/app/api/sync/r2/status/route");
    const res = await GET(getRequest("http://localhost/api/sync/r2/status") as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, r2: fakeStatus });
    expect(pullCalledBeforeStatus).toBe(true);
  });
});
