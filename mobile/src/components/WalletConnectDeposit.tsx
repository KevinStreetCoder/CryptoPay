import { Spinner } from "./brand/Spinner";
/**
 * WalletConnect deposit component · allows users to deposit crypto
 * directly from MetaMask, Trust Wallet, etc. into their CryptoPay wallet.
 *
 * Renders:
 * - Connect Wallet button (opens Reown AppKit modal)
 * - Connected wallet info (address, chain)
 * - Token + amount selector
 * - "Deposit" button that triggers an ERC-20/ETH transfer
 */

import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  Platform,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, getThemeColors, getThemeShadows } from "../constants/theme";
import { useThemeMode } from "../stores/theme";
import { useToast } from "./Toast";
import { useWalletDeposit } from "../hooks/useWalletDeposit";

const isWeb = Platform.OS === "web";

// AppKit imports are done LAZILY inside the component to avoid
// crashing the app at module load time. The @reown/appkit-react-native
// module registers React context hooks at import time that throw
// "AppKit instance is not yet available in context" if no provider exists.
let _appKitLoaded = false;
let _appKitAvailable = false;
let _appKitInitialized = false;
let _useAppKit: any;
let _useAppKitAccount: any;
let _useAppKitProvider: any;
let _AppKitModal: any;
let __DEPOSIT_NETWORKS: any[] = [];

function ensureAppKitLoaded() {
  if (_appKitLoaded) return _appKitAvailable;
  _appKitLoaded = true;
  try {
    // Import and initialize AppKit on first use
    const appkitConfig = require("../config/appkit");
    __DEPOSIT_NETWORKS = appkitConfig.DEPOSIT_NETWORKS || [];
    _appKitInitialized = appkitConfig.appKitInitialized || false;

    // Initialize if not already done
    if (!_appKitInitialized && appkitConfig.initAppKit) {
      try {
        const result = appkitConfig.initAppKit();
        _appKitInitialized = result != null;
      } catch {}
    }

    const appKit = require("@reown/appkit-react-native");
    _useAppKit = appKit.useAppKit;
    _useAppKitAccount = appKit.useAppKitAccount;
    _useAppKitProvider = appKit.useAppKitProvider;
    _AppKitModal = appKit.AppKit;
    _appKitAvailable = true;
  } catch {
    _appKitAvailable = false;
  }
  return _appKitAvailable;
}

type DepositNetwork = { id: string; name: string; chainId: number; tokens: string[] };

const TOKEN_OPTIONS = [
  { symbol: "USDT", name: "Tether", decimals: 6, color: "#26A17B" },
  { symbol: "USDC", name: "USD Coin", decimals: 6, color: "#2775CA" },
  { symbol: "ETH", name: "Ethereum", decimals: 18, color: "#627EEA" },
];

interface Props {
  depositAddress: string;
  onDepositInitiated?: (txHash: string, token: string, amount: string) => void;
}

/**
 * Public export · renders the connected version only when AppKit is ready.
 * This avoids conditional hook calls (Rules of Hooks violation).
 */
/** Error boundary to catch AppKit context errors at runtime */
class AppKitErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error) {
    console.warn("AppKit error caught:", error.message);
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

export function WalletConnectDeposit(props: Props) {
  // Load AppKit lazily on first render of this component
  const isReady = ensureAppKitLoaded() && _appKitInitialized && Platform.OS !== "web";

  if (isReady) {
    return (
      <AppKitErrorBoundary fallback={<WalletConnectFallback />}>
        <WalletConnectDepositInner {...props} />
        {_AppKitModal && <_AppKitModal />}
      </AppKitErrorBoundary>
    );
  }

  return <WalletConnectFallback />;
}

/** Fallback when AppKit isn't available or not initialized */
function WalletConnectFallback() {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);

  // On web, AppKit uses a web modal that works without native modules
  // However if AppKit was not initialized (no PROJECT_ID), show guidance
  const isWebPlatform = Platform.OS === "web";

  return (
    <View
      style={{
        borderRadius: 16,
        paddingVertical: 20,
        paddingHorizontal: 16,
        backgroundColor: tc.dark.elevated,
        borderWidth: 1,
        borderColor: tc.glass.border,
        alignItems: "center",
        gap: 10,
      }}
    >
      <Ionicons name="wallet-outline" size={28} color={tc.textMuted} />
      <Text
        style={{
          color: tc.textSecondary,
          fontSize: 14,
          fontFamily: "DMSans_600SemiBold",
          textAlign: "center",
        }}
      >
        {isWebPlatform ? "External Wallet" : "WalletConnect Not Available"}
      </Text>
      <Text
        style={{
          color: tc.textMuted,
          fontSize: 12,
          fontFamily: "DMSans_400Regular",
          textAlign: "center",
          lineHeight: 18,
          maxWidth: 300,
        }}
      >
        {isWebPlatform
          ? "To deposit from MetaMask or other wallets, copy your deposit address from the Wallet tab and paste it in your wallet app."
          : "Requires an EAS build (not Expo Go) to connect external wallets. Use the manual deposit option below instead."}
      </Text>
    </View>
  );
}

