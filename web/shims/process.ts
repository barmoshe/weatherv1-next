// Node globals the server code expects, installed before anything else loads:
// `process` (env, cwd, platform), `Buffer`, `setImmediate`. Our sources read
// env through `globalThis.__WV1_ENV__` (see the live-env plugin in
// vite.config.ts); it is the same object as `process.env`.
import { Buffer } from "buffer";

const g = globalThis as unknown as Record<string, unknown>;
const env: Record<string, string | undefined> = { NODE_ENV: "production", NEXT_RUNTIME: "nodejs" };

g.process = {
  env,
  cwd: () => "/app",
  platform: "browser",
  pid: 1,
  versions: {},
  nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args)),
  on: () => undefined,
  emitWarning: () => undefined,
};
g.__WV1_ENV__ = env;
g.Buffer ??= Buffer;
g.setImmediate ??= (fn: (...a: unknown[]) => void, ...args: unknown[]) => setTimeout(fn, 0, ...args);
g.global ??= globalThis;
