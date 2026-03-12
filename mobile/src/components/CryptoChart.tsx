import React, { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  Platform,
  Animated,
  Easing,
  LayoutChangeEvent,
  GestureResponderEvent,
} from "react-native";
import Svg, {
  Path,
  Defs,
  LinearGradient as SvgLinearGradient,
  Stop,
  Line,
  Circle,
  Rect,
} from "react-native-svg";
import { colors, getThemeColors, getThemeShadows } from "../constants/theme";
import { useThemeMode } from "../stores/theme";

/* ─── Types ─── */
export interface ChartDataPoint {
  timestamp: string;
  rate: number;
}

export interface CryptoChartProps {
  data?: ChartDataPoint[];
  currency: string;
  color: string;
  height?: number;
  interactive?: boolean;
  onPeriodChange?: (period: string) => void;
  loading?: boolean;
}

type Period = "1D" | "7D" | "1M" | "3M";

/* ─── Convert API data to chart format ─── */
export function apiDataToChartPoints(
  apiData: Array<{ timestamp: number | string; rate: number | string }>
): ChartDataPoint[] {
  return apiData.map((p) => ({
    timestamp:
      typeof p.timestamp === "number"
        ? new Date(p.timestamp).toISOString()
        : p.timestamp,
    rate: typeof p.rate === "string" ? parseFloat(p.rate) : p.rate,
  }));
}

/* ─── Helpers ─── */
const PERIOD_DAYS: Record<Period, number> = {
  "1D": 1,
  "7D": 7,
  "1M": 30,
  "3M": 90,
};

function filterDataByPeriod(data: ChartDataPoint[], period: Period): ChartDataPoint[] {
  const days = PERIOD_DAYS[period];
  const cutoff = Date.now() - days * 24 * 3600000;
  const filtered = data.filter((d) => new Date(d.timestamp).getTime() >= cutoff);
  return filtered.length > 1 ? filtered : data;
}

function formatPrice(value: number): string {
  if (value >= 1000000) return `KES ${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `KES ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (value >= 1) return `KES ${value.toFixed(2)}`;
  return `KES ${value.toFixed(6)}`;
}

function formatDate(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Build a smooth bezier path string from normalized points.
 * Uses cubic bezier curves with control points at ~1/3 distance for smoothness.
 */
function buildSmoothPath(
  points: { x: number; y: number }[],
  close: boolean,
  chartHeight: number,
  chartWidth: number
): string {
  if (points.length < 2) return "";

  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];

    const tension = 0.3;
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  if (close) {
    const last = points[points.length - 1];
    d += ` L ${last.x} ${chartHeight} L ${points[0].x} ${chartHeight} Z`;
  }

  return d;
}

/* ─── Skeleton Shimmer ─── */
function ChartSkeleton({ height }: { height: number }) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const shimmer = useRef(new Animated.Value(0)).current;
  const useNative = Platform.OS !== "web";

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: useNative,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: useNative,
        }),
      ])
    ).start();
  }, [shimmer, useNative]);

  const opacity = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [0.25, 0.55],
  });

  return (
    <View style={{ padding: 20 }}>
      <Animated.View
        style={{
          width: "40%",
          height: 14,
          borderRadius: 6,
          backgroundColor: tc.dark.elevated,
          opacity,
          marginBottom: 8,
        }}
      />
      <Animated.View
        style={{
          width: "60%",
          height: 28,
          borderRadius: 8,
          backgroundColor: tc.dark.elevated,
          opacity,
          marginBottom: 16,
        }}
      />
      <Animated.View
        style={{
          width: "100%",
          height: height,
          borderRadius: 12,
          backgroundColor: tc.dark.elevated,
          opacity,
          marginBottom: 16,
        }}
      />
      <View style={{ flexDirection: "row", gap: 8, justifyContent: "center" }}>
        {[1, 2, 3, 4].map((i) => (
          <Animated.View
            key={i}
            style={{
              width: 48,
              height: 28,
              borderRadius: 14,
              backgroundColor: tc.dark.elevated,
              opacity,
            }}
          />
        ))}
      </View>
    </View>
  );
}

