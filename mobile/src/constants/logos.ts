// Centralized logo assets for crypto currencies and service providers

export const CRYPTO_LOGOS: Record<string, string> = {
  USDC: "https://assets.coingecko.com/coins/images/6319/small/usdc.png",
  USDT: "https://assets.coingecko.com/coins/images/325/small/Tether.png",
  BTC: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png",
  SOL: "https://assets.coingecko.com/coins/images/4128/small/solana.png",
  ETH: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
};

// Local logo assets — require() returns an asset module (number on native, object on web)
// Pass directly to <Image source={...} /> — React Native handles resolution internally
export const SERVICE_LOGOS: Record<string, any> = {
  "KPLC Prepaid": require("../../assets/logos/services/kplc.png"),
  "KPLC Postpaid": require("../../assets/logos/services/kplc.png"),
  "Nairobi Water": require("../../assets/logos/services/nairobi_water.png"),
  Safaricom: require("../../assets/logos/services/safaricom.png"),
  GOtv: require("../../assets/logos/services/gotv.png"),
  StarTimes: require("../../assets/logos/services/startimes.png"),
  NHIF: require("../../assets/logos/services/nhif.png"),
  Zuku: require("../../assets/logos/services/zuku.png"),
  Uber: require("../../assets/logos/services/uber.png"),
  Bolt: require("../../assets/logos/services/bolt.png"),
};

export const BRAND_LOGOS = {
  google: "https://img.icons8.com/color/48/google-logo.png",
  kenyaFlag: "https://flagcdn.com/w40/ke.png",
};
