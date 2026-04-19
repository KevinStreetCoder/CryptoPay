// Rasterize the Cpay Coin-C logo SVG into every PNG Expo expects.
// Run: node scripts/rasterize-icons.mjs
//
// Targets:
//   assets/icon.png                   1024×1024 (main app icon, used by iOS + Android fallback)
//   assets/favicon.png                  48×48   (web favicon)
//   assets/android-icon-foreground.png 1024×1024 (Android adaptive icon foreground — padded for safe zone)
//   assets/android-icon-monochrome.png 1024×1024 (Android 13+ themed icon — white on transparent)
//   assets/android-icon-background.png 1024×1024 (Android adaptive icon background — solid ink)
//   assets/splash-icon.png              800×800  (splash screen mark)
//
// The mark itself is already in an SVG string below so we don't touch the
// master on disk — keeps it single-source-of-truth for humans editing.

import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(__dirname, "..", "assets");

// Brand palette (kept in sync with mobile/src/constants/theme.ts).
const EMERALD = "#10B981";
const INK = "#0B1220";

// Master SVG — same as assets/logo-coinc.svg but parameterized so we can
// swap fg/bg per target without shelling out to XML edit.
function coinC({ fg = EMERALD, bg = "transparent", padScale = 1, corner = 0 } = {}) {
  // padScale < 1 shrinks the mark toward the center so adaptive icons
  // don't clip when Android crops to a circle. 0.68 = 66% of the canvas
  // (matches Google's adaptive-icon safe zone guidance).
  const s = 200; // viewBox
  const inset = (s - s * padScale) / 2;
  const mark = s * padScale;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
  ${
    bg !== "transparent"
      ? `<rect x="0" y="0" width="${s}" height="${s}" ${
          corner ? `rx="${corner}"` : ""
        } fill="${bg}"/>`
      : ""
  }
  <g transform="translate(${inset}, ${inset}) scale(${padScale})">
    <circle cx="100" cy="100" r="72" fill="none" stroke="${fg}" stroke-width="22"
            stroke-linecap="round" stroke-dasharray="380 500"
            transform="rotate(-135 100 100)"/>
    <rect x="100" y="92" width="46" height="16" rx="3" fill="${fg}"/>
  </g>
</svg>`;
}

async function render(svg, outPath, size) {
  const buf = Buffer.from(svg);
  await sharp(buf, { density: 384 }) // 384 dpi → crisp at any output size
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outPath);
  const { size: bytes } = fs.statSync(outPath);
  console.log(`  ✓ ${path.relative(path.resolve(__dirname, ".."), outPath)}  (${size}×${size}, ${(bytes / 1024).toFixed(1)} KB)`);
}

async function main() {
  console.log("Rasterizing Cpay Coin-C logo to all required PNG targets...");

  // 1. Main icon (iOS + Android legacy). Emerald on paper bg (same as splash).
  //    iOS displays this inside a rounded rect; we provide a solid paper
  //    background so it reads crisp on any home-screen wallpaper.
  await render(
    coinC({ fg: EMERALD, bg: "#FFFFFF" }),
    path.join(ASSETS, "icon.png"),
    1024,
  );

  // 2. Web favicon. Emerald on paper.
  await render(
    coinC({ fg: EMERALD, bg: "#FFFFFF" }),
    path.join(ASSETS, "favicon.png"),
    48,
  );

  // 3. Android adaptive foreground. Mark only, at 66% scale so Android's
  //    circular/square/squircle mask can't clip it. Transparent bg.
  await render(
    coinC({ fg: EMERALD, bg: "transparent", padScale: 0.66 }),
    path.join(ASSETS, "android-icon-foreground.png"),
    1024,
  );

  // 4. Android adaptive background. Solid ink — provides contrast for the
  //    emerald mark.
  await render(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
       <rect x="0" y="0" width="200" height="200" fill="${INK}"/>
     </svg>`,
    path.join(ASSETS, "android-icon-background.png"),
    1024,
  );

  // 5. Android 13+ themed monochrome. White on transparent — Android
  //    tints it to match the user's wallpaper.
  await render(
    coinC({ fg: "#FFFFFF", bg: "transparent", padScale: 0.66 }),
    path.join(ASSETS, "android-icon-monochrome.png"),
    1024,
  );

  // 6. Splash. Same paper bg as main icon for visual consistency.
  await render(
    coinC({ fg: EMERALD, bg: "#FFFFFF" }),
    path.join(ASSETS, "splash-icon.png"),
    800,
  );

  // 7. In-app brand mark — emerald on transparent. Used for the navbar
  //    logo, auth-gate header, testimonial chrome, etc., where the
  //    surrounding dark theme provides the background. Paper-bg would
  //    read as a boxy white tile in those contexts.
  await render(
    coinC({ fg: EMERALD, bg: "transparent" }),
    path.join(ASSETS, "brand-mark.png"),
    512,
  );

  console.log("\nDone. Commit with:");
  console.log("  git add mobile/assets/icon.png mobile/assets/favicon.png \\");
  console.log("          mobile/assets/android-icon-{foreground,background,monochrome}.png \\");
  console.log("          mobile/assets/splash-icon.png");
}

main().catch((e) => {
  console.error("Rasterize failed:", e);
  process.exit(1);
});
