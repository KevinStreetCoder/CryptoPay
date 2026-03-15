/**
 * DepositTracker — shows recent blockchain deposits with real-time status,
 * confirmation progress, and expandable details.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  Platform,
  Animated,
  Linking,
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { walletsApi, BlockchainDeposit } from "../api/wallets";
import { CryptoLogo } from "./CryptoLogo";
import { SectionHeader } from "./SectionHeader";
import { useToast } from "./Toast";
import { colors, getThemeColors, getThemeShadows } from "../constants/theme";
import { useThemeMode } from "../stores/theme";

const isWeb = Platform.OS === "web";
const useNative = Platform.OS !== "web";

// ── Block explorer URLs ──
const EXPLORER_TX: Record<string, string> = {
  tron: "https://tronscan.org/#/transaction/",
  ethereum: "https://etherscan.io/tx/",
  bitcoin: "https://mempool.space/tx/",
  solana: "https://solscan.io/tx/",
  polygon: "https://polygonscan.com/tx/",
};

// ── Status config ──
type DepositStatus = BlockchainDeposit["status"] | "failed";

interface StatusConfig {
  label: string;
  color: string;
  bg: string;
  icon: keyof typeof Ionicons.glyphMap;
  pulse: boolean;
}

function getStatusConfig(status: DepositStatus): StatusConfig {
  switch (status) {
    case "detecting":
      return {
        label: "Detecting",
        color: "#F59E0B",
        bg: "#F59E0B1F",
        icon: "radio-outline",
        pulse: true,
      };
    case "confirming":
      return {
        label: "Confirming",
        color: "#3B82F6",
        bg: "#3B82F61F",
        icon: "hourglass-outline",
        pulse: false,
      };
    case "confirmed":
      return {
        label: "Confirmed",
        color: "#10B981",
        bg: "#10B9811F",
        icon: "checkmark-circle-outline",
        pulse: false,
      };
    case "credited":
      return {
        label: "Credited",
        color: "#10B981",
        bg: "#10B9811F",
        icon: "checkmark-circle",
        pulse: false,
      };
    default:
      return {
        label: "Failed",
        color: "#EF4444",
        bg: "#EF44441F",
        icon: "close-circle-outline",
        pulse: false,
      };
  }
}

// ── Time ago helper ──
function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  );
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Truncate hash ──
function truncateHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

// ── Pulsing dot animation ──
function PulsingDot({ color }: { color: string }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: 1.6,
            duration: 800,
            useNativeDriver: useNative,
          }),
          Animated.timing(opacityAnim, {
            toValue: 0.3,
            duration: 800,
            useNativeDriver: useNative,
          }),
        ]),
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: useNative,
          }),
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: useNative,
          }),
        ]),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [scaleAnim, opacityAnim]);

  return (
    <View style={{ width: 10, height: 10, alignItems: "center", justifyContent: "center" }}>
      <Animated.View
        style={{
          position: "absolute",
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: color,
          opacity: opacityAnim,
          transform: [{ scale: scaleAnim }],
        }}
      />
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

// ── Confirmation Progress Bar ──
function ConfirmationBar({
  current,
  required,
  color,
}: {
  current: number;
  required: number;
  color: string;
}) {
  const widthAnim = useRef(new Animated.Value(0)).current;
  const pct = Math.min(current / Math.max(required, 1), 1);

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: pct,
      duration: 600,
      useNativeDriver: false,
    }).start();
  }, [pct, widthAnim]);

  return (
    <View style={{ gap: 6 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text
          style={{
            color: color,
            fontSize: 11,
            fontFamily: "DMSans_600SemiBold",
          }}
        >
          {current}/{required} confirmations
        </Text>
        <Text
          style={{
            color: color + "99",
            fontSize: 11,
            fontFamily: "DMSans_500Medium",
          }}
        >
          {Math.round(pct * 100)}%
        </Text>
      </View>
      <View
        style={{
          height: 4,
          borderRadius: 2,
          backgroundColor: color + "20",
          overflow: "hidden",
        }}
      >
        <Animated.View
          style={{
            height: "100%",
            borderRadius: 2,
            backgroundColor: color,
            width: widthAnim.interpolate({
              inputRange: [0, 1],
              outputRange: ["0%", "100%"],
            }),
          }}
        />
      </View>
    </View>
  );
}

// ── Single Deposit Card ──
function DepositCard({
  deposit,
  onOpenModal,
}: {
  deposit: BlockchainDeposit;
  onOpenModal?: (deposit: BlockchainDeposit) => void;
}) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);
  const expandAnim = useRef(new Animated.Value(0)).current;

  const status = getStatusConfig(deposit.status as DepositStatus);
  const isActive = deposit.status === "detecting" || deposit.status === "confirming";

  useEffect(() => {
    Animated.timing(expandAnim, {
      toValue: expanded ? 1 : 0,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, [expanded, expandAnim]);

  const copyTxHash = useCallback(async () => {
    await Clipboard.setStringAsync(deposit.tx_hash);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setCopiedHash(true);
    toast.success("Copied", "Transaction hash copied to clipboard");
    setTimeout(() => setCopiedHash(false), 2000);
  }, [deposit.tx_hash, toast]);

  const openExplorer = useCallback(() => {
    const baseUrl = EXPLORER_TX[deposit.chain] || EXPLORER_TX.ethereum;
    const url = baseUrl + deposit.tx_hash;
    Linking.openURL(url);
  }, [deposit.chain, deposit.tx_hash]);

  const chainLabel =
    deposit.chain.charAt(0).toUpperCase() + deposit.chain.slice(1);

  return (
    <Pressable
      onPress={() => {
        if (onOpenModal && isActive) {
          onOpenModal(deposit);
        } else {
          setExpanded(!expanded);
        }
      }}
      style={({ pressed, hovered }: any) => ({
        backgroundColor: hovered
          ? tc.glass.highlight
          : pressed
            ? tc.dark.elevated
            : tc.dark.card,
        borderRadius: 18,
        padding: 16,
        borderWidth: 1,
        borderColor: isActive ? status.color + "30" : tc.glass.border,
        ...(isWeb
          ? ({
              cursor: "pointer",
              transition: "all 0.2s ease",
            } as any)
          : {}),
      })}
    >
      {/* Main row */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        {/* Currency icon */}
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            backgroundColor:
              (colors.crypto[deposit.currency] || colors.primary[500]) + "1F",
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1.5,
            borderColor:
              (colors.crypto[deposit.currency] || colors.primary[500]) + "33",
          }}
        >
          <CryptoLogo
            currency={deposit.currency}
            size={26}
            fallbackColor={colors.crypto[deposit.currency] || colors.primary[400]}
          />
        </View>

        {/* Amount and chain */}
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 15,
              fontFamily: "DMSans_600SemiBold",
              marginBottom: 2,
            }}
          >
            +{parseFloat(deposit.amount).toLocaleString(undefined, {
              maximumFractionDigits: 8,
            })}{" "}
            {deposit.currency}
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 12,
              fontFamily: "DMSans_400Regular",
            }}
          >
            {chainLabel} network
          </Text>
        </View>

        {/* Status + time */}
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          {/* Status badge */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              backgroundColor: status.bg,
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 10,
            }}
          >
            {status.pulse ? (
              <PulsingDot color={status.color} />
            ) : (
              <Ionicons name={status.icon} size={12} color={status.color} />
            )}
            <Text
              style={{
                color: status.color,
                fontSize: 11,
                fontFamily: "DMSans_600SemiBold",
              }}
            >
              {status.label}
            </Text>
          </View>

          <Text
            style={{
              color: tc.textMuted,
              fontSize: 11,
              fontFamily: "DMSans_400Regular",
            }}
          >
            {timeAgo(deposit.created_at)}
          </Text>
        </View>
      </View>

      {/* Confirmation bar for confirming status */}
      {(deposit.status === "confirming" || deposit.status === "detecting") &&
        deposit.required_confirmations > 0 && (
          <View style={{ marginTop: 12 }}>
            <ConfirmationBar
              current={deposit.confirmations}
              required={deposit.required_confirmations}
              color={status.color}
            />
          </View>
        )}

      {/* Expanded details */}
      {expanded && (
        <Animated.View
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTopWidth: 1,
            borderTopColor: tc.glass.border,
            gap: 10,
            opacity: expandAnim,
          }}
        >
          {/* Tx Hash */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 12,
                fontFamily: "DMSans_500Medium",
              }}
            >
              Tx Hash
            </Text>
            <Pressable
              onPress={copyTxHash}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 12,
                  fontFamily: isWeb ? "monospace" : "Courier",
                }}
              >
                {truncateHash(deposit.tx_hash)}
              </Text>
              <Ionicons
                name={copiedHash ? "checkmark" : "copy-outline"}
                size={13}
                color={copiedHash ? colors.success : tc.textMuted}
              />
            </Pressable>
          </View>

          {/* Network */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 12,
                fontFamily: "DMSans_500Medium",
              }}
            >
              Network
            </Text>
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: 12,
                fontFamily: "DMSans_500Medium",
              }}
            >
              {chainLabel}
            </Text>
          </View>

          {/* Deposit Address (truncated) */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 12,
                fontFamily: "DMSans_500Medium",
              }}
            >
              To Address
            </Text>
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: 12,
                fontFamily: isWeb ? "monospace" : "Courier",
              }}
            >
              {truncateHash(deposit.to_address)}
            </Text>
          </View>

          {/* Block number */}
          {deposit.block_number && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 12,
                  fontFamily: "DMSans_500Medium",
                }}
              >
                Block
              </Text>
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 12,
                  fontFamily: "DMSans_500Medium",
                }}
              >
                {deposit.block_number.toLocaleString()}
              </Text>
            </View>
          )}

          {/* View on Explorer button */}
          <Pressable
            onPress={openExplorer}
            style={({ pressed, hovered }: any) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              paddingVertical: 10,
              borderRadius: 12,
              backgroundColor: hovered
                ? colors.primary[500] + "18"
                : colors.primary[500] + "10",
              borderWidth: 1,
              borderColor: colors.primary[500] + "25",
              marginTop: 4,
              opacity: pressed ? 0.85 : 1,
              ...(isWeb
                ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any)
                : {}),
            })}
          >
            <Ionicons
              name="open-outline"
              size={14}
              color={colors.primary[400]}
            />
            <Text
              style={{
                color: colors.primary[400],
                fontSize: 13,
                fontFamily: "DMSans_600SemiBold",
              }}
            >
              View on Explorer
            </Text>
          </Pressable>
        </Animated.View>
      )}

      {/* Expand hint for non-active */}
      {!isActive && !expanded && (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "center",
            marginTop: 8,
          }}
        >
          <Ionicons
            name="chevron-down-outline"
            size={14}
            color={tc.textMuted + "60"}
          />
        </View>
      )}
    </Pressable>
  );
}

