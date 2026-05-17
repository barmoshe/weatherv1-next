// R2 client — talks only to the gateway Worker, never to S3 directly.
//
// Phase 2 of the proxy migration: the desktop app no longer mints temporary
// S3 credentials. Every read/write goes through `/v1/objects` (single-shot)
// or `/v1/multipart/*` (chunked uploads for files larger than the Worker
// request body limit). Authentication is HTTP Basic with the unified
// editor credential.

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { getRuntimeConfig } from "@/server/runtime/config";

// Single-PUT cap. Workers Free/Pro accept up to 100 MB; we leave 10 MB of
// headroom for Worker-side accounting before falling back to multipart.
const MAX_SINGLE_PUT_BYTES = 90 * 1024 * 1024;
// Multipart part size. R2 requires each part except the last to be at
// least 5 MiB. 8 MiB keeps part counts low for typical multi-hundred-MB
// renders while staying well under any Worker subrequest cap.
const MULTIPART_PART_BYTES = 8 * 1024 * 1024;

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function configuredTenantPrefix(): string {
  const tenantId = getRuntimeConfig().r2.tenantId ?? "default";
  return `tenants/${tenantId}`;
}

function normalizeEtag(etag: string | null | undefined): string | undefined {
  return etag ? etag.replace(/^"|"$/g, "") : undefined;
}

export function tenantKey(relativeKey: string): string {
  const clean = relativeKey.replace(/^\/+/, "");
  return `${configuredTenantPrefix()}/${clean}`;
}

export function r2Configured(): boolean {
  const cfg = getRuntimeConfig().r2;
  return Boolean(
    cfg.enabled && cfg.gatewayUrl && cfg.tenantId && cfg.appUsername && cfg.appPassword,
  );
}

function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

function gatewayBase(): string {
  const cfg = getRuntimeConfig().r2;
  if (!r2Configured()) throw new Error("R2 sync is not configured");
  return trimSlash(cfg.gatewayUrl!);
}

function authHeader(): string {
  const cfg = getRuntimeConfig().r2;
  return basicAuthHeader(cfg.appUsername!, cfg.appPassword!);
}

function objectUrl(key: string): string {
  return `${gatewayBase()}/v1/objects?key=${encodeURIComponent(key)}`;
}

function multipartUrl(key: string, extra: Record<string, string | number> = {}): string {
  const params = new URLSearchParams({ key });
  for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
  return `${gatewayBase()}/v1/multipart?${params.toString()}`;
}

function multipartCompleteUrl(key: string, uploadId: string): string {
  const params = new URLSearchParams({ key, uploadId });
  return `${gatewayBase()}/v1/multipart/complete?${params.toString()}`;
}

async function readErrorMessage(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  return data?.error || `HTTP ${res.status}`;
}

async function streamToFile(body: ReadableStream<Uint8Array>, targetPath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  const nodeStream = Readable.fromWeb(body as never);
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(targetPath);
    nodeStream.pipe(out);
    nodeStream.on("error", reject);
    out.on("error", reject);
    out.on("finish", resolve);
  });
}

