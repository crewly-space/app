import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// Keep local tool worktrees out of the product suite. Vitest's default glob
// descends into hidden directories, which made an unrelated `.claude` checkout
// run a second, stale copy of tests during the release gate.
export default mergeConfig(viteConfig, defineConfig({
  test: {
    include: ["test/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}"]
  }
}));
