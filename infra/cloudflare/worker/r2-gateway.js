// HTTP Basic Auth gateway for the WeatherV1 R2 bucket.
//
// Auth model: a single shared username + password pair, stored as Worker
// secrets (`WEATHERV1_APP_USERNAME`, `WEATHERV1_APP_PASSWORD`). The desktop
// app sends them via `Authorization: Basic <base64(user:pass)>`.
//
// Notes:
//   - Comparison uses `crypto.subtle.timingSafeEqual` (Web Crypto). We never
//     short-circuit on length mismatch — that would leak the secret length
//     through timing. See:
//     https://developers.cloudflare.com/workers/examples/protect-against-timing-attacks
//   - We deliberately do NOT send a `WWW-Authenticate: Basic ...` header on
//     401. The client is the Electron desktop app, not a browser; the header
//     would only serve to pop a login dialog if someone visits the worker URL
//     in a browser.
//   - Decoding uses `atob` so we don't require the `nodejs_compat` flag.
//
// All R2 reads/writes go through this Worker — the desktop app never holds
// S3 credentials. The previous /v1/r2/temporary-credentials endpoint and
// its Cloudflare-API-bound secrets were removed in the Phase-2 cleanup.

const encoder = new TextEncoder();

/** Constant-time string compare. Returns false even if lengths differ. */
function timingSafeEqualStr(a, b) {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.byteLength !== bBytes.byteLength) {
    return !crypto.subtle.timingSafeEqual(aBytes, aBytes);
  }
  return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}