export async function headR2Object(
  key: string,
): Promise<{ etag?: string; size?: number; updatedAt?: string } | null> {
  const res = await fetch(objectUrl(key), {
    method: "HEAD",
    headers: { authorization: authHeader() },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`headR2Object(${key}): HTTP ${res.status}`);
  const sizeHeader = res.headers.get("content-length");
  const updatedHeader = res.headers.get("last-modified");
  return {
    etag: normalizeEtag(res.headers.get("etag")),
    size: sizeHeader ? Number(sizeHeader) : undefined,
    updatedAt: updatedHeader ? new Date(updatedHeader).toISOString() : undefined,
  };
}

export async function getR2Text(key: string): Promise<{ text: string; etag?: string }> {
  const res = await fetch(objectUrl(key), {
    method: "GET",
    headers: { authorization: authHeader() },
  });
  if (!res.ok) throw new Error(`getR2Text(${key}): ${await readErrorMessage(res)}`);
  return { text: await res.text(), etag: normalizeEtag(res.headers.get("etag")) };
}

export async function putR2Text(key: string, text: string): Promise<{ etag?: string }> {
  if (/(^|\/)outputs\//.test(key)) {
    throw new Error(`putR2Text: refusing to upload to outputs/ prefix (key=${key})`);
  }
  const res = await fetch(objectUrl(key), {
    method: "PUT",
    headers: {
      authorization: authHeader(),
      "content-type": "application/json; charset=utf-8",
      "x-cache-control": "no-cache",
    },
    body: text,
  });
  if (!res.ok) throw new Error(`putR2Text(${key}): ${await readErrorMessage(res)}`);
  const data = (await res.json().catch(() => ({}))) as { etag?: string };
  return { etag: normalizeEtag(data.etag) };
}

export async function uploadR2File(
  key: string,
  filePath: string,
  contentType: string,
  onProgress?: (loaded?: number, total?: number) => void,
): Promise<{ etag?: string; size: number }> {
  // Rendered forecast MP4s must stay local — they're regenerable from the
  // plan bundle and their previous R2 home (`tenants/<id>/outputs/<jobId>/forecast.mp4`)
  // was removed in 826a79b. Defense-in-depth: the Worker rejects this too.
  if (/(^|\/)outputs\//.test(key)) {
    throw new Error(`uploadR2File: refusing to upload to outputs/ prefix (key=${key})`);
  }
  const stat = await fs.promises.stat(filePath);
  if (stat.size <= MAX_SINGLE_PUT_BYTES) {
    return uploadSinglePut(key, filePath, contentType, stat.size, onProgress);
  }
  return uploadMultipart(key, filePath, contentType, stat.size, onProgress);
}

async function uploadSinglePut(
  key: string,
  filePath: string,
  contentType: string,
  size: number,
  onProgress?: (loaded?: number, total?: number) => void,
): Promise<{ etag?: string; size: number }> {
  onProgress?.(0, size);
  // Node fetch can stream a file via Readable.toWeb + duplex:'half'.
  const nodeStream = fs.createReadStream(filePath);
  let sent = 0;
  nodeStream.on("data", (chunk) => {
    sent += chunk.length;
    onProgress?.(sent, size);
  });
  const body = Readable.toWeb(nodeStream) as unknown as BodyInit;
  const res = await fetch(objectUrl(key), {
    method: "PUT",
    headers: {
      authorization: authHeader(),
      "content-type": contentType,
      "content-length": String(size),
      "x-cache-control": "private, max-age=31536000, immutable",
    },
    body,
    // Node-only fetch option for streaming request bodies.
    // @ts-expect-error: 'duplex' is a Node fetch option not in lib.dom.d.ts.
    duplex: "half",
  });
  if (!res.ok) throw new Error(`uploadR2File(${key}): ${await readErrorMessage(res)}`);
  const data = (await res.json().catch(() => ({}))) as { etag?: string; size?: number };
  onProgress?.(size, size);
  return { etag: normalizeEtag(data.etag), size };
}

async function uploadMultipart(
  key: string,
  filePath: string,
  contentType: string,
  size: number,
  onProgress?: (loaded?: number, total?: number) => void,
): Promise<{ etag?: string; size: number }> {
  // 1. Initiate
  const initRes = await fetch(
    multipartUrl(key, { contentType }),
    { method: "POST", headers: { authorization: authHeader() } },
  );
  if (!initRes.ok) throw new Error(`uploadMultipart init(${key}): ${await readErrorMessage(initRes)}`);
  const { uploadId } = (await initRes.json()) as { uploadId: string };
  if (!uploadId) throw new Error(`uploadMultipart init(${key}): missing uploadId`);

  const parts: { partNumber: number; etag: string }[] = [];
  let partNumber = 0;
  let sent = 0;
  const fh = await fs.promises.open(filePath, "r");
  try {
    onProgress?.(0, size);
    while (sent < size) {
      partNumber += 1;
      const remaining = size - sent;
      const partSize = Math.min(MULTIPART_PART_BYTES, remaining);
      const buf = Buffer.alloc(partSize);
      await fh.read(buf, 0, partSize, sent);
      const res = await fetch(
        multipartUrl(key, { uploadId, partNumber }),
        {
          method: "PUT",
          headers: {
            authorization: authHeader(),
            "content-type": "application/octet-stream",
            "content-length": String(partSize),
          },
          body: buf,
        },
      );
      if (!res.ok) {
        // Best-effort abort so we don't leak storage on the R2 side.
        await fetch(multipartUrl(key, { uploadId }), {
          method: "DELETE",
          headers: { authorization: authHeader() },
        }).catch(() => {});
        throw new Error(`uploadMultipart part ${partNumber}(${key}): ${await readErrorMessage(res)}`);
      }
      const data = (await res.json()) as { etag: string };
      parts.push({ partNumber, etag: data.etag });
      sent += partSize;
      onProgress?.(sent, size);
    }
  } finally {
    await fh.close();
  }

  // 2. Complete
  const completeRes = await fetch(multipartCompleteUrl(key, uploadId), {
    method: "POST",
    headers: {
      authorization: authHeader(),
      "content-type": "application/json",
    },
    body: JSON.stringify({ parts }),
  });
  if (!completeRes.ok) {
    throw new Error(`uploadMultipart complete(${key}): ${await readErrorMessage(completeRes)}`);
  }
  const data = (await completeRes.json()) as { etag?: string; size?: number };
  return { etag: normalizeEtag(data.etag), size };
}

/**
 * Remove a single object from R2 via the gateway. Treats 404 as success
 * so callers can be idempotent. Throws on any other non-2xx.
 */
export async function deleteR2Object(key: string): Promise<void> {
  const res = await fetch(objectUrl(key), {
    method: "DELETE",
    headers: { authorization: authHeader() },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteR2Object(${key}): ${await readErrorMessage(res)}`);
  }
}

export async function downloadR2File(
  key: string,
  targetPath: string,
): Promise<{ etag?: string; size?: number; updatedAt?: string }> {
  const res = await fetch(objectUrl(key), {
    method: "GET",
    headers: { authorization: authHeader() },
  });
  if (!res.ok) throw new Error(`downloadR2File(${key}): ${await readErrorMessage(res)}`);
  if (!res.body) throw new Error(`downloadR2File(${key}): empty body`);
  await streamToFile(res.body, targetPath);
  const sizeHeader = res.headers.get("content-length");
  const updatedHeader = res.headers.get("last-modified");
  return {
    etag: normalizeEtag(res.headers.get("etag")),
    size: sizeHeader ? Number(sizeHeader) : undefined,
    updatedAt: updatedHeader ? new Date(updatedHeader).toISOString() : undefined,
  };
}

export interface R2Stream {
  body: ReadableStream<Uint8Array>;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  updatedAt?: string;
}

/**
 * Stream an R2 object straight through without writing to local disk.
 * Returns null when the object does not exist. Throws on transport / auth
 * failure so callers can decide whether to retry or fall through.
 */
export async function getR2Stream(key: string): Promise<R2Stream | null> {
  const res = await fetch(objectUrl(key), {
    method: "GET",
    headers: { authorization: authHeader() },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getR2Stream(${key}): ${await readErrorMessage(res)}`);
  if (!res.body) return null;
  const sizeHeader = res.headers.get("content-length");
  const updatedHeader = res.headers.get("last-modified");
  return {
    body: res.body,
    contentType: res.headers.get("content-type") ?? undefined,
    contentLength: sizeHeader ? Number(sizeHeader) : undefined,
    etag: normalizeEtag(res.headers.get("etag")),
    updatedAt: updatedHeader ? new Date(updatedHeader).toISOString() : undefined,
  };
}
