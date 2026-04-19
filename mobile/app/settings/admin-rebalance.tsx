import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/stores/auth";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { GlassCard } from "../../src/components/GlassCard";
import { Spinner } from "../../src/components/brand/Spinner";

const isWeb = Platform.OS === "web";

// ── Types ────────────────────────────────────────────────────────────────────

/** Active order from backend get_rebalance_status() */
interface ActiveOrder {
  id: string;
  status: string;
  trigger: string;
  sell_amount: string;
  sell_currency: string;
  expected_kes: string;
  age_minutes: number;
  created_at: string;
  reason: string;
}

/** Completed order from backend get_rebalance_status() */
interface CompletedOrder {
  id: string;
  kes_received: string;
  sell_amount: string;
  sell_currency: string;
  slippage: string;
  completed_at: string | null;
}

/** Circuit breaker status dict from PaymentCircuitBreaker.get_status_dict() */
interface CircuitBreakerStatus {
  state: "closed" | "half_open" | "open";
  is_paused: boolean;
  reason: string;
  last_float_kes: string;
  max_allowed_amount_kes: string;
  paused_at: string | null;
  manual_override: boolean;
  thresholds: {
    emergency_kes: string;
    critical_kes: string;
    resume_kes: string;
    healthy_kes: string;
  };
}

/** Crypto balance entry */
interface CryptoBalance {
  balance: string;
  updated_at: string | null;
}

/** Sweep summary */
interface SweepSummary {
  enabled: boolean;
  active_count: number;
  pending_by_currency: Record<string, { total: string; count: number }>;
  recent_sweeps: {
    id: string;
    currency: string;
    amount: string;
    fee: string;
    tx_hash: string;
    credited_at: string | null;
  }[];
}

/** HD Wallet info */
interface HDWalletInfo {
  derivation: string;
  seed_source: string;
  supported_chains: string[];
}