// ── Main DepositTracker Component ──
interface DepositTrackerProps {
  /** Only show pending (non-credited) deposits */
  pendingOnly?: boolean;
  /** Maximum items to show */
  maxItems?: number;
  /** Callback when a deposit is tapped for modal */
  onOpenModal?: (deposit: BlockchainDeposit) => void;
  /** Horizontal padding to match parent layout */
  hPad?: number;
}

export function useDeposits() {
  return useQuery<BlockchainDeposit[]>({
    queryKey: ["deposits"],
    queryFn: async () => {
      const { data } = await walletsApi.deposits();
      return data.results || [];
    },
    refetchInterval: 15000,
    staleTime: 5000,
    refetchOnWindowFocus: true,
  });
}

export function usePendingDeposits() {
  const { data: deposits, ...rest } = useDeposits();
  const pending = (deposits || []).filter(
    (d) => d.status === "detecting" || d.status === "confirming"
  );
  return { data: pending, hasPending: pending.length > 0, ...rest };
}

export function DepositTracker({
  pendingOnly = false,
  maxItems = 5,
  onOpenModal,
  hPad = 16,
}: DepositTrackerProps) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const { data: allDeposits, isLoading } = useDeposits();

  const deposits = pendingOnly
    ? (allDeposits || []).filter(
        (d) => d.status === "detecting" || d.status === "confirming"
      )
    : allDeposits || [];

  const visibleDeposits = deposits.slice(0, maxItems);

  // Don't render anything if no deposits to show
  if (!isLoading && visibleDeposits.length === 0) {
    if (!pendingOnly) {
      return (
        <View style={{ paddingHorizontal: hPad }}>
          <SectionHeader
            title="Deposits"
            icon="arrow-down-circle-outline"
            iconColor={colors.primary[400]}
          />
          <View
            style={{
              backgroundColor: tc.dark.card,
              borderRadius: 20,
              padding: 32,
              alignItems: "center",
              borderWidth: 1,
              borderColor: tc.glass.border,
            }}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 18,
                backgroundColor: tc.dark.elevated + "60",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 14,
              }}
            >
              <Ionicons
                name="arrow-down-circle-outline"
                size={26}
                color={tc.dark.muted}
              />
            </View>
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: 14,
                fontFamily: "DMSans_500Medium",
                marginBottom: 4,
              }}
            >
              No pending deposits
            </Text>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 12,
                fontFamily: "DMSans_400Regular",
                textAlign: "center",
                lineHeight: 18,
                maxWidth: 240,
              }}
            >
              Incoming crypto deposits will appear here with live status tracking
            </Text>
          </View>
        </View>
      );
    }
    return null;
  }

  if (isLoading) {
    return (
      <View style={{ paddingHorizontal: hPad }}>
        <SectionHeader
          title="Deposits"
          icon="arrow-down-circle-outline"
          iconColor={colors.primary[400]}
        />
        <View
          style={{
            backgroundColor: tc.dark.card,
            borderRadius: 20,
            padding: 32,
            alignItems: "center",
            borderWidth: 1,
            borderColor: tc.glass.border,
          }}
        >
          <ActivityIndicator size="small" color={colors.primary[400]} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ paddingHorizontal: hPad }}>
      <SectionHeader
        title={pendingOnly ? "Pending Deposits" : "Deposits"}
        icon="arrow-down-circle-outline"
        iconColor={
          pendingOnly ? "#F59E0B" : colors.primary[400]
        }
        count={visibleDeposits.length}
      />
      <View style={{ gap: 10 }}>
        {visibleDeposits.map((deposit) => (
          <DepositCard
            key={deposit.id}
            deposit={deposit}
            onOpenModal={onOpenModal}
          />
        ))}
      </View>
    </View>
  );
}