/** Inner component · only rendered when AppKit is fully initialized */
function WalletConnectDepositInner({ depositAddress, onDepositInitiated }: Props) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const toast = useToast();
  const { sendERC20, sendETH, isDepositing, error, clearError } = useWalletDeposit();

  const [selectedToken, setSelectedToken] = useState(TOKEN_OPTIONS[0]);
  const [amount, setAmount] = useState("");
  const [selectedNetwork, setSelectedNetwork] = useState<DepositNetwork>(__DEPOSIT_NETWORKS[0]);

  // Hooks always called · this component only renders when AppKit is ready
  const appKit = _useAppKit();
  const account = _useAppKitAccount();
  const providerHook = _useAppKitProvider("eip155");

  const { address, isConnected } = account;
  const { provider } = providerHook;

  useEffect(() => {
    if (error) {
      toast.error("Deposit Failed", error);
      clearError();
    }
  }, [error]);

  const handleConnect = useCallback(() => {
    appKit.open({ view: "Connect" });
  }, [appKit]);

  const handleDeposit = useCallback(async () => {
    if (!provider || !address || !depositAddress) return;

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.error("Invalid Amount", "Please enter a valid amount");
      return;
    }

    // Validate deposit address format
    if (!/^0x[0-9a-fA-F]{40}$/.test(depositAddress)) {
      toast.error("Address Error", "Invalid deposit address. Please try again.");
      return;
    }

    // Auto-switch chain if wallet is on wrong network
    const targetChainId = selectedToken.symbol === "ETH" ? 1 : selectedNetwork.chainId;
    const walletChainId = account.chainId;
    if (walletChainId && walletChainId !== targetChainId) {
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${targetChainId.toString(16)}` }],
        });
      } catch (switchErr: any) {
        toast.error("Wrong Network", `Please switch to ${selectedNetwork.name} in your wallet`);
        return;
      }
    }

    try {
      let result;
      if (selectedToken.symbol === "ETH") {
        result = await sendETH(provider, address, depositAddress, amount);
      } else {
        result = await sendERC20(
          provider,
          address,
          depositAddress,
          selectedToken.symbol as "USDT" | "USDC",
          amount,
          selectedNetwork.chainId
        );
      }

      toast.success(
        "Deposit Initiated",
        `${amount} ${selectedToken.symbol} sent. Your balance will update after network confirmation.`
      );
      onDepositInitiated?.(result.txHash, selectedToken.symbol, amount);
      setAmount("");
    } catch (err: any) {
      if (err?.message?.includes("User rejected") || err?.message?.includes("cancelled")) {
        toast.error("Cancelled", "Transaction was cancelled in your wallet");
      } else if (err?.message?.includes("Minimum deposit")) {
        toast.error("Amount Too Low", err.message);
      } else if (err?.message?.includes("Invalid deposit")) {
        toast.error("Address Error", err.message);
      }
    }
  }, [provider, address, depositAddress, amount, selectedToken, selectedNetwork, account.chainId]);

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "";

  return (
    <View style={{ gap: 16 }}>
      {/* Connection Status */}
      {!isConnected ? (
        <Pressable
          onPress={handleConnect}
          style={({ pressed, hovered }: any) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            backgroundColor: hovered ? "#627EEA" : "#627EEA" + "E6",
            borderRadius: 16,
            paddingVertical: 16,
            opacity: pressed ? 0.85 : 1,
            ...(isWeb ? { cursor: "pointer", transition: "all 0.2s ease" } as any : {}),
          })}
        >
          <Ionicons name="wallet-outline" size={20} color="#FFFFFF" />
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: 16,
              fontFamily: "DMSans_600SemiBold",
            }}
          >
            Connect External Wallet
          </Text>
        </Pressable>
      ) : (
        <>
          {/* Connected wallet info */}
          <View
            style={{
              backgroundColor: tc.dark.card,
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: colors.success + "30",
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: colors.success + "18",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="checkmark-circle" size={22} color={colors.success} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: colors.success,
                  fontSize: 12,
                  fontFamily: "DMSans_500Medium",
                }}
              >
                Connected
              </Text>
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 15,
                  fontFamily: "DMSans_600SemiBold",
                  marginTop: 2,
                }}
                selectable
              >
                {shortAddress}
              </Text>
            </View>
            <Pressable
              onPress={() => appKit.disconnect()}
              style={({ pressed }) => ({
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 8,
                backgroundColor: colors.error + "15",
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text
                style={{
                  color: colors.error,
                  fontSize: 12,
                  fontFamily: "DMSans_500Medium",
                }}
              >
                Disconnect
              </Text>
            </Pressable>
          </View>

          {/* Token Selector */}
          <View style={{ gap: 8 }}>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 12,
                fontFamily: "DMSans_500Medium",
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Select Token
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {TOKEN_OPTIONS.map((token) => {
                const active = selectedToken.symbol === token.symbol;
                return (
                  <Pressable
                    key={token.symbol}
                    onPress={() => setSelectedToken(token)}
                    style={({ hovered }: any) => ({
                      flex: 1,
                      paddingVertical: 12,
                      paddingHorizontal: 8,
                      borderRadius: 12,
                      backgroundColor: active
                        ? token.color + "18"
                        : hovered
                          ? tc.glass.highlight
                          : tc.dark.elevated,
                      borderWidth: 1.5,
                      borderColor: active ? token.color + "50" : tc.glass.border,
                      alignItems: "center",
                      ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
                    })}
                  >
                    <Text
                      style={{
                        color: active ? token.color : tc.textPrimary,
                        fontSize: 14,
                        fontFamily: "DMSans_700Bold",
                      }}
                    >
                      {token.symbol}
                    </Text>
                    <Text
                      style={{
                        color: tc.textMuted,
                        fontSize: 10,
                        fontFamily: "DMSans_400Regular",
                        marginTop: 2,
                      }}
                    >
                      {token.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Network Selector (for ERC-20 only) */}
          {selectedToken.symbol !== "ETH" && __DEPOSIT_NETWORKS.length > 1 && (
            <View style={{ gap: 8 }}>
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 12,
                  fontFamily: "DMSans_500Medium",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Network
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {__DEPOSIT_NETWORKS.filter((n: any) =>
                  n.tokens.includes(selectedToken.symbol)
                ).map((network: any) => {
                  const active = selectedNetwork.chainId === network.chainId;
                  return (
                    <Pressable
                      key={network.chainId}
                      onPress={() => setSelectedNetwork(network)}
                      style={({ hovered }: any) => ({
                        flex: 1,
                        paddingVertical: 10,
                        borderRadius: 10,
                        backgroundColor: active
                          ? colors.primary[500] + "15"
                          : hovered
                            ? tc.glass.highlight
                            : tc.dark.elevated,
                        borderWidth: 1,
                        borderColor: active
                          ? colors.primary[500] + "40"
                          : tc.glass.border,
                        alignItems: "center",
                        ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
                      })}
                    >
                      <Text
                        style={{
                          color: active ? colors.primary[400] : tc.textPrimary,
                          fontSize: 12,
                          fontFamily: "DMSans_600SemiBold",
                        }}
                      >
                        {network.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* Amount Input */}
          <View style={{ gap: 8 }}>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 12,
                fontFamily: "DMSans_500Medium",
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Amount
            </Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: tc.dark.elevated,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: tc.glass.border,
                paddingHorizontal: 16,
              }}
            >
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder={`0.00 ${selectedToken.symbol}`}
                placeholderTextColor={tc.textMuted}
                keyboardType="decimal-pad"
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  color: tc.textPrimary,
                  fontSize: 18,
                  fontFamily: "DMSans_600SemiBold",
                  ...(isWeb ? { outlineStyle: "none" } as any : {}),
                }}
              />
              <Text
                style={{
                  color: selectedToken.color,
                  fontSize: 14,
                  fontFamily: "DMSans_700Bold",
                }}
              >
                {selectedToken.symbol}
              </Text>
            </View>
          </View>

          {/* Deposit Button */}
          <Pressable
            onPress={handleDeposit}
            disabled={isDepositing || !amount || parseFloat(amount) <= 0}
            style={({ pressed, hovered }: any) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              backgroundColor: isDepositing
                ? colors.primary[500] + "60"
                : hovered
                  ? colors.primary[400]
                  : colors.primary[500],
              borderRadius: 16,
              paddingVertical: 16,
              opacity: (!amount || parseFloat(amount) <= 0) ? 0.5 : pressed ? 0.85 : 1,
              ...(isWeb ? { cursor: isDepositing ? "wait" : "pointer", transition: "all 0.2s ease" } as any : {}),
            })}
          >
            {isDepositing ? (
              <Spinner size={16} color="#FFFFFF" />
            ) : (
              <Ionicons name="arrow-down-circle-outline" size={20} color="#FFFFFF" />
            )}
            <Text
              style={{
                color: "#FFFFFF",
                fontSize: 16,
                fontFamily: "DMSans_600SemiBold",
              }}
            >
              {isDepositing
                ? "Confirm in wallet..."
                : `Deposit ${amount || "0"} ${selectedToken.symbol}`}
            </Text>
          </Pressable>

          {/* Info Note */}
          <View
            style={{
              flexDirection: "row",
              gap: 8,
              paddingHorizontal: 4,
            }}
          >
            <Ionicons name="information-circle-outline" size={16} color={tc.textMuted} />
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 12,
                fontFamily: "DMSans_400Regular",
                lineHeight: 17,
                flex: 1,
              }}
            >
              Your wallet app will open for you to confirm the transaction. Crypto
              will be credited to your CryptoPay balance after network confirmation.
            </Text>
          </View>
        </>
      )}
    </View>
  );
}
