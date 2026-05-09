#!/usr/bin/env node
/**
 * Generate the 1200×630 Open Graph card for cpay.co.ke.
 *
 * Why · Twitter, WhatsApp, Slack, iMessage, etc. all expect a
 * 1200×630 image at the og:image URL. Anything else gets cropped or
 * downscaled and looks unprofessional. We compose the existing
 * brand-wordmark-light.png onto a brand-dark canvas with a subtle
 * emerald accent · written once, output committed under public/ so
 * the static export bundles it 1:1 into dist/.
 *
 * Run · `node scripts/gen-og-image.js` from mobile/
 * Output · mobile/public/og-image.png (1200×630 PNG)
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const W = 1200;
const H = 630;
const BG = "#060E1F"; // brand dark (matches splash + html bg)
const ACCENT = "#10B981"; // emerald-500
const ACCENT_SOFT = "#34D399"; // emerald-400

const OUT_DIR = path.resolve(__dirname, "..", "public");
const OUT = path.join(OUT_DIR, "og-image.png");
const WORDMARK = path.resolve(
  __dirname,
  "..",
  "assets",
  "brand-wordmark-light.png",
);

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  // Wordmark · resize to 600×150 (preserves the 4:1 aspect of the source).
  const wordmark = await sharp(WORDMARK)
    .resize({ width: 600, height: 150, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  // Tagline + accent strip + footer URL drawn as SVG · sharp composites
  // SVG into the raster canvas so we keep text crisp at any density.
  const overlay = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.18"/>
          <stop offset="60%" stop-color="${ACCENT}" stop-opacity="0.0"/>
        </linearGradient>
        <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${ACCENT}"/>
          <stop offset="100%" stop-color="${ACCENT_SOFT}"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${W}" height="${H}" fill="url(#glow)"/>
      <rect x="0" y="0" width="8" height="${H}" fill="url(#bar)"/>
      <text x="600" y="400" font-family="Inter, 'DM Sans', system-ui, sans-serif"
        font-size="44" font-weight="600" fill="#E2E8F0" text-anchor="middle">
        Pay Any Bill in Kenya with Crypto
      </text>
      <text x="600" y="460" font-family="Inter, 'DM Sans', system-ui, sans-serif"
        font-size="26" font-weight="400" fill="#94A3B8" text-anchor="middle">
        USDT · USDC · BTC · ETH · SOL  →  M-Pesa, Paybill, Buy Goods
      </text>
      <text x="600" y="560" font-family="Inter, 'DM Sans', system-ui, sans-serif"
        font-size="22" font-weight="500" fill="${ACCENT_SOFT}" text-anchor="middle">
        cpay.co.ke
      </text>
    </svg>`,
  );

  await sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: BG,
    },
  })
    .composite([
      { input: overlay, top: 0, left: 0 },
      { input: wordmark, top: 200, left: Math.round((W - 600) / 2) },
    ])
    .png()
    .toFile(OUT);

  const { size } = fs.statSync(OUT);
  console.log(`[og-image] wrote ${OUT} (${(size / 1024).toFixed(1)} KB, ${W}×${H})`);
})().catch((err) => {
  console.error(`[og-image] failed: ${err.message}`);
  process.exit(1);
});