/* ─── Period Selector Pills ─── */
function PeriodSelector({
  selected,
  onSelect,
  accentColor,
}: {
  selected: Period;
  onSelect: (p: Period) => void;
  accentColor: string;
}) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const periods: Period[] = ["1D", "7D", "1M", "3M"];

  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "center",
        gap: 8,
        marginTop: 16,
      }}
    >
      {periods.map((p) => {
        const isActive = p === selected;
        return (
          <Pressable
            key={p}
            onPress={() => onSelect(p)}
            accessibilityRole="button"
            accessibilityLabel={`Show ${p} chart`}
            style={({ pressed }: any) => ({
              paddingHorizontal: 14,
              paddingVertical: 6,
              borderRadius: 14,
              backgroundColor: isActive ? accentColor + "22" : "transparent",
              borderWidth: 1,
              borderColor: isActive ? accentColor + "44" : tc.dark.border,
              opacity: pressed ? 0.7 : 1,
              ...(Platform.OS === "web"
                ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any)
                : {}),
            })}
          >
            <Text
              style={{
                color: isActive ? accentColor : tc.textMuted,
                fontSize: 12,
                fontFamily: "DMSans_600SemiBold",
                letterSpacing: 0.5,
              }}
            >
              {p}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─── Tooltip ─── */
function Tooltip({
  x,
  y,
  price,
  date,
  chartWidth,
  color,
}: {
  x: number;
  y: number;
  price: string;
  date: string;
  chartWidth: number;
  color: string;
}) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const tooltipWidth = 140;
  // Keep tooltip within bounds
  let left = x - tooltipWidth / 2;
  if (left < 0) left = 0;
  if (left + tooltipWidth > chartWidth) left = chartWidth - tooltipWidth;

  return (
    <View
      style={{
        position: "absolute",
        left,
        top: Math.max(y - 60, 0),
        width: tooltipWidth,
        backgroundColor: tc.dark.elevated,
        borderRadius: 10,
        padding: 8,
        borderWidth: 1,
        borderColor: color + "44",
        ...ts.md,
        zIndex: 10,
        pointerEvents: "none" as any,
      }}
    >
      <Text
        style={{
          color: tc.textPrimary,
          fontSize: 13,
          fontFamily: "DMSans_700Bold",
          textAlign: "center",
          marginBottom: 2,
        }}
        numberOfLines={1}
      >
        {price}
      </Text>
      <Text
        style={{
          color: tc.textMuted,
          fontSize: 10,
          fontFamily: "DMSans_400Regular",
          textAlign: "center",
        }}
        numberOfLines={1}
      >
        {date}
      </Text>
    </View>
  );
}

const PERIOD_API_MAP: Record<Period, string> = {
  "1D": "1d",
  "7D": "7d",
  "1M": "30d",
  "3M": "90d",
};

/* ─── Main CryptoChart Component ─── */
export function CryptoChart({
  data,
  currency,
  color,
  height = 200,
  interactive = true,
  onPeriodChange,
  loading = false,
}: CryptoChartProps) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const [period, setPeriod] = useState<Period>("7D");

  const handlePeriodChange = useCallback(
    (p: Period) => {
      setPeriod(p);
      onPeriodChange?.(PERIOD_API_MAP[p]);
    },
    [onPeriodChange]
  );
  const [containerWidth, setContainerWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const isWeb = Platform.OS === "web";
  const PADDING_H = 0;
  const PADDING_V = 6;
  // Extra inset so the line + glow never clips at top/bottom
  const DATA_INSET_TOP = 10;
  const DATA_INSET_BOTTOM = 4;

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  }, []);

  // Data is already filtered by period from API — use directly
  const filteredData = useMemo(() => data || [], [data]);

  // Downsample to max ~120 points for performance
  const chartData = useMemo(() => {
    if (filteredData.length <= 120) return filteredData;
    const step = Math.ceil(filteredData.length / 120);
    const sampled: ChartDataPoint[] = [];
    for (let i = 0; i < filteredData.length; i += step) {
      sampled.push(filteredData[i]);
    }
    // Always include last point
    if (sampled[sampled.length - 1] !== filteredData[filteredData.length - 1]) {
      sampled.push(filteredData[filteredData.length - 1]);
    }
    return sampled;
  }, [filteredData]);

  // Price metrics
  const currentPrice = chartData.length > 0 ? chartData[chartData.length - 1].rate : 0;
  const firstPrice = chartData.length > 0 ? chartData[0].rate : 0;
  const priceChange =
    firstPrice > 0 ? ((currentPrice - firstPrice) / firstPrice) * 100 : 0;
  const isPositive = priceChange >= 0;
  const changeColor = isPositive ? colors.primary[400] : colors.error;

  // Compute SVG points
  const chartWidth = containerWidth - PADDING_H * 2;
  const chartHeight = height - PADDING_V * 2;

  const { points, minRate, maxRate } = useMemo(() => {
    if (chartData.length < 2 || chartWidth <= 0)
      return { points: [], minRate: 0, maxRate: 0 };

    const rates = chartData.map((d) => d.rate);
    const mn = Math.min(...rates);
    const mx = Math.max(...rates);
    const range = mx - mn || 1;

    const drawableHeight = chartHeight - DATA_INSET_TOP - DATA_INSET_BOTTOM;
    const pts = chartData.map((d, i) => ({
      x: PADDING_H + (i / (chartData.length - 1)) * chartWidth,
      y: PADDING_V + DATA_INSET_TOP + drawableHeight - ((d.rate - mn) / range) * drawableHeight,
    }));

    return { points: pts, minRate: mn, maxRate: mx };
  }, [chartData, chartWidth, chartHeight]);

  const linePath = useMemo(
    () => buildSmoothPath(points, false, chartHeight + PADDING_V, containerWidth),
    [points, chartHeight, containerWidth]
  );

  const areaPath = useMemo(
    () => buildSmoothPath(points, true, chartHeight + PADDING_V, containerWidth),
    [points, chartHeight, containerWidth]
  );

  // Interaction handlers
  const getIndexFromX = useCallback(
    (pageX: number, containerX: number) => {
      if (chartData.length < 2 || chartWidth <= 0) return null;
      const x = pageX - containerX;
      const ratio = Math.max(0, Math.min(1, x / chartWidth));
      return Math.round(ratio * (chartData.length - 1));
    },
    [chartData.length, chartWidth]
  );

  const svgContainerRef = useRef<View>(null);
  const containerXRef = useRef(0);

  const handleInteractionStart = useCallback(
    (pageX: number) => {
      if (!interactive) return;
      const idx = getIndexFromX(pageX, containerXRef.current);
      setActiveIndex(idx);
    },
    [interactive, getIndexFromX]
  );

  const handleInteractionMove = useCallback(
    (pageX: number) => {
      if (!interactive) return;
      const idx = getIndexFromX(pageX, containerXRef.current);
      setActiveIndex(idx);
    },
    [interactive, getIndexFromX]
  );

  const handleInteractionEnd = useCallback(() => {
    setActiveIndex(null);
  }, []);

  // Web mouse events
  const webProps = isWeb && interactive
    ? {
        onMouseMove: (e: any) => {
          if (svgContainerRef.current) {
            (svgContainerRef.current as any).measure?.(
              (_x: number, _y: number, _w: number, _h: number, px: number) => {
                containerXRef.current = px;
                handleInteractionMove(e.nativeEvent.pageX);
              }
            );
            // Fallback: use stored offset
            handleInteractionMove(e.nativeEvent.pageX);
          }
        },
        onMouseLeave: handleInteractionEnd,
      }
    : {};

  // Native touch events
  const nativeTouchProps =
    !isWeb && interactive
      ? {
          onTouchStart: (e: GestureResponderEvent) => {
            svgContainerRef.current?.measure?.(
              (_x: number, _y: number, _w: number, _h: number, px: number) => {
                containerXRef.current = px;
              }
            );
            handleInteractionStart(e.nativeEvent.pageX);
          },
          onTouchMove: (e: GestureResponderEvent) => {
            handleInteractionMove(e.nativeEvent.pageX);
          },
          onTouchEnd: handleInteractionEnd,
        }
      : {};

  // Measure container on layout
  const handleSvgLayout = useCallback(
    (e: LayoutChangeEvent) => {
      // Measure absolute position for touch/mouse offset
      if (svgContainerRef.current) {
        (svgContainerRef.current as any).measure?.(
          (_x: number, _y: number, _w: number, _h: number, px: number) => {
            containerXRef.current = px;
          }
        );
      }
    },
    []
  );

  // Grid lines at 25%, 50%, 75%
  const drawableH = chartHeight - DATA_INSET_TOP - DATA_INSET_BOTTOM;
  const gridLines = [0.25, 0.5, 0.75].map((pct) => ({
    y: PADDING_V + DATA_INSET_TOP + drawableH - pct * drawableH,
    label:
      minRate > 0
        ? formatPrice(minRate + pct * (maxRate - minRate))
        : "",
  }));

  // Loading / Empty state
  if (loading || !data || data.length === 0) {
    if (loading) {
      return <ChartSkeleton height={height} />;
    }
    return (
      <View
        style={{
          backgroundColor: tc.dark.card,
          borderRadius: 20,
          padding: 24,
          borderWidth: 1,
          borderColor: tc.glass.border,
          minHeight: height + 80,
        }}
      >
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 14,
            fontFamily: "DMSans_500Medium",
            textAlign: "center",
            marginTop: height / 3,
          }}
        >
          No price data available
        </Text>
        {/* Still show period selector */}
        <PeriodSelector selected={period} onSelect={handlePeriodChange} accentColor={color} />
      </View>
    );
  }

  const activePoint =
    activeIndex !== null && points[activeIndex] ? points[activeIndex] : null;
  const activeData =
    activeIndex !== null && chartData[activeIndex] ? chartData[activeIndex] : null;

  return (
    <View
      style={{
        backgroundColor: tc.dark.card,
        borderRadius: 20,
        padding: 20,
        borderWidth: 1,
        borderColor: tc.glass.border,
        ...ts.md,
      }}
    >
      {/* Price Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
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
            {currency}/KES
          </Text>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 24,
              fontFamily: "DMSans_700Bold",
              letterSpacing: -0.5,
            }}
          >
            {activeData ? formatPrice(activeData.rate) : formatPrice(currentPrice)}
          </Text>
        </View>
        <View
          style={{
            backgroundColor: changeColor + "1A",
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 5,
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
          }}
        >
          <Text
            style={{
              color: changeColor,
              fontSize: 13,
              fontFamily: "DMSans_600SemiBold",
            }}
          >
            {isPositive ? "+" : ""}
            {priceChange.toFixed(2)}%
          </Text>
        </View>
      </View>

      {/* Chart Area */}
      <View
        ref={svgContainerRef}
        onLayout={(e) => {
          onLayout(e);
          handleSvgLayout(e);
        }}
        {...webProps}
        {...nativeTouchProps}
        style={{
          width: "100%",
          height: height,
          ...(isWeb && interactive ? ({ cursor: "crosshair" } as any) : {}),
        }}
      >
        {containerWidth > 0 && points.length >= 2 && (
          <Svg
            width={containerWidth}
            height={height}
            viewBox={`0 0 ${containerWidth} ${height}`}
          >
            <Defs>
              <SvgLinearGradient id={`grad-${currency}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={color} stopOpacity={0.45} />
                <Stop offset="60%" stopColor={color} stopOpacity={0.12} />
                <Stop offset="100%" stopColor={color} stopOpacity={0.0} />
              </SvgLinearGradient>
            </Defs>

            {/* Grid lines */}
            {gridLines.map((gl, i) => (
              <Line
                key={`grid-${i}`}
                x1={PADDING_H}
                y1={gl.y}
                x2={containerWidth - PADDING_H}
                y2={gl.y}
                stroke={tc.dark.border}
                strokeWidth={1}
                strokeDasharray="4 4"
                opacity={0.5}
              />
            ))}

            {/* Gradient fill area */}
            <Path d={areaPath} fill={`url(#grad-${currency})`} />

            {/* Line — glow layer for visibility */}
            <Path
              d={linePath}
              fill="none"
              stroke={color}
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.2}
            />
            {/* Line — main */}
            <Path
              d={linePath}
              fill="none"
              stroke={color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Active indicator */}
            {activePoint && (
              <>
                {/* Vertical guide line */}
                <Line
                  x1={activePoint.x}
                  y1={PADDING_V}
                  x2={activePoint.x}
                  y2={chartHeight + PADDING_V}
                  stroke={color}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  opacity={0.5}
                />
                {/* Dot */}
                <Circle
                  cx={activePoint.x}
                  cy={activePoint.y}
                  r={5}
                  fill={color}
                  stroke={tc.dark.card}
                  strokeWidth={2}
                />
              </>
            )}
          </Svg>
        )}

        {/* Tooltip overlay (RN View for better text rendering) */}
        {activePoint && activeData && (
          <Tooltip
            x={activePoint.x}
            y={activePoint.y}
            price={formatPrice(activeData.rate)}
            date={formatDate(activeData.timestamp)}
            chartWidth={containerWidth}
            color={color}
          />
        )}
      </View>

      {/* Period Selector */}
      <PeriodSelector selected={period} onSelect={handlePeriodChange} accentColor={color} />
    </View>
  );
}

