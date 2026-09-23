import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * App.tsx is being taken apart along product boundaries (CRE-66). Features
 * and libraries may be imported by App, never the other way round: one import
 * of App from a feature makes a cycle, and cycles are how a split monolith
 * quietly becomes one again.
 */
const src = fileURLToPath(new URL("../src/", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("module boundaries", () => {
  it("never imports App from a feature or library module", () => {
    const offenders = [...files(join(src, "features")), ...files(join(src, "lib"))]
      .filter((path) => /from\s+["'](?:\.\.\/)+App["']/.test(readFileSync(path, "utf8")))
      .map((path) => relative(src, path));
    expect(offenders).toEqual([]);
  });
});
