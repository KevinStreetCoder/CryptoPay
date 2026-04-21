/**
 * Unified WalletConnect hook · wraps Reown AppKit to provide a clean API
 * for connecting/disconnecting wallets, reading session state, and sending
 * transactions from the connected external wallet.
 *
 * Gracefully degrades when AppKit is unavailable (Expo Go, web, missing deps).
 *
 * Supported wallets: MetaMask, Trust Wallet, Rainbow, Zerion, etc. (EVM)
 * Non-EVM chains (Tron, Bitcoin, Solana) are not supported by WalletConnect v2
 * natively · users should use manual deposit addresses for those networks.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Platform } from "react-native";
import { appKitInitialized, ERC20_CONTRACTS, DEPOSIT_NETWORKS } from "../config/appkit";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WalletSession {
  address: string;
  chainId: number;
  chainName: string;
  isConnected: boolean;
}

export interface TransactionResult {
  txHash: string;
  chain: string;
  token: string;
  amount: string;
}

export type WalletConnectStatus =
  | "unavailable" // AppKit not installed / Expo Go
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

// ── Dynamic imports · avoid crashing when AppKit not available ───────────────

let _useAppKit: any;
let _useAppKitAccount: any;
let _useAppKitProvider: any;
let _useAppKitEvents: any;
let _appKitHooksAvailable = false;

try {
  const appKit = require("@reown/appkit-react-native");
  _useAppKit = appKit.useAppKit;
  _useAppKitAccount = appKit.useAppKitAccount;
  _useAppKitProvider = appKit.useAppKitProvider;
  _useAppKitEvents = appKit.useAppKitEvents;
  _appKitHooksAvailable = true;
} catch {
  // Not available
}

// ── Chain metadata ──────────────────────────────────────────────────────────

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  137: "Polygon",
  56: "BNB Smart Chain",
};

// ── ERC-20 transfer encoding ────────────────────────────────────────────────

function encodeERC20Transfer(to: string, amount: bigint): string {
  const selector = "a9059cbb";
  const paddedAddress = to.replace("0x", "").toLowerCase().padStart(64, "0");
  const paddedAmount = amount.toString(16).padStart(64, "0");
  return `0x${selector}${paddedAddress}${paddedAmount}`;
}

// ── Noop hook (when AppKit is unavailable) ──────────────────────────────────

function useWalletConnectUnavailable() {
  return {
    status: "unavailable" as WalletConnectStatus,
    session: null as WalletSession | null,
    isAvailable: false,
    isConnected: false,
    address: null as string | null,
    chainId: null as number | null,
    connect: async () => {},
    disconnect: async () => {},
    switchChain: async (_chainId: number) => {},
    sendETH: async (
      _to: string,
      _amount: string
    ): Promise<TransactionResult> => {
      throw new Error("WalletConnect not available");
    },
    sendERC20: async (
      _to: string,
      _token: "USDT" | "USDC",
      _amount: string,
      _chainId?: number
    ): Promise<TransactionResult> => {
      throw new Error("WalletConnect not available");
    },
    isSending: false,
    error: null as string | null,
    clearError: () => {},
  };
}

// ── Real hook (only called when AppKit is ready) ────────────────────────────

function useWalletConnectInner() {
  const appKit = _useAppKit();
  const account = _useAppKitAccount();
  const providerHook = _useAppKitProvider("eip155");

  const { address, isConnected, chainId: rawChainId } = account;
  const { provider } = providerHook;

  const [status, setStatus] = useState<WalletConnectStatus>(
    isConnected ? "connected" : "disconnected"
  );
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derived chain ID · AppKit may return it as caip-2 or number
  const chainId = typeof rawChainId === "number" ? rawChainId : 1;
  const chainName = CHAIN_NAMES[chainId] || `Chain ${chainId}`;

  // Sync connection status
  useEffect(() => {
    if (isConnected && address) {
      setStatus("connected");
    } else {
      setStatus("disconnected");
    }
  }, [isConnected, address]);

  const session: WalletSession | null =
    isConnected && address
      ? { address, chainId, chainName, isConnected: true }
      : null;

  // ── Actions ─────────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    try {
      setStatus("connecting");
      setError(null);
      appKit.open({ view: "Connect" });
    } catch (err: any) {
      setError(err?.message || "Failed to open wallet modal");
      setStatus("error");
    }
  }, [appKit]);

  const disconnect = useCallback(async () => {
    try {
      await appKit.disconnect();
      setStatus("disconnected");
    } catch (err: any) {
      setError(err?.message || "Failed to disconnect");
    }
  }, [appKit]);

  const switchChain = useCallback(
    async (targetChainId: number) => {
      if (!provider) return;
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${targetChainId.toString(16)}` }],
        });
      } catch (err: any) {
        setError(err?.message || "Failed to switch chain");
        throw err;
      }
    },
    [provider]
  );

  // ── Send native ETH ──────────────────────────────────────────────────────

  const sendETH = useCallback(
    async (to: string, amount: string): Promise<TransactionResult> => {
      if (!provider || !address) {
        throw new Error("Wallet not connected");
      }
      setIsSending(true);
      setError(null);
      try {
        const weiAmount = BigInt(Math.floor(parseFloat(amount) * 10 ** 18));
        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: address,
              to,
              value: `0x${weiAmount.toString(16)}`,
            },
          ],
        });
        return { txHash, chain: `eip155:${chainId}`, token: "ETH", amount };
      } catch (err: any) {
        const msg = err?.message || "Transaction failed";
        setError(msg);
        throw err;
      } finally {
        setIsSending(false);
      }
    },
    [provider, address, chainId]
  );

  // ── Send ERC-20 (USDT/USDC) ─────────────────────────────────────────────

  const sendERC20 = useCallback(
    async (
      to: string,
      token: "USDT" | "USDC",
      amount: string,
      targetChainId?: number
    ): Promise<TransactionResult> => {
      if (!provider || !address) {
        throw new Error("Wallet not connected");
      }
      const cid = targetChainId ?? chainId;
      const contracts = ERC20_CONTRACTS[token];
      const contractAddress = contracts[cid as keyof typeof contracts];
      if (!contractAddress) {
        throw new Error(`${token} not supported on chain ${cid}`);
      }

      setIsSending(true);
      setError(null);
      try {
        // USDT and USDC both use 6 decimals
        const rawAmount = BigInt(Math.floor(parseFloat(amount) * 10 ** 6));
        const data = encodeERC20Transfer(to, rawAmount);

        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: address,
              to: contractAddress,
              data,
            },
          ],
        });
        return {
          txHash,
          chain: `eip155:${cid}`,
          token,
          amount,
        };
      } catch (err: any) {
        const msg = err?.message || "Transaction failed";
        setError(msg);
        throw err;
      } finally {
        setIsSending(false);
      }
    },
    [provider, address, chainId]
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    status,
    session,
    isAvailable: true,
    isConnected: !!isConnected,
    address: address || null,
    chainId,
    connect,
    disconnect,
    switchChain,
    sendETH,
    sendERC20,
    isSending,
    error,
    clearError,
  };
}

// ── Public export ───────────────────────────────────────────────────────────

/**
 * Main hook for WalletConnect integration.
 *
 * Usage:
 * ```tsx
 * const { connect, disconnect, isConnected, address, sendETH, sendERC20 } = useWalletConnect();
 * ```
 *
 * On web or in Expo Go, `isAvailable` will be false and all actions are no-ops.
 */
export function useWalletConnect() {
  const ready =
    _appKitHooksAvailable && appKitInitialized && Platform.OS !== "web";

  if (ready) {
    // Safe to call hooks · this path is stable (won't flip during component lifecycle
    // because appKitInitialized is set at module load time before any render)
    return useWalletConnectInner();
  }

  return useWalletConnectUnavailable();
}

/**
 * Supported EVM deposit networks · re-exported for convenience.
 */
export { DEPOSIT_NETWORKS } from "../config/appkit";

/**
 * Non-EVM chains that CryptoPay supports via manual deposit addresses.
 * WalletConnect v2 does not support these natively.
 */
export const NON_EVM_CHAINS = [
  { id: "tron", name: "Tron (TRC-20)", tokens: ["USDT"], note: "Manual address only" },
  { id: "bitcoin", name: "Bitcoin", tokens: ["BTC"], note: "Manual address only" },
  { id: "solana", name: "Solana", tokens: ["SOL"], note: "Manual address only" },
] as const;
