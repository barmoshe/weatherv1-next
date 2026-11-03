// `node:crypto` for the browser build: the few calls the server code makes.
import { sha1 } from "@noble/hashes/legacy";
import { sha256 } from "@noble/hashes/sha2";
import { Buffer } from "buffer";

type Algo = "sha1" | "sha256";

export function createHash(algo: Algo) {
  const chunks: Uint8Array[] = [];
  const api = {
    update(data: string | Uint8Array) {
      chunks.push(typeof data === "string" ? new TextEncoder().encode(data) : data);
      return api;
    },
    digest(enc?: "hex") {
      const all = Buffer.concat(chunks);
      const out = Buffer.from(algo === "sha1" ? sha1(all) : sha256(all));
      return enc === "hex" ? out.toString("hex") : out;
    },
  };
  return api;
}

export function randomBytes(n: number): Buffer {
  return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n)));
}

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export default { createHash, randomBytes, randomUUID, timingSafeEqual };