/** Full response from /wallets/admin/rebalance/status/ */
interface FloatStatus {
  current_float_kes: string;
  target_float_kes: string;
  trigger_threshold_kes: string;
  min_rebalance_kes: string;
  needs_rebalance: boolean;
  daily_outflow_kes: string;
  days_of_coverage: number | null;
  float_source: string;
  float_last_synced: string | null;
  execution_mode: string;
  available_crypto: Record<string, CryptoBalance>;
  fee_balances: Record<string, string>;
  hd_wallet: HDWalletInfo;
  unsettled_deposits: Record<string, { total: string; count: number }>;
  sweep: SweepSummary;
  active_orders: ActiveOrder[];
  recent_completed: CompletedOrder[];
  is_in_cooldown: boolean;
  circuit_breaker: CircuitBreakerStatus;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatKES(amount: number): string {
  return `KES ${amount.toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type BreakerState = CircuitBreakerStatus["state"];

/** Map circuit breaker state to a display-friendly label */
function getBreakerLabel(state: BreakerState): string {
  switch (state) {
    case "closed": return "Healthy";
    case "half_open": return "Warning";
    case "open": return "Emergency";
    default: return state;
  }
}

function getStatusColor(state: BreakerState): string {
  switch (state) {
    case "closed":
      return colors.success;
    case "half_open":
      return colors.warning;
    case "open":
      return "#DC2626";
    default:
      return colors.textMuted;
  }
}

/** Parse a string KES value from backend to number, defaulting to 0 */
function parseKES(val: string | number | null | undefined): number {
  if (val == null || val === "unknown") return 0;
  const n = typeof val === "number" ? val : parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function getFloatColor(balance: number, target: number): string {
  const ratio = balance / (target || 1);
  if (ratio >= 0.8) return colors.success;
  if (ratio >= 0.5) return colors.warning;
  return colors.error;
}

const CURRENCY_OPTIONS = ["USDT", "USDC", "BTC", "ETH", "SOL"] as const;

// ── StatusBadge ──────────────────────────────────────────────────────────────

function StatusBadge({ state }: { state: BreakerState }) {
  const color = getStatusColor(state);
  const label = getBreakerLabel(state);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: color + "18",
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 5,
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: color,
        }}
      />
      <Text
        style={{
          color,
          fontSize: 12,
          fontFamily: "DMSans_700Bold",
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

// ── OrderRow ─────────────────────────────────────────────────────────────────

function OrderRow({
  order,
  onConfirm,
  onFail,
  onCancel,
  tc,
  ts,
}: {
  order: ActiveOrder;
  onConfirm: (id: string) => void;
  onFail: (id: string) => void;
  onCancel: (id: string) => void;
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
}) {
  const statusColor =
    order.status === "pending"
      ? colors.warning
      : order.status === "submitted"
        ? colors.info
        : colors.primary[400];

  const expectedKes = parseKES(order.expected_kes);

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: tc.glass.border,
        gap: 12,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: statusColor + "18",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons
          name={
            order.status === "pending"
              ? "time-outline"
              : order.status === "submitted"
                ? "paper-plane-outline"
                : "swap-horizontal-outline"
          }
          size={18}
          color={statusColor}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 14,
            fontFamily: "DMSans_600SemiBold",
          }}
        >
          Sell {parseFloat(order.sell_amount).toLocaleString()} {order.sell_currency}
        </Text>
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 12,
            fontFamily: "DMSans_400Regular",
            marginTop: 2,
          }}
        >
          {order.status.toUpperCase()} -- ~{formatKES(expectedKes)} -- {Math.round(order.age_minutes)}m ago
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 6 }}>
        <Pressable
          onPress={() => onConfirm(order.id)}
          accessibilityRole="button"
          accessibilityLabel="Confirm settlement"
          style={({ pressed }: any) => ({
            backgroundColor: colors.success + "20",
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 6,
            opacity: pressed ? 0.7 : 1,
            ...(isWeb ? ({ cursor: "pointer" } as any) : {}),
          })}
        >
          <Text style={{ color: colors.success, fontSize: 11, fontFamily: "DMSans_700Bold" }}>
            Confirm
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onFail(order.id)}
          accessibilityRole="button"
          accessibilityLabel="Mark order as failed"
          style={({ pressed }: any) => ({
            backgroundColor: colors.warning + "20",
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 6,
            opacity: pressed ? 0.7 : 1,
            ...(isWeb ? ({ cursor: "pointer" } as any) : {}),
          })}
        >
          <Text style={{ color: colors.warning, fontSize: 11, fontFamily: "DMSans_700Bold" }}>
            Fail
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onCancel(order.id)}
          accessibilityRole="button"
          accessibilityLabel="Cancel order"
          style={({ pressed }: any) => ({
            backgroundColor: colors.error + "20",
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 6,
            opacity: pressed ? 0.7 : 1,
            ...(isWeb ? ({ cursor: "pointer" } as any) : {}),
          })}
        >
          <Text style={{ color: colors.error, fontSize: 11, fontFamily: "DMSans_700Bold" }}>
            Cancel
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── CompletionRow ────────────────────────────────────────────────────────────

function CompletionRow({
  order,
  tc,
}: {
  order: CompletedOrder;
  tc: ReturnType<typeof getThemeColors>;
}) {
  const kesReceived = parseKES(order.kes_received);
  const slippage = parseKES(order.slippage);
  const slippageColor = Math.abs(slippage) <= 5000 ? colors.success : Math.abs(slippage) > 20000 ? colors.error : colors.warning;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: tc.glass.border,
        gap: 12,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          backgroundColor: colors.success + "18",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="checkmark-done-outline" size={16} color={colors.success} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 13,
            fontFamily: "DMSans_500Medium",
          }}
        >
          {formatKES(kesReceived)} received
        </Text>
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 11,
            fontFamily: "DMSans_400Regular",
            marginTop: 2,
          }}
        >
          {order.completed_at ? formatAge(order.completed_at) : "N/A"}
        </Text>
      </View>
      <View
        style={{
          backgroundColor: slippageColor + "18",
          borderRadius: 6,
          paddingHorizontal: 8,
          paddingVertical: 3,
        }}
      >
        <Text
          style={{
            color: slippageColor,
            fontSize: 11,
            fontFamily: "DMSans_700Bold",
          }}
        >
          {slippage >= 0 ? "+" : ""}{formatKES(slippage)} slip
        </Text>
      </View>
    </View>
  );
}

// ── MetricCard ───────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  valueColor,
  icon,
  tc,
}: {
  label: string;
  value: string;
  valueColor?: string;
  icon: keyof typeof Ionicons.glyphMap;
  tc: ReturnType<typeof getThemeColors>;
}) {
  return (
    <View style={{ flex: 1, minWidth: 140, padding: 14, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons name={icon} size={14} color={tc.textMuted} />
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 11,
            fontFamily: "DMSans_500Medium",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          {label}
        </Text>
      </View>
      <Text
        style={{
          color: valueColor || tc.textPrimary,
          fontSize: 18,
          fontFamily: "DMSans_700Bold",
          letterSpacing: -0.3,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

// ── Main Screen ──────────────────────────────────────────────────────────────

export default function AdminRebalanceScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);

  // Route-level admin protection: redirect non-staff users
  useEffect(() => {
    if (user && !user.is_staff) {
      router.replace("/(tabs)" as any);
    }
  }, [user, router]);

  // State
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FloatStatus | null>(null);

  // Trigger rebalance
  const [selectedCurrency, setSelectedCurrency] = useState<string>("USDT");
  const [forceRebalance, setForceRebalance] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);

  // Confirm settlement modal
  const [confirmOrderId, setConfirmOrderId] = useState<string | null>(null);
  const [kesReceived, setKesReceived] = useState("");
  const [exchangeRef, setExchangeRef] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [confirming, setConfirming] = useState(false);

  // Pulse animation for circuit breaker
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const horizontalPadding = isDesktop ? 48 : 20;

  // ── Fetch data ───────────────────────────────────────────────────────────

  const fetchStatus = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await api.get("/wallets/admin/rebalance/status/");
        setData(res.data);
      } catch (err: any) {
        const msg =
          err?.response?.data?.detail ||
          err?.response?.data?.error ||
          err?.message ||
          "Failed to load rebalance status";
        setError(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  // Initial load + auto-refresh every 30s
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => fetchStatus(true), 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Pulse animation for non-healthy status
  useEffect(() => {
    if (data && data.circuit_breaker?.state !== "closed") {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.6,
            duration: 1000,
            useNativeDriver: Platform.OS !== "web",
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: Platform.OS !== "web",
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [data?.circuit_breaker?.state]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleTriggerRebalance = useCallback(async () => {
    setTriggering(true);
    try {
      await api.post("/wallets/admin/rebalance/trigger/", {
        sell_currency: selectedCurrency,
        force: forceRebalance,
      });
      await fetchStatus(true);
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        "Failed to trigger rebalance";
      setError(msg);
    } finally {
      setTriggering(false);
    }
  }, [selectedCurrency, forceRebalance, fetchStatus]);

  const handleCancelOrder = useCallback(
    async (orderId: string) => {
      try {
        await api.post(`/wallets/admin/rebalance/${orderId}/cancel/`);
        await fetchStatus(true);
      } catch (err: any) {
        const msg = err?.response?.data?.detail || "Failed to cancel order";
        setError(msg);
      }
    },
    [fetchStatus],
  );

  const handleFailOrder = useCallback(
    async (orderId: string) => {
      try {
        await api.post(`/wallets/admin/rebalance/${orderId}/fail/`, {
          error_message: "Marked failed by admin",
        });
        await fetchStatus(true);
      } catch (err: any) {
        const msg = err?.response?.data?.detail || "Failed to mark order as failed";
        setError(msg);
      }
    },
    [fetchStatus],
  );

  const handleConfirmSettlement = useCallback(async () => {
    if (!confirmOrderId) return;
    setConfirming(true);
    try {
      await api.post(`/wallets/admin/rebalance/${confirmOrderId}/confirm/`, {
        kes_received: parseFloat(kesReceived) || 0,
        exchange_reference: exchangeRef,
        admin_notes: adminNotes,
      });
      setConfirmOrderId(null);
      setKesReceived("");
      setExchangeRef("");
      setAdminNotes("");
      await fetchStatus(true);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || "Failed to confirm settlement";
      setError(msg);
    } finally {
      setConfirming(false);
    }
  }, [confirmOrderId, kesReceived, exchangeRef, adminNotes, fetchStatus]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchStatus();
  }, [fetchStatus]);

  // ── Render ───────────────────────────────────────────────────────────────

  // Guard: don't render anything for non-staff
  if (!user?.is_staff) return null;

  if (loading && !data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16 }}>
          <Spinner size={32} color={colors.primary[500]} />
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 14,
              fontFamily: "DMSans_500Medium",
            }}
          >
            Loading float status...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary[500]}
          />
        }
        contentContainerStyle={{
          paddingHorizontal: horizontalPadding,
          paddingTop: isDesktop ? 12 : 8,
          paddingBottom: 40,
        }}
      >
        {/* Back button */}
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/settings" as any);
          }}
          style={({ pressed, hovered }: any) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 12,
            backgroundColor: hovered
              ? tc.glass.highlight
              : pressed
                ? tc.dark.elevated
                : "transparent",
            alignSelf: "flex-start",
            marginBottom: 8,
            opacity: pressed ? 0.9 : 1,
            ...(isWeb
              ? ({
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  transform: hovered ? "translateX(-2px)" : "translateX(0px)",
                } as any)
              : {}),
          })}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
          <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_500Medium" }}>
            Back
          </Text>
        </Pressable>

        {/* Page title */}
        <View style={{ marginBottom: isDesktop ? 28 : 20, paddingHorizontal: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: isDesktop ? 32 : 26,
                fontFamily: "DMSans_700Bold",
                letterSpacing: -0.5,
              }}
            >
              Float Management
            </Text>
            {data && <StatusBadge state={data.circuit_breaker?.state ?? "closed"} />}
          </View>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: isDesktop ? 16 : 14,
              marginTop: 4,
              lineHeight: 22,
              fontFamily: "DMSans_400Regular",
            }}
          >
            Monitor and manage KES float for M-Pesa payouts
          </Text>
        </View>

        {/* Error banner */}
        {error && (
          <Pressable
            onPress={() => setError(null)}
            style={{
              backgroundColor: colors.error + "18",
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.error + "40",
              padding: 14,
              marginBottom: 20,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Ionicons name="alert-circle" size={20} color={colors.error} />
            <Text
              style={{
                color: colors.error,
                fontSize: 13,
                fontFamily: "DMSans_500Medium",
                flex: 1,
              }}
            >
              {error}
            </Text>
            <Ionicons name="close" size={16} color={colors.error} />
          </Pressable>
        )}

        {data && (() => {
          const floatBal = parseKES(data.current_float_kes);
          const targetBal = parseKES(data.target_float_kes);
          const triggerBal = parseKES(data.trigger_threshold_kes);
          const daysCov = data.days_of_coverage;
          const breakerState = data.circuit_breaker?.state ?? "closed";

          return (
          <>
            {/* ── Float Overview Card ─────────────────────────────────── */}
            <GlassCard
              style={{ marginBottom: 20, padding: 0 }}
              glowColor={getFloatColor(floatBal, targetBal)}
              glowOpacity={0.15}
            >
              <View style={{ padding: isDesktop ? 24 : 20 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 }}>
                  <Ionicons name="wallet-outline" size={18} color={tc.textSecondary} />
                  <Text
                    style={{
                      color: tc.textSecondary,
                      fontSize: 13,
                      fontFamily: "DMSans_600SemiBold",
                      textTransform: "uppercase",
                      letterSpacing: 0.8,
                    }}
                  >
                    KES Float Balance
                  </Text>
                  <View style={{ flex: 1 }} />
                  <Text style={{ color: tc.textMuted, fontSize: 10, fontFamily: "DMSans_400Regular" }}>
                    {data.float_source ?? "M-Pesa"}
                  </Text>
                </View>
                <Animated.Text
                  style={{
                    color: getFloatColor(floatBal, targetBal),
                    fontSize: isDesktop ? 42 : 34,
                    fontFamily: "DMSans_700Bold",
                    letterSpacing: -1,
                    opacity: breakerState !== "closed" ? pulseAnim : 1,
                  }}
                >
                  {data.current_float_kes === "unknown" ? "Unknown" : formatKES(floatBal)}
                </Animated.Text>

                {/* Progress bar */}
                <View
                  style={{
                    height: 6,
                    backgroundColor: tc.dark.elevated,
                    borderRadius: 3,
                    marginTop: 16,
                    marginBottom: 8,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      height: "100%",
                      width: `${Math.min(100, (floatBal / (targetBal || 1)) * 100)}%`,
                      backgroundColor: getFloatColor(floatBal, targetBal),
                      borderRadius: 3,
                    }}
                  />
                </View>
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 11,
                    fontFamily: "DMSans_400Regular",
                  }}
                >
                  {Math.round((floatBal / (targetBal || 1)) * 100)}% of target
                </Text>
              </View>

              {/* Metrics row */}
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  borderTopWidth: 1,
                  borderTopColor: tc.glass.border,
                }}
              >
                <MetricCard
                  label="Target Float"
                  value={formatKES(targetBal)}
                  icon="flag-outline"
                  tc={tc}
                />
                <MetricCard
                  label="Trigger At"
                  value={formatKES(triggerBal)}
                  icon="trending-down-outline"
                  valueColor={colors.warning}
                  tc={tc}
                />
                <MetricCard
                  label="Days Coverage"
                  value={daysCov != null ? `${daysCov.toFixed(1)} days` : "N/A"}
                  icon="calendar-outline"
                  valueColor={daysCov == null ? tc.textMuted : daysCov >= 3 ? colors.success : daysCov >= 1 ? colors.warning : colors.error}
                  tc={tc}
                />
                <MetricCard
                  label="24h Outflow"
                  value={formatKES(parseKES(data.daily_outflow_kes))}
                  icon="arrow-up-outline"
                  valueColor={colors.error}
                  tc={tc}
                />
              </View>
            </GlassCard>

            {/* ── Rebalance Pipeline ──────────────────────────────── */}
            <GlassCard style={{ marginBottom: 20, padding: isDesktop ? 24 : 20 }} noGlow>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 18 }}>
                <Ionicons name="git-network-outline" size={18} color={colors.primary[400]} />
                <Text style={{ color: tc.textPrimary, fontSize: 16, fontFamily: "DMSans_700Bold" }}>
                  Rebalance Flow
                </Text>
              </View>
              <View style={{
                flexDirection: isDesktop ? "row" : "column",
                gap: isDesktop ? 0 : 12,
                alignItems: isDesktop ? "center" : "stretch",
              }}>
                {[
                  { icon: "trending-down-outline" as const, label: "Float Low", desc: `Trigger at ${formatKES(triggerBal)}`, active: data.needs_rebalance },
                  { icon: "swap-horizontal-outline" as const, label: "Sell Crypto", desc: `From HOT wallet on Yellow Card`, active: data.active_orders.length > 0 },
                  { icon: "cash-outline" as const, label: "KES to M-Pesa", desc: "Settlement via bank transfer", active: data.active_orders.some(o => o.status === "settling") },
                  { icon: "shield-checkmark-outline" as const, label: "Float Updated", desc: "SystemWallet synced", active: false },
                  { icon: "pulse-outline" as const, label: "Breaker Recovers", desc: breakerState === "closed" ? "Normal ops" : "Waiting...", active: breakerState !== "closed" },
                ].map((step, i, arr) => (
                  <View key={i} style={{ flexDirection: isDesktop ? "row" : "row", alignItems: "center", flex: isDesktop ? 1 : undefined }}>
                    <View style={{
                      alignItems: "center",
                      flex: isDesktop ? 1 : undefined,
                      flexDirection: isDesktop ? "column" : "row",
                      gap: isDesktop ? 6 : 12,
                    }}>
                      <View style={{
                        width: 40, height: 40, borderRadius: 12,
                        backgroundColor: step.active ? colors.primary[500] + "20" : tc.dark.elevated,
                        alignItems: "center", justifyContent: "center",
                        borderWidth: step.active ? 1.5 : 0,
                        borderColor: step.active ? colors.primary[500] + "60" : "transparent",
                      }}>
                        <Ionicons name={step.icon} size={18} color={step.active ? colors.primary[400] : tc.textMuted} />
                      </View>
                      <View style={{ alignItems: isDesktop ? "center" : "flex-start" }}>
                        <Text style={{ color: step.active ? tc.textPrimary : tc.textSecondary, fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>
                          {step.label}
                        </Text>
                        <Text style={{ color: tc.textMuted, fontSize: 10, fontFamily: "DMSans_400Regular", marginTop: 1, textAlign: isDesktop ? "center" : "left" }}>
                          {step.desc}
                        </Text>
                      </View>
                    </View>
                    {isDesktop && i < arr.length - 1 && (
                      <Ionicons name="chevron-forward" size={14} color={tc.textMuted} style={{ marginHorizontal: 4 }} />
                    )}
                  </View>
                ))}
              </View>
            </GlassCard>

            {/* ── Hot Wallet / Crypto Balances ─────────────────────── */}
            <GlassCard style={{ marginBottom: 20, padding: 0 }} noGlow>
              <View style={{
                flexDirection: "row", alignItems: "center", gap: 8,
                padding: isDesktop ? 20 : 16,
                borderBottomWidth: 1, borderBottomColor: tc.glass.border,
              }}>
                <Ionicons name="server-outline" size={18} color={colors.info} />
                <Text style={{ color: tc.textPrimary, fontSize: 16, fontFamily: "DMSans_700Bold" }}>
                  Hot Wallet (Crypto)
                </Text>
                <View style={{ flex: 1 }} />
                <View style={{
                  backgroundColor: colors.info + "18", borderRadius: 8,
                  paddingHorizontal: 8, paddingVertical: 3,
                }}>
                  <Text style={{ color: colors.info, fontSize: 10, fontFamily: "DMSans_600SemiBold" }}>
                    {data.hd_wallet?.derivation ?? "BIP-44"}
                  </Text>
                </View>
              </View>
              {/* Seed source info */}
              <View style={{
                flexDirection: "row", alignItems: "center", gap: 6,
                paddingHorizontal: isDesktop ? 20 : 16, paddingTop: 12, paddingBottom: 4,
              }}>
                <Ionicons name="key-outline" size={12} color={tc.textMuted} />
                <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular" }}>
                  Seed: {data.hd_wallet?.seed_source ?? "Unknown"}
                </Text>
              </View>
              {/* Crypto balances */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", padding: isDesktop ? 12 : 8 }}>
                {Object.keys(data.available_crypto ?? {}).length === 0 ? (
                  <View style={{ padding: 20, alignItems: "center", width: "100%" }}>
                    <Text style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_500Medium" }}>
                      No hot wallet balances configured
                    </Text>
                  </View>
                ) : (
                  Object.entries(data.available_crypto).map(([currency, info]) => {
                    const bal = parseKES(typeof info === "string" ? info : info.balance);
                    const updatedAt = typeof info === "object" ? info.updated_at : null;
                    const unsettled = data.unsettled_deposits?.[currency];
                    return (
                      <View key={currency} style={{
                        flex: 1, minWidth: isDesktop ? 180 : 140,
                        padding: 14, margin: 4,
                        backgroundColor: tc.dark.elevated,
                        borderRadius: 14, borderWidth: 1,
                        borderColor: tc.glass.border,
                      }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                          <View style={{
                            width: 28, height: 28, borderRadius: 8,
                            backgroundColor: colors.primary[500] + "15",
                            alignItems: "center", justifyContent: "center",
                          }}>
                            <Text style={{ color: colors.primary[400], fontSize: 11, fontFamily: "DMSans_700Bold" }}>
                              {currency}
                            </Text>
                          </View>
                          <Text style={{ color: tc.textPrimary, fontSize: 15, fontFamily: "DMSans_700Bold" }}>
                            {bal.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                          </Text>
                        </View>
                        <Text style={{ color: tc.textMuted, fontSize: 10, fontFamily: "DMSans_400Regular" }}>
                          Hot Wallet Balance
                        </Text>
                        {unsettled && (
                          <View style={{ marginTop: 6, flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <Ionicons name="hourglass-outline" size={10} color={colors.warning} />
                            <Text style={{ color: colors.warning, fontSize: 10, fontFamily: "DMSans_500Medium" }}>
                              {unsettled.count} unsettled ({parseKES(unsettled.total).toLocaleString(undefined, { maximumFractionDigits: 4 })})
                            </Text>
                          </View>
                        )}
                        {updatedAt ? (
                          <Text style={{ color: tc.textMuted, fontSize: 9, fontFamily: "DMSans_400Regular", marginTop: 4 }}>
                            Updated {formatAge(updatedAt)}
                          </Text>
                        ) : null}
                      </View>
                    );
                  })
                )}
              </View>
            </GlassCard>

            {/* ── Sweep / Consolidation ────────────────────────────── */}
            <GlassCard style={{ marginBottom: 20, padding: isDesktop ? 24 : 20 }} noGlow>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <Ionicons name="download-outline" size={18} color={colors.primary[400]} />
                <Text style={{ color: tc.textPrimary, fontSize: 16, fontFamily: "DMSans_700Bold" }}>
                  Sweep / Consolidation
                </Text>
                <View style={{ flex: 1 }} />
                <View style={{
                  backgroundColor: (data.sweep?.enabled ? colors.success : colors.warning) + "18",
                  borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
                }}>
                  <Text style={{
                    color: data.sweep?.enabled ? colors.success : colors.warning,
                    fontSize: 10, fontFamily: "DMSans_700Bold",
                  }}>
                    {data.sweep?.enabled ? "ACTIVE" : "PENDING SETUP"}
                  </Text>
                </View>
              </View>
              <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular", lineHeight: 18, marginBottom: 14 }}>
                Consolidates user deposit addresses into the platform hot wallet. Funds are swept after deposits are confirmed and credited.
              </Text>
              {/* Unsettled deposits summary */}
              {Object.keys(data.unsettled_deposits ?? {}).length > 0 && (
                <View style={{
                  backgroundColor: tc.dark.elevated, borderRadius: 12,
                  padding: 14, marginBottom: 12,
                }}>
                  <Text style={{ color: tc.textSecondary, fontSize: 11, fontFamily: "DMSans_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                    Awaiting Sweep
                  </Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                    {Object.entries(data.unsettled_deposits).map(([cur, info]) => (
                      <View key={cur} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_700Bold" }}>
                          {parseKES(info.total).toLocaleString(undefined, { maximumFractionDigits: 4 })} {cur}
                        </Text>
                        <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular" }}>
                          ({info.count} txns)
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
              {/* Recent sweeps */}
              {(data.sweep?.recent_sweeps ?? []).length > 0 && (
                <View>
                  <Text style={{ color: tc.textSecondary, fontSize: 11, fontFamily: "DMSans_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                    Recent Sweeps
                  </Text>
                  {data.sweep.recent_sweeps.map((s) => (
                    <View key={s.id} style={{
                      flexDirection: "row", alignItems: "center", gap: 10,
                      paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: tc.glass.border,
                    }}>
                      <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                      <Text style={{ color: tc.textPrimary, fontSize: 13, fontFamily: "DMSans_500Medium", flex: 1 }}>
                        {parseKES(s.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })} {s.currency}
                      </Text>
                      <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular" }}>
                        Fee: {s.fee}
                      </Text>
                      {s.tx_hash ? (
                        <Text style={{ color: colors.info, fontSize: 10, fontFamily: "DMSans_400Regular" }}>
                          {s.tx_hash}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              )}
              {(data.sweep?.recent_sweeps ?? []).length === 0 && Object.keys(data.unsettled_deposits ?? {}).length === 0 && (
                <View style={{ alignItems: "center", gap: 6, paddingVertical: 8 }}>
                  <Ionicons name="checkmark-circle-outline" size={24} color={tc.textMuted} />
                  <Text style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_500Medium" }}>
                    No pending sweeps
                  </Text>
                </View>
              )}
            </GlassCard>

            {/* ── Active Orders ────────────────────────────────────── */}
            <GlassCard style={{ marginBottom: 20, padding: 0 }} noGlow>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: isDesktop ? 20 : 16,
                  borderBottomWidth: 1,
                  borderBottomColor: tc.glass.border,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="swap-vertical-outline" size={18} color={colors.primary[400]} />
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 16,
                      fontFamily: "DMSans_700Bold",
                    }}
                  >
                    Active Orders
                  </Text>
                </View>
                {data.active_orders.length > 0 && (
                  <View
                    style={{
                      backgroundColor: colors.warning + "20",
                      borderRadius: 10,
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                    }}
                  >
                    <Text
                      style={{
                        color: colors.warning,
                        fontSize: 12,
                        fontFamily: "DMSans_700Bold",
                      }}
                    >
                      {data.active_orders.length}
                    </Text>
                  </View>
                )}
              </View>

              {data.active_orders.length === 0 ? (
                <View style={{ padding: 32, alignItems: "center", gap: 8 }}>
                  <Ionicons name="checkmark-circle-outline" size={32} color={tc.textMuted} />
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 14,
                      fontFamily: "DMSans_500Medium",
                    }}
                  >
                    No active orders
                  </Text>
                </View>
              ) : (
                data.active_orders.map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    onConfirm={(id) => setConfirmOrderId(id)}
                    onFail={handleFailOrder}
                    onCancel={handleCancelOrder}
                    tc={tc}
                    ts={ts}
                  />
                ))
              )}
            </GlassCard>

            {/* ── Trigger Rebalance ───────────────────────────────── */}
            <GlassCard style={{ marginBottom: 20, padding: isDesktop ? 24 : 20 }} noGlow>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 18 }}>
                <Ionicons name="flash-outline" size={18} color={colors.primary[400]} />
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: 16,
                    fontFamily: "DMSans_700Bold",
                  }}
                >
                  Trigger Rebalance
                </Text>
              </View>

              {/* Currency selector */}
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 12,
                  fontFamily: "DMSans_600SemiBold",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  marginBottom: 8,
                }}
              >
                Sell Currency
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
                {CURRENCY_OPTIONS.map((cur) => {
                  const isSelected = selectedCurrency === cur;
                  return (
                    <Pressable
                      key={cur}
                      onPress={() => setSelectedCurrency(cur)}
                      style={({ pressed, hovered }: any) => ({
                        paddingHorizontal: 16,
                        paddingVertical: 10,
                        borderRadius: 12,
                        borderWidth: 1.5,
                        borderColor: isSelected
                          ? colors.primary[500]
                          : tc.glass.border,
                        backgroundColor: isSelected
                          ? colors.primary[500] + "18"
                          : hovered
                            ? tc.glass.highlight
                            : "transparent",
                        opacity: pressed ? 0.7 : 1,
                        ...(isWeb ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any) : {}),
                      })}
                    >
                      <Text
                        style={{
                          color: isSelected ? colors.primary[400] : tc.textSecondary,
                          fontSize: 14,
                          fontFamily: isSelected ? "DMSans_700Bold" : "DMSans_500Medium",
                        }}
                      >
                        {cur}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Force toggle */}
              <Pressable
                onPress={() => setForceRebalance(!forceRebalance)}
                style={({ hovered }: any) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  backgroundColor: hovered ? tc.glass.highlight : "transparent",
                  marginBottom: 20,
                  ...(isWeb ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any) : {}),
                })}
              >
                <View
                  style={{
                    width: 44,
                    height: 26,
                    borderRadius: 13,
                    backgroundColor: forceRebalance ? colors.warning : tc.dark.elevated,
                    justifyContent: "center",
                    paddingHorizontal: 3,
                  }}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      backgroundColor: "#FFFFFF",
                      alignSelf: forceRebalance ? "flex-end" : "flex-start",
                      ...(isWeb ? ({ transition: "all 0.2s ease" } as any) : {}),
                      ...ts.sm,
                    }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 14,
                      fontFamily: "DMSans_600SemiBold",
                    }}
                  >
                    Force Rebalance
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 12,
                      fontFamily: "DMSans_400Regular",
                      marginTop: 2,
                    }}
                  >
                    Bypass threshold checks and force an immediate rebalance
                  </Text>
                </View>
              </Pressable>

              {/* Trigger button */}
              <Pressable
                onPress={handleTriggerRebalance}
                disabled={triggering}
                style={({ pressed, hovered }: any) => ({
                  backgroundColor: triggering
                    ? colors.primary[700]
                    : hovered
                      ? colors.primary[400]
                      : colors.primary[500],
                  borderRadius: 14,
                  paddingVertical: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 8,
                  maxWidth: 420,
                  opacity: pressed ? 0.85 : 1,
                  ...ts.md,
                  ...(isWeb
                    ? ({
                        cursor: triggering ? "not-allowed" : "pointer",
                        transition: "all 0.2s ease",
                      } as any)
                    : {}),
                })}
              >
                {triggering ? (
                  <Spinner size={16} color="#FFFFFF" />
                ) : (
                  <Ionicons name="flash" size={18} color="#FFFFFF" />
                )}
                <Text
                  style={{
                    color: "#FFFFFF",
                    fontSize: 15,
                    fontFamily: "DMSans_700Bold",
                  }}
                >
                  {triggering ? "Triggering..." : `Sell ${selectedCurrency} for KES`}
                </Text>
              </Pressable>
            </GlassCard>

            {/* ── Recent Completions ──────────────────────────────── */}
            <GlassCard style={{ marginBottom: 20, padding: 0 }} noGlow>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  padding: isDesktop ? 20 : 16,
                  borderBottomWidth: 1,
                  borderBottomColor: tc.glass.border,
                }}
              >
                <Ionicons name="receipt-outline" size={18} color={colors.primary[400]} />
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: 16,
                    fontFamily: "DMSans_700Bold",
                  }}
                >
                  Recent Completions
                </Text>
              </View>

              {(data.recent_completed ?? []).length === 0 ? (
                <View style={{ padding: 32, alignItems: "center", gap: 8 }}>
                  <Ionicons name="document-outline" size={32} color={tc.textMuted} />
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 14,
                      fontFamily: "DMSans_500Medium",
                    }}
                  >
                    No recent completions
                  </Text>
                </View>
              ) : (
                (data.recent_completed ?? []).slice(0, 5).map((order) => (
                  <CompletionRow key={order.id} order={order} tc={tc} />
                ))
              )}
            </GlassCard>
          </>
          );
        })()}
      </ScrollView>

      {/* ── Confirm Settlement Modal ──────────────────────────────────────── */}
      <Modal
        visible={!!confirmOrderId}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmOrderId(null)}
      >
        <Pressable
          onPress={() => setConfirmOrderId(null)}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.6)",
            justifyContent: "center",
            alignItems: "center",
            padding: 20,
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: tc.dark.card,
              borderRadius: 24,
              borderWidth: 1,
              borderColor: tc.glass.borderStrong,
              width: "100%",
              maxWidth: 460,
              padding: isDesktop ? 28 : 24,
              ...ts.lg,
            }}
          >
            {/* Modal header */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
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
                  <Ionicons name="checkmark-circle-outline" size={22} color={colors.success} />
                </View>
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: 18,
                    fontFamily: "DMSans_700Bold",
                  }}
                >
                  Confirm Settlement
                </Text>
              </View>
              <Pressable
                onPress={() => setConfirmOrderId(null)}
                style={({ pressed }: any) => ({
                  padding: 6,
                  borderRadius: 8,
                  opacity: pressed ? 0.6 : 1,
                  ...(isWeb ? ({ cursor: "pointer" } as any) : {}),
                })}
              >
                <Ionicons name="close" size={22} color={tc.textMuted} />
              </Pressable>
            </View>

            {/* KES received */}
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: 12,
                fontFamily: "DMSans_600SemiBold",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                marginBottom: 6,
              }}
            >
              KES Received
            </Text>
            <TextInput
              value={kesReceived}
              onChangeText={setKesReceived}
              placeholder="0.00"
              placeholderTextColor={tc.textMuted}
              keyboardType="numeric"
              style={{
                backgroundColor: tc.dark.elevated,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: tc.glass.border,
                paddingHorizontal: 14,
                paddingVertical: 12,
                color: tc.textPrimary,
                fontSize: 16,
                fontFamily: "DMSans_600SemiBold",
                marginBottom: 16,
                ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
              }}
            />

            {/* Exchange ref */}
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: 12,
                fontFamily: "DMSans_600SemiBold",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                marginBottom: 6,
              }}
            >
              Exchange Reference
            </Text>
            <TextInput
              value={exchangeRef}
              onChangeText={setExchangeRef}
              placeholder="e.g. TRX-12345"
              placeholderTextColor={tc.textMuted}
              style={{
                backgroundColor: tc.dark.elevated,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: tc.glass.border,
                paddingHorizontal: 14,
                paddingVertical: 12,
                color: tc.textPrimary,
                fontSize: 14,
                fontFamily: "DMSans_500Medium",
                marginBottom: 16,
                ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
              }}
            />

            {/* Admin notes */}
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: 12,
                fontFamily: "DMSans_600SemiBold",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                marginBottom: 6,
              }}
            >
              Admin Notes
            </Text>
            <TextInput
              value={adminNotes}
              onChangeText={setAdminNotes}
              placeholder="Optional notes..."
              placeholderTextColor={tc.textMuted}
              multiline
              numberOfLines={3}
              style={{
                backgroundColor: tc.dark.elevated,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: tc.glass.border,
                paddingHorizontal: 14,
                paddingVertical: 12,
                color: tc.textPrimary,
                fontSize: 14,
                fontFamily: "DMSans_500Medium",
                minHeight: 80,
                textAlignVertical: "top",
                marginBottom: 24,
                ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
              }}
            />

            {/* Confirm button */}
            <Pressable
              onPress={handleConfirmSettlement}
              disabled={confirming || !kesReceived}
              style={({ pressed, hovered }: any) => ({
                backgroundColor:
                  confirming || !kesReceived
                    ? colors.primary[700]
                    : hovered
                      ? colors.primary[400]
                      : colors.primary[500],
                borderRadius: 14,
                paddingVertical: 14,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: 8,
                opacity: pressed ? 0.85 : !kesReceived ? 0.5 : 1,
                ...(isWeb
                  ? ({
                      cursor: confirming || !kesReceived ? "not-allowed" : "pointer",
                      transition: "all 0.2s ease",
                    } as any)
                  : {}),
              })}
            >
              {confirming ? (
                <Spinner size={16} color="#FFFFFF" />
              ) : (
                <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
              )}
              <Text
                style={{
                  color: "#FFFFFF",
                  fontSize: 15,
                  fontFamily: "DMSans_700Bold",
                }}
              >
                {confirming ? "Confirming..." : "Confirm Settlement"}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
