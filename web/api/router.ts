// In-page API: every `fetch("/api/...")` the UI makes is answered by the same
// Next route handler that answers it in the Electron app, run in the page.
// Routes are discovered from src/app/api/**/route.ts at build time; a
// `[param]` folder becomes a path parameter.

import { NextRequest } from "../shims/next-server";

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
type RouteModule = Partial<Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE", Handler>>;

interface Route {
  segments: string[];
  module: RouteModule;
}

const modules = import.meta.glob<RouteModule>("../../src/app/api/**/route.ts", { eager: true });

export const ORIGIN = "http://weatherv1.local";

const routes: Route[] = Object.entries(modules)
  .map(([file, module]) => ({
    segments: file.replace(/^.*\/src\/app\/api\//, "").replace(/\/route\.ts$/, "").split("/"),
    module,
  }))
  // Static segments beat params at the same depth (e.g. catalog/videos vs [id]).
  .sort((a, b) => a.segments.filter((s) => s.startsWith("[")).length - b.segments.filter((s) => s.startsWith("[")).length);

function match(pathname: string): { route: Route; params: Record<string, string> } | null {
  const parts = pathname.replace(/^\/api\//, "").split("/").filter(Boolean).map(decodeURIComponent);
  for (const route of routes) {
    if (route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    route.segments.forEach((seg, i) => {
      if (!ok) return;
      if (seg.startsWith("[") && seg.endsWith("]")) params[seg.slice(1, -1)] = parts[i];
      else if (seg !== parts[i]) ok = false;
    });
    if (ok) return { route, params };
  }
  return null;
}

/** "/api/x?y" or an absolute URL on our fake origin or file:// → the API path, else null. */
function apiPath(raw: string): string | null {
  if (raw.startsWith("/api/")) return raw;
  try {
    const u = new URL(raw);
    if ((u.origin === ORIGIN || u.protocol === "file:") && u.pathname.includes("/api/")) {
      return u.pathname.slice(u.pathname.indexOf("/api/")) + u.search;
    }
  } catch {
    // not a URL
  }
  return null;
}

export async function handleApi(path: string, init: RequestInit, sessionToken: string): Promise<Response> {
  const url = new URL(path, ORIGIN);
  const found = match(url.pathname);
  if (!found) return Response.json({ success: false, error: `No route for ${url.pathname}` }, { status: 404 });
  const method = (init.method ?? "GET").toUpperCase() as keyof RouteModule;
  const handler = found.route.module[method];
  if (!handler) return Response.json({ success: false, error: `${method} not allowed` }, { status: 405 });

  const headers = new Headers(init.headers);
  headers.set("x-weather-desktop-token", sessionToken);
  const req = new NextRequest(url, { ...init, headers, ...(init.body ? { duplex: "half" } : {}) } as RequestInit);
  try {
    return await handler(req, { params: Promise.resolve(found.params) });
  } catch (err) {
    console.error(`[api] ${method} ${url.pathname} failed:`, err);
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export function installApiRouter(sessionToken: string): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = apiPath(raw);
    if (!path) return realFetch(input, init);
    if (input instanceof Request) {
      const body = input.method === "GET" || input.method === "HEAD" ? undefined : await input.arrayBuffer();
      return handleApi(path, { method: input.method, headers: input.headers, body, ...init }, sessionToken);
    }
    return handleApi(path, init ?? {}, sessionToken);
  };
}

export const __test = { match, apiPath, routes };
