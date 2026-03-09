import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  Platform,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BalanceCard } from "../../src/components/BalanceCard";
import { QuickAction } from "../../src/components/QuickAction";
import { TransactionItem } from "../../src/components/TransactionItem";
import { RateTicker } from "../../src/components/RateTicker";
import {
  BalanceCardSkeleton,
  TransactionSkeleton,
} from "../../src/components/Skeleton";
import { useWallets } from "../../src/hooks/useWallets";
import { useTransactions } from "../../src/hooks/useTransactions";
import { useAuth } from "../../src/stores/auth";
import { ratesApi, Rate, normalizeRate } from "../../src/api/rates";
import { Transaction, getTxKesAmount } from "../../src/api/payments";
import { colors, shadows, CURRENCIES } from "../../src/constants/theme";
import {
  CryptoChart,
  SparklineChart,
  generateMockHistory,
  ChartDataPoint,
} from "../../src/components/CryptoChart";

function useRates() {
  return useQuery<Rate[]>({
    queryKey: ["rates"],
    queryFn: async () => {
      const currencies = ["USDT", "BTC", "ETH", "SOL"];
      const results = await Promise.all(
        currencies.map(async (c) => {
          try {
            const { data } = await ratesApi.getRate(c);
            return normalizeRate(data);
          } catch {
            return null;
          }
        })
      );
      return results.filter(Boolean) as Rate[];
    },
    refetchInterval: 30000,
  });
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getInitials(name: string | undefined): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0][0].toUpperCase();
}

/* ─── Helpers to derive chart data from transactions ─── */
const DAY_ABBREVS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getLast7DayLabels(): string[] {
  const labels: string[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    labels.push(DAY_ABBREVS[d.getDay()]);
  }
  return labels;
}

function getLast7DayTotals(transactions: Transaction[]): number[] {
  const now = new Date();
  const totals: number[] = [0, 0, 0, 0, 0, 0, 0];

  for (const tx of transactions) {
    const txDate = new Date(tx.created_at);
    const diffMs = now.getTime() - txDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    // Index 6 = today, 5 = yesterday, ..., 0 = 6 days ago
    if (diffDays >= 0 && diffDays < 7) {
      const index = 6 - diffDays;
      totals[index] += getTxKesAmount(tx);
    }
  }

  return totals;
}

