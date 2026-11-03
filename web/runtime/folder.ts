// The catalog folder the editor picked (`weather/`), through the File System
// Access API. Everything the app keeps on disk lives under it:
//   notouch!/catalog.json   the catalog (app-written only)
//   videos/  music/         the footage and the music bed (read)
//   outputs/                finished renders
//   .weatherv1/             jobs, plan bundles, uploads, caches, the model
//
// The handle persists in IndexedDB; Chrome asks once per session to re-allow
// it, which needs a click (`ensurePermission` is called from a button).

import { idbGet, idbSet } from "./idb";

const HANDLE_KEY = "folder-handle";

let root: FileSystemDirectoryHandle | null = null;

export function getRoot(): FileSystemDirectoryHandle {
  if (!root) throw new Error("No catalog folder selected");
  return root;
}

export function hasRoot(): boolean {
  return root !== null;
}

export async function savedHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return idbGet<FileSystemDirectoryHandle>(HANDLE_KEY);
}

export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  const handle = await window.showDirectoryPicker({ id: "weatherv1-catalog", mode: "readwrite" });
  await idbSet(HANDLE_KEY, handle);
  return handle;
}

/** Ask for readwrite access (must run inside a click). True when granted. */
export async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: "readwrite" } as const;
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

/** Mount a granted handle (the picker, the saved handle, or a test folder). */
export function setRoot(handle: FileSystemDirectoryHandle): void {
  root = handle;
}

function parts(rel: string): string[] {
  return rel.split("/").filter((p) => p && p !== ".");
}

async function dirHandle(rel: string, create: boolean): Promise<FileSystemDirectoryHandle> {
  let dir = getRoot();
  for (const p of parts(rel)) dir = await dir.getDirectoryHandle(p, { create });
  return dir;
}

async function fileHandle(rel: string, create: boolean): Promise<FileSystemFileHandle> {
  const ps = parts(rel);
  const name = ps.pop();
  if (!name) throw new Error(`bad path: ${rel}`);
  const dir = await dirHandle(ps.join("/"), create);
  return dir.getFileHandle(name, { create });
}

export async function readFile(rel: string): Promise<File> {
  return (await fileHandle(rel, false)).getFile();
}

/** Size of a file without reading it (a real handle's getFile() is lazy). */
export async function fileSize(rel: string): Promise<number> {
  const h = (await fileHandle(rel, false)) as FileSystemFileHandle & { size?: () => number };
  return typeof h.size === "function" ? h.size() : (await h.getFile()).size;
}

export async function exists(rel: string): Promise<boolean> {
  try {
    await fileHandle(rel, false);
    return true;
  } catch {
    return false;
  }
}

export async function writeFile(rel: string, data: Blob | BufferSource | string): Promise<void> {
  const w = await (await fileHandle(rel, true)).createWritable();
  await w.write(data);
  await w.close();
}

/** A writable stream into `rel` (for renders: never held whole in memory). */
export async function openWritable(rel: string): Promise<FileSystemWritableFileStream> {
  return (await fileHandle(rel, true)).createWritable();
}

export async function removeFile(rel: string): Promise<void> {
  const ps = parts(rel);
  const name = ps.pop();
  if (!name) return;
  try {
    const dir = await dirHandle(ps.join("/"), false);
    await dir.removeEntry(name, { recursive: true });
  } catch {
    // already gone
  }
}

export interface FolderEntry {
  path: string;
  kind: "file" | "directory";
}

/** List `rel` (recursively when asked), skipping any directory in `skip`. */
export async function list(rel: string, recursive: boolean, skip: Set<string> = new Set()): Promise<FolderEntry[]> {
  const out: FolderEntry[] = [];
  let start: FileSystemDirectoryHandle;
  try {
    start = await dirHandle(rel, false);
  } catch {
    return out;
  }
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
    for await (const [name, h] of dir.entries()) {
      const p = prefix ? `${prefix}/${name}` : name;
      if (h.kind === "directory") {
        if (skip.has(p)) continue;
        out.push({ path: p, kind: "directory" });
        if (recursive) await walk(h as FileSystemDirectoryHandle, p);
      } else {
        out.push({ path: p, kind: "file" });
      }
    }
  };
  await walk(start, parts(rel).join("/"));
  return out;
}
