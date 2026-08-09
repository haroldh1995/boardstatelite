/// <reference types="node" />

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const portableRoots = [
  "athena",
  "domain",
  "echo",
  "gameModes",
  "hub",
  "multiplayer",
  "rulesAdapter",
  "rulesResult",
  "services",
  "sharedSession",
  "state",
  "utils",
];

const blockedRuntimeReferences: Array<{ label: string; pattern: RegExp }> = [
  { label: "document", pattern: /\bdocument\b/ },
  { label: "navigator", pattern: /\bnavigator\b/ },
  { label: "browser storage", pattern: /\b(?:localStorage|sessionStorage)\b/ },
  { label: "browser fetch", pattern: /\bfetch\s*\(/ },
  { label: "DOM element type", pattern: /\bHTML[A-Za-z]*Element\b/ },
  {
    label: "DOM event type",
    pattern: /\b(?:Keyboard|Mouse|Pointer|Touch)Event\b/,
  },
  {
    label: "web audio",
    pattern: /\b(?:AudioContext|webkitAudioContext|getUserMedia)\b/,
  },
  { label: "IndexedDB adapter", pattern: /\bDexie\b|from\s+["']dexie["']/ },
  { label: "wall clock", pattern: /\bDate\.now\s*\(/ },
  { label: "random source", pattern: /\b(?:crypto|Math\.random\s*\()\b/ },
  { label: "performance clock", pattern: /\bperformance\.now\s*\(/ },
  { label: "global performance", pattern: /\bglobalThis\.performance\b/ },
  {
    label: "timers",
    pattern: /\b(?:setTimeout|clearTimeout|setInterval|clearInterval)\s*\(/,
  },
];

describe("BoardState Lite platform boundaries", () => {
  it("keeps portable gameplay logic free of direct web runtime dependencies", () => {
    const violations = portableRoots.flatMap((root) =>
      collectSourceFiles(join(sourceRoot, root)).flatMap((file) =>
        violationsForFile(file),
      ),
    );

    expect(violations).toEqual([]);
  });
});

function collectSourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) return collectSourceFiles(path);
    if (!/\.(?:ts|tsx)$/.test(entry)) return [];
    if (/\.test\.(?:ts|tsx)$/.test(entry)) return [];
    return [path];
  });
}

function violationsForFile(file: string): string[] {
  const content = readFileSync(file, "utf8");
  const relativeFile = relative(sourceRoot, file).replace(/\\/g, "/");
  return blockedRuntimeReferences.flatMap(({ label, pattern }) =>
    pattern.test(content) ? [`${relativeFile}: direct ${label} reference`] : [],
  );
}