/* ─── SparklineChart: mini version for cards ─── */
export interface SparklineProps {
  data: ChartDataPoint[];
  color: string;
  width?: number;
  height?: number;
}

export function SparklineChart({
  data,
  color,
  width: propWidth,
  height: propHeight = 60,
}: SparklineProps) {
  const [containerWidth, setContainerWidth] = useState(propWidth || 0);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      if (!propWidth) setContainerWidth(e.nativeEvent.layout.width);
    },
    [propWidth]
  );

  const w = propWidth || containerWidth;

  const { linePath, areaPath } = useMemo(() => {
    if (data.length < 2 || w <= 0) return { linePath: "", areaPath: "" };

    const rates = data.map((d) => d.rate);
    const mn = Math.min(...rates);
    const mx = Math.max(...rates);
    const range = mx - mn || 1;

    const pts = data.map((d, i) => ({
      x: (i / (data.length - 1)) * w,
      y: 4 + (propHeight - 8) - ((d.rate - mn) / range) * (propHeight - 8),
    }));

    return {
      linePath: buildSmoothPath(pts, false, propHeight, w),
      areaPath: buildSmoothPath(pts, true, propHeight, w),
    };
  }, [data, w, propHeight]);

  if (data.length < 2) return null;

  return (
    <View
      onLayout={onLayout}
      style={{ width: propWidth || "100%", height: propHeight }}
    >
      {w > 0 && (
        <Svg width={w} height={propHeight} viewBox={`0 0 ${w} ${propHeight}`}>
          <Defs>
            <SvgLinearGradient id={`spark-${color}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <Stop offset="60%" stopColor={color} stopOpacity={0.08} />
              <Stop offset="100%" stopColor={color} stopOpacity={0.0} />
            </SvgLinearGradient>
          </Defs>
          <Path d={areaPath} fill={`url(#spark-${color})`} />
          {/* Glow for visibility */}
          <Path
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.15}
          />
          <Path
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      )}
    </View>
  );
}

/* ─── CryptoChartSkeleton: loading state for full chart ─── */
export { ChartSkeleton as CryptoChartSkeleton };
