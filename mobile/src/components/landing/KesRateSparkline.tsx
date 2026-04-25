/**
 * KesRateSparkline · a single-stroke, data-driven sparkline of crypto/USD
 * price over the last 7 days, drawn as a plain SVG polyline.
 *
 * Aesthetic: financial-instrument minimalism. One hairline stroke (1px
 * primary-500), a 12% opacity area fill beneath, no axes, no grid, no
 * labels at rest. The chart is an atmospheric underlay behind the stats
 * tiles · present but not clamouring for attention.
 *
 * Motion rule: NO idle animation. Hover (or tap on mobile web) reveals
 * a vertical guide line, a dot on the curve, and a compact value tooltip.
 * Everything else is static.
 *
 * Data source: GET /api/v1/rates/history/?currency=<X>&period=7d · a
 * public, cached endpoint backed by CoinGecko → CryptoCompare → DB
 * fallback. If the fetch fails, the component renders nothing rather
 * than showing fake data.
 */

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { View, Text, Platform } from "react-native";
import { getThemeColors } from "../../constants/theme";
import { useThemeMode } from "../../stores/theme";

type Point = { timestamp: number; rate: number };

type Props = {
  /** Crypto symbol to chart. BTC is the default because it visibly moves
   * day-to-day; USDT would be a flat line near 1.0 and carry no signal. */
  currency?: "BTC" | "ETH" | "SOL";
  /** Chart width in CSS pixels. Defaults to parent width via 100%. */
  width?: number | string;
  /** Chart height in CSS pixels. */
  height?: number;
  /** Override the API base if the landing is hosted off-domain. */
  apiBase?: string;
};

const DEFAULT_API_BASE = "https://cpay.co.ke/api/v1";

