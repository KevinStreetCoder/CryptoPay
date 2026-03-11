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
import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { BalanceCard } from "../../src/components/BalanceCard";
import { QuickAction, DesktopQuickActionCard } from "../../src/components/QuickAction";
import { TransactionItem } from "../../src/components/TransactionItem";
import { RateTicker } from "../../src/components/RateTicker";
import { SectionHeader } from "../../src/components/SectionHeader";
import {
  Skeleton,
  BalanceCardSkeleton,
  TransactionSkeleton,
  CryptoCardSkeleton,
  CryptoChartsSkeleton,
  RateTickerSkeleton,
  PortfolioChartSkeleton,
} from "../../src/components/Skeleton";
import { useWallets } from "../../src/hooks/useWallets";
import { useTransactions } from "../../src/hooks/useTransactions";
import { useAuth } from "../../src/stores/auth";
import { ratesApi, Rate, normalizeRate } from "../../src/api/rates";
import { Transaction, getTxKesAmount } from "../../src/api/payments";
import { colors, CURRENCIES, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import {
  CryptoChart,
  SparklineChart,
  apiDataToChartPoints,
  ChartDataPoint,
} from "../../src/components/CryptoChart";
import { CryptoLogo } from "../../src/components/CryptoLogo";
import { useLocale } from "../../src/hooks/useLocale";

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

function getGreeting(): { textKey: string; icon: string; emoji: string } {
  const hour = new Date().getHours();
  if (hour < 6) return { textKey: "home.goodNight", icon: "moon-outline", emoji: "" };
  if (hour < 12) return { textKey: "home.goodMorning", icon: "sunny-outline", emoji: "" };
  if (hour < 17) return { textKey: "home.goodAfternoon", icon: "partly-sunny-outline", emoji: "" };
  if (hour < 21) return { textKey: "home.goodEvening", icon: "cloudy-night-outline", emoji: "" };
  return { textKey: "home.goodNight", icon: "moon-outline", emoji: "" };
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
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
}

function PortfolioChart({
  chartPoints,
  chartLabels,
  changePercent,
  tc,
  ts,
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
        backgroundColor: tc.dark.card,
        borderRadius: 20,
        padding: 20,
        borderWidth: 1,
        borderColor: tc.glass.border,
        flex: 1,
        ...ts.md,
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
              color: tc.textSecondary,
              fontSize: 12,
              fontFamily: "DMSans_500Medium",
              letterSpacing: 0.5,
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            Portfolio Value
          </Text>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 22,
              fontFamily: "DMSans_700Bold",
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
              fontFamily: "DMSans_600SemiBold",
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
              backgroundColor: tc.glass.border,
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
                  : tc.textMuted,
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
                : tc.textMuted,
              borderWidth: 2,
              borderColor: tc.dark.card,
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
              color: tc.textMuted,
              fontSize: 10,
              fontFamily: "DMSans_400Regular",
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

function TransactionSummary({ transactions, tc, ts }: { transactions: Transaction[]; tc: ReturnType<typeof getThemeColors>; ts: ReturnType<typeof getThemeShadows> }) {
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
        backgroundColor: tc.dark.card,
        borderRadius: 20,
        padding: 20,
        borderWidth: 1,
        borderColor: tc.glass.border,
        flex: 1,
        ...ts.md,
      }}
    >
      <Text
        style={{
          color: tc.textPrimary,
          fontSize: 16,
          fontFamily: "DMSans_600SemiBold",
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
                color: tc.textPrimary,
                fontSize: 14,
                fontFamily: "DMSans_600SemiBold",
                marginBottom: 2,
              }}
            >
              {cat.label}
            </Text>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 12,
                fontFamily: "DMSans_400Regular",
              }}
            >
              {cat.count} transaction{cat.count !== 1 ? "s" : ""}
            </Text>
          </View>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 14,
              fontFamily: "DMSans_700Bold",
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
          backgroundColor: tc.glass.border,
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
            color: tc.textSecondary,
            fontSize: 13,
            fontFamily: "DMSans_500Medium",
          }}
        >
          Total Volume
        </Text>
        <Text
          style={{
            color: colors.primary[400],
            fontSize: 16,
            fontFamily: "DMSans_700Bold",
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

/* DesktopQuickActionCard imported from QuickAction.tsx */

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
  tc,
  ts,
}: {
  rates: Rate[];
  tickerRates: { symbol: string; rate: number; change24h: number }[];
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chartPeriod, setChartPeriod] = useState<string>("7d");
  const [chartLoading, setChartLoading] = useState(false);

  // Fetch sparkline data (1-day) for all currencies
  const sparklineQueries = useQuery({
    queryKey: ["sparklines"],
    queryFn: async () => {
      const map: Record<string, ChartDataPoint[]> = {};
      await Promise.all(
        CHART_CURRENCIES.map(async (cur) => {
          try {
            const { data } = await ratesApi.getRateHistory(cur.symbol, "1d");
            map[cur.symbol] = apiDataToChartPoints(data.data);
          } catch {
            map[cur.symbol] = [];
          }
        })
      );
      return map;
    },
    staleTime: 5 * 60 * 1000, // 5 min
  });

  // Fetch expanded chart data for selected currency + period
  const expandedQuery = useQuery({
    queryKey: ["chart", expanded, chartPeriod],
    queryFn: async () => {
      if (!expanded) return [];
      const { data } = await ratesApi.getRateHistory(expanded, chartPeriod);
      return apiDataToChartPoints(data.data);
    },
    enabled: !!expanded,
    staleTime: chartPeriod === "1d" ? 5 * 60 * 1000 : 30 * 60 * 1000,
  });

  const sparklines = sparklineQueries.data || {};
  const sparklinesLoading = sparklineQueries.isLoading;

  const handlePeriodChange = useCallback((apiPeriod: string) => {
    setChartPeriod(apiPeriod);
  }, []);

  return (
    <View style={{ marginBottom: 24 }}>
      <Text
        style={{
          color: tc.dark.muted,
          fontSize: 11,
          fontFamily: "DMSans_600SemiBold",
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
          const sparkData = sparklines[cur.symbol]?.slice(-48) || [];
          const iconSymbol =
            (CURRENCIES as any)[cur.symbol]?.iconSymbol || cur.symbol[0];

          return (
            <Pressable
              key={cur.symbol}
              onPress={() => {
                setExpanded(isExpanded ? null : cur.symbol);
                setChartPeriod("7d"); // Reset period when switching currency
              }}
              accessibilityRole="button"
              accessibilityLabel={`${cur.name} price chart`}
              style={({ pressed, hovered }: any) => ({
                flex: 1,
                backgroundColor: isExpanded
                  ? cur.color + "0D"
                  : Platform.OS === "web" && hovered
                  ? tc.dark.elevated
                  : tc.dark.card,
                borderRadius: 16,
                padding: 16,
                borderWidth: 1,
                borderColor: isExpanded
                  ? cur.color + "33"
                  : Platform.OS === "web" && hovered
                  ? tc.glass.borderStrong
                  : tc.glass.border,
                opacity: pressed ? 0.9 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
                ...(Platform.OS === "web"
                  ? ({ cursor: "pointer", transition: "all 0.2s ease" } as any)
                  : {}),
                ...ts.sm,
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
                  <CryptoLogo currency={cur.symbol} size={28} fallbackColor={cur.color} />
                </View>
                <View>
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 13,
                      fontFamily: "DMSans_600SemiBold",
                    }}
                  >
                    {cur.symbol}
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 10,
                      fontFamily: "DMSans_400Regular",
                    }}
                  >
                    {cur.name}
                  </Text>
                </View>
              </View>

              {/* Price */}
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 14,
                  fontFamily: "DMSans_700Bold",
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
                  fontFamily: "DMSans_600SemiBold",
                  marginBottom: 8,
                }}
              >
                {isPos ? "+" : ""}
                {tr.change24h.toFixed(2)}%
              </Text>

              {/* Mini sparkline */}
              {sparklinesLoading && sparkData.length < 2 ? (
                <Skeleton width="100%" height={48} borderRadius={6} />
              ) : (
                <SparklineChart data={sparkData} color={cur.color} height={48} />
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Expanded full chart */}
      {expanded && (
        <CryptoChart
          data={expandedQuery.data || []}
          currency={expanded}
          color={
            CHART_CURRENCIES.find((c) => c.symbol === expanded)?.color ||
            colors.primary[400]
          }
          height={280}
          interactive
          onPeriodChange={handlePeriodChange}
          loading={expandedQuery.isLoading || expandedQuery.isFetching}
        />
      )}
    </View>
  );
}

/* ─── Mobile Crypto Charts (2x2 compact grid) ─── */
function MobileCryptoCharts({
  tickerRates,
  tc,
  ts,
}: {
  tickerRates: { symbol: string; rate: number; change24h: number }[];
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chartPeriod, setChartPeriod] = useState<string>("7d");

  const sparklineQueries = useQuery({
    queryKey: ["sparklines-mobile"],
    queryFn: async () => {
      const map: Record<string, ChartDataPoint[]> = {};
      await Promise.all(
        CHART_CURRENCIES.map(async (cur) => {
          try {
            const { data } = await ratesApi.getRateHistory(cur.symbol, "1d");
            map[cur.symbol] = apiDataToChartPoints(data.data);
          } catch {
            map[cur.symbol] = [];
          }
        })
      );
      return map;
    },
    staleTime: 5 * 60 * 1000,
  });

  const expandedQuery = useQuery({
    queryKey: ["chart-mobile", expanded, chartPeriod],
    queryFn: async () => {
      if (!expanded) return [];
      const { data } = await ratesApi.getRateHistory(expanded, chartPeriod);
      return apiDataToChartPoints(data.data);
    },
    enabled: !!expanded,
    staleTime: chartPeriod === "1d" ? 5 * 60 * 1000 : 30 * 60 * 1000,
  });

  const sparklines = sparklineQueries.data || {};
  const sparklinesLoading = sparklineQueries.isLoading;

  const handlePeriodChange = useCallback((apiPeriod: string) => {
    setChartPeriod(apiPeriod);
  }, []);

  return (
    <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
      <Text
        style={{
          color: tc.dark.muted,
          fontSize: 11,
          fontFamily: "DMSans_600SemiBold",
          letterSpacing: 1.2,
          textTransform: "uppercase",
          marginBottom: 14,
          paddingHorizontal: 4,
        }}
      >
        CRYPTO PRICES
      </Text>

      {/* 2x2 grid of cards */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {CHART_CURRENCIES.map((cur) => {
          const tr = tickerRates.find((r) => r.symbol === cur.symbol);
          if (!tr) return null;
          const isPos = tr.change24h >= 0;
          const changeColor = isPos ? colors.primary[400] : colors.error;
          const isExpanded = expanded === cur.symbol;
          const sparkData = (sparklines[cur.symbol] || []).slice(-48);
          const iconSymbol =
            (CURRENCIES as any)[cur.symbol]?.iconSymbol || cur.symbol[0];

          return (
            <Pressable
              key={cur.symbol}
              onPress={() => {
                setExpanded(isExpanded ? null : cur.symbol);
                setChartPeriod("7d");
              }}
              style={({ pressed }) => ({
                width: "47%" as any,
                flexGrow: 1,
                backgroundColor: isExpanded ? cur.color + "0D" : tc.dark.card,
                borderRadius: 16,
                padding: 14,
                borderWidth: 1,
                borderColor: isExpanded ? cur.color + "33" : tc.glass.border,
                opacity: pressed ? 0.9 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    backgroundColor: cur.color + "1A",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <CryptoLogo currency={cur.symbol} size={24} fallbackColor={cur.color} />
                </View>
                <Text style={{ color: tc.textPrimary, fontSize: 13, fontFamily: "DMSans_600SemiBold" }}>
                  {cur.symbol}
                </Text>
              </View>
              <Text
                style={{ color: tc.textPrimary, fontSize: 13, fontFamily: "DMSans_700Bold", marginBottom: 2 }}
                numberOfLines={1}
              >
                KES {tr.rate >= 1000
                  ? tr.rate.toLocaleString(undefined, { maximumFractionDigits: 0 })
                  : tr.rate.toFixed(2)}
              </Text>
              <Text
                style={{ color: changeColor, fontSize: 11, fontFamily: "DMSans_600SemiBold", marginBottom: 6 }}
              >
                {isPos ? "+" : ""}{tr.change24h.toFixed(2)}%
              </Text>
              {sparklinesLoading && sparkData.length < 2 ? (
                <Skeleton width="100%" height={40} borderRadius={6} />
              ) : (
                <SparklineChart data={sparkData} color={cur.color} height={40} />
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Expanded full chart */}
      {expanded && (
        <View style={{ marginTop: 12 }}>
          <CryptoChart
            data={expandedQuery.data || []}
            currency={expanded}
            color={
              CHART_CURRENCIES.find((c) => c.symbol === expanded)?.color ||
              colors.primary[400]
            }
            height={220}
            interactive
            onPeriodChange={handlePeriodChange}
            loading={expandedQuery.isLoading || expandedQuery.isFetching}
          />
        </View>
      )}
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useLocale();
  const { width } = useWindowDimensions();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 900;
  const isLargeDesktop = isWeb && width >= 1200;
  const isXLDesktop = isWeb && width >= 1500;
  const hPad = isXLDesktop ? 48 : isLargeDesktop ? 48 : isDesktop ? 32 : 16;
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
  const { data: rates, isLoading: ratesLoading } = useRates();
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
      <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary[400]}
              progressBackgroundColor={tc.dark.card}
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
                    fontFamily: "DMSans_700Bold",
                    letterSpacing: 0.5,
                  }}
                >
                  {initials}
                </Text>
              </View>
              <View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name={getGreeting().icon as any} size={14} color={tc.textMuted} />
                  <Text
                    style={{
                      color: tc.textSecondary,
                      fontSize: 13,
                      fontFamily: "DMSans_400Regular",
                      marginBottom: 1,
                    }}
                  >
                    {t(getGreeting().textKey)}
                  </Text>
                </View>
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: 22,
                    fontFamily: "DMSans_700Bold",
                    letterSpacing: -0.4,
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
                  ? tc.dark.elevated
                  : tc.dark.card,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: Platform.OS === "web" && hovered
                  ? tc.glass.borderStrong
                  : tc.glass.border,
                opacity: pressed ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
                ...(Platform.OS === "web" ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
              })}
            >
              <Ionicons
                name="notifications-outline"
                size={22}
                color={tc.textSecondary}
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
                    borderColor: tc.dark.card,
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
            <SectionHeader
              title={t("home.quickActions")}
              icon="flash-outline"
              iconColor={colors.primary[400]}
            />
            <View
              style={{
                flexDirection: "row",
                backgroundColor: tc.dark.card,
                borderRadius: 20,
                padding: 18,
                borderWidth: 1,
                borderColor: tc.glass.border,
                ...ts.sm,
              }}
            >
              <QuickAction
                icon="receipt-outline"
                label={t("home.payBill")}
                color={colors.primary[400]}
                onPress={() => router.push("/payment/paybill")}
              />
              <QuickAction
                icon="cart-outline"
                label={t("home.payTill")}
                color={colors.info}
                onPress={() => router.push("/payment/till")}
              />
              <QuickAction
                icon="arrow-down-circle-outline"
                label={t("wallet.deposit")}
                color={colors.success}
                onPress={() => router.push("/(tabs)/wallet")}
              />
              <QuickAction
                icon="send-outline"
                label={t("wallet.send")}
                color={colors.accent}
                onPress={() => router.push("/payment/send")}
              />
            </View>
          </View>

          {/* Live Rate Ticker */}
          {tickerRates.length > 0 ? (
            <View style={{ marginHorizontal: 16, marginBottom: 24 }}>
              <RateTicker rates={tickerRates} />
            </View>
          ) : ratesLoading ? (
            <View style={{ marginHorizontal: 16, marginBottom: 24 }}>
              <RateTickerSkeleton />
            </View>
          ) : null}

          {/* Crypto Price Charts (mobile) */}
          {tickerRates.length > 0 ? (
            <MobileCryptoCharts tickerRates={tickerRates} tc={tc} ts={ts} />
          ) : ratesLoading ? (
            <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
              <Skeleton width={110} height={11} style={{ marginBottom: 14, marginLeft: 4 }} />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                {[1, 2, 3, 4].map((i) => (
                  <View key={i} style={{ width: "47%", flexGrow: 1 }}>
                    <CryptoCardSkeleton />
                  </View>
                ))}
              </View>
            </View>
          ) : null}

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
                            fontFamily: "DMSans_700Bold",
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
                        fontFamily: "DMSans_700Bold",
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
                        fontFamily: "DMSans_400Regular",
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
                          fontFamily: "DMSans_600SemiBold",
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
            <SectionHeader
              title={t("home.recentActivity")}
              uppercase={false}
              icon="time-outline"
              iconColor={tc.textSecondary}
              actionLabel={t("home.seeAll")}
              onAction={() => router.push("/(tabs)/wallet")}
              count={recentTx.length}
            />

            <View
              style={{
                backgroundColor: tc.dark.card,
                borderRadius: 20,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: tc.glass.border,
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
                      color: tc.textPrimary,
                      fontSize: 16,
                      fontFamily: "DMSans_600SemiBold",
                      marginBottom: 6,
                      textAlign: "center",
                    }}
                  >
                    No transactions yet
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 13,
                      fontFamily: "DMSans_400Regular",
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
                        fontFamily: "DMSans_600SemiBold",
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
                            backgroundColor: tc.glass.highlight,
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
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary[400]}
            progressBackgroundColor={tc.dark.card}
          />
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: 48,
          paddingHorizontal: hPad,
          paddingTop: 8,
          width: "100%" as const,
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Ionicons name={getGreeting().icon as any} size={16} color={tc.textMuted} />
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 14,
                  fontFamily: "DMSans_400Regular",
                }}
              >
                {t(getGreeting().textKey)}, {firstName}
              </Text>
            </View>
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 30,
                fontFamily: "DMSans_700Bold",
                letterSpacing: -0.6,
              }}
            >
              Dashboard
            </Text>
          </View>

          {/* Notification Bell + Settings */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Pressable
            onPress={() => router.push("/settings")}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            style={({ pressed, hovered }: any) => ({
              width: 44,
              height: 44,
              borderRadius: 14,
              backgroundColor: Platform.OS === "web" && hovered
                ? tc.dark.elevated
                : tc.dark.card,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: Platform.OS === "web" && hovered
                ? tc.glass.borderStrong
                : tc.glass.border,
              opacity: pressed ? 0.85 : 1,
              ...(Platform.OS === "web" ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
            })}
          >
            <Ionicons name="settings-outline" size={20} color={tc.textSecondary} />
          </Pressable>
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
                ? tc.dark.elevated
                : tc.dark.card,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: Platform.OS === "web" && hovered
                ? tc.glass.borderStrong
                : tc.glass.border,
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
              ...(Platform.OS === "web" ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
            })}
          >
            <Ionicons
              name="notifications-outline"
              size={22}
              color={tc.textSecondary}
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
                  borderColor: tc.dark.card,
                }}
              />
            )}
          </Pressable>
          </View>
        </View>

        {/* Live Stats Row — visible on large desktop */}
        {isLargeDesktop && ratesLoading && tickerRates.length === 0 && (
          <View style={{ flexDirection: "row", gap: 16, marginBottom: 20 }}>
            {[1, 2, 3, 4].map((i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  backgroundColor: tc.dark.card,
                  borderRadius: 14,
                  paddingHorizontal: 18,
                  paddingVertical: 14,
                  borderWidth: 1,
                  borderColor: tc.glass.border,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  ...ts.sm,
                }}
              >
                <Skeleton width={36} height={36} borderRadius={10} />
                <View style={{ flex: 1 }}>
                  <Skeleton width={80} height={14} style={{ marginBottom: 4 }} />
                  <Skeleton width={40} height={11} />
                </View>
                <Skeleton width={52} height={22} borderRadius={6} />
              </View>
            ))}
          </View>
        )}
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
                    backgroundColor: tc.dark.card,
                    borderRadius: 14,
                    paddingHorizontal: 18,
                    paddingVertical: 14,
                    borderWidth: 1,
                    borderColor: tc.glass.border,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    ...ts.sm,
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
                    <CryptoLogo currency={tr.symbol} size={28} fallbackColor={cur?.color || colors.primary[400]} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: tc.textPrimary,
                        fontSize: 14,
                        fontFamily: "DMSans_600SemiBold",
                      }}
                      numberOfLines={1}
                    >
                      KES {tr.rate >= 1000
                        ? tr.rate.toLocaleString(undefined, { maximumFractionDigits: 0 })
                        : tr.rate.toFixed(2)}
                    </Text>
                    <Text
                      style={{
                        color: tc.textMuted,
                        fontSize: 11,
                        fontFamily: "DMSans_400Regular",
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
                        fontFamily: "DMSans_600SemiBold",
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
            {txLoading ? (
              <PortfolioChartSkeleton />
            ) : (
              <PortfolioChart
                chartPoints={chartPoints}
                chartLabels={chartLabels}
                changePercent={changePercent}
                tc={tc}
                ts={ts}
              />
            )}
          </View>
        </View>

        {/* Row 2: Quick Actions */}
        <View style={{ marginBottom: 24 }}>
          <SectionHeader
            title={t("home.quickActions")}
            icon="flash-outline"
            iconColor={colors.primary[400]}
          />
          <View
            style={{
              flexDirection: "row",
              gap: 16,
            }}
          >
            <DesktopQuickActionCard
              icon="receipt-outline"
              label={t("home.payBill")}
              description={t("home.payBillDesc")}
              color={colors.primary[400]}
              onPress={() => router.push("/payment/paybill")}
            />
            <DesktopQuickActionCard
              icon="cart-outline"
              label={t("home.payTill")}
              description={t("home.payTillDesc")}
              color={colors.info}
              onPress={() => router.push("/payment/till")}
            />
            <DesktopQuickActionCard
              icon="arrow-down-circle-outline"
              label={t("wallet.deposit")}
              description={t("home.depositDesc")}
              color={colors.success}
              onPress={() => router.push("/(tabs)/wallet")}
            />
            <DesktopQuickActionCard
              icon="send-outline"
              label={t("wallet.send")}
              description={t("home.sendDesc")}
              color={colors.accent}
              onPress={() => router.push("/payment/send")}
            />
          </View>
        </View>

        {/* Row 2.5: Crypto Price Charts */}
        {tickerRates.length > 0 ? (
          <CryptoPriceChartsSection rates={rates || []} tickerRates={tickerRates} tc={tc} ts={ts} />
        ) : ratesLoading ? (
          <CryptoChartsSkeleton />
        ) : null}

        {/* Row 3: Rate Ticker (full width, contained) */}
        {tickerRates.length > 0 ? (
          <View style={{ marginBottom: 24 }}>
            <RateTicker rates={tickerRates} />
          </View>
        ) : ratesLoading ? (
          <View style={{ marginBottom: 24 }}>
            <RateTickerSkeleton />
          </View>
        ) : null}

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
            <SectionHeader
              title={t("home.recentActivity")}
              uppercase={false}
              icon="time-outline"
              iconColor={tc.textSecondary}
              actionLabel={t("home.seeAll")}
              onAction={() => router.push("/(tabs)/wallet")}
              count={recentTx.length}
            />

            <View
              style={{
                backgroundColor: tc.dark.card,
                borderRadius: 20,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: tc.glass.border,
                ...ts.md,
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
                      color: tc.textPrimary,
                      fontSize: 16,
                      fontFamily: "DMSans_600SemiBold",
                      marginBottom: 6,
                      textAlign: "center",
                    }}
                  >
                    No transactions yet
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 13,
                      fontFamily: "DMSans_400Regular",
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
                      ...ts.glow(colors.primary[500], 0.3),
                    })}
                  >
                    <Ionicons name="add-circle-outline" size={18} color="#FFFFFF" />
                    <Text
                      style={{
                        color: "#FFFFFF",
                        fontSize: 14,
                        fontFamily: "DMSans_600SemiBold",
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
                            backgroundColor: tc.glass.highlight,
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
            <TransactionSummary transactions={recentTx} tc={tc} ts={ts} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
