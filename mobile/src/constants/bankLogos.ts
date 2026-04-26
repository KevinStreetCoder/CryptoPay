/**
 * Bundled Kenyan-bank logos.
 *
 * 2026-04-26 redesign · we used to point at remote logo CDNs (Clearbit,
 * Google favicon, the bank's own /favicon.ico) at runtime, but Clearbit
 * doesn't have every Kenyan bank in its database, several banks return
 * 16×16 favicons that scale poorly to a 36 px tile, and a couple of
 * domains block hot-link entirely. The result was a picker full of
 * letter placeholders. Per user instruction "Down the companies logo
 * in the asserts and use them not depending on the url", we ship the
 * logos as local assets.
 *
 * For banks where we couldn't get a usable PNG (Clearbit miss + Google
 * returns a 16 px favicon that ImageMagick can't upscale cleanly) we
 * fall back to a coloured-letter tile drawn at runtime · still local,
 * never a broken-image glyph.
 *
 * Refresh process:
 *   1. Run `bash scripts/download-bank-logos.sh` from the repo root.
 *   2. Run `bash scripts/convert-bank-logos.sh` to normalise to PNG.
 *   3. Update the BANK_LOGOS map below if a new slug landed.
 */

import type { ImageSourcePropType } from "react-native";

/**
 * Map of bank slug → bundled logo asset. A slug missing from this map
 * (or one whose asset failed to bundle) is rendered as a coloured-
 * letter tile by `BankTileLogo` using the brand colour from
 * `BANK_BRAND_COLORS` below.
 */
export const BANK_LOGOS: Record<string, ImageSourcePropType> = {
  absa: require("../../assets/logos/banks/absa.png"),
  boa: require("../../assets/logos/banks/boa.png"),
  coop: require("../../assets/logos/banks/coop.png"),
  dtb: require("../../assets/logos/banks/dtb.png"),
  ecobank: require("../../assets/logos/banks/ecobank.png"),
  equity: require("../../assets/logos/banks/equity.png"),
  family: require("../../assets/logos/banks/family.png"),
  gulf: require("../../assets/logos/banks/gulf.png"),
  hfc: require("../../assets/logos/banks/hfc.png"),
  im: require("../../assets/logos/banks/im.png"),
  kcb: require("../../assets/logos/banks/kcb.png"),
  ncba: require("../../assets/logos/banks/ncba.png"),
  sidian: require("../../assets/logos/banks/sidian.png"),
  stanchart: require("../../assets/logos/banks/stanchart.png"),
  // stanbic · all sources we tried (Wikipedia, Commons, Brandfetch,
  // their CDN) returned 404 or HTML for the logo. Falls back to a
  // coloured-letter "S" on Stanbic-navy in `BankTileLogo`.
};

/**
 * Per-bank brand colour for the coloured-letter fallback tile · only
 * used when the slug isn't in BANK_LOGOS. Colours sourced from each
 * bank's official brand book where published, otherwise from a sample
 * of their primary website surface.
 */
export const BANK_BRAND_COLORS: Record<string, string> = {
  equity: "#A6192E",     // Equity Group · scarlet
  kcb: "#15823A",        // KCB · forest green
  coop: "#0B5DA9",       // Co-op Bank · cobalt
  ncba: "#3F2A56",       // NCBA · plum
  absa: "#DC0032",       // ABSA · red
  stanbic: "#0033A0",    // Stanbic · navy
  stanchart: "#0473EA",  // Standard Chartered · blue
  im: "#00518A",         // I&M · steel blue
  dtb: "#1F2A6E",        // DTB · indigo
  family: "#0F7D52",     // Family Bank · emerald
  hfc: "#E93E2F",        // HFC · vermilion
  sidian: "#003D5B",     // Sidian · midnight
  boa: "#E2231A",        // Bank of Africa · red
  ecobank: "#0066B3",    // Ecobank · azure
  gulf: "#0E8E7E",       // Gulf African · teal
};

export function getBankBrandColor(slug: string): string {
  return BANK_BRAND_COLORS[slug] || "#1E293B";
}

export function getBankLogo(slug: string): ImageSourcePropType | null {
  return BANK_LOGOS[slug] || null;
}
