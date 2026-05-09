/**
 * Custom HTML wrapper for Expo Router web exports.
 *
 * 2026-05-09 · replaces the default index.html (which was a bare
 * `<title>Cpay</title>` and nothing else) with a proper SEO + social
 * meta stack so links pasted in Twitter / WhatsApp / Slack / iMessage
 * render a real card with our logo, title, and description.
 *
 * What's covered:
 *   - Standard SEO · description, keywords, canonical, robots
 *   - Open Graph · og:title, og:description, og:image, og:url, og:type, og:site_name, og:locale
 *   - Twitter Cards · twitter:card, twitter:title, twitter:description, twitter:image, twitter:site
 *   - Apple touch icon + theme-color for iOS / Android home-screen install
 *   - JSON-LD structured data describing CPAY TECHNOLOGIES as the org
 *
 * Render is static (build-time) so crawlers + chat-app preview bots
 * see the tags without running JavaScript. The OG image must exist at
 * /og-image.png on the served origin (place a 1200×630 PNG in
 * mobile/public/og-image.png · expo bundles `public/` 1:1 to dist).
 */
import { ScrollViewStyleReset } from "expo-router/html";
import { type PropsWithChildren } from "react";

const SITE_URL = "https://cpay.co.ke";
const APP_URL = "https://app.cpay.co.ke";
const SITE_NAME = "Cpay";
const TITLE = "Cpay · Pay Any Bill in Kenya with Crypto";
const DESCRIPTION =
  "Pay any Kenyan Paybill, Buy Goods Till, or send M-Pesa directly from your USDT, USDC, BTC, ETH or SOL. " +
  "Live KES rates, instant settlement via licensed payment partners. " +
  "Operating under Kenya VASP Act 2025.";
const OG_IMAGE = `${SITE_URL}/og-image.png`;
const TWITTER_HANDLE = "@cpaykenya"; // update to the real handle when ready
const THEME_COLOR = "#10B981"; // brand emerald-500

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />

        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <meta
          name="keywords"
          content="cpay, cryptocurrency, m-pesa, kenya, paybill, buygoods, USDT, USDC, BTC, ETH, SOL, crypto payments, fintech, vasp"
        />
        <meta name="robots" content="index,follow,max-image-preview:large" />
        <meta name="theme-color" content={THEME_COLOR} />
        <link rel="canonical" href={SITE_URL} />

        {/* Favicon set */}
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        {/* Open Graph (Facebook, WhatsApp, Slack, LinkedIn, iMessage) */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={SITE_NAME} />
        <meta property="og:url" content={SITE_URL} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:image" content={OG_IMAGE} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="Cpay · pay bills in Kenya from your crypto" />
        <meta property="og:locale" content="en_KE" />

        {/* Twitter Card · `summary_large_image` shows the wide hero */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:site" content={TWITTER_HANDLE} />
        <meta name="twitter:creator" content={TWITTER_HANDLE} />
        <meta name="twitter:title" content={TITLE} />
        <meta name="twitter:description" content={DESCRIPTION} />
        <meta name="twitter:image" content={OG_IMAGE} />
        <meta name="twitter:image:alt" content="Cpay · pay bills in Kenya from your crypto" />

        {/* Schema.org JSON-LD · gives Google rich-results eligibility */}
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Cpay Technologies",
              alternateName: "Cpay",
              url: SITE_URL,
              logo: `${SITE_URL}/logo-512.png`,
              description: DESCRIPTION,
              sameAs: [
                "https://app.cpay.co.ke",
              ],
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
            }),
          }}
        />

        {/* react-native-web's recommended style reset (kept verbatim
            from Expo's default · prevents the body from scrolling and
            sets the root flex shell). */}
        <ScrollViewStyleReset />
        <style
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: `
              html, body { height: 100%; background-color: #060E1F; }
              body { overflow: hidden; }
              #root { display: flex; height: 100%; flex: 1; background-color: #060E1F; }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
