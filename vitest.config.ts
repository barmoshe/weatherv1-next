import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    // `next build` with `output: "standalone"` copies the entire source tree
    // (including `src/test/**`) into `.next/standalone/`. Without this
    // exclude, vitest discovers and runs every test twice.
    //
    // `.claude/worktrees/**` is Claude Code's per-agent worktree directory.
    // Each worktree is a full checkout of the repo (including src/test) so
    // pre-existing worktrees would otherwise re-run every test under their
    // own paths — masking real failures in the host repo.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/.claude/worktrees/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
