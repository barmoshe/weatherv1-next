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

    const auth = request.headers.get("authorization") || "";
    if (auth !== `Bearer ${env.WEATHERV1_APP_TOKEN}`) {
      return json({ success: false, error: "unauthorized" }, cors, 401);
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
