/**
 * Hook for depositing crypto from a connected external wallet (MetaMask, Trust, etc.)
 * into the user's CryptoPay deposit address.
 *
 * Supports ERC-20 (USDT, USDC) and native ETH transfers.
 */

import { useState, useCallback } from "react";
import { ERC20_CONTRACTS } from "../config/appkit";

/**
 * Validate Ethereum address format (0x + 40 hex chars).
 * Does NOT verify checksum — wallets handle that.
 */
function isValidEVMAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

/** Minimum deposit amounts to prevent dust transactions */
const MIN_DEPOSIT: Record<string, number> = {
  USDT: 1,
  USDC: 1,
  ETH: 0.001,
};

// Encode ERC-20 transfer calldata (no ethers.js dependency)
function encodeERC20Transfer(to: string, amount: bigint): string {
  // Function selector: keccak256("transfer(address,uint256)") = 0xa9059cbb
  const selector = "a9059cbb";
  // Pad address to 32 bytes (remove 0x prefix, left-pad with zeros)
  const paddedAddress = to.replace("0x", "").toLowerCase().padStart(64, "0");
  // Pad amount to 32 bytes
  const paddedAmount = amount.toString(16).padStart(64, "0");
  return `0x${selector}${paddedAddress}${paddedAmount}`;
}

interface DepositResult {
  txHash: string;
  chain: string;
  token: string;
  amount: string;
}

export function useWalletDeposit() {
  const [isDepositing, setIsDepositing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Send ERC-20 tokens (USDT/USDC) from connected wallet to deposit address.
   */
  const sendERC20 = useCallback(
    async (
      provider: any,
      fromAddress: string,
      toAddress: string,
      token: "USDT" | "USDC",
      amount: string, // Human-readable amount (e.g., "50")
      chainId: number
    ): Promise<DepositResult> => {
      setIsDepositing(true);
      setError(null);

      try {
        if (!isValidEVMAddress(toAddress)) {
          throw new Error("Invalid deposit address format");
        }

        const numAmount = parseFloat(amount);
        const minAmount = MIN_DEPOSIT[token] || 1;
        if (isNaN(numAmount) || numAmount < minAmount) {
          throw new Error(`Minimum deposit is ${minAmount} ${token}`);
        }

        const contracts = ERC20_CONTRACTS[token];
        const contractAddress = contracts[chainId as keyof typeof contracts];
        if (!contractAddress) {
          throw new Error(`${token} not supported on chain ${chainId}`);
        }

        // USDT and USDC use 6 decimals
        const decimals = 6;
        const rawAmount = BigInt(Math.floor(parseFloat(amount) * 10 ** decimals));

        const data = encodeERC20Transfer(toAddress, rawAmount);

        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: fromAddress,
              to: contractAddress,
              data,
              // Gas will be estimated by the wallet
            },
          ],
        });

        return {
          txHash,
          chain: `eip155:${chainId}`,
          token,
          amount,
        };
      } catch (err: any) {
        const msg = err?.message || "Transaction failed";
        setError(msg);
        throw err;
      } finally {
        setIsDepositing(false);
      }
    },
    []
  );

  /**
   * Send native ETH from connected wallet to deposit address.
   */
  const sendETH = useCallback(
    async (
      provider: any,
      fromAddress: string,
      toAddress: string,
      amount: string // Human-readable ETH amount (e.g., "0.1")
    ): Promise<DepositResult> => {
      setIsDepositing(true);
      setError(null);

      try {
        if (!isValidEVMAddress(toAddress)) {
          throw new Error("Invalid deposit address format");
        }

        const numAmount = parseFloat(amount);
        const minAmount = MIN_DEPOSIT.ETH || 0.001;
        if (isNaN(numAmount) || numAmount < minAmount) {
          throw new Error(`Minimum deposit is ${minAmount} ETH`);
        }

        // Convert ETH to Wei (18 decimals)
        const weiAmount = BigInt(
          Math.floor(parseFloat(amount) * 10 ** 18)
        );

        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: fromAddress,
              to: toAddress,
              value: `0x${weiAmount.toString(16)}`,
            },
          ],
        });

        return {
          txHash,
          chain: "eip155:1",
          token: "ETH",
          amount,
        };
      } catch (err: any) {
        const msg = err?.message || "Transaction failed";
        setError(msg);
        throw err;
      } finally {
        setIsDepositing(false);
      }
    },
    []
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    sendERC20,
    sendETH,
    isDepositing,
    error,
    clearError,
  };
}
