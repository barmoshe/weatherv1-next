// `archiver` for the browser build: the slice the Premiere export uses —
// archiver("zip", { store: true }), .append(data, { name }), .finalize(), and
// a Node-style readable (on "data"/"end"/"error"/"close") the route turns into
// a web stream. Built on fflate's streaming Zip with stored (uncompressed)
// entries. Appended memfs read streams of library media (placeholders) are
// read from the folder instead.

import { Zip, ZipPassThrough } from "fflate";
import { isExternal, readExternal } from "../runtime/vfs";

type Listener = (arg?: unknown) => void;
type Entry = { name: string; data: string | Uint8Array | { path?: string } };

export default function archiver(_format: "zip", _opts?: { store?: boolean }) {
  const listeners = new Map<string, Listener[]>();
  const entries: Entry[] = [];
  const emit = (ev: string, arg?: unknown) => (listeners.get(ev) ?? []).forEach((fn) => fn(arg));

  async function bytesOf(data: Entry["data"]): Promise<Uint8Array> {
    if (typeof data === "string") return new TextEncoder().encode(data);
    if (data instanceof Uint8Array) return data;
    const path = typeof data.path === "string" ? data.path : null;
    if (!path) throw new Error("archiver shim: unsupported entry");
    if (isExternal(path)) return new Uint8Array(await (await readExternal(path)).arrayBuffer());
    const fs = (await import("../runtime/vfs")).webFs;
    return fs.readFileSync(path) as Uint8Array;
  }

  return {
    on(ev: string, fn: Listener) {
      listeners.set(ev, [...(listeners.get(ev) ?? []), fn]);
      return this;
    },
    append(data: Entry["data"], opts: { name: string }) {
      entries.push({ name: opts.name, data });
      return this;
    },
    async finalize() {
      try {
        const zip = new Zip((err, chunk, final) => {
          if (err) return emit("error", err);
          if (chunk.length) emit("data", chunk);
          if (final) {
            emit("end");
            emit("close");
          }
        });
        for (const e of entries) {
          const file = new ZipPassThrough(e.name);
          zip.add(file);
          file.push(await bytesOf(e.data), true);
        }
        zip.end();
      } catch (err) {
        emit("error", err);
      }
    },
  };
}
