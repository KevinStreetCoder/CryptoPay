/**
 * Hook for depositing crypto from a connected external wallet (MetaMask, Trust, etc.)
 * into the user's CryptoPay deposit address.
 *
 * Supports ERC-20 (USDT, USDC) and native ETH transfers.
 */

import { useState, useCallback } from "react";
import { ERC20_CONTRACTS } from "../config/appkit";

// Minimal ERC-20 transfer ABI
const ERC20_TRANSFER_ABI = [
  {
    constant: false,
    inputs: [
      { name: "_to", type: "address" },
      { name: "_value", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    type: "function",
  },
];

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
