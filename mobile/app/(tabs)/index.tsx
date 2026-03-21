import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  Platform,
  useWindowDimensions,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useNavigation } from "expo-router";
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
import { useTransactions, useActivity } from "../../src/hooks/useTransactions";
import { useUnreadCount } from "../../src/hooks/useUnreadCount";
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
import { useDeposits } from "../../src/components/DepositTracker";
import { useLocale } from "../../src/hooks/useLocale";
import { UserAvatar } from "../../src/components/UserAvatar";
import { cacheRates, getCachedRates, rateAge } from "../../src/utils/rateCache";
import { config } from "../../src/constants/config";

function useRates() {
  return useQuery<Rate[]>({
    queryKey: ["rates"],
    queryFn: async () => {
      const currencies = ["USDT", "BTC", "ETH", "SOL"];
      try {
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
        const rates = results.filter(Boolean) as Rate[];
        // Cache rates for offline use
        if (rates.length > 0) {
          await cacheRates(
            rates.map((r) => ({
              currency: r.currency,
              kes_rate: r.kes_rate,
              usd_rate: r.usd_rate,
            }))
          );
        }
        return rates;
      } catch {
        // Network failed — try cached rates
        const cached = await getCachedRates();
        if (cached && cached.length > 0) {
          return cached.map((c) => ({
            currency: c.currency,
            usd_rate: c.usd_rate,
            kes_rate: c.kes_rate,
            spread: "0",
            updated_at: new Date(c.timestamp).toISOString(),
          }));
        }
        return [];
      }
    },
    refetchInterval: 15000,
    staleTime: 0,
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

const AVATAR_COLORS = ["#10B981", "#3B82F6", "#8B5CF6", "#EC4899", "#6366F1", "#14B8A6", "#F59E0B", "#EF4444"];
const ADMIN_GOLD = "#D4AF37";

function getAvatarColor(identifier: string, isAdmin?: boolean): string {
  if (isAdmin) return ADMIN_GOLD;
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) hash = identifier.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string | undefined): string {
  if (!name || !name.trim()) return "U";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0][0].toUpperCase();
}

function resolveAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) return url;
  const base = config.apiUrl.replace(/\/api\/v1\/?$/, "");
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
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

const DEPOSIT_TYPES = ["BUY", "KES_DEPOSIT", "KES_DEPOSIT_C2B", "DEPOSIT"];
const PAYMENT_TYPES = ["PAYBILL_PAYMENT", "TILL_PAYMENT", "SEND_MPESA"];

function getLast7DayTotals(transactions: Transaction[]): number[] {
  const now = new Date();
  const totals: number[] = [0, 0, 0, 0, 0, 0, 0];

  for (const tx of transactions) {
    const txDate = new Date(tx.created_at);
    const diffMs = now.getTime() - txDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays >= 0 && diffDays < 7) {
      const index = 6 - diffDays;
      totals[index] += getTxKesAmount(tx);
    }
  }

  return totals;
}

function getLast7DaySplit(transactions: Transaction[]): {
  deposits: number[];
  payments: number[];
} {
  const now = new Date();
  const deposits: number[] = [0, 0, 0, 0, 0, 0, 0];
  const payments: number[] = [0, 0, 0, 0, 0, 0, 0];

  for (const tx of transactions) {
    if (tx.status !== "completed") continue;
    const txDate = new Date(tx.created_at);
    const diffMs = now.getTime() - txDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays >= 0 && diffDays < 7) {
      const index = 6 - diffDays;
      const amount = getTxKesAmount(tx);
      if (DEPOSIT_TYPES.includes(tx.type)) {
        deposits[index] += amount;
      } else if (PAYMENT_TYPES.includes(tx.type)) {
        payments[index] += amount;
      }
    }
  }

  return { deposits, payments };
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

/* ─── Interactive dual-line portfolio chart ─── */
interface PortfolioChartProps {
  chartPoints: number[];
  chartLabels: string[];
  changePercent: string;
  depositPoints: number[];
  paymentPoints: number[];
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
}

const DEPOSIT_COLOR = "#10B981"; // emerald
const PAYMENT_COLOR = "#A78BFA"; // violet

