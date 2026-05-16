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
  // Always run both compares so timing doesn't leak which field was wrong.
  const userOk = timingSafeEqualStr(user, expectedUser);
  const passOk = timingSafeEqualStr(pass, expectedPass);
  if (!userOk || !passOk) return { ok: false, status: 401, error: "unauthorized" };
  return { ok: true };
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
    // `downloads/` key prefix. Strict path whitelist prevents traversal; temp
    // creds minted by /v1/r2/temporary-credentials scope to `tenants/...` only,
    // so they can never read or overwrite anything under `downloads/`.
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
      const isMutablePointer =
        rawKey.includes("/latest/") || rawKey.includes("/latest-stable/");
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
      if (object.size !== undefined) headers["content-length"] = String(object.size);
      if (object.uploaded) headers["last-modified"] = new Date(object.uploaded).toUTCString();

      if (request.method === "HEAD") {
        return new Response(null, { status: 200, headers });
      }
      const status = range && object.range ? 206 : 200;
      if (status === 206 && object.range) {
        const start = object.range.offset ?? 0;
        const length = object.range.length ?? 0;
        const end = start + length - 1;
        headers["content-range"] = `bytes ${start}-${end}/${object.size}`;
      }
      return new Response(object.body, { status, headers });
    }

    const auth = checkBasicAuth(request, env);
    if (!auth.ok) {
      return json({ success: false, error: auth.error }, cors, auth.status);
    }

    if (url.pathname === "/v1/r2/temporary-credentials" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const tenantId = sanitizeTenant(body.tenantId || env.DEFAULT_TENANT_ID);
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/r2/temp-access-credentials`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          bucket: env.R2_BUCKET_NAME,
          parentAccessKeyId: env.R2_PARENT_ACCESS_KEY_ID,
          permission: "object-read-write",
          ttlSeconds: 900,
          prefixes: [`tenants/${tenantId}/`],
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        return json({ success: false, error: payload.errors?.[0]?.message || `Cloudflare API HTTP ${response.status}` }, cors, 502);
      }
      const result = payload.result || payload;
      return json({
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
        bucketName: env.R2_BUCKET_NAME,
        accessKeyId: result.accessKeyId,
        secretAccessKey: result.secretAccessKey,
        sessionToken: result.sessionToken,
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
        tenantPrefix: `tenants/${tenantId}/`,
      }, cors);
    }

    if (url.pathname === "/v1/catalog" && request.method === "GET") {
      const tenantId = sanitizeTenant(url.searchParams.get("tenantId") || env.DEFAULT_TENANT_ID);
      const object = await env.WEATHERV1_MEDIA.get(`tenants/${tenantId}/catalog/catalog.json`);
      if (!object) return json({ success: false, error: "catalog not found" }, cors, 404);
      return new Response(await object.text(), {
        headers: {
          ...cors,
          "content-type": "application/json; charset=utf-8",
          etag: object.httpEtag,
          "cache-control": "no-cache",
        },
      });
    }

    if (url.pathname === "/v1/catalog" && request.method === "PUT") {
      const tenantId = sanitizeTenant(url.searchParams.get("tenantId") || env.DEFAULT_TENANT_ID);
      const text = await request.text();
      JSON.parse(text);
      const key = `tenants/${tenantId}/catalog/catalog.json`;
      await env.WEATHERV1_MEDIA.put(key, text, {
        httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "no-cache" },
      });
      const object = await env.WEATHERV1_MEDIA.head(key);
      return json({ success: true, etag: object?.httpEtag }, cors);
    }

    return json({ success: false, error: "not found" }, cors, 404);
  },
};

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
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
  };
}

function sanitizeTenant(value) {
  const tenant = String(value || "default").trim();
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(tenant)) throw new Error("invalid tenant id");
  return tenant;
}
