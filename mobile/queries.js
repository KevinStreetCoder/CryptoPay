/**
 * Expo config plugin — adds Android <queries> for wallet app deep links.
 * Required for Android 11+ (API 30+) package visibility restrictions.
 *
 * Usage: Add to app.json plugins: ["./queries.js"]
 */

const { withAndroidManifest } = require("expo/config-plugins");

const WALLET_PACKAGES = [
  "io.metamask",
  "com.wallet.crypto.trustapp",
  "io.gnosis.safe",
  "me.rainbow",
  "app.phantom",
  "org.toshi", // Coinbase Wallet
  "com.zerion.android",
  "io.uniswap.app",
];

function addWalletQueries(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;

    // Ensure <queries> element exists
    if (!manifest.queries) {
      manifest.queries = [];
    }

    // Add each wallet package as a <package> query
    const packages = WALLET_PACKAGES.map((pkg) => ({
      $: { "android:name": pkg },
    }));

    // Find or create the queries block
    if (manifest.queries.length === 0) {
      manifest.queries.push({ package: packages });
    } else {
      const existing = manifest.queries[0].package || [];
      const existingNames = new Set(
        existing.map((p) => p.$?.["android:name"])
      );
      for (const pkg of packages) {
        if (!existingNames.has(pkg.$["android:name"])) {
          existing.push(pkg);
        }
      }
      manifest.queries[0].package = existing;
    }

    return mod;
  });
}

module.exports = addWalletQueries;
