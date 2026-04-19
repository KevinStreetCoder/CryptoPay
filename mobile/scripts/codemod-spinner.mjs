// Codemod: ActivityIndicator → <Spinner /> across the mobile app.
//
// Design contract (from brand brief):
//   - ActivityIndicator size="small"  → <Spinner size={16} />     (arc)
//   - ActivityIndicator size="large"  → <Spinner size={32} />     (arc)
//   - ActivityIndicator (no size)     → <Spinner size={20} />     (arc)
//   - preserves the color prop verbatim
//
// Also:
//   - Adds `import { Spinner } from "<relative>/src/components/brand/Spinner"`
//     if the file doesn't already import it.
//   - Leaves the `ActivityIndicator` symbol in the react-native import
//     statement alone. A follow-up ts-eslint run can remove the unused
//     import — doing it here risks breaking multi-line import blocks
//     with edge cases.
//
// Idempotent. Run: node scripts/codemod-spinner.mjs

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

function relativeImportFrom(fromFile) {
  const to = path.join(ROOT, "src", "components", "brand", "Spinner");
  let rel = path.relative(path.dirname(fromFile), to).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

function addSpinnerImport(src, fromFile) {
  if (/from ["'].*brand\/Spinner["']/.test(src)) return src;
  const importLine = `import { Spinner } from "${relativeImportFrom(fromFile)}";`;
  // Insert after the last top-level import line.
  const lines = src.split("\n");
  let lastImport = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\s/.test(lines[i])) lastImport = i;
    if (!/^\s*import\s/.test(lines[i]) && lastImport !== -1 && lines[i].trim() !== "" && !lines[i].startsWith("//")) break;
  }
  if (lastImport === -1) return importLine + "\n" + src;
  lines.splice(lastImport + 1, 0, importLine);
  return lines.join("\n");
}

function replaceActivityIndicator(src) {
  // Generic handler: match the whole JSX tag (including multi-line + any
  // attribute order), parse its attributes, emit a <Spinner> with the
  // mapped size + preserved color/style.
  return src.replace(
    /<ActivityIndicator\b([^>]*?)\s*\/>/gs,
    (match, attrsRaw) => {
      // Extract attrs we care about. Leave everything else alone.
      const attrs = attrsRaw || "";
      const sizeAttr = attrs.match(/size=(?:"(small|large)"|'(small|large)'|\{(\d+)\})/);
      let size = 20; // default
      if (sizeAttr) {
        if (sizeAttr[1] === "small" || sizeAttr[2] === "small") size = 16;
        else if (sizeAttr[1] === "large" || sizeAttr[2] === "large") size = 32;
        else if (sizeAttr[3]) size = parseInt(sizeAttr[3], 10);
      }
      const colorMatch = attrs.match(/color=(\{[^}]+\}|"[^"]+"|'[^']+')/);
      // style is almost always `style={{ ... }}` — match the outer braces
      // by balancing. Greedy-lazy `\{\{[\s\S]*?\}\}` gets the whole inner
      // object correctly even when the inner has commas / spaces.
      const styleMatch = attrs.match(/style=(\{\{[\s\S]*?\}\}|\{[^}]+\}|"[^"]+")/);
      const parts = [`size={${size}}`];
      if (colorMatch) parts.push(`color=${colorMatch[1]}`);
      if (styleMatch) parts.push(`style=${styleMatch[1]}`);
      return `<Spinner ${parts.join(" ")} />`;
    },
  );
}

function processFile(file) {
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes("ActivityIndicator")) return null;
  if (!/<ActivityIndicator/.test(src)) return null; // Import-only, skip.
  let out = replaceActivityIndicator(src);
  if (out === src) return null; // No JSX matches — bail, don't add import.
  out = addSpinnerImport(out, file);
  fs.writeFileSync(file, out);
  return file;
}

function main() {
  const files = walk(path.join(ROOT, "app")).concat(walk(path.join(ROOT, "src")));
  // Don't rewrite the Spinner itself.
  const filtered = files.filter((f) => !f.includes(path.join("brand", "Spinner")));
  const touched = [];
  for (const f of filtered) {
    const r = processFile(f);
    if (r) touched.push(path.relative(ROOT, r));
  }
  console.log(`Touched ${touched.length} files:`);
  touched.forEach((f) => console.log(`  ✓ ${f}`));
}

main();