function PortfolioChart({
  chartPoints,
  chartLabels,
  changePercent,
  depositPoints,
  paymentPoints,
  tc,
  ts,
}: PortfolioChartProps) {
  const { width: windowWidth } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isDesktopChart = isWeb && windowWidth >= 900;
  const chartWidth = isDesktopChart ? Math.min(windowWidth * 0.25, 400) : windowWidth - 80;
  const chartHeight = isDesktopChart ? 130 : 110;

  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const allValues = [...depositPoints, ...paymentPoints];
  const hasData = allValues.some((v) => v > 0);
  const globalMax = hasData ? Math.max(...allValues, 1) : 1;

  const CHART_PAD_TOP = 12;
  const CHART_PAD_BOTTOM = 8;
  const usableHeight = chartHeight - CHART_PAD_TOP - CHART_PAD_BOTTOM;

  const toPoints = (data: number[]) =>
    data.map((val, i) => ({
      x: (i / Math.max(data.length - 1, 1)) * chartWidth,
      y: CHART_PAD_TOP + usableHeight - (val / globalMax) * usableHeight,
      value: val,
    }));

  const depPts = toPoints(depositPoints);
  const payPts = toPoints(paymentPoints);

  const isPositive = changePercent.startsWith("+");
  const trendIcon = isPositive ? "trending-up" : "trending-down";
  const trendColor = isPositive ? colors.primary[400] : colors.error;

  const renderLine = (
    pts: { x: number; y: number }[],
    color: string,
    prefix: string
  ) =>
    pts.map((point, i) => {
      if (i === 0) return null;
      const prev = pts[i - 1];
      const dx = point.x - prev.x;
      const dy = point.y - prev.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      return (
        <View
          key={`${prefix}-${i}`}
          style={{
            position: "absolute",
            left: prev.x,
            top: prev.y,
            width: length,
            height: 2.5,
            backgroundColor: color,
            borderRadius: 1.5,
            transform: [{ rotate: `${angle}deg` }],
            transformOrigin: "0 0",
          }}
        />
      );
    });

  const renderDots = (
    pts: { x: number; y: number }[],
    color: string,
    prefix: string
  ) =>
    pts.map((point, i) => {
      const isActive = activeIndex === i;
      const dotSize = 7;
      return (
        <View
          key={`${prefix}-dot-${i}`}
          style={{
            position: "absolute",
            left: point.x - dotSize / 2,
            top: point.y - dotSize / 2,
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: isActive ? color : color + "B0",
            borderWidth: 2,
            borderColor: tc.dark.card,
            ...(Platform.OS === "web"
              ? {
                  transition: "transform 0.15s ease, box-shadow 0.15s ease",
                  transform: isActive ? "scale(1.5)" : "scale(1)",
                  boxShadow: isActive ? `0 0 8px ${color}80` : "none",
                } as any
              : {}),
          }}
        />
      );
    });

  // Single overlay for mouse tracking — no per-zone re-renders
  const chartRef = useRef<View>(null);
  const handleChartMouse = useCallback(
    (e: any) => {
      if (!isWeb) return;
      const rect = e.currentTarget?.getBoundingClientRect?.();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const zoneWidth = chartWidth / chartLabels.length;
      const idx = Math.min(Math.max(Math.floor(x / zoneWidth), 0), chartLabels.length - 1);
      setActiveIndex(idx);
    },
    [chartWidth, chartLabels.length]
  );
  const handleChartLeave = useCallback(() => setActiveIndex(null), []);

  const totalDeposits = depositPoints.reduce((a, b) => a + b, 0);
  const totalPayments = paymentPoints.reduce((a, b) => a + b, 0);

  return (
    <View
      style={{
        backgroundColor: tc.dark.card,
        borderRadius: 20,
        padding: 20,
        borderWidth: 1,
        borderColor: tc.glass.border,
        flex: 1,
        overflow: "hidden" as const,
        ...ts.md,
      }}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
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
              fontSize: 20,
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
          <Ionicons name={trendIcon as any} size={14} color={trendColor} />
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

      {/* Legend */}
      <View style={{ flexDirection: "row", gap: 16, marginBottom: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: DEPOSIT_COLOR }} />
          <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_500Medium" }}>
            Deposits
          </Text>
          <Text style={{ color: tc.textSecondary, fontSize: 11, fontFamily: "DMSans_600SemiBold" }}>
            KSh {totalDeposits.toLocaleString()}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: PAYMENT_COLOR }} />
          <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_500Medium" }}>
            Payments
          </Text>
          <Text style={{ color: tc.textSecondary, fontSize: 11, fontFamily: "DMSans_600SemiBold" }}>
            KSh {totalPayments.toLocaleString()}
          </Text>
        </View>
      </View>

      {/* Interactive tooltip — fixed height to prevent layout shift */}
      <View
        style={{
          height: 36,
          marginBottom: 8,
          justifyContent: "center",
        }}
      >
        {activeIndex !== null ? (
          <View
            style={{
              backgroundColor: tc.dark.elevated,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderWidth: 1,
              borderColor: tc.glass.border,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              ...(Platform.OS === "web" ? { transition: "opacity 0.15s ease" } as any : {}),
            }}
          >
            <Text style={{ color: tc.textSecondary, fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>
              {chartLabels[activeIndex]}
            </Text>
            <View style={{ flexDirection: "row", gap: 14 }}>
              <Text style={{ color: DEPOSIT_COLOR, fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>
                +KSh {depositPoints[activeIndex]?.toLocaleString() || "0"}
              </Text>
              <Text style={{ color: PAYMENT_COLOR, fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>
                -KSh {paymentPoints[activeIndex]?.toLocaleString() || "0"}
              </Text>
            </View>
          </View>
        ) : (
          <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular", textAlign: "center" }}>
            Hover over chart for details
          </Text>
        )}
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
        {[0, 1, 2, 3].map((i) => (
          <View
            key={`grid-${i}`}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: (i / 3) * chartHeight,
              height: 1,
              backgroundColor: tc.glass.border + "60",
            }}
          />
        ))}

        {/* Active day vertical indicator */}
        {activeIndex !== null && (
          <View
            style={{
              position: "absolute",
              left: (activeIndex / Math.max(chartLabels.length - 1, 1)) * chartWidth,
              top: 0,
              width: 1,
              height: chartHeight,
              backgroundColor: tc.textMuted + "40",
            }}
          />
        )}

        {/* Area fills (subtle gradient approximation) */}
        {hasData && depPts.map((point, i) => (
          <View
            key={`dep-area-${i}`}
            style={{
              position: "absolute",
              left: point.x - 1,
              top: point.y,
              width: 2,
              height: chartHeight - point.y,
              backgroundColor: DEPOSIT_COLOR + "08",
            }}
          />
        ))}
        {hasData && payPts.map((point, i) => (
          <View
            key={`pay-area-${i}`}
            style={{
              position: "absolute",
              left: point.x - 1,
              top: point.y,
              width: 2,
              height: chartHeight - point.y,
              backgroundColor: PAYMENT_COLOR + "06",
            }}
          />
        ))}

        {/* Lines */}
        {hasData && renderLine(depPts, DEPOSIT_COLOR, "dep")}
        {hasData && renderLine(payPts, PAYMENT_COLOR, "pay")}

        {/* Dots */}
        {hasData && renderDots(depPts, DEPOSIT_COLOR, "dep")}
        {hasData && renderDots(payPts, PAYMENT_COLOR, "pay")}

        {/* No data message */}
        {!hasData && (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular" }}>
              No activity this week
            </Text>
          </View>
        )}

        {/* Single overlay for smooth mouse tracking — no flickering */}
        {isWeb ? (
          <View
            ref={chartRef}
            {...({ onMouseMove: handleChartMouse, onMouseLeave: handleChartLeave } as any)}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: chartWidth,
              height: chartHeight,
              cursor: "crosshair",
              zIndex: 10,
            } as any}
          />
        ) : null}
      </View>

      {/* X-axis labels */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          marginTop: 8,
          width: chartWidth,
          alignSelf: "center",
        }}
      >
        {chartLabels.map((label, idx) => (
          <Text
            key={`${label}-${idx}`}
            style={{
              color: activeIndex === idx ? tc.textPrimary : tc.textMuted,
              fontSize: 10,
              fontFamily: activeIndex === idx ? "DMSans_600SemiBold" : "DMSans_400Regular",
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
        (t) => t.type === "BUY" || t.type === "SELL" || t.type === "SWAP"
      ).length,
      total: transactions
        .filter((t) => t.type === "BUY" || t.type === "SELL" || t.type === "SWAP")
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
  { symbol: "USDC", name: "USD Coin", color: colors.crypto.USDC },
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
  const [expanded, setExpanded] = useState<string | null>("USDT");
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
  const [expanded, setExpanded] = useState<string | null>("USDT");
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

import { AppTourProvider, TourStep, TourAutoStart } from "../../src/components/AppTour";

function HomeScreenContent() {
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
  // Unified activity feed (includes crypto deposits)
  const {
    data: activityData,
    refetch: refetchActivity,
    isLoading: activityLoading,
  } = useActivity({ page_size: 10 });
  const { data: rates, isLoading: ratesLoading } = useRates();
  const [refreshing, setRefreshing] = useState(false);

  // Refetch wallet balances when this tab gains focus (e.g., after payment)
  const navigation = useNavigation();
  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      refetchWallets();
      refetchTx();
      refetchActivity();
    });
    return unsubscribe;
  }, [navigation, refetchWallets, refetchTx, refetchActivity]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchWallets(), refetchTx(), refetchActivity()]);
    setRefreshing(false);
  };

  // Use unified activity feed for recent items (includes crypto deposits)
  const recentTx = activityData?.results?.slice(0, 5) || txData?.results?.slice(0, 5) || [];
  const allTx = txData?.results || [];

  // Merge blockchain deposits (credited) into transaction list for chart
  const { data: blockchainDeposits } = useDeposits();
  const allTxWithDeposits = useMemo(() => {
    const rateMap: Record<string, number> = {};
    (rates || []).forEach((r: any) => {
      rateMap[r.currency] = parseFloat(r.kes_rate) || 0;
    });
    const creditedDeposits = (blockchainDeposits || [])
      .filter((d: any) => d.status === "credited" && d.credited_at)
      .map((d: any) => {
        const amt = parseFloat(d.amount) || 0;
        const kesRate = rateMap[d.currency] || 0;
        const kesValue = (amt * kesRate).toFixed(2);
        return {
          id: d.id,
          type: "DEPOSIT",
          status: "completed",
          source_currency: d.currency,
          source_amount: d.amount,
          dest_currency: "KES",
          dest_amount: kesValue,
          exchange_rate: "",
          fee_amount: "0",
          fee_currency: "KES",
          mpesa_paybill: "",
          mpesa_till: "",
          mpesa_account: "",
          mpesa_phone: "",
          mpesa_receipt: "",
          excise_duty_amount: "0",
          chain: "",
          tx_hash: "",
          confirmations: 0,
          created_at: d.credited_at || d.created_at,
          completed_at: d.credited_at || null,
        } satisfies Transaction;
      });
    return [...allTx, ...creditedDeposits];
  }, [allTx, blockchainDeposits, rates]);

  /* ─── Derive chart data from real transactions + blockchain deposits ─── */
  const chartLabels = useMemo(() => getLast7DayLabels(), []);
  const chartPoints = useMemo(() => getLast7DayTotals(allTxWithDeposits), [allTxWithDeposits]);
  const chartSplit = useMemo(() => getLast7DaySplit(allTxWithDeposits), [allTxWithDeposits]);
  const changePercent = useMemo(() => computeChangePercent(allTxWithDeposits), [allTxWithDeposits]);

  const tickerRates = (rates || [])
    .filter((r) => !isNaN(parseFloat(r.kes_rate)))
    .map((r) => ({
      symbol: r.currency,
      rate: parseFloat(r.kes_rate),
      change24h: parseFloat((r as any).change_24h || r.spread) || 0,
    }));

  const firstName = user?.full_name?.split(" ")[0] || "there";
  const initials = getInitials(user?.full_name);
  const isAdmin = user?.is_staff || user?.is_superuser;
  const avatarBgColor = getAvatarColor(user?.id?.toString() || user?.phone || "user", isAdmin);
  // Tier-based border: gold=admin, green=verified(T1+), default=primary
  const tierBorderColor = isAdmin ? ADMIN_GOLD : (user?.kyc_tier ?? 0) >= 1 ? "#10B981" : avatarBgColor;
  // UI Avatars: reliable PNG generation that works on all platforms including Android
  const avatarBgHex = avatarBgColor.replace("#", "");
  const avatarName = encodeURIComponent(user?.full_name || user?.phone?.slice(-4) || "U");
  const generatedAvatarUrl = `https://ui-avatars.com/api/?name=${avatarName}&size=96&background=${avatarBgHex}&color=fff&bold=true&font-size=0.4&rounded=true&format=png`;
  const { unreadCount } = useUnreadCount(allTx);

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
            paddingBottom: Platform.OS === "android" ? 100 : 40,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <TourStep nameKey="tour.step5Title" textKey="tour.step5Text" order={5}>
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
              <UserAvatar
                avatarUrl={user?.avatar_url}
                fullName={user?.full_name}
                phone={user?.phone}
                userId={user?.id}
                isStaff={user?.is_staff}
                isSuperuser={user?.is_superuser}
                kycTier={user?.kyc_tier}
                size={46}
                borderRadius={15}
              />
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
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
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
                  {(user?.kyc_tier ?? 0) >= 1 && (
                    <View
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        backgroundColor: colors.primary[500],
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                    </View>
                  )}
                </View>
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
              {/* Unread count badge */}
              {unreadCount > 0 && (
                <View
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    minWidth: 18,
                    height: 18,
                    borderRadius: 9,
                    backgroundColor: colors.error,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: 4,
                    borderWidth: 2,
                    borderColor: tc.dark.card,
                  }}
                >
                  <Text
                    style={{
                      color: "#FFFFFF",
                      fontSize: 10,
                      fontFamily: "DMSans_700Bold",
                      lineHeight: 12,
                    }}
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </Text>
                </View>
              )}
            </Pressable>
          </View>
          </TourStep>

          {/* Balance Card */}
          <TourStep nameKey="tour.step1Title" textKey="tour.step1Text" order={1}>
          <View style={{ marginBottom: 24, paddingHorizontal: 0 }}>
            {wallets && <BalanceCard wallets={wallets} />}
            {walletsLoading && <BalanceCardSkeleton />}
          </View>
          </TourStep>

          {/* KYC Upgrade Banner — show for Tier 0 users */}
          {(user?.kyc_tier ?? 0) === 0 && (
            <Pressable
              onPress={() => router.push("/settings/kyc" as any)}
              style={({ pressed, hovered }: any) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                marginHorizontal: 16,
                marginBottom: 20,
                paddingVertical: 14,
                paddingHorizontal: 16,
                borderRadius: 16,
                backgroundColor: colors.warning + "14",
                borderWidth: 1,
                borderColor: colors.warning + "30",
                ...(Platform.OS === "web" ? {
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  ...(hovered ? { backgroundColor: colors.warning + "20", borderColor: colors.warning + "50" } : {}),
                } as any : {}),
                opacity: pressed ? 0.85 : 1,
              })}
              accessibilityRole="button"
              accessibilityLabel={t("home.verifyBanner")}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: colors.warning + "20",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="warning-outline" size={18} color={colors.warning} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: 13,
                    fontFamily: "DMSans_600SemiBold",
                    marginBottom: 2,
                  }}
                >
                  {t("home.verifyBanner")}
                </Text>
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 11,
                    fontFamily: "DMSans_400Regular",
                  }}
                >
                  {t("home.verifyBannerDesc")}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={tc.textMuted} />
            </Pressable>
          )}

          {/* Quick Actions */}
          <TourStep nameKey="tour.step3Title" textKey="tour.step3Text" order={3}>
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
                onPress={() => router.push("/payment/deposit" as any)}
              />
              <QuickAction
                icon="send-outline"
                label={t("wallet.send")}
                color={colors.accent}
                onPress={() => router.push("/payment/send")}
              />
              <QuickAction
                icon="swap-horizontal-outline"
                label="Swap"
                color={colors.crypto.ETH}
                onPress={() => router.push("/payment/swap")}
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

          </TourStep>

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
              {(txLoading && activityLoading) ? (
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
        <TourAutoStart />
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
                {(user?.kyc_tier ?? 0) >= 1 && (
                  <Text>{" "}<Ionicons name="checkmark-circle" size={14} color={colors.primary[400]} /></Text>
                )}
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
          <TourStep nameKey="tour.step6Title" textKey="tour.step6Text" order={6}>
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
            {/* Unread count badge */}
            {unreadCount > 0 && (
              <View
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  minWidth: 18,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: colors.error,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 4,
                  borderWidth: 2,
                  borderColor: tc.dark.card,
                }}
              >
                <Text
                  style={{
                    color: "#FFFFFF",
                    fontSize: 10,
                    fontFamily: "DMSans_700Bold",
                    lineHeight: 12,
                  }}
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </Text>
              </View>
            )}
          </Pressable>

          {/* User Avatar */}
          <Pressable
            onPress={() => router.push("/(tabs)/profile")}
            accessibilityRole="button"
            accessibilityLabel="Profile"
            style={({ pressed, hovered }: any) => ({
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.96 : 1 }],
              ...(Platform.OS === "web" ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
            })}
          >
            <UserAvatar
              avatarUrl={user?.avatar_url}
              fullName={user?.full_name}
              phone={user?.phone}
              userId={user?.id}
              isStaff={user?.is_staff}
              isSuperuser={user?.is_superuser}
              kycTier={user?.kyc_tier}
              size={44}
              borderRadius={14}
            />
          </Pressable>
          </View>
          </TourStep>
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
            <TourStep nameKey="tour.step1Title" textKey="tour.step1Text" order={1}>
              <View>{wallets && <BalanceCard wallets={wallets} />}
              {walletsLoading && <BalanceCardSkeleton />}</View>
            </TourStep>
          </View>
          <View style={{ flex: isXLDesktop ? 3 : 4 }}>
            <TourStep nameKey="tour.step2Title" textKey="tour.step2Text" order={2}>
            {txLoading ? (
              <PortfolioChartSkeleton />
            ) : (
              <PortfolioChart
                chartPoints={chartPoints}
                chartLabels={chartLabels}
                changePercent={changePercent}
                depositPoints={chartSplit.deposits}
                paymentPoints={chartSplit.payments}
                tc={tc}
                ts={ts}
              />
            )}
            </TourStep>
          </View>
        </View>

        {/* KYC Upgrade Banner — desktop, show for Tier 0 users */}
        {(user?.kyc_tier ?? 0) === 0 && (
          <Pressable
            onPress={() => router.push("/settings/kyc" as any)}
            style={({ pressed, hovered }: any) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              marginBottom: 20,
              paddingVertical: 14,
              paddingHorizontal: 20,
              borderRadius: 16,
              backgroundColor: colors.warning + "14",
              borderWidth: 1,
              borderColor: colors.warning + "30",
              ...(Platform.OS === "web" ? {
                cursor: "pointer",
                transition: "all 0.2s ease",
                ...(hovered ? { backgroundColor: colors.warning + "20", borderColor: colors.warning + "50" } : {}),
              } as any : {}),
              opacity: pressed ? 0.85 : 1,
            })}
            accessibilityRole="button"
            accessibilityLabel={t("home.verifyBanner")}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: colors.warning + "20",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="warning-outline" size={20} color={colors.warning} />
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
                {t("home.verifyBanner")}
              </Text>
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 12,
                  fontFamily: "DMSans_400Regular",
                }}
              >
                {t("home.verifyBannerDesc")}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={tc.textMuted} />
          </Pressable>
        )}

        {/* Row 2: Quick Actions */}
        <TourStep nameKey="tour.step3Title" textKey="tour.step3Text" order={3}>
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
              onPress={() => router.push("/payment/deposit" as any)}
            />
            <DesktopQuickActionCard
              icon="send-outline"
              label={t("wallet.send")}
              description={t("home.sendDesc")}
              color={colors.accent}
              onPress={() => router.push("/payment/send")}
            />
            <DesktopQuickActionCard
              icon="swap-horizontal-outline"
              label="Swap"
              description="Convert between crypto"
              color={colors.crypto.ETH}
              onPress={() => router.push("/payment/swap")}
            />
          </View>
        </View>
        </TourStep>

        {/* Row 2.5: Crypto Price Charts */}
        <TourStep nameKey="tour.step4Title" textKey="tour.step4Text" order={4}>
        {tickerRates.length > 0 ? (
          <CryptoPriceChartsSection rates={rates || []} tickerRates={tickerRates} tc={tc} ts={ts} />
        ) : ratesLoading ? (
          <CryptoChartsSkeleton />
        ) : null}
        </TourStep>

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
              {(txLoading && activityLoading) ? (
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
      <TourAutoStart />
    </SafeAreaView>
  );
}

export default function HomeScreen() {
  return <HomeScreenContent />;
}
