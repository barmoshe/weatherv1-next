import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getRuntimeConfig } from "@/server/runtime/config";
import type { R2TemporaryCredentials } from "./types";

let cachedCredentials: R2TemporaryCredentials | null = null;

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function configuredTenantPrefix(): string {
  const tenantId = getRuntimeConfig().r2.tenantId ?? "default";
  return `tenants/${tenantId}`;
}

function normalizeEtag(etag: string | undefined): string | undefined {
  return etag?.replace(/^"|"$/g, "");
}

async function streamToString(body: GetObjectCommandOutput["Body"]): Promise<string> {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  }
  const webStream = body as ReadableStream<Uint8Array>;
  const reader = webStream.getReader?.();
  if (!reader) return String(body);
  const chunks: Uint8Array[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

async function streamToFile(body: GetObjectCommandOutput["Body"], targetPath: string): Promise<void> {
  if (!body) throw new Error("R2 returned an empty object body");
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  if (body instanceof Readable) {
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(targetPath);
      body.pipe(out);
      body.on("error", reject);
      out.on("error", reject);
      out.on("finish", resolve);
    });
    return;
  }
  const text = await streamToString(body);
  await fs.promises.writeFile(targetPath, text);
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

export async function fetchTemporaryCredentials(force = false): Promise<R2TemporaryCredentials> {
  const cfg = getRuntimeConfig().r2;
  if (!r2Configured()) {
    throw new Error("R2 sync is not configured");
  }
  if (!force && cachedCredentials && Date.parse(cachedCredentials.expiresAt) - Date.now() > 60_000) {
    return cachedCredentials;
  }
  const res = await fetch(`${trimSlash(cfg.gatewayUrl!)}/v1/r2/temporary-credentials`, {
    method: "POST",
    headers: {
      authorization: basicAuthHeader(cfg.appUsername!, cfg.appPassword!),
      "content-type": "application/json",
    },
    body: JSON.stringify({ tenantId: cfg.tenantId }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<R2TemporaryCredentials> & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `R2 gateway returned HTTP ${res.status}`);
  if (!data.accountId || !data.bucketName || !data.accessKeyId || !data.secretAccessKey || !data.expiresAt) {
    throw new Error("R2 gateway returned incomplete temporary credentials");
  }
  cachedCredentials = data as R2TemporaryCredentials;
  return cachedCredentials;
}

async function makeS3Client(): Promise<{ client: S3Client; credentials: R2TemporaryCredentials }> {
  const credentials = await fetchTemporaryCredentials();
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${credentials.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
  });
  return { client, credentials };
}

export async function headR2Object(key: string): Promise<{ etag?: string; size?: number; updatedAt?: string } | null> {
  const { client, credentials } = await makeS3Client();
  try {
    const result = await client.send(new HeadObjectCommand({ Bucket: credentials.bucketName, Key: key }));
    return {
      etag: normalizeEtag(result.ETag),
      size: result.ContentLength,
      updatedAt: result.LastModified?.toISOString(),
    };
  } catch (err: any) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === "NotFound") return null;
    throw err;
  }
}

export async function getR2Text(key: string): Promise<{ text: string; etag?: string }> {
  const { client, credentials } = await makeS3Client();
  const result = await client.send(new GetObjectCommand({ Bucket: credentials.bucketName, Key: key }));
  return { text: await streamToString(result.Body), etag: normalizeEtag(result.ETag) };
}

export async function putR2Text(key: string, text: string): Promise<{ etag?: string }> {
  const { client, credentials } = await makeS3Client();
  const result = await client.send(new PutObjectCommand({
    Bucket: credentials.bucketName,
    Key: key,
    Body: text,
    ContentType: "application/json; charset=utf-8",
    CacheControl: "no-cache",
  }));
  return { etag: normalizeEtag(result.ETag) };
}

export async function uploadR2File(
  key: string,
  filePath: string,
  contentType: string,
  onProgress?: (loaded?: number, total?: number) => void,
): Promise<{ etag?: string; size: number }> {
  // Rendered forecast MP4s must stay local — they are large, regenerable from
  // the plan bundle, and their previous R2 home (`tenants/<id>/outputs/<jobId>/forecast.mp4`)
  // was removed in 826a79b. Reject any attempt to revive that path.
  if (/(^|\/)outputs\//.test(key)) {
    throw new Error(`uploadR2File: refusing to upload to outputs/ prefix (key=${key})`);
  }
  const { client, credentials } = await makeS3Client();
  const stat = fs.statSync(filePath);
  const upload = new Upload({
    client,
    params: {
      Bucket: credentials.bucketName,
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentType: contentType,
      CacheControl: "private, max-age=31536000, immutable",
    },
  });
  upload.on("httpUploadProgress", (progress) => onProgress?.(progress.loaded, progress.total ?? stat.size));
  const result = await upload.done();
  return { etag: normalizeEtag(result.ETag), size: stat.size };
}

export async function downloadR2File(
  key: string,
  targetPath: string,
): Promise<{ etag?: string; size?: number; updatedAt?: string }> {
  const { client, credentials } = await makeS3Client();
  const result = await client.send(new GetObjectCommand({ Bucket: credentials.bucketName, Key: key }));
  await streamToFile(result.Body, targetPath);
  return {
    etag: normalizeEtag(result.ETag),
    size: result.ContentLength,
    updatedAt: result.LastModified?.toISOString(),
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
  const { client, credentials } = await makeS3Client();
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: credentials.bucketName, Key: key }));
    if (!result.Body) return null;
    let body: ReadableStream<Uint8Array>;
    if (result.Body instanceof Readable) {
      body = Readable.toWeb(result.Body) as unknown as ReadableStream<Uint8Array>;
    } else if (result.Body instanceof Uint8Array) {
      const bytes = result.Body;
      body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    } else {
      body = result.Body as unknown as ReadableStream<Uint8Array>;
    }
    return {
      body,
      contentType: result.ContentType,
      contentLength: result.ContentLength,
      etag: normalizeEtag(result.ETag),
      updatedAt: result.LastModified?.toISOString(),
    };
  } catch (err: any) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === "NoSuchKey" || err?.name === "NotFound") return null;
    throw err;
  }
}
