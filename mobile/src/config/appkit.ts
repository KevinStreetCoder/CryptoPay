/**
 * Reown AppKit (WalletConnect) configuration.
 *
 * Enables external wallet connections: MetaMask, Trust Wallet, Phantom, etc.
 * Users can deposit crypto directly from their connected wallet.
 *
 * NOTE: This does NOT work in Expo Go · requires EAS Build / custom dev client.
 */

// Must be imported first · handles crypto/Buffer polyfills
import "@walletconnect/react-native-compat";

import { createAppKit } from "@reown/appkit-react-native";
import { EthersAdapter } from "@reown/appkit-ethers-react-native";
import { storage } from "../utils/storage";

// Reown Project ID · get from https://cloud.reown.com
// Set via EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID env var.
// See also: mobile/src/constants/config.ts for the exported constant.
const PROJECT_ID = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

// EVM networks we support for deposits
const ethereum = {
  id: 1,
  name: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://eth.llamarpc.com"] as const } },
  blockExplorers: { default: { name: "Etherscan", url: "https://etherscan.io" } },
};

const polygon = {
  id: 137,
  name: "Polygon",
  nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
  rpcUrls: { default: { http: ["https://polygon-rpc.com"] as const } },
  blockExplorers: { default: { name: "PolygonScan", url: "https://polygonscan.com" } },
};

const bsc = {
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://bsc-dataseed.binance.org"] as const } },
  blockExplorers: { default: { name: "BscScan", url: "https://bscscan.com" } },
};

// ERC-20 token contracts for displaying balances in the modal
const TOKEN_CONTRACTS: Record<string, { address: `0x${string}` }> = {
  // USDT
  "eip155:1": { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
  // USDT on Polygon
  "eip155:137": { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" },
  // USDT on BSC
  "eip155:56": { address: "0x55d398326f99059fF775485246999027B3197955" },
};

const ethersAdapter = new EthersAdapter();

// Storage adapter bridging AppKit's Storage interface to our storage util
const APPKIT_PREFIX = "appkit:";
const appKitStorage = {
  async getKeys(): Promise<string[]> {
    return [];
  },
  async getEntries<T = any>(): Promise<[string, T][]> {
    return [];
  },
  async getItem<T = any>(key: string): Promise<T | undefined> {
    const val = await storage.getItemAsync(`${APPKIT_PREFIX}${key}`);
    if (val === null) return undefined;
    try {
      return JSON.parse(val) as T;
    } catch {
      return val as T;
    }
  },
  async setItem<T = any>(key: string, value: T): Promise<void> {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    await storage.setItemAsync(`${APPKIT_PREFIX}${key}`, serialized);
  },
  async removeItem(key: string): Promise<void> {
    await storage.deleteItemAsync(`${APPKIT_PREFIX}${key}`);
  },
};

export let appKitInitialized = false;

export function initAppKit() {
  if (!PROJECT_ID) {
    console.warn(
      "[AppKit] EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID not set. WalletConnect disabled."
    );
    return null;
  }

  const instance = createAppKit({
    projectId: PROJECT_ID,
    networks: [ethereum, polygon, bsc],
    defaultNetwork: ethereum,
    adapters: [ethersAdapter],
    storage: appKitStorage,
    metadata: {
      name: "CryptoPay",
      description: "Crypto to M-Pesa payments · deposit, pay bills, send money",
      url: "https://cpay.co.ke",
      icons: ["https://cpay.co.ke/icon.png"],
      redirect: {
        native: "cryptopay://",
        universal: "https://cpay.co.ke/walletconnect",
      },
    },
    tokens: TOKEN_CONTRACTS,
    features: {
      swaps: false,
      onramp: false,
    },
  });
  appKitInitialized = true;
  return instance;
}

// Token addresses for transfer operations
export const ERC20_CONTRACTS = {
  USDT: {
    1: "0xdAC17F958D2ee523a2206206994597C13D831ec7", // Ethereum
    137: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", // Polygon
    56: "0x55d398326f99059fF775485246999027B3197955", // BSC
  },
  USDC: {
    1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // Ethereum
    137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // Polygon
    56: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // BSC
  },
} as const;

// Supported deposit networks
// NOTE: Only Ethereum is monitored by backend listeners currently.
// Polygon and BSC listeners need to be implemented before enabling those networks.
export interface DepositNetwork {
  chainId: number;
  name: string;
  symbol: string;
  tokens: string[];
}

export const DEPOSIT_NETWORKS: DepositNetwork[] = [
  { chainId: 1, name: "Ethereum", symbol: "ETH", tokens: ["USDT", "USDC", "ETH"] },
  { chainId: 137, name: "Polygon", symbol: "MATIC", tokens: ["USDT", "USDC"] },
  // { chainId: 56, name: "BNB Chain", symbol: "BNB", tokens: ["USDT", "USDC"] },    // TODO: Enable after bsc_listener.py implemented
];