function computeChangePercent(transactions: Transaction[]): string {
  const now = new Date();
  const last24h = transactions.filter((tx) => {
    const txDate = new Date(tx.created_at);
    return now.getTime() - txDate.getTime() <= 24 * 60 * 60 * 1000;
  });
  const prev24h = transactions.filter((tx) => {
    const txDate = new Date(tx.created_at);
    const diffMs = now.getTime() - txDate.getTime();
    return diffMs > 24 * 60 * 60 * 1000 && diffMs <= 48 * 60 * 60 * 1000;
  });

  const currentTotal = last24h.reduce(
    (sum, tx) => sum + getTxKesAmount(tx),
    0
  );
  const previousTotal = prev24h.reduce(
    (sum, tx) => sum + getTxKesAmount(tx),
    0
  );

  if (previousTotal === 0) {
    if (currentTotal > 0) return "+100.00%";
    return "+0.00%";
  }

  const change = ((currentTotal - previousTotal) / previousTotal) * 100;
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(2)}%`;
}

/* ─── Mini line chart built with View elements ─── */
interface PortfolioChartProps {
  chartPoints: number[];
  chartLabels: string[];
  changePercent: string;
}

function PortfolioChart({
  chartPoints,
  chartLabels,
  changePercent,
}: PortfolioChartProps) {
  const { width: windowWidth } = useWindowDimensions();
  const isDesktopChart = Platform.OS === "web" && windowWidth >= 900;
  const chartWidth = isDesktopChart ? Math.min(windowWidth * 0.25, 400) : 280;
  const chartHeight = isDesktopChart ? 120 : 100;
  const hasData = chartPoints.some((v) => v > 0);

  const maxVal = hasData ? Math.max(...chartPoints) : 1;
  const minVal = hasData ? Math.min(...chartPoints) : 0;
  const range = maxVal - minVal || 1;

  // If no data, show a flat line in the middle
  const displayPoints = hasData ? chartPoints : chartPoints.map(() => 0.5);
  const displayMax = hasData ? maxVal : 1;
  const displayMin = hasData ? minVal : 0;
  const displayRange = displayMax - displayMin || 1;

  const points = displayPoints.map((val, i) => ({
    x: (i / (displayPoints.length - 1)) * chartWidth,
    y:
      chartHeight -
      ((val - displayMin) / displayRange) * (chartHeight - 20) -
      10,
  }));

  const isPositive = changePercent.startsWith("+");
  const trendIcon = isPositive ? "trending-up" : "trending-down";
  const trendColor = isPositive ? colors.primary[400] : colors.error;

  return (
    <View
      style={{
        backgroundColor: colors.dark.card,
        borderRadius: 20,
        padding: 20,
        borderWidth: 1,
        borderColor: colors.glass.border,
        flex: 1,
        ...shadows.md,
      }}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <View>
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: 12,
              fontFamily: "Inter_500Medium",
              letterSpacing: 0.5,
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            Portfolio Value
          </Text>
          <Text
            style={{
              color: colors.textPrimary,
              fontSize: 22,
              fontFamily: "Inter_700Bold",
            }}
          >
            7-Day Trend
          </Text>
        </View>
        <View
          style={{
            backgroundColor: trendColor + "1A",
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 5,
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
          }}
        >
          <Ionicons name={trendIcon} size={14} color={trendColor} />
          <Text
            style={{
              color: trendColor,
              fontSize: 13,
              fontFamily: "Inter_600SemiBold",
            }}
          >
            {changePercent}
          </Text>
        </View>
      </View>

      {/* Chart area */}
      <View
        style={{
          width: chartWidth,
          height: chartHeight,
          alignSelf: "center",
          position: "relative",
        }}
      >
        {/* Horizontal grid lines */}
        {[0, 1, 2].map((i) => (
          <View
            key={`grid-${i}`}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: (i / 2) * chartHeight,
              height: 1,
              backgroundColor: colors.glass.border,
            }}
          />
        ))}

        {/* Line segments */}
        {points.map((point, i) => {
          if (i === 0) return null;
          const prev = points[i - 1];
          const dx = point.x - prev.x;
          const dy = point.y - prev.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          return (
            <View
              key={`line-${i}`}
              style={{
                position: "absolute",
                left: prev.x,
                top: prev.y,
                width: length,
                height: 2,
                backgroundColor: hasData
                  ? colors.primary[400]
                  : colors.textMuted,
                borderRadius: 1,
                transform: [{ rotate: `${angle}deg` }],
                transformOrigin: "0 0",
              }}
            />
          );
        })}

        {/* Dots */}
        {points.map((point, i) => (
          <View
            key={`dot-${i}`}
            style={{
              position: "absolute",
              left: point.x - 4,
              top: point.y - 4,
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: hasData
                ? colors.primary[400]
                : colors.textMuted,
              borderWidth: 2,
              borderColor: colors.dark.card,
            }}
          />
        ))}

        {/* Glow under the line (area fill approximation) */}
        {hasData &&
          points.map((point, i) => (
            <View
              key={`glow-${i}`}
              style={{
                position: "absolute",
                left: point.x - 1,
                top: point.y,
                width: 2,
                height: chartHeight - point.y,
                backgroundColor: colors.primary[400] + "08",
              }}
            />
          ))}
      </View>

      {/* X-axis labels */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          marginTop: 10,
          paddingHorizontal: 0,
          width: chartWidth,
          alignSelf: "center",
        }}
      >
        {chartLabels.map((label, idx) => (
          <Text
            key={`${label}-${idx}`}
            style={{
              color: colors.textMuted,
              fontSize: 10,
              fontFamily: "Inter_400Regular",
              textAlign: "center",
              width: chartWidth / chartLabels.length,
            }}
          >
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

/* ─── Transaction Summary / Stats card ─── */
interface TxCategory {
  label: string;
  color: string;
  icon: string;
  count: number;
  total: number;
}

function TransactionSummary({ transactions }: { transactions: Transaction[] }) {
  const categories: TxCategory[] = [
    {
      label: "Payments",
      color: colors.primary[400],
      icon: "receipt-outline",
      count: transactions.filter(
        (t) => t.type === "PAYBILL_PAYMENT" || t.type === "TILL_PAYMENT" || t.type === "SEND_MPESA"
      ).length,
      total: transactions
        .filter(
          (t) => t.type === "PAYBILL_PAYMENT" || t.type === "TILL_PAYMENT" || t.type === "SEND_MPESA"
        )
        .reduce((sum, t) => sum + getTxKesAmount(t), 0),
    },
    {
      label: "Deposits",
      color: colors.info,
      icon: "arrow-down-circle-outline",
      count: transactions.filter((t) => t.type === "DEPOSIT").length,
      total: transactions
        .filter((t) => t.type === "DEPOSIT")
        .reduce((sum, t) => sum + getTxKesAmount(t), 0),
    },
    {
      label: "Conversions",
      color: colors.accent,
      icon: "swap-horizontal-outline",
      count: transactions.filter(
        (t) => t.type === "BUY" || t.type === "SELL"
      ).length,
      total: transactions
        .filter((t) => t.type === "BUY" || t.type === "SELL")
        .reduce((sum, t) => sum + getTxKesAmount(t), 0),
    },
  ];

  return (
    <View
      style={{
        backgroundColor: colors.dark.card,
        borderRadius: 20,
        padding: 20,
        borderWidth: 1,
        borderColor: colors.glass.border,
        flex: 1,
        ...shadows.md,
      }}
    >
      <Text
        style={{
          color: colors.textPrimary,
          fontSize: 16,
          fontFamily: "Inter_600SemiBold",
          marginBottom: 20,
        }}
      >
        Transaction Summary
      </Text>

      {categories.map((cat) => (
        <View
          key={cat.label}
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: cat.color + "1A",
              alignItems: "center",
              justifyContent: "center",
              marginRight: 12,
            }}
          >
            <Ionicons name={cat.icon as any} size={20} color={cat.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: colors.textPrimary,
                fontSize: 14,
                fontFamily: "Inter_600SemiBold",
                marginBottom: 2,
              }}
            >
              {cat.label}
            </Text>
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 12,
                fontFamily: "Inter_400Regular",
              }}
            >
              {cat.count} transaction{cat.count !== 1 ? "s" : ""}
            </Text>
          </View>
          <Text
            style={{
              color: colors.textPrimary,
              fontSize: 14,
              fontFamily: "Inter_700Bold",
            }}
          >
            KSh {cat.total.toLocaleString("en-KE", { minimumFractionDigits: 0 })}
          </Text>
        </View>
      ))}

      {/* Divider */}
      <View
        style={{
          height: 1,
          backgroundColor: colors.glass.border,
          marginVertical: 8,
        }}
      />

      {/* Total */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 4,
        }}
      >
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: 13,
            fontFamily: "Inter_500Medium",
          }}
        >
          Total Volume
        </Text>
        <Text
          style={{
            color: colors.primary[400],
            fontSize: 16,
            fontFamily: "Inter_700Bold",
          }}
        >
          KSh{" "}
          {categories
            .reduce((s, c) => s + c.total, 0)
            .toLocaleString("en-KE", { minimumFractionDigits: 0 })}
        </Text>
      </View>
    </View>
  );
}

/* ─── Desktop Quick Action Card (richer than mobile) ─── */
function DesktopQuickActionCard({
  icon,
  label,
  description,
  color,
  onPress,
}: {
  icon: string;
  label: string;
  description: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        backgroundColor: colors.dark.card,
        borderRadius: 16,
        padding: 18,
        borderWidth: 1,
        borderColor: pressed ? color + "40" : colors.glass.border,
        opacity: pressed ? 0.9 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
        ...shadows.sm,
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          backgroundColor: color + "1A",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 12,
        }}
      >
        <Ionicons name={icon as any} size={22} color={color} />
      </View>
      <Text
        style={{
          color: colors.textPrimary,
          fontSize: 14,
          fontFamily: "Inter_600SemiBold",
          marginBottom: 4,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: colors.textMuted,
          fontSize: 12,
          fontFamily: "Inter_400Regular",
          lineHeight: 17,
        }}
      >
        {description}
      </Text>
    </Pressable>
  );
}

/* ─── Crypto Price Charts Section (Desktop) ─── */
const CHART_CURRENCIES: { symbol: string; name: string; color: string }[] = [
  { symbol: "USDT", name: "Tether", color: colors.crypto.USDT },
  { symbol: "BTC", name: "Bitcoin", color: colors.crypto.BTC },
  { symbol: "ETH", name: "Ethereum", color: colors.crypto.ETH },
  { symbol: "SOL", name: "Solana", color: colors.crypto.SOL },
];

function CryptoPriceChartsSection({
  rates,
  tickerRates,
}: {
  rates: Rate[];
  tickerRates: { symbol: string; rate: number; change24h: number }[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  // Generate mock history for each currency (memoized so it doesn't regenerate on re-render)
  const mockHistories = useMemo(() => {
    const map: Record<string, ChartDataPoint[]> = {};
    for (const tr of tickerRates) {
      map[tr.symbol] = generateMockHistory(tr.rate, 90); // 90 days for 3M support
    }
    return map;
  }, [tickerRates.map((r) => `${r.symbol}:${r.rate}`).join(",")]);

  return (
    <View style={{ marginBottom: 24 }}>
      <Text
        style={{
          color: colors.dark.muted,
          fontSize: 11,
          fontFamily: "Inter_600SemiBold",
          letterSpacing: 1.2,
          textTransform: "uppercase",
          marginBottom: 14,
          paddingHorizontal: 4,
        }}
      >
        CRYPTO PRICES
      </Text>

      {/* Row of 4 crypto cards */}
      <View style={{ flexDirection: "row", gap: 16, marginBottom: expanded ? 16 : 0 }}>
        {CHART_CURRENCIES.map((cur) => {
          const tr = tickerRates.find((r) => r.symbol === cur.symbol);
          if (!tr) return null;
          const isPos = tr.change24h >= 0;
          const changeColor = isPos ? colors.primary[400] : colors.error;
          const isExpanded = expanded === cur.symbol;
          const sparkData = mockHistories[cur.symbol]?.slice(-24) || []; // last 24 hours
          const iconSymbol =
            (CURRENCIES as any)[cur.symbol]?.iconSymbol || cur.symbol[0];

          return (
            <Pressable
              key={cur.symbol}
              onPress={() => setExpanded(isExpanded ? null : cur.symbol)}
              accessibilityRole="button"
              accessibilityLabel={`${cur.name} price chart`}
              style={({ pressed, hovered }: any) => ({
                flex: 1,
                backgroundColor: isExpanded
                  ? cur.color + "0D"
                  : Platform.OS === "web" && hovered
                  ? colors.dark.elevated
                  : colors.dark.card,
                borderRadius: 16,
                padding: 16,
                borderWidth: 1,
                borderColor: isExpanded
                  ? cur.color + "33"
                  : Platform.OS === "web" && hovered
                  ? colors.glass.borderStrong
                  : colors.glass.border,
                opacity: pressed ? 0.9 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
                ...(Platform.OS === "web"
                  ? ({ cursor: "pointer", transition: "all 0.2s ease" } as any)
                  : {}),
                ...shadows.sm,
              })}
            >
              {/* Icon + Symbol */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    backgroundColor: cur.color + "1A",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{
                      color: cur.color,
                      fontSize: 16,
                      fontFamily: "Inter_700Bold",
                    }}
                  >
                    {iconSymbol}
                  </Text>
                </View>
                <View>
                  <Text
                    style={{
                      color: colors.textPrimary,
                      fontSize: 13,
                      fontFamily: "Inter_600SemiBold",
                    }}
                  >
                    {cur.symbol}
                  </Text>
                  <Text
                    style={{
                      color: colors.textMuted,
                      fontSize: 10,
                      fontFamily: "Inter_400Regular",
                    }}
                  >
                    {cur.name}
                  </Text>
                </View>
              </View>

              {/* Price */}
              <Text
                style={{
                  color: colors.textPrimary,
                  fontSize: 14,
                  fontFamily: "Inter_700Bold",
                  marginBottom: 2,
                }}
                numberOfLines={1}
              >
                KES {tr.rate >= 1000
                  ? tr.rate.toLocaleString(undefined, { maximumFractionDigits: 2 })
                  : tr.rate.toFixed(2)}
              </Text>

              {/* 24h change */}
              <Text
                style={{
                  color: changeColor,
                  fontSize: 11,
                  fontFamily: "Inter_600SemiBold",
                  marginBottom: 8,
                }}
              >
                {isPos ? "+" : ""}
                {tr.change24h.toFixed(2)}%
              </Text>

              {/* Mini sparkline */}
              <SparklineChart data={sparkData} color={cur.color} height={48} />
            </Pressable>
          );
        })}
      </View>

      {/* Expanded full chart */}
      {expanded && mockHistories[expanded] && (
        <CryptoChart
          data={mockHistories[expanded]}
          currency={expanded}
          color={
            CHART_CURRENCIES.find((c) => c.symbol === expanded)?.color ||
            colors.primary[400]
          }
          height={280}
          interactive
        />
      )}
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 900;
  const isLargeDesktop = isWeb && width >= 1200;
  const isXLDesktop = isWeb && width >= 1500;
  const hPad = isXLDesktop ? 48 : isLargeDesktop ? 40 : isDesktop ? 32 : 16;
  const {
    data: wallets,
    refetch: refetchWallets,
    isLoading: walletsLoading,
  } = useWallets();
  const {
    data: txData,
    refetch: refetchTx,
    isLoading: txLoading,
  } = useTransactions();
  const { data: rates } = useRates();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchWallets(), refetchTx()]);
    setRefreshing(false);
  };

  const recentTx = txData?.results?.slice(0, 5) || [];
  const allTx = txData?.results || [];

  /* ─── Derive chart data from real transactions ─── */
  const chartLabels = useMemo(() => getLast7DayLabels(), []);
  const chartPoints = useMemo(() => getLast7DayTotals(allTx), [allTx]);
  const changePercent = useMemo(() => computeChangePercent(allTx), [allTx]);

  const tickerRates = (rates || [])
    .filter((r) => !isNaN(parseFloat(r.kes_rate)))
    .map((r) => ({
      symbol: r.currency,
      rate: parseFloat(r.kes_rate),
      change24h: parseFloat(r.spread) || 0,
    }));

  const firstName = user?.full_name?.split(" ")[0] || "there";
  const initials = getInitials(user?.full_name);
  const hasUnread = true; // TODO: derive from notifications API

  /* ─── MOBILE LAYOUT (unchanged) ─── */
  if (!isDesktop) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.dark.bg }}>
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary[400]}
              progressBackgroundColor={colors.dark.card}
            />
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingBottom: 32,
          }}
        >
          {/* Header */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 20,
              paddingTop: 8,
              paddingBottom: 20,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              {/* Avatar */}
              <View
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 23,
                  backgroundColor: colors.primary[500],
                  alignItems: "center",
                  justifyContent: "center",
                  ...(Platform.OS !== "web"
                    ? {
                        shadowColor: colors.primary[400],
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.3,
                        shadowRadius: 8,
                        elevation: 4,
                      }
                    : { boxShadow: "0 2px 8px rgba(52, 211, 153, 0.3)" } as any),
                }}
              >
                <Text
                  style={{
                    color: "#FFFFFF",
                    fontSize: 17,
                    fontFamily: "Inter_700Bold",
                    letterSpacing: 0.5,
                  }}
                >
                  {initials}
                </Text>
              </View>
              <View>
                <Text
                  style={{
                    color: colors.textSecondary,
                    fontSize: 13,
                    fontFamily: "Inter_400Regular",
                    marginBottom: 1,
                  }}
                >
                  {getGreeting()}
                </Text>
                <Text
                  style={{
                    color: colors.textPrimary,
                    fontSize: 20,
                    fontFamily: "Inter_700Bold",
                    letterSpacing: -0.3,
                  }}
                >
                  {firstName}
                </Text>
              </View>
            </View>

            {/* Notification Bell */}
            <Pressable
              onPress={() => router.push("/settings/notifications-inbox")}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              testID="notifications-button"
              style={({ pressed, hovered }: any) => ({
                width: 44,
                height: 44,
                borderRadius: 14,
                backgroundColor: Platform.OS === "web" && hovered
                  ? colors.dark.elevated
                  : colors.dark.card,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: Platform.OS === "web" && hovered
                  ? colors.glass.borderStrong
                  : colors.glass.border,
                opacity: pressed ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
                ...(Platform.OS === "web" ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
              })}
            >
              <Ionicons
                name="notifications-outline"
                size={22}
                color={colors.textSecondary}
              />
              {/* Unread badge dot */}
              {hasUnread && (
                <View
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 11,
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: colors.primary[400],
                    borderWidth: 1.5,
                    borderColor: colors.dark.card,
                  }}
                />
              )}
            </Pressable>
          </View>

          {/* Balance Card */}
          <View style={{ marginBottom: 24, paddingHorizontal: 0 }}>
            {wallets && <BalanceCard wallets={wallets} />}
            {walletsLoading && <BalanceCardSkeleton />}
          </View>

          {/* Quick Actions */}
          <View
            style={{
              paddingHorizontal: 16,
              marginBottom: 24,
            }}
          >
            <Text
              style={{
                color: colors.dark.muted,
                fontSize: 11,
                fontFamily: "Inter_600SemiBold",
                letterSpacing: 1.2,
                textTransform: "uppercase",
                marginBottom: 14,
                paddingHorizontal: 4,
              }}
            >
              QUICK ACTIONS
            </Text>
            <View
              style={{
                flexDirection: "row",
                backgroundColor: colors.dark.card,
                borderRadius: 20,
                padding: 18,
                borderWidth: 1,
                borderColor: colors.glass.border,
              }}
            >
              <QuickAction
                icon="receipt-outline"
                label="Pay Bill"
                color={colors.primary[400]}
                onPress={() => router.push("/payment/paybill")}
              />
              <QuickAction
                icon="cart-outline"
                label="Buy Goods"
                color={colors.info}
                onPress={() => router.push("/payment/till")}
              />
              <QuickAction
                icon="arrow-down-circle-outline"
                label="Deposit"
                color={colors.success}
                onPress={() => router.push("/(tabs)/wallet")}
              />
              <QuickAction
                icon="swap-horizontal-outline"
                label="Convert"
                color={colors.accent}
                // TODO: convert will be a separate screen later
                onPress={() => router.push("/(tabs)/wallet")}
              />
            </View>
          </View>

          {/* Live Rate Ticker */}
          {tickerRates.length > 0 && (
            <View style={{ marginHorizontal: 16, marginBottom: 24 }}>
              <RateTicker rates={tickerRates} />
            </View>
          )}

          {/* Promotional Banner */}
          <Pressable
            onPress={() => router.push("/(tabs)/pay")}
            style={({ pressed }) => ({
              marginHorizontal: 16,
              marginBottom: 24,
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            })}
          >
            <View
              style={{
                borderRadius: 20,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: "rgba(13, 159, 110, 0.3)",
              }}
            >
              {/* Gradient-like background using layered views */}
              <View
                style={{
                  backgroundColor: colors.primary[500],
                  padding: 24,
                  position: "relative",
                }}
              >
                {/* Decorative circles */}
                <View
                  style={{
                    position: "absolute",
                    top: -20,
                    right: -20,
                    width: 120,
                    height: 120,
                    borderRadius: 60,
                    backgroundColor: "rgba(255,255,255,0.06)",
                  }}
                />
                <View
                  style={{
                    position: "absolute",
                    bottom: -30,
                    right: 40,
                    width: 80,
                    height: 80,
                    borderRadius: 40,
                    backgroundColor: "rgba(255,255,255,0.04)",
                  }}
                />

                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View style={{ flex: 1, marginRight: 16 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                        marginBottom: 8,
                      }}
                    >
                      <View
                        style={{
                          backgroundColor: "rgba(255,255,255,0.2)",
                          borderRadius: 6,
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                        }}
                      >
                        <Text
                          style={{
                            color: "#FFFFFF",
                            fontSize: 10,
                            fontFamily: "Inter_700Bold",
                            letterSpacing: 1.2,
                            textTransform: "uppercase",
                          }}
                        >
                          NEW
                        </Text>
                      </View>
                    </View>
                    <Text
                      style={{
                        color: "#FFFFFF",
                        fontSize: 21,
                        fontFamily: "Inter_700Bold",
                        marginBottom: 6,
                        lineHeight: 27,
                      }}
                    >
                      Pay bills with crypto
                    </Text>
                    <Text
                      style={{
                        color: "rgba(255,255,255,0.7)",
                        fontSize: 14,
                        fontFamily: "Inter_400Regular",
                        marginBottom: 16,
                        lineHeight: 20,
                      }}
                    >
                      Convert & pay via M-Pesa instantly
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        backgroundColor: "rgba(255,255,255,0.2)",
                        borderRadius: 12,
                        paddingHorizontal: 16,
                        paddingVertical: 10,
                        alignSelf: "flex-start",
                        gap: 6,
                      }}
                    >
                      <Text
                        style={{
                          color: "#FFFFFF",
                          fontSize: 13,
                          fontFamily: "Inter_600SemiBold",
                        }}
                      >
                        Get started
                      </Text>
                      <Ionicons name="arrow-forward" size={14} color="#FFFFFF" />
                    </View>
                  </View>
                  {/* Flash icon in glass circle */}
                  <View
                    style={{
                      width: 68,
                      height: 68,
                      borderRadius: 20,
                      backgroundColor: "rgba(255,255,255,0.12)",
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.15)",
                    }}
                  >
                    <Ionicons name="flash" size={34} color="#FFFFFF" />
                  </View>
                </View>
              </View>
            </View>
          </Pressable>

          {/* Recent Transactions */}
          <View style={{ paddingHorizontal: 16 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
                paddingHorizontal: 4,
              }}
            >
              <Text
                style={{
                  color: colors.textPrimary,
                  fontSize: 17,
                  fontFamily: "Inter_600SemiBold",
                  letterSpacing: -0.2,
                }}
              >
                Recent Activity
              </Text>
              <Pressable
                onPress={() => router.push("/(tabs)/wallet")}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Text
                  style={{
                    color: colors.primary[400],
                    fontSize: 13,
                    fontFamily: "Inter_600SemiBold",
                  }}
                >
                  See All
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={14}
                  color={colors.primary[400]}
                />
              </Pressable>
            </View>

            <View
              style={{
                backgroundColor: colors.dark.card,
                borderRadius: 20,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: colors.glass.border,
              }}
            >
              {txLoading ? (
                <TransactionSkeleton />
              ) : recentTx.length === 0 ? (
                /* Empty State */
                <View
                  style={{
                    paddingVertical: 48,
                    paddingHorizontal: 32,
                    alignItems: "center",
                  }}
                >
                  {/* Layered icon */}
                  <View
                    style={{
                      width: 88,
                      height: 88,
                      borderRadius: 28,
                      backgroundColor: "rgba(13, 159, 110, 0.08)",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 20,
                    }}
                  >
                    <View
                      style={{
                        width: 60,
                        height: 60,
                        borderRadius: 20,
                        backgroundColor: "rgba(13, 159, 110, 0.12)",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons
                        name="receipt-outline"
                        size={28}
                        color={colors.primary[400]}
                      />
                    </View>
                  </View>
                  <Text
                    style={{
                      color: colors.textPrimary,
                      fontSize: 16,
                      fontFamily: "Inter_600SemiBold",
                      marginBottom: 6,
                      textAlign: "center",
                    }}
                  >
                    No transactions yet
                  </Text>
                  <Text
                    style={{
                      color: colors.textMuted,
                      fontSize: 13,
                      fontFamily: "Inter_400Regular",
                      marginBottom: 24,
                      textAlign: "center",
                      lineHeight: 19,
                    }}
                  >
                    Start by depositing crypto or making{"\n"}your first payment
                  </Text>
                  <Pressable
                    onPress={() => router.push("/(tabs)/pay")}
                    style={({ pressed }) => ({
                      backgroundColor: colors.primary[500],
                      borderRadius: 14,
                      paddingHorizontal: 24,
                      paddingVertical: 12,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      ...(Platform.OS !== "web"
                        ? {
                            shadowColor: colors.primary[500],
                            shadowOffset: { width: 0, height: 4 },
                            shadowOpacity: 0.3,
                            shadowRadius: 8,
                            elevation: 4,
                          }
                        : { boxShadow: "0 4px 8px rgba(16, 185, 129, 0.3)" } as any),
                      opacity: pressed ? 0.85 : 1,
                      transform: [{ scale: pressed ? 0.98 : 1 }],
                    })}
                  >
                    <Ionicons name="add-circle-outline" size={18} color="#FFFFFF" />
                    <Text
                      style={{
                        color: "#FFFFFF",
                        fontSize: 14,
                        fontFamily: "Inter_600SemiBold",
                      }}
                    >
                      Make a Payment
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <View>
                  {recentTx.map((tx, index) => (
                    <View key={tx.id}>
                      <TransactionItem transaction={tx} />
                      {index < recentTx.length - 1 && (
                        <View
                          style={{
                            height: 1,
                            backgroundColor: "rgba(255, 255, 255, 0.04)",
                            marginLeft: 68,
                            marginRight: 16,
                          }}
                        />
                      )}
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* ─── DESKTOP WEB LAYOUT (width >= 900) ─── */
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.dark.bg }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary[400]}
            progressBackgroundColor={colors.dark.card}
          />
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: 48,
          paddingHorizontal: hPad,
          paddingTop: 8,
        }}
      >
        {/* Desktop Header - simplified */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingBottom: 28,
            paddingTop: 8,
          }}
        >
          <View>
            <Text
              style={{
                color: colors.textSecondary,
                fontSize: 14,
                fontFamily: "Inter_400Regular",
                marginBottom: 4,
              }}
            >
              {getGreeting()}, {firstName}
            </Text>
            <Text
              style={{
                color: colors.textPrimary,
                fontSize: 28,
                fontFamily: "Inter_700Bold",
                letterSpacing: -0.5,
              }}
            >
              Dashboard
            </Text>
          </View>

          {/* Notification Bell */}
          <Pressable
            onPress={() => router.push("/settings/notifications-inbox")}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            testID="notifications-button"
            style={({ pressed, hovered }: any) => ({
              width: 44,
              height: 44,
              borderRadius: 14,
              backgroundColor: Platform.OS === "web" && hovered
                ? colors.dark.elevated
                : colors.dark.card,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: Platform.OS === "web" && hovered
                ? colors.glass.borderStrong
                : colors.glass.border,
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
              ...(Platform.OS === "web" ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
            })}
          >
            <Ionicons
              name="notifications-outline"
              size={22}
              color={colors.textSecondary}
            />
            {/* Unread badge dot */}
            {hasUnread && (
              <View
                style={{
                  position: "absolute",
                  top: 10,
                  right: 11,
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: colors.primary[400],
                  borderWidth: 1.5,
                  borderColor: colors.dark.card,
                }}
              />
            )}
          </Pressable>
        </View>

        {/* Live Stats Row — visible on large desktop */}
        {isLargeDesktop && tickerRates.length > 0 && (
          <View
            style={{
              flexDirection: "row",
              gap: 16,
              marginBottom: 20,
            }}
          >
            {tickerRates.slice(0, 4).map((tr) => {
              const isPos = tr.change24h >= 0;
              const changeColor = isPos ? colors.primary[400] : colors.error;
              const cur = CHART_CURRENCIES.find((c) => c.symbol === tr.symbol);
              return (
                <View
                  key={tr.symbol}
                  style={{
                    flex: 1,
                    backgroundColor: colors.dark.card,
                    borderRadius: 14,
                    paddingHorizontal: 18,
                    paddingVertical: 14,
                    borderWidth: 1,
                    borderColor: colors.glass.border,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    ...shadows.sm,
                  }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      backgroundColor: (cur?.color || colors.primary[400]) + "1A",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: cur?.color || colors.primary[400],
                        fontSize: 16,
                        fontFamily: "Inter_700Bold",
                      }}
                    >
                      {(CURRENCIES as any)[tr.symbol]?.iconSymbol || tr.symbol[0]}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: colors.textPrimary,
                        fontSize: 14,
                        fontFamily: "Inter_600SemiBold",
                      }}
                      numberOfLines={1}
                    >
                      KES {tr.rate >= 1000
                        ? tr.rate.toLocaleString(undefined, { maximumFractionDigits: 0 })
                        : tr.rate.toFixed(2)}
                    </Text>
                    <Text
                      style={{
                        color: colors.textMuted,
                        fontSize: 11,
                        fontFamily: "Inter_400Regular",
                      }}
                    >
                      {tr.symbol}
                    </Text>
                  </View>
                  <View
                    style={{
                      backgroundColor: changeColor + "1A",
                      borderRadius: 6,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                    }}
                  >
                    <Text
                      style={{
                        color: changeColor,
                        fontSize: 11,
                        fontFamily: "Inter_600SemiBold",
                      }}
                    >
                      {isPos ? "+" : ""}{tr.change24h.toFixed(2)}%
                    </Text>
                  </View>
                  {/* Pulsing live dot */}
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: colors.primary[400],
                    }}
                  />
                </View>
              );
            })}
          </View>
        )}

        {/* Row 1: Balance Card (60%) + Portfolio Chart (40%) */}
        <View
          style={{
            flexDirection: "row",
            gap: isLargeDesktop ? 24 : 20,
            marginBottom: 24,
          }}
        >
          <View style={{ flex: isXLDesktop ? 7 : 6 }}>
            {wallets && <BalanceCard wallets={wallets} />}
            {walletsLoading && <BalanceCardSkeleton />}
          </View>
          <View style={{ flex: isXLDesktop ? 3 : 4 }}>
            <PortfolioChart
              chartPoints={chartPoints}
              chartLabels={chartLabels}
              changePercent={changePercent}
            />
          </View>
        </View>

        {/* Row 2: Quick Actions (contained, not full width) */}
        <View style={{ marginBottom: 24 }}>
          <Text
            style={{
              color: colors.dark.muted,
              fontSize: 11,
              fontFamily: "Inter_600SemiBold",
              letterSpacing: 1.2,
              textTransform: "uppercase",
              marginBottom: 14,
              paddingHorizontal: 4,
            }}
          >
            QUICK ACTIONS
          </Text>
          <View
            style={{
              flexDirection: "row",
              gap: 16,
            }}
          >
            <DesktopQuickActionCard
              icon="receipt-outline"
              label="Pay Bill"
              description="Pay utility & service bills"
              color={colors.primary[400]}
              onPress={() => router.push("/payment/paybill")}
            />
            <DesktopQuickActionCard
              icon="cart-outline"
              label="Buy Goods"
              description="Pay merchants directly"
              color={colors.info}
              onPress={() => router.push("/payment/till")}
            />
            <DesktopQuickActionCard
              icon="arrow-down-circle-outline"
              label="Deposit"
              description="Add crypto to your wallet"
              color={colors.success}
              onPress={() => router.push("/(tabs)/wallet")}
            />
            <DesktopQuickActionCard
              icon="swap-horizontal-outline"
              label="Convert"
              description="Swap between currencies"
              color={colors.accent}
              // TODO: convert will be a separate screen later
              onPress={() => router.push("/(tabs)/wallet")}
            />
          </View>
        </View>

        {/* Row 2.5: Crypto Price Charts */}
        {tickerRates.length > 0 && (
          <CryptoPriceChartsSection rates={rates || []} tickerRates={tickerRates} />
        )}

        {/* Row 3: Rate Ticker (full width, contained) */}
        {tickerRates.length > 0 && (
          <View style={{ marginBottom: 24 }}>
            <RateTicker rates={tickerRates} />
          </View>
        )}

        {/* Row 4: Recent Transactions (60%) + Transaction Summary (40%) */}
        <View
          style={{
            flexDirection: "row",
            gap: isLargeDesktop ? 24 : 20,
            marginBottom: 24,
          }}
        >
          {/* Recent Transactions */}
          <View style={{ flex: 6 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
                paddingHorizontal: 4,
              }}
            >
              <Text
                style={{
                  color: colors.textPrimary,
                  fontSize: 17,
                  fontFamily: "Inter_600SemiBold",
                  letterSpacing: -0.2,
                }}
              >
                Recent Activity
              </Text>
              <Pressable
                onPress={() => router.push("/(tabs)/wallet")}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Text
                  style={{
                    color: colors.primary[400],
                    fontSize: 13,
                    fontFamily: "Inter_600SemiBold",
                  }}
                >
                  See All
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={14}
                  color={colors.primary[400]}
                />
              </Pressable>
            </View>

            <View
              style={{
                backgroundColor: colors.dark.card,
                borderRadius: 20,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: colors.glass.border,
                ...shadows.md,
              }}
            >
              {txLoading ? (
                <TransactionSkeleton />
              ) : recentTx.length === 0 ? (
                <View
                  style={{
                    paddingVertical: 48,
                    paddingHorizontal: 32,
                    alignItems: "center",
                  }}
                >
                  <View
                    style={{
                      width: 88,
                      height: 88,
                      borderRadius: 28,
                      backgroundColor: "rgba(13, 159, 110, 0.08)",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 20,
                    }}
                  >
                    <View
                      style={{
                        width: 60,
                        height: 60,
                        borderRadius: 20,
                        backgroundColor: "rgba(13, 159, 110, 0.12)",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons
                        name="receipt-outline"
                        size={28}
                        color={colors.primary[400]}
                      />
                    </View>
                  </View>
                  <Text
                    style={{
                      color: colors.textPrimary,
                      fontSize: 16,
                      fontFamily: "Inter_600SemiBold",
                      marginBottom: 6,
                      textAlign: "center",
                    }}
                  >
                    No transactions yet
                  </Text>
                  <Text
                    style={{
                      color: colors.textMuted,
                      fontSize: 13,
                      fontFamily: "Inter_400Regular",
                      marginBottom: 24,
                      textAlign: "center",
                      lineHeight: 19,
                    }}
                  >
                    Start by depositing crypto or making{"\n"}your first payment
                  </Text>
                  <Pressable
                    onPress={() => router.push("/(tabs)/pay")}
                    style={({ pressed }) => ({
                      backgroundColor: colors.primary[500],
                      borderRadius: 14,
                      paddingHorizontal: 24,
                      paddingVertical: 12,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      opacity: pressed ? 0.85 : 1,
                      transform: [{ scale: pressed ? 0.98 : 1 }],
                      ...shadows.glow(colors.primary[500], 0.3),
                    })}
                  >
                    <Ionicons name="add-circle-outline" size={18} color="#FFFFFF" />
                    <Text
                      style={{
                        color: "#FFFFFF",
                        fontSize: 14,
                        fontFamily: "Inter_600SemiBold",
                      }}
                    >
                      Make a Payment
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <View>
                  {recentTx.map((tx, index) => (
                    <View key={tx.id}>
                      <TransactionItem transaction={tx} />
                      {index < recentTx.length - 1 && (
                        <View
                          style={{
                            height: 1,
                            backgroundColor: "rgba(255, 255, 255, 0.04)",
                            marginLeft: 68,
                            marginRight: 16,
                          }}
                        />
                      )}
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>

          {/* Transaction Summary */}
          <View style={{ flex: 4 }}>
            <View
              style={{
                marginBottom: 14,
                paddingHorizontal: 4,
                height: 24,
              }}
            />
            <TransactionSummary transactions={recentTx} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
