#!/usr/bin/env node
/**
 * Post-export · inject SEO + Open Graph + Twitter Card meta into the
 * Expo web bundle's index.html.
 *
 * Why this exists · Expo Router's `app/+html.tsx` static-render hook
 * requires `web.output: "static"` in app.json, which switches every
 * route to per-page pre-render and risks breaking auth-flow routes
 * that read client-side state. Keeping SPA mode (`output: "single"`,
 * default) means we have ONE index.html · this script patches it
 * directly with the meta tags so crawlers + chat-app preview bots
 * (Twitter, WhatsApp, Slack, iMessage, LinkedIn, Facebook) render
 * the right card when our links are pasted.
 *
 * Run after `expo export --platform web --output-dir dist` ·
 * idempotent (re-running on an already-injected file is a no-op).
 */
const fs = require("fs");
const path = require("path");

const DIST = path.resolve(__dirname, "..", "dist");
const INDEX = path.join(DIST, "index.html");

if (!fs.existsSync(INDEX)) {
  console.error(`[inject-seo] index.html not found at ${INDEX}`);
  process.exit(1);
}

const SITE_URL = "https://cpay.co.ke";
const SITE_NAME = "Cpay";
const TITLE = "Cpay · Pay Any Bill in Kenya with Crypto";
const DESCRIPTION =
  "Pay any Kenyan Paybill, Buy Goods Till, or send M-Pesa directly from your USDT, USDC, BTC, ETH or SOL. " +
  "Live KES rates, instant settlement via licensed payment partners. " +
  "Operating under Kenya VASP Act 2025.";
const OG_IMAGE = `${SITE_URL}/og-image.png`;
const TWITTER_HANDLE = "@cpaykenya";
const THEME_COLOR = "#10B981";

const META_TAGS = `
    <!-- 2026-05-09 · injected by scripts/inject-seo.js after expo export -->
    <meta name="description" content="${DESCRIPTION}" />
    <meta name="keywords" content="cpay, cryptocurrency, m-pesa, kenya, paybill, buygoods, USDT, USDC, BTC, ETH, SOL, crypto payments, fintech, vasp" />
    <meta name="robots" content="index,follow,max-image-preview:large" />
    <meta name="theme-color" content="${THEME_COLOR}" />
    <link rel="canonical" href="${SITE_URL}" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

    <!-- Open Graph (Facebook, WhatsApp, Slack, LinkedIn, iMessage) -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:url" content="${SITE_URL}" />
    <meta property="og:title" content="${TITLE}" />
    <meta property="og:description" content="${DESCRIPTION}" />
    <meta property="og:image" content="${OG_IMAGE}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="Cpay · pay bills in Kenya from your crypto" />
    <meta property="og:locale" content="en_KE" />

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="${TWITTER_HANDLE}" />
    <meta name="twitter:creator" content="${TWITTER_HANDLE}" />
    <meta name="twitter:title" content="${TITLE}" />
    <meta name="twitter:description" content="${DESCRIPTION}" />
    <meta name="twitter:image" content="${OG_IMAGE}" />
    <meta name="twitter:image:alt" content="Cpay · pay bills in Kenya from your crypto" />

    <!-- Schema.org Organization JSON-LD · gives Google rich-results eligibility -->
    <script type="application/ld+json">
${JSON.stringify(
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Cpay Technologies",
    alternateName: "Cpay",
    url: SITE_URL,
    logo: `${SITE_URL}/logo-512.png`,
    description: DESCRIPTION,
    sameAs: ["https://app.cpay.co.ke"],
    address: {
      "@type": "PostalAddress",
      addressLocality: "Nairobi",
      addressCountry: "KE",
    },
    contactPoint: {
      "@type": "ContactPoint",
      email: "support@cpay.co.ke",
      contactType: "customer support",
      areaServed: "KE",
      availableLanguage: ["en", "sw"],
    },
  },
  null,
  2,
)}
    </script>
`;

let html = fs.readFileSync(INDEX, "utf8");

// Idempotency · skip if already injected (look for our marker comment).
if (html.includes("injected by scripts/inject-seo.js")) {
  console.log("[inject-seo] tags already present · skipping");
  process.exit(0);
}

// Replace the bare `<title>Cpay</title>` with the real title + inject
// the meta block BEFORE </head>.
html = html.replace(
  /<title>[^<]*<\/title>/,
  `<title>${TITLE}</title>`,
);
html = html.replace(/<\/head>/, `${META_TAGS}\n  </head>`);

// Also paint <html> + <body> + #root with the brand dark · belt-and-
// braces with the runtime DOM override in app/_layout.tsx, this kills
// the white flash on first paint before JS loads.
html = html.replace(
  /<style id="expo-reset">[\s\S]*?<\/style>/,
  `<style id="expo-reset">
      html, body {
        height: 100%;
        background-color: #060E1F;
        margin: 0;
        padding: 0;
      }
      body {
        overflow: hidden;
      }
      #root {
        display: flex;
        height: 100%;
        flex: 1;
        background-color: #060E1F;
      }
    </style>`,
);

fs.writeFileSync(INDEX, html, "utf8");
console.log(`[inject-seo] wrote ${html.length} bytes to ${INDEX}`);
console.log(`[inject-seo] title: ${TITLE}`);
console.log(`[inject-seo] og:image: ${OG_IMAGE}`);
console.log(`[inject-seo] og:url: ${SITE_URL}`);
