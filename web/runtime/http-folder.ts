// Test-only folder: a FileSystemDirectoryHandle look-alike over HTTP, served
// by web/test/folder-server.mjs (GET reads, PUT writes, DELETE removes,
// /__manifest.json lists). The native folder picker needs a real click, so
// end-to-end tests open `index.html?testFolder=http://127.0.0.1:PORT/` and
// the gate mounts this instead. Writes land on the test server's disk, so a
// test can check the rendered MP4 with ffprobe.

interface Manifest {
  files: string[];
  sizes: Record<string, number>;
}

class HttpFile {
  readonly kind = "file";
  constructor(
    private readonly base: string,
    readonly path: string,
    private readonly manifest: Manifest,
  ) {}
  /** Size without downloading (a real handle's getFile() is lazy; HTTP isn't). */
  size(): number {
    return this.manifest.sizes[this.path] ?? 0;
  }
  get name(): string {
    return this.path.split("/").pop() ?? "";
  }
  async getFile(): Promise<File> {
    const res = await fetch(this.base + encodePath(this.path), { cache: "no-store" });
    if (!res.ok) throw new DOMException(`${this.path}: ${res.status}`, "NotFoundError");
    return new File([await res.blob()], this.name);
  }
  async createWritable() {
    const parts: BlobPart[] = [];
    const base = this.base;
    const path = this.path;
    const manifest = this.manifest;
    return {
      async write(data: BlobPart) {
        parts.push(data);
      },
      async close() {
        const res = await fetch(base + encodePath(path), { method: "PUT", body: new Blob(parts) });
        if (!res.ok) throw new Error(`PUT ${path}: ${res.status}`);
        manifest.sizes[path] = new Blob(parts).size;
      },
      async abort() {
        parts.length = 0;
      },
    };
  }
}

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

class HttpDir {
  readonly kind = "directory";
  constructor(
    private readonly base: string,
    readonly path: string,
    private readonly manifest: Manifest,
  ) {}
  get name(): string {
    return this.path.split("/").pop() || "weather";
  }
  async queryPermission(): Promise<PermissionState> {
    return "granted";
  }
  async requestPermission(): Promise<PermissionState> {
    return "granted";
  }
  private child(name: string): string {
    return this.path ? `${this.path}/${name}` : name;
  }
  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<HttpDir> {
    const p = this.child(name);
    const exists = this.manifest.files.some((f) => f.startsWith(`${p}/`));
    if (!exists && !opts?.create) throw new DOMException(p, "NotFoundError");
    return new HttpDir(this.base, p, this.manifest);
  }
  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<HttpFile> {
    const p = this.child(name);
    if (!this.manifest.files.includes(p)) {
      if (!opts?.create) throw new DOMException(p, "NotFoundError");
      this.manifest.files.push(p);
    }
    return new HttpFile(this.base, p, this.manifest);
  }
  async removeEntry(name: string): Promise<void> {
    const p = this.child(name);
    await fetch(this.base + encodePath(p), { method: "DELETE" });
    this.manifest.files = this.manifest.files.filter((f) => f !== p && !f.startsWith(`${p}/`));
  }
  async *entries(): AsyncIterableIterator<[string, HttpDir | HttpFile]> {
    const prefix = this.path ? `${this.path}/` : "";
    const seen = new Set<string>();
    for (const f of this.manifest.files) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      const name = rest.split("/")[0];
      if (seen.has(name)) continue;
      seen.add(name);
      yield rest.includes("/")
        ? [name, new HttpDir(this.base, this.child(name), this.manifest)]
        : [name, new HttpFile(this.base, this.child(name), this.manifest)];
    }
  }
}

export async function httpFolder(base: string): Promise<FileSystemDirectoryHandle> {
  const root = base.endsWith("/") ? base : `${base}/`;
  const manifest = (await (await fetch(`${root}__manifest.json`, { cache: "no-store" })).json()) as Manifest;
  return new HttpDir(root, "", manifest) as unknown as FileSystemDirectoryHandle;
}
