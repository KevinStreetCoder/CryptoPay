// Bulk-export every asset from the design canvas via headless Chrome.
//
// Renders C:/…/Cpay-handoff-resources/cpay/project/Cpay Landing Assets.html
// against a local http-server, walks every <AssetCard>, triggers its
// SVG + PNG 2× download handlers, and saves to mobile/assets/brand/.
//
// Run: node scripts/extract-brand-assets.mjs
// Requires: puppeteer (auto-installed first run — Chromium ~170MB).
//
// Idempotent. Re-run after the designer ships a new handoff.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ROOT, "..");
const DESIGN_DIR = path.join(
  REPO_ROOT,
  "Cpay-handoff-resources",
  "cpay",
  "project",
);
const OUT_DIR = path.join(ROOT, "assets", "brand");

fs.mkdirSync(OUT_DIR, { recursive: true });

async function ensurePuppeteer() {
  // Puppeteer ships CJS. ESM `import "puppeteer"` fails on its legacy
  // `main` resolution — fall back to resolving the installed package's
  // index path, then `createRequire` to load it synchronously.
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const tryLoad = () => {
    try {
      return require("puppeteer");
    } catch {
      return null;
    }
  };
  let mod = tryLoad();
  if (!mod) {
    console.log("Installing puppeteer (one-time, ~170 MB)...");
    await new Promise((resolve, reject) => {
      const p = spawn("npm", ["install", "--no-save", "puppeteer"], {
        cwd: ROOT,
        stdio: "inherit",
        shell: true,
      });
      p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`npm exit ${code}`))));
    });
    mod = tryLoad();
  }
  if (!mod) throw new Error("Failed to load puppeteer after install.");
  return mod.default || mod;
}

async function startServer() {
  // Tiny inline static file server — no external dependency on http-server.
  const http = await import("node:http");
  const mime = {
    ".html": "text/html",
    ".jsx": "text/babel",
    ".js": "application/javascript",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".json": "application/json",
  };
  const server = http.createServer((req, res) => {
    try {
      const u = decodeURIComponent((req.url || "/").split("?")[0]);
      const p = path.normalize(path.join(DESIGN_DIR, u === "/" ? "/Cpay Landing Assets.html" : u));
      if (!p.startsWith(DESIGN_DIR)) return res.writeHead(403).end();
      const st = fs.statSync(p);
      if (st.isDirectory()) return res.writeHead(404).end();
      const ext = path.extname(p).toLowerCase();
      res.writeHead(200, { "content-type": mime[ext] || "application/octet-stream" });
      fs.createReadStream(p).pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(8183, "127.0.0.1", resolve));
  return { kill: () => server.close() };
}

async function main() {
  const puppeteer = await ensurePuppeteer();
  const server = await startServer();
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 2 });

    // Intercept downloads by hijacking <a>.click() + URL.createObjectURL.
    // Easier: capture the Blob's bytes by overriding click + reading href.
    const client = await page.target().createCDPSession();
    await client.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: OUT_DIR,
    });

    console.log("Loading design canvas...");
    await page.goto("http://127.0.0.1:8183/Cpay Landing Assets.html", {
      waitUntil: "networkidle2",
      timeout: 60_000,
    });

    // Design uses Babel standalone — give JSX a moment to compile + mount.
    await page.waitForFunction(
      () => document.querySelectorAll("button.dl-btn").length > 4,
      { timeout: 30_000 },
    );
    await new Promise((r) => setTimeout(r, 1500));

    // Click every button. Each fires a blob download that Chrome writes
    // to OUT_DIR via the CDP setDownloadBehavior above.
    const buttons = await page.$$eval("button.dl-btn", (btns) =>
      btns.map((b, i) => ({ i, label: b.textContent.trim() })),
    );
    console.log(`Found ${buttons.length} download buttons. Exporting...`);

    for (let i = 0; i < buttons.length; i++) {
      const info = buttons[i];
      try {
        await page.evaluate((idx) => {
          const btn = document.querySelectorAll("button.dl-btn")[idx];
          btn.click();
        }, i);
        await new Promise((r) => setTimeout(r, 250)); // gap between downloads
      } catch (e) {
        console.warn(`  ⚠ button ${i} (${info.label}): ${e.message}`);
      }
    }

    // Give the last few downloads time to flush to disk.
    await new Promise((r) => setTimeout(r, 4000));

    const files = fs.readdirSync(OUT_DIR).sort();
    console.log(`\nExported ${files.length} files to ${path.relative(REPO_ROOT, OUT_DIR)}/:`);
    files.forEach((f) => {
      const size = fs.statSync(path.join(OUT_DIR, f)).size;
      console.log(`  ✓ ${f}  (${(size / 1024).toFixed(1)} KB)`);
    });
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((e) => {
  console.error("Extract failed:", e);
  process.exit(1);
});
