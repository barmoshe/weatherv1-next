// The server code runs in the page against a synchronous `fs`. That fs is an
// in-memory memfs volume, filled from the catalog folder at start-up and
// written back to it after every change (debounced, in order).
//
// Virtual layout (process.env paths point here):
//   /ws/...                          ↔ folder root
//   /ws/.weatherv1/runtime/outputs/  ↔ folder outputs/  (renders live there)
//
// Small JSON state (catalog, jobs, plan bundles) is loaded whole. Large media
// (videos/, music/, outputs/, uploads, caches) is "external": the volume holds
// a zero-byte placeholder so existsSync/readdirSync/statSync answer correctly,
// statSync reports the real size, and readers that need the bytes (renderer,
// file serving) go to the folder through `readExternal`.

import { Volume, createFsFromVolume } from "memfs";
import * as folder from "./folder";

export const WS = "/ws";
export const RUNTIME_DIR = `${WS}/.weatherv1/runtime`;
export const OUTPUTS_DIR = `${RUNTIME_DIR}/outputs`;
export const UPLOADS_DIR = `${RUNTIME_DIR}/uploads`;

/** Folder subtrees kept as placeholders, never read into memory. */
const EXTERNAL_DIRS = ["videos", "music", "outputs", ".weatherv1/runtime/uploads", ".weatherv1/runtime/cache"];
/** Folder subtrees the volume never mirrors. */
const SKIP_DIRS = new Set([".weatherv1/models", ".weatherv1/runtime/tmp"]);

export const vol = new Volume();
const rawFs = createFsFromVolume(vol) as unknown as typeof import("node:fs");

const externalSizes = new Map<string, number>();
const dirty = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> = Promise.resolve();

/** Virtual path → folder-relative path, or null when it isn't persisted. */
export function toFolderPath(vpath: string): string | null {
  const p = vpath.replace(/\\/g, "/");
  if (p === OUTPUTS_DIR || p.startsWith(`${OUTPUTS_DIR}/`)) return `outputs${p.slice(OUTPUTS_DIR.length)}`;
  if (p.startsWith(`${WS}/`)) {
    const rel = p.slice(WS.length + 1);
    for (const s of SKIP_DIRS) if (rel === s || rel.startsWith(`${s}/`)) return null;
    return rel;
  }
  return null;
}

/** Folder-relative path → virtual path. */
export function toVirtualPath(rel: string): string {
  if (rel === "outputs" || rel.startsWith("outputs/")) return `${OUTPUTS_DIR}${rel.slice("outputs".length)}`;
  return `${WS}/${rel}`;
}

