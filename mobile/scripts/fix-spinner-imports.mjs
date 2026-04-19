// Fix the broken Spinner imports that the earlier codemod inserted in
// the middle of a multi-line `import { ... }` block.
//
// Bug pattern:
//   import {
//   import { Spinner } from "...";
//     View, Text, ...
//   } from "react-native";
//
// Fix:
//   1. Remove the misplaced Spinner import line.
//   2. Re-insert it AFTER the last closing `} from "...";` line.
//
// Idempotent — safe to run multiple times.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function fixFile(file) {
  let src = fs.readFileSync(file, "utf8");
  if (!/brand\/Spinner/.test(src)) return null;

  const lines = src.split("\n");
  // Find the misplaced Spinner import line.
  let brokenIdx = -1;
  let importLineContent = "";
  for (let i = 0; i < lines.length; i++) {
    if (/^import \{ Spinner \} from/.test(lines[i])) {
      // Check: previous non-empty line ends with an open `{` (no closing
      // `} from "..."` yet on that line) — meaning we're inside a
      // multi-line import.
      let j = i - 1;
      while (j >= 0 && lines[j].trim() === "") j--;
      if (j >= 0 && /import\s*\{\s*$/.test(lines[j])) {
        brokenIdx = i;
        importLineContent = lines[i];
        break;
      }
    }
  }
  if (brokenIdx === -1) return null;

  // Remove the broken line.
  lines.splice(brokenIdx, 1);

  // Find the end of the last top-level import (closing `} from "..."` or
  // single-line `import ...;` line). Scan from top while we're still in
  // the import prelude.
  let lastImportEnd = -1;
  let inMulti = false;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (/^import\s/.test(L)) {
      // If the line opens a `{` without a matching `}`, enter multi-line.
      if (/^import\s*\{\s*$/.test(L) || (/^import\s*\{/.test(L) && !/\}\s*from/.test(L))) {
        inMulti = true;
      } else {
        lastImportEnd = i;
      }
      continue;
    }
    if (inMulti) {
      if (/^\}\s*from\s*["']/.test(L.trim()) || /\}\s*from\s*["']/.test(L)) {
        lastImportEnd = i;
        inMulti = false;
      }
      continue;
    }
    // First non-import, non-comment, non-empty line → stop scanning.
    if (L.trim() !== "" && !L.trim().startsWith("//") && !L.trim().startsWith("/*")) break;
  }
  if (lastImportEnd === -1) {
    lines.splice(0, 0, importLineContent);
  } else {
    lines.splice(lastImportEnd + 1, 0, importLineContent);
  }

  fs.writeFileSync(file, lines.join("\n"));
  return file;
}

function main() {
  const files = walk(path.join(ROOT, "app")).concat(walk(path.join(ROOT, "src")));
  const touched = [];
  for (const f of files) {
    const r = fixFile(f);
    if (r) touched.push(path.relative(ROOT, r));
  }
  console.log(`Fixed ${touched.length} files:`);
  touched.forEach((f) => console.log(`  ✓ ${f}`));
}

main();