export function KesRateSparkline({
  currency = "BTC",
  width = "100%",
  height = 96,
  apiBase = DEFAULT_API_BASE,
}: Props) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const accent = tc.primary[500] || "#10B981";

  const [points, setPoints] = useState<Point[] | null>(null);
  const [error, setError] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const svgRef = useRef<any>(null);

  // Fetch once on mount. We deliberately don't refetch on re-render or on
  // interval · the 7-day window is cached 30 minutes server-side anyway,
  // and a fresh sparkline every minute would be aesthetic noise.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = `${apiBase}/rates/history/?currency=${currency}&period=7d`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as Point[];
        if (!Array.isArray(data) || data.length < 2) {
          throw new Error("insufficient data");
        }
        if (!cancelled) setPoints(data);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currency, apiBase]);

  // Normalise points to a 0..VIEW_W / 0..VIEW_H coordinate space. The SVG
  // uses preserveAspectRatio="none" below so it stretches to fit the
  // container, which is what we want for a decorative underlay.
  const VIEW_W = 1000;
  const VIEW_H = 100;
  const PAD = 6; // keep the line from touching the top/bottom edges

  const geometry = useMemo(() => {
    if (!points || points.length < 2) return null;
    const rates = points.map((p) => p.rate);
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    const range = max - min || 1; // avoid /0 on a perfectly flat series
    const step = VIEW_W / (points.length - 1);

    const coords = points.map((p, i) => {
      const x = i * step;
      const norm = (p.rate - min) / range;
      const y = VIEW_H - PAD - norm * (VIEW_H - PAD * 2);
      return { x, y, rate: p.rate, timestamp: p.timestamp };
    });

    const polyline = coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");
    // Close the area fill back down to the baseline.
    const area = `${coords[0].x},${VIEW_H} ${polyline} ${coords[coords.length - 1].x},${VIEW_H}`;

    const change = (points[points.length - 1].rate - points[0].rate) / points[0].rate;
    return { coords, polyline, area, min, max, change };
  }, [points]);

  // Pointer tracking. Map pointer X in the SVG to the nearest data index.
  const onMove = useCallback(
    (clientX: number) => {
      if (!geometry || Platform.OS !== "web") return;
      const el = svgRef.current as SVGSVGElement | null;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const xRatio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      const idx = Math.round(xRatio * (geometry.coords.length - 1));
      setHoverIdx(idx);
    },
    [geometry],
  );

  if (error || !points || !geometry) {
    // Silent fallback: render nothing so the stats tiles above look
    // intentional rather than "oh, something failed to load".
    return <View style={{ width: width as any, height, opacity: 0 }} />;
  }

  const hover = hoverIdx != null ? geometry.coords[hoverIdx] : null;
  const gradientId = `cpay-spark-grad-${currency}`;

  // On native we just render a flat placeholder · the stats section is
  // web-dominant and sparkline interactivity requires DOM events.
  if (Platform.OS !== "web") {
    return <View style={{ width: width as any, height }} />;
  }

  const formattedValue = (v: number) => {
    if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (v >= 1) return v.toFixed(2);
    return v.toFixed(4);
  };

  const formattedChange = `${geometry.change >= 0 ? "+" : ""}${(geometry.change * 100).toFixed(2)}%`;
  const changeColour = geometry.change >= 0 ? accent : "#F87171";

  return (
    <View
      // @ts-ignore · web-only DOM events; RN-web forwards these.
      onMouseMove={(e: any) => onMove(e.clientX)}
      onMouseLeave={() => setHoverIdx(null)}
      // @ts-ignore
      onTouchStart={(e: any) => e.touches?.[0] && onMove(e.touches[0].clientX)}
      // @ts-ignore
      onTouchMove={(e: any) => e.touches?.[0] && onMove(e.touches[0].clientX)}
      onTouchEnd={() => setHoverIdx(null)}
      style={{ width: width as any, height, position: "relative" }}
    >
      {/* Corner label: currency and 7d % change. Stays small and quiet. */}
      <View
        style={{
          position: "absolute",
          top: 6,
          left: 10,
          zIndex: 2,
          flexDirection: "row",
          alignItems: "baseline",
          gap: 8,
          pointerEvents: "none" as any,
        }}
      >
        <Text style={{ color: tc.textMuted, fontSize: 10, fontFamily: "DMSans_500Medium", letterSpacing: 1.5 }}>
          {currency}/USD · 7D
        </Text>
        <Text style={{ color: changeColour, fontSize: 10, fontFamily: "DMSans_600SemiBold" }}>
          {formattedChange}
        </Text>
      </View>

      {/* Tooltip bubble follows the hover point. Positioned in CSS px so it
          sits above the SVG coordinate system cleanly. */}
      {hover ? (
        <View
          style={{
            position: "absolute",
            top: 6,
            right: 10,
            zIndex: 2,
            flexDirection: "row",
            alignItems: "baseline",
            gap: 6,
            pointerEvents: "none" as any,
          }}
        >
          <Text style={{ color: tc.textSecondary, fontSize: 10, fontFamily: "DMSans_400Regular" }}>
            {new Date(hover.timestamp).toLocaleDateString(undefined, {
              weekday: "short",
              day: "numeric",
            })}
          </Text>
          <Text style={{ color: tc.textPrimary, fontSize: 11, fontFamily: "DMSans_600SemiBold" }}>
            ${formattedValue(hover.rate)}
          </Text>
        </View>
      ) : null}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.18" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Area fill under the line. Low opacity · this is atmosphere. */}
        <polygon points={geometry.area} fill={`url(#${gradientId})`} />

        {/* The price line itself. 1.2px reads as ~1px on 1x displays and
            half-a-hair on retina · deliberately fine. */}
        <polyline
          points={geometry.polyline}
          fill="none"
          stroke={accent}
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Hover guide line + dot. Only exists during hover. */}
        {hover ? (
          <g pointerEvents="none">
            <line
              x1={hover.x}
              y1="0"
              x2={hover.x}
              y2={VIEW_H}
              stroke={accent}
              strokeWidth="0.8"
              strokeDasharray="2 3"
              opacity="0.4"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={hover.x} cy={hover.y} r="4" fill={tc.dark.bg} stroke={accent} strokeWidth="1.5" />
          </g>
        ) : null}
      </svg>
    </View>
  );
}
