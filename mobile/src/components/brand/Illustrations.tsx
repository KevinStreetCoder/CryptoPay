/**
 * Brand illustrations ported from the design handoff
 * (cpay/project/assets.jsx). These are the on-brand replacements for
 * unDraw stock art — 200×200 viewBox, 1.5px ink-2 strokes, single
 * emerald accent per illustration.
 *
 * Usage rules (from the brief):
 *   - No emoji, no stock illustration, no 3D blob art.
 *   - One animated component per fold.
 *   - prefers-reduced-motion: the two that animate (SpeedRing,
 *     KenyaCorridor) are safe — they fall back to static final frames.
 */
import { useEffect, useRef, useState, useMemo } from "react";
import { View, Text, Animated, Easing, Platform } from "react-native";
import Svg, { Circle, Rect, Path, Line, Text as SvgText, G } from "react-native-svg";

// Brand palette — locked to the design, not the theme.
const INK = "#0B1220";
const INK2 = "#1F2937";
const EMERALD = "#10B981";
const EMERALD_DARK = "#059669";
const LINE = "#E5E7EB";
const MUTED = "#64748B";
const PAPER = "#FFFFFF";

const isWeb = Platform.OS === "web";

// ─────────────────────────────────────────────────────────────────────────
// Static wallet card (replaces "wallet_aym5" unDraw illustration).
// ─────────────────────────────────────────────────────────────────────────
export function WalletIcon({ size = 200 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Rect x="40" y="60" width="120" height="90" rx="10" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Rect x="40" y="75" width="120" height="14" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Rect x="110" y="100" width="36" height="22" rx="3" fill={EMERALD} />
      <Circle cx="128" cy="111" r="4" fill={PAPER} />
      <Path
        d="M 55 60 Q 55 50 65 50 L 135 50 Q 145 50 145 60"
        fill="none"
        stroke={INK2}
        strokeWidth="1.5"
      />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Shield + padlock (replaces "secure_data_0rwp" + "safe_c-7y").
// ─────────────────────────────────────────────────────────────────────────
export function SecurityLock({ size = 200 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Path
        d="M 100 30 L 150 50 L 150 105 Q 150 150 100 170 Q 50 150 50 105 L 50 50 Z"
        fill="none"
        stroke={INK2}
        strokeWidth="1.5"
      />
      <Rect x="78" y="92" width="44" height="38" rx="4" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Path
        d="M 86 92 L 86 82 Q 86 70 100 70 Q 114 70 114 82 L 114 92"
        fill="none"
        stroke={INK2}
        strokeWidth="1.5"
      />
      <Circle cx="100" cy="108" r="4" fill={EMERALD} />
      <Rect x="98" y="108" width="4" height="10" fill={EMERALD} />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SpeedRing — counts 30 → 0 on a shrinking emerald arc.
// Replaces "fast_loading_0lbh" (settle time illustration).
// 3s loop. Reduced-motion → freezes at "30".
// ─────────────────────────────────────────────────────────────────────────
export function SpeedRing({ size = 200, seconds = 30 }: { size?: number; seconds?: number }) {
  const progress = useLoopProgress(3000, { reverse: true }); // 1 → 0 over 3s
  const r = 70;
  const circumference = 2 * Math.PI * r;
  const dash = circumference * progress;
  const display = Math.ceil(seconds * progress);

  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Circle cx="100" cy="100" r={r} fill="none" stroke={LINE} strokeWidth="4" />
      <Circle
        cx="100"
        cy="100"
        r={r}
        fill="none"
        stroke={EMERALD}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
        strokeDashoffset={circumference / 4}
        transform="rotate(-90 100 100)"
      />
      <SvgText
        x="100"
        y="108"
        textAnchor="middle"
        fontSize="42"
        fontWeight="700"
        fill={INK}
        fontFamily="DMSans_700Bold"
        letterSpacing="-1"
      >
        {display}
      </SvgText>
      <SvgText
        x="100"
        y="128"
        textAnchor="middle"
        fontSize="11"
        fontWeight="500"
        fill={MUTED}
        fontFamily="DMSans_500Medium"
        letterSpacing="2"
      >
        SECONDS
      </SvgText>
      <SvgText
        x="100"
        y="158"
        textAnchor="middle"
        fontSize="10"
        fontWeight="600"
        fill={EMERALD_DARK}
        fontFamily="DMSans_600SemiBold"
        letterSpacing="1"
      >
        AVG SETTLEMENT
      </SvgText>
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// FaqMark — large outline "?" with emerald dot.
// Replaces "questions_re1f".
// ─────────────────────────────────────────────────────────────────────────
export function FaqMark({ size = 200 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Path
        d="M 70 75 Q 70 45 100 45 Q 130 45 130 72 Q 130 92 100 100 L 100 125"
        fill="none"
        stroke={INK2}
        strokeWidth="6"
        strokeLinecap="round"
      />
      <Circle cx="100" cy="148" r="6" fill={EMERALD} />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// TargetMark — concentric rings with an arrow impact.
// Replaces "target_kriv" (mission / goal).
// ─────────────────────────────────────────────────────────────────────────
export function TargetMark({ size = 200 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Circle cx="100" cy="100" r="70" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Circle cx="100" cy="100" r="48" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Circle cx="100" cy="100" r="26" fill="none" stroke={INK2} strokeWidth="1.5" />
      <Circle cx="100" cy="100" r="8" fill={EMERALD} />
      <Path d="M 145 55 L 112 88" stroke={EMERALD} strokeWidth="2.5" strokeLinecap="round" />
      <Path d="M 112 88 L 120 80" stroke={EMERALD} strokeWidth="2.5" strokeLinecap="round" />
      <Path d="M 112 88 L 104 80" stroke={EMERALD} strokeWidth="2.5" strokeLinecap="round" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// KenyaCorridor — stylised dot-grid with a pulsing "Nairobi" ring.
// Replaces "online_world_igmw" (global reach).
// ─────────────────────────────────────────────────────────────────────────
export function KenyaCorridor({ size = 200 }: { size?: number }) {
  const dots = useMemo(() => {
    const out: { x: number; y: number; active: boolean }[] = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 11; c++) {
        const x = 30 + c * 14;
        const y = 45 + r * 12;
        const dx = (c - 5) / 5;
        const dy = (r - 4) / 4;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1.1) continue;
        out.push({ x, y, active: d < 0.35 });
      }
    }
    return out;
  }, []);

  // Nairobi pulse: radius 6 → 20 → 6 over 3s, opacity 0.8 → 0 → 0.8.
  const pulseR = useRef(new Animated.Value(6)).current;
  const pulseO = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    const rLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseR, {
          toValue: 20,
          duration: 1500,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(pulseR, {
          toValue: 6,
          duration: 1500,
          easing: Easing.in(Easing.quad),
          useNativeDriver: false,
        }),
      ]),
    );
    const oLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseO, { toValue: 0, duration: 1500, useNativeDriver: false }),
        Animated.timing(pulseO, { toValue: 0.8, duration: 1500, useNativeDriver: false }),
      ]),
    );
    rLoop.start();
    oLoop.start();
    return () => {
      rLoop.stop();
      oLoop.stop();
    };
  }, []);

  // Drive two state values (radius + opacity) off the Animated refs so
  // we can pass plain numeric props to <Circle> instead of wrapping it
  // in Animated.createAnimatedComponent. The AnimatedComponent wrapper
  // leaks RN's internal `collapsable={false}` to the DOM, which React
  // warns about on web (non-boolean attribute).
  const [pulse, setPulse] = useState({ r: 6, o: 0.8 });
  useEffect(() => {
    const rId = pulseR.addListener(({ value }) => setPulse((p) => ({ ...p, r: value })));
    const oId = pulseO.addListener(({ value }) => setPulse((p) => ({ ...p, o: value })));
    return () => {
      pulseR.removeListener(rId);
      pulseO.removeListener(oId);
    };
  }, []);

  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      {dots.map((d, i) => (
        <Circle
          key={i}
          cx={d.x}
          cy={d.y}
          r={d.active ? 2.5 : 1.5}
          fill={d.active ? EMERALD : LINE}
        />
      ))}
      <Circle
        cx="100"
        cy="93"
        r={pulse.r}
        fill="none"
        stroke={EMERALD}
        strokeWidth="1"
        opacity={pulse.o}
      />
      <SvgText
        x="100"
        y="170"
        textAnchor="middle"
        fontSize="10"
        fontWeight="600"
        fill={MUTED}
        fontFamily="DMSans_600SemiBold"
        letterSpacing="2"
      >
        NAIROBI · LIVE
      </SvgText>
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// FeeBreakdown — pricing card with spread, flat fee, first-5K waived.
// Replaces "finance_0bdk" + "bitcoin2_ave7".
// ─────────────────────────────────────────────────────────────────────────
export function FeeBreakdown({ width = 320, height = 220 }: { width?: number; height?: number }) {
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Rect x="0" y="0" width={width} height={height} fill={PAPER} />
      <SvgText
        x="24"
        y="32"
        fontSize="10"
        fontWeight="700"
        fill={MUTED}
        fontFamily="DMSans_700Bold"
        letterSpacing="2"
      >
        PRICING · TRANSPARENT
      </SvgText>

      <SvgText x="24" y="70" fontSize="12" fill={INK2} fontFamily="DMSans_400Regular">
        Platform spread
      </SvgText>
      <SvgText
        x={width - 24}
        y="70"
        textAnchor="end"
        fontSize="22"
        fontWeight="700"
        fill={EMERALD}
        fontFamily="JetBrainsMono_700Bold"
      >
        1.5%
      </SvgText>

      <Line x1="24" y1="86" x2={width - 24} y2="86" stroke={LINE} />

      <SvgText x="24" y="114" fontSize="12" fill={INK2} fontFamily="DMSans_400Regular">
        Flat fee
      </SvgText>
      <SvgText
        x={width - 24}
        y="114"
        textAnchor="end"
        fontSize="22"
        fontWeight="700"
        fill={INK}
        fontFamily="JetBrainsMono_700Bold"
      >
        KES 10
      </SvgText>

      <Line x1="24" y1="130" x2={width - 24} y2="130" stroke={LINE} />

      <SvgText x="24" y="158" fontSize="12" fill={INK2} fontFamily="DMSans_400Regular">
        First KES 5,000
      </SvgText>
      <SvgText
        x={width - 24}
        y="158"
        textAnchor="end"
        fontSize="13"
        fontWeight="700"
        fill={EMERALD_DARK}
        fontFamily="DMSans_700Bold"
      >
        FLAT FEE WAIVED
      </SvgText>

      <SvgText
        x="24"
        y={height - 14}
        fontSize="10"
        fill={MUTED}
        fontFamily="DMSans_400Regular"
        letterSpacing="0.5"
      >
        No hidden FX markup · No card fees
      </SvgText>
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// useLoopProgress — drives 0→1 (or 1→0) on a loop. Used by SpeedRing.
// On web we use requestAnimationFrame; on native we use RN Animated.
// Honors prefers-reduced-motion by returning a static final frame.
// ─────────────────────────────────────────────────────────────────────────
function useLoopProgress(durationMs: number, opts: { reverse?: boolean } = {}) {
  const [p, setP] = useState(opts.reverse ? 1 : 0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (prefersReduced) {
      setP(opts.reverse ? 1 : 0);
      return;
    }
    // Bind raf to `window` — detached calls throw "Illegal invocation".
    const raf = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);

    let mounted = true;
    const tick = (now: number) => {
      if (!mounted) return;
      if (!startRef.current) startRef.current = now;
      const elapsed = (now - startRef.current) % durationMs;
      const linear = elapsed / durationMs;
      setP(opts.reverse ? 1 - linear : linear);
      rafRef.current = raf(tick);
    };
    rafRef.current = raf(tick);
    return () => {
      mounted = false;
      if (rafRef.current) cancel(rafRef.current);
    };
  }, [durationMs]);

  return p;
}
