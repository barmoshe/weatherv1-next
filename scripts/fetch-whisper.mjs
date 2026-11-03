#!/usr/bin/env node
// Puts a pinned `whisper-cli` (whisper.cpp) into resources/whisper/, which
// forge ships as an extraResource (outside asar, next to bg-music). The local
// transcription provider finds it through WEATHER_RESOURCES_DIR.
//
//   - Windows: the official CPU build zip from the pinned build release,
//     sha256-checked, trimmed to whisper-cli.exe + the DLLs it loads.
//   - macOS / Linux: built from the same pinned commit with CMake (static,
//     only the whisper-cli target). whisper.cpp ships no macOS CLI binary.
//
// Idempotent: skips when resources/whisper/VERSION already matches the pin.
// Run before `electron-forge package|make`:
//   node scripts/fetch-whisper.mjs
//
// The previous local-Whisper attempt (0c7a3e5) failed in released builds
// because nothing put the binary into the installer. This script is that step.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PIN = {
  // whisper.cpp build release b5454 = v1.9.5 (2026-10-06), MIT.
  tag: "b5454",
  commit: "d1be6fde11ac6e0407606b4e42fe72d34add8037",
  win32: {
    url: "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip",
    sha256: "6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb",
  },
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "resources", "whisper");
const CACHE_DIR = path.join(ROOT, "node_modules", ".cache", "whisper.cpp");
const BINARY = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
const STAMP = `${PIN.tag} ${process.platform}-${process.arch}\n`;

// whisper-cli.exe loads whisper.dll + ggml.dll, which picks one of the
// ggml-cpu-<isa>.dll backends at runtime. Everything else in the zip
// (server, stream, tests, parakeet, llama.dll, SDL2) is dead weight.
const WIN_KEEP = /^(whisper-cli\.exe|whisper\.dll|ggml(-base|-cpu-[a-z0-9]+)?\.dll)$/i;

function log(msg) {
  console.log(`[fetch-whisper] ${msg}`);
}

function upToDate() {
  try {
    return (
      fs.readFileSync(path.join(OUT_DIR, "VERSION"), "utf8") === STAMP &&
      fs.existsSync(path.join(OUT_DIR, BINARY))
    );
  } catch {
    return false;
  }
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status} ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function fetchWindows() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const zip = path.join(CACHE_DIR, `whisper-${PIN.tag}-win-x64.zip`);
  if (!fs.existsSync(zip) || sha256(zip) !== PIN.win32.sha256) {
    log(`downloading ${PIN.win32.url}`);
    await download(PIN.win32.url, zip);
  }
  const got = sha256(zip);
  if (got !== PIN.win32.sha256) {
    throw new Error(`sha256 mismatch for ${zip}: ${got}`);
  }
  const unpack = fs.mkdtempSync(path.join(os.tmpdir(), "whisper-zip-"));
  // bsdtar reads zip on Windows 10+ and macOS alike.
  execFileSync("tar", ["-xf", zip, "-C", unpack], { stdio: "inherit" });
  const release = path.join(unpack, "Release");
  for (const name of fs.readdirSync(release)) {
    if (WIN_KEEP.test(name)) fs.copyFileSync(path.join(release, name), path.join(OUT_DIR, name));
  }
  fs.rmSync(unpack, { recursive: true, force: true });
}

function buildFromSource() {
  const src = path.join(CACHE_DIR, `src-${PIN.tag}`);
  if (!fs.existsSync(path.join(src, "CMakeLists.txt"))) {
    fs.mkdirSync(src, { recursive: true });
    const git = (...args) => execFileSync("git", args, { cwd: src, stdio: "inherit" });
    git("init", "-q");
    git("fetch", "-q", "--depth", "1", "https://github.com/ggml-org/whisper.cpp.git", PIN.commit);
    git("checkout", "-q", "FETCH_HEAD");
  }
  const build = path.join(src, "build");
  const cmake = (...args) => execFileSync("cmake", args, { cwd: src, stdio: "inherit" });
  log(`building whisper-cli ${PIN.tag} with CMake (a few minutes the first time)`);
  // On macOS, pin Apple's clang: a Homebrew LLVM on PATH links its own
  // libunwind.dylib, which other Macs don't have.
  const compilers =
    process.platform === "darwin"
      ? ["-DCMAKE_C_COMPILER=/usr/bin/clang", "-DCMAKE_CXX_COMPILER=/usr/bin/clang++"]
      : [];
  fs.rmSync(build, { recursive: true, force: true });
  cmake(
    "-B", build,
    ...compilers,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DBUILD_SHARED_LIBS=OFF",
    "-DGGML_NATIVE=OFF",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_SDL2=OFF",
  );
  cmake("--build", build, "--config", "Release", "--target", "whisper-cli", "-j", String(os.cpus().length));
  const bin = path.join(build, "bin", "whisper-cli");
  fs.copyFileSync(bin, path.join(OUT_DIR, BINARY));
  fs.chmodSync(path.join(OUT_DIR, BINARY), 0o755);
}

async function main() {
  if (upToDate()) {
    log(`up to date (${STAMP.trim()})`);
    return;
  }
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (process.platform === "win32") {
    if (process.arch !== "x64") throw new Error(`no pinned whisper.cpp build for win32-${process.arch}`);
    await fetchWindows();
  } else {
    buildFromSource();
  }
  fs.writeFileSync(path.join(OUT_DIR, "VERSION"), STAMP);
  log(`ready: ${path.join(OUT_DIR, BINARY)}`);
}

main().catch((err) => {
  console.error(`[fetch-whisper] ${err.message}`);
  process.exit(1);
});