function isExternalRel(rel: string): boolean {
  // JSON (plan bundles sit in outputs/ next to the renders) is state, not media.
  if (rel.endsWith(".json")) return false;
  return EXTERNAL_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`));
}

export function isExternal(vpath: string): boolean {
  return externalSizes.has(vpath);
}

/** Record a file that lives only in the folder (e.g. a finished render). */
export function registerExternal(vpath: string, size: number): void {
  rawFs.mkdirSync(vpath.slice(0, vpath.lastIndexOf("/")) || "/", { recursive: true });
  rawFs.writeFileSync(vpath, "");
  externalSizes.set(vpath, size);
  dirty.delete(vpath);
}

/** The real bytes of a virtual file: from the folder when external, else memory. */
export async function readExternal(vpath: string): Promise<Blob> {
  const rel = toFolderPath(vpath);
  if (rel && (externalSizes.has(vpath) || !rawFs.existsSync(vpath))) return folder.readFile(rel);
  const buf = rawFs.readFileSync(vpath) as Uint8Array;
  return new Blob([buf as Uint8Array<ArrayBuffer>]);
}

function markDirty(p: unknown): void {
  if (typeof p !== "string") return;
  externalSizes.delete(p);
  dirty.add(p);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flush(), 250);
}

/** Write every changed virtual file back to the folder, in order. */
export function flush(): Promise<void> {
  flushTimer = null;
  const batch = [...dirty];
  dirty.clear();
  flushing = flushing.then(async () => {
    for (const vpath of batch) {
      const rel = toFolderPath(vpath);
      if (!rel) continue;
      let isFile = false;
      try {
        isFile = rawFs.statSync(vpath).isFile();
      } catch {
        isFile = false;
      }
      try {
        if (isFile) await folder.writeFile(rel, rawFs.readFileSync(vpath) as Uint8Array<ArrayBuffer>);
        else if (!rawFs.existsSync(vpath)) await folder.removeFile(rel);
      } catch (err) {
        console.error(`[vfs] could not write ${rel} to the folder:`, err);
      }
    }
  });
  return flushing;
}

export function hasPendingWrites(): boolean {
  return dirty.size > 0 || flushTimer !== null;
}

/** Load the folder into the volume. Run once after the folder is granted. */
export async function mountFolder(): Promise<void> {
  vol.reset();
  externalSizes.clear();
  rawFs.mkdirSync(WS, { recursive: true });
  for (const dir of ["notouch!", "videos", "music", ".weatherv1/runtime", "outputs"]) {
    rawFs.mkdirSync(toVirtualPath(dir), { recursive: true });
  }
  const entries = await folder.list("", true, SKIP_DIRS);
  await Promise.all(
    entries.map(async (e) => {
      const vpath = toVirtualPath(e.path);
      if (e.kind === "directory") {
        rawFs.mkdirSync(vpath, { recursive: true });
        return;
      }
      rawFs.mkdirSync(vpath.slice(0, vpath.lastIndexOf("/")), { recursive: true });
      if (isExternalRel(e.path)) {
        rawFs.writeFileSync(vpath, "");
        externalSizes.set(vpath, await folder.fileSize(e.path));
      } else {
        const file = await folder.readFile(e.path);
        rawFs.writeFileSync(vpath, new Uint8Array(await file.arrayBuffer()));
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// The fs the server code sees: memfs plus write tracking and real sizes.
// ---------------------------------------------------------------------------

type AnyFn = (...args: unknown[]) => unknown;

function tracked<T extends AnyFn>(fn: T, dirtyArgs: number[]): T {
  return ((...args: unknown[]) => {
    const out = fn(...args);
    for (const i of dirtyArgs) markDirty(args[i]);
    return out;
  }) as T;
}

function trackedAsync<T extends AnyFn>(fn: T, dirtyArgs: number[]): T {
  return (async (...args: unknown[]) => {
    const out = await fn(...args);
    for (const i of dirtyArgs) markDirty(args[i]);
    return out;
  }) as unknown as T;
}

function withRealSize<T extends AnyFn>(fn: T): T {
  return ((...args: unknown[]) => {
    const st = fn(...args) as { size: number } | undefined;
    const size = typeof args[0] === "string" ? externalSizes.get(args[0]) : undefined;
    if (st && size !== undefined) Object.defineProperty(st, "size", { value: size });
    return st;
  }) as T;
}

const f = rawFs as unknown as Record<string, AnyFn> & { promises: Record<string, AnyFn> };
const p = f.promises;

export const webFs = {
  ...rawFs,
  existsSync: f.existsSync,
  readFileSync: f.readFileSync,
  readdirSync: f.readdirSync,
  mkdirSync: f.mkdirSync,
  statSync: withRealSize(f.statSync),
  lstatSync: withRealSize(f.lstatSync),
  writeFileSync: tracked(f.writeFileSync, [0]),
  appendFileSync: tracked(f.appendFileSync, [0]),
  renameSync: tracked(f.renameSync, [0, 1]),
  unlinkSync: tracked(f.unlinkSync, [0]),
  rmSync: tracked(f.rmSync, [0]),
  copyFileSync: tracked(f.copyFileSync, [1]),
  createReadStream: f.createReadStream,
  createWriteStream: (path: string, opts?: unknown) => {
    const ws = f.createWriteStream(path, opts) as { on(ev: string, cb: () => void): void };
    ws.on("close", () => markDirty(path));
    return ws;
  },
  promises: {
    ...p,
    stat: async (path: string) => withRealSize(f.statSync)(path),
    writeFile: trackedAsync(p.writeFile, [0]),
    appendFile: trackedAsync(p.appendFile, [0]),
    rename: trackedAsync(p.rename, [0, 1]),
    unlink: trackedAsync(p.unlink, [0]),
    rm: trackedAsync(p.rm, [0]),
    copyFile: trackedAsync(p.copyFile, [1]),
  },
} as unknown as typeof import("node:fs");