/**
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
function checkBasicAuth(request, env) {
  const expectedUser = env.WEATHERV1_APP_USERNAME;
  const expectedPass = env.WEATHERV1_APP_PASSWORD;
  if (!expectedUser || !expectedPass) {
    return { ok: false, status: 500, error: "worker missing WEATHERV1_APP_USERNAME / WEATHERV1_APP_PASSWORD" };
  }
  const header = request.headers.get("authorization") || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  let decoded;
  try {
    decoded = atob(encoded);
  } catch {
    return { ok: false, status: 400, error: "malformed authorization header" };
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return { ok: false, status: 400, error: "malformed authorization header" };
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  const userOk = timingSafeEqualStr(user, expectedUser);
  const passOk = timingSafeEqualStr(pass, expectedPass);
  return userOk && passOk ? { ok: true } : { ok: false, status: 401, error: "unauthorized" };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (url.pathname === "/v1/health" && request.method === "GET") {
      return json({ ok: true, bucket: env.R2_BUCKET_NAME, tenantId: env.DEFAULT_TENANT_ID }, cors);
    }

    // Public installer downloads. Served unauthenticated from R2 under the
    // `downloads/` key prefix. Strict path whitelist prevents traversal.
    // The /v1/objects/* gate below rejects anything that doesn't start with
    // `tenants/`, so these public keys can never be read or overwritten via
    // the authenticated path either.
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      url.pathname.startsWith("/downloads/")
    ) {
      const rawKey = decodeURIComponent(url.pathname.slice("/".length));
      if (
        rawKey.length > 256 ||
        rawKey.includes("..") ||
        rawKey.includes("//") ||
        !/^[A-Za-z0-9._/-]+$/.test(rawKey)
      ) {
        return json({ success: false, error: "bad request" }, cors, 400);
      }

      const range = request.headers.get("range") || undefined;
      const object =
        request.method === "HEAD"
          ? await env.WEATHERV1_MEDIA.head(rawKey)
          : await env.WEATHERV1_MEDIA.get(rawKey, range ? { range } : undefined);
      if (!object) return json({ success: false, error: "not found" }, cors, 404);

      const filename = rawKey.split("/").pop() || "download.bin";
      const isMutablePointer = /\/(latest|latest-stable)\/[^/]+$/.test(rawKey);
      const headers = {
        ...cors,
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${filename}"`,
        etag: object.httpEtag,
        "accept-ranges": "bytes",
        "cache-control": isMutablePointer
          ? "public, max-age=300"
          : "public, max-age=31536000, immutable",
      };
      if (object.uploaded) headers["last-modified"] = new Date(object.uploaded).toUTCString();

      if (request.method === "HEAD") {
        if (object.size !== undefined) headers["content-length"] = String(object.size);
        return new Response(null, { status: 200, headers });
      }
      const status = range && object.range ? 206 : 200;
      if (status === 206 && object.range) {
        const start = object.range.offset ?? 0;
        const length = object.range.length ?? 0;
        const end = start + length - 1;
        headers["content-range"] = `bytes ${start}-${end}/${object.size}`;
        headers["content-length"] = String(length);
      } else if (object.size !== undefined) {
        headers["content-length"] = String(object.size);
      }
      return new Response(object.body, { status, headers });
    }

    const auth = checkBasicAuth(request, env);
    if (!auth.ok) {
      return json({ success: false, error: auth.error }, cors, auth.status);
    }

    // --- Authenticated object proxy --------------------------------------
    //
    // Every R2 object the desktop app touches flows through these routes.
    // Key is passed as ?key=tenants/<tenant>/<rest>; validated to keep
    // callers inside their tenant prefix and out of any forbidden namespaces
    // (currently just `outputs/`, which holds local-only forecast renders).
    //
    // Streaming: GET pipes object.body straight to the client; PUT pipes
    // request.body straight to R2.put. Workers cap request bodies at 100 MB
    // on Free/Pro plans; videos larger than that use the multipart API below.

    if (url.pathname === "/v1/objects") {
      const key = url.searchParams.get("key") || "";
      const keyError = validateObjectKey(key);
      if (keyError) return json({ success: false, error: keyError }, cors, 400);

      if (request.method === "HEAD") {
        const obj = await env.WEATHERV1_MEDIA.head(key);
        if (!obj) return new Response(null, { status: 404, headers: cors });
        return new Response(null, {
          status: 200,
          headers: objectMetaHeaders(obj, cors),
        });
      }

      if (request.method === "GET") {
        const rangeHeader = request.headers.get("range") || undefined;
        const obj = await env.WEATHERV1_MEDIA.get(
          key,
          rangeHeader ? { range: parseRange(rangeHeader) } : undefined,
        );
        if (!obj) return json({ success: false, error: "not found" }, cors, 404);
        const headers = objectMetaHeaders(obj, cors);
        let status = 200;
        if (rangeHeader && obj.range) {
          status = 206;
          const start = obj.range.offset ?? 0;
          const length = obj.range.length ?? 0;
          headers["content-range"] = `bytes ${start}-${start + length - 1}/${obj.size ?? "*"}`;
          headers["content-length"] = String(length);
        }
        return new Response(obj.body, { status, headers });
      }

      if (request.method === "PUT") {
        if (!request.body) {
          return json({ success: false, error: "missing body" }, cors, 400);
        }
        const contentType = request.headers.get("content-type") || "application/octet-stream";
        const cacheControl = request.headers.get("x-cache-control") || undefined;
        const obj = await env.WEATHERV1_MEDIA.put(key, request.body, {
          httpMetadata: { contentType, ...(cacheControl ? { cacheControl } : {}) },
        });
        return json(
          { success: true, etag: obj?.httpEtag, size: obj?.size, key },
          cors,
        );
      }

      if (request.method === "DELETE") {
        await env.WEATHERV1_MEDIA.delete(key);
        return json({ success: true, key }, cors);
      }

      return json({ success: false, error: "method not allowed" }, cors, 405);
    }

    // --- Multipart uploads -----------------------------------------------
    //
    // Used by uploadR2File when file size > MAX_SINGLE_PUT (~90 MB). The
    // R2 binding handles the actual multipart accounting; this Worker just
    // exposes it as four small HTTP routes.

    if (url.pathname === "/v1/multipart" && request.method === "POST") {
      const key = url.searchParams.get("key") || "";
      const keyError = validateObjectKey(key);
      if (keyError) return json({ success: false, error: keyError }, cors, 400);
      const contentType = url.searchParams.get("contentType") || "application/octet-stream";
      const upload = await env.WEATHERV1_MEDIA.createMultipartUpload(key, {
        httpMetadata: { contentType },
      });
      return json({ success: true, key, uploadId: upload.uploadId }, cors);
    }

    if (url.pathname === "/v1/multipart" && request.method === "PUT") {
      const key = url.searchParams.get("key") || "";
      const keyError = validateObjectKey(key);
      if (keyError) return json({ success: false, error: keyError }, cors, 400);
      const uploadId = url.searchParams.get("uploadId");
      const partNumberRaw = url.searchParams.get("partNumber");
      const partNumber = Number(partNumberRaw);
      if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1) {
        return json({ success: false, error: "missing uploadId or partNumber" }, cors, 400);
      }
      if (!request.body) {
        return json({ success: false, error: "missing body" }, cors, 400);
      }
      const upload = env.WEATHERV1_MEDIA.resumeMultipartUpload(key, uploadId);
      const part = await upload.uploadPart(partNumber, request.body);
      return json({ success: true, partNumber, etag: part.etag }, cors);
    }

    if (url.pathname === "/v1/multipart/complete" && request.method === "POST") {
      const key = url.searchParams.get("key") || "";
      const keyError = validateObjectKey(key);
      if (keyError) return json({ success: false, error: keyError }, cors, 400);
      const uploadId = url.searchParams.get("uploadId");
      if (!uploadId) return json({ success: false, error: "missing uploadId" }, cors, 400);
      const body = await request.json().catch(() => ({}));
      const parts = Array.isArray(body?.parts) ? body.parts : null;
      if (!parts) return json({ success: false, error: "missing parts[]" }, cors, 400);
      const upload = env.WEATHERV1_MEDIA.resumeMultipartUpload(key, uploadId);
      const obj = await upload.complete(parts);
      return json(
        { success: true, etag: obj?.httpEtag, size: obj?.size, key },
        cors,
      );
    }

    if (url.pathname === "/v1/multipart" && request.method === "DELETE") {
      const key = url.searchParams.get("key") || "";
      const keyError = validateObjectKey(key);
      if (keyError) return json({ success: false, error: keyError }, cors, 400);
      const uploadId = url.searchParams.get("uploadId");
      if (!uploadId) return json({ success: false, error: "missing uploadId" }, cors, 400);
      const upload = env.WEATHERV1_MEDIA.resumeMultipartUpload(key, uploadId);
      await upload.abort();
      return json({ success: true }, cors);
    }

    return json({ success: false, error: "not found" }, cors, 404);
  },
};

/**
 * Reject any key that isn't tenant-scoped or that touches the forbidden
 * `outputs/` prefix (where local-only forecast renders live in cache —
 * uploading them would waste R2 storage and is blocked client-side too).
 * Returns null on success or a human-readable string on failure.
 */
function validateObjectKey(key) {
  if (typeof key !== "string" || key.length === 0) return "missing key";
  if (key.length > 1024) return "key too long";
  if (key.includes("..") || key.includes("//")) return "invalid key";
  if (!/^tenants\/[a-zA-Z0-9_-]{1,80}\//.test(key)) return "key must start with tenants/<id>/";
  if (/(^|\/)outputs\//.test(key)) return "outputs/ prefix is forbidden";
  return null;
}

/** Parse a single-range Range header into the form R2 expects. */
function parseRange(header) {
  // Only `bytes=start-end` and `bytes=start-` are supported. `suffix-length`
  // is uncommon for the app's use case (downloading a known-size object).
  const m = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!m) return undefined;
  const offset = Number(m[1]);
  if (m[2] === "") return { offset };
  const end = Number(m[2]);
  return { offset, length: end - offset + 1 };
}

function objectMetaHeaders(obj, cors) {
  const headers = {
    ...cors,
    etag: obj.httpEtag,
    "accept-ranges": "bytes",
  };
  if (obj.size !== undefined) headers["content-length"] = String(obj.size);
  if (obj.uploaded) headers["last-modified"] = new Date(obj.uploaded).toUTCString();
  const meta = obj.httpMetadata || {};
  if (meta.contentType) headers["content-type"] = meta.contentType;
  if (meta.cacheControl) headers["cache-control"] = meta.cacheControl;
  return headers;
}

function json(data, cors, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8" },
  });
}

function corsHeaders(env) {
  const origin = env.ALLOWED_ORIGIN || "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PUT,DELETE,HEAD,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,range,x-cache-control",
  };
}
