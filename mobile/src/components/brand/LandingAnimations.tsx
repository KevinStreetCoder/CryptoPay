/**
 * Landing-page animated components ported from the design handoff
 * (cpay/project/assets.jsx). Each is a self-contained SVG that
 * renders via react-native-svg on native and inline SVG on web.
 *
 * Animations are driven by a shared useLoop hook that returns a 0→1
 * tick on a fixed period. Respects prefers-reduced-motion (static
 * final frame) on web.
 *
 * Components:
 *   - HeroFlow         6s loop. Coin → phone → receipt.
 *   - RateSparkline    4s loop. Animated USDT/KES line draw.
 *   - RateLockRing     9s loop (10x speed vs real 90s).
 *   - ChainConverge    3.5s loop. Particles USDT/BTC/ETH/SOL → hub → KES.
 *   - PaymentTicker    20s loop. Scrolling settled-tx chips.
 *
 * Motion rule: one running per fold. Gate with IntersectionObserver in
 * the landing page to avoid running off-screen (ChainConverge + Ticker
 * would otherwise both spin while hidden).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";

const isWeb = Platform.OS === "web";

// ── Brand palette — locked to the design, not the theme. ────────────────
const CPAY = {
  emerald: "#10B981",
  emeraldDark: "#059669",
  emeraldSoft: "#D1FAE5",
  ink: "#0B1220",
  ink2: "#1F2937",
  muted: "#64748B",
  line: "#E5E7EB",
  lineSoft: "#F1F5F9",
  paper: "#FFFFFF",
  bg: "#F8FAFC",
};

// ── Shared: loop + easings ──────────────────────────────────────────────
function useLoop(duration = 4000) {
  const [t, setT] = useState(0);
  useEffect(() => {
    // `requestAnimationFrame` must be called with `window` as `this` on
    // web — yanking it out of a ternary throws "Illegal invocation" in
    // modern browsers. Bind (or closure-capture) it instead.
    const raf = isWeb
      ? (cb: FrameRequestCallback) => window.requestAnimationFrame(cb)
      : (cb: (now: number) => void) => setTimeout(() => cb(Date.now()), 16) as any;
    const cancel = isWeb
      ? (id: any) => window.cancelAnimationFrame(id)
      : (id: any) => clearTimeout(id);

    if (isWeb && typeof window !== "undefined") {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (reduced) {
        setT(0); // static frame
        return;
      }
    }
    let id: any = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      if (start === null) start = now;
      setT(((now - start) % duration) / duration);
      id = raf(tick);
    };
    id = raf(tick);
    return () => cancel(id);
  }, [duration]);
  return t;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

// ── Native guard ────────────────────────────────────────────────────────
// These components render heavy animated SVG — web is the primary target.
// On native we render a lightweight placeholder so the screen doesn't
// blank out, and a real port can land in a follow-up.
function NativeFallback({ width, height, label }: { width: number; height: number; label: string }) {
  return (
    <View
      style={{
        width,
        height,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: CPAY.bg,
        borderRadius: 16,
      }}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 1. HeroFlow — Coin → phone → M-Pesa receipt, 6s loop
// ═══════════════════════════════════════════════════════════════════════
export function HeroFlow({ width = 520, height = 420 }: { width?: number; height?: number }) {
  const t = useLoop(6000);
  if (!isWeb) return <NativeFallback width={width} height={height} label="Hero flow" />;

  // Fixed internal canvas — the designer's layout (phone at x=200, receipt
  // at x≈360) assumes a 520x420 stage. External width/height just scale
  // the SVG, so the whole flow (coin + phone + receipt) stays visible at
  // any render size without clipping.
  const VB_W = 520;
  const VB_H = 420;

  const a = Math.min(1, t / 0.35);
  const b = Math.min(1, Math.max(0, (t - 0.35) / 0.25));
  const c = Math.min(1, Math.max(0, (t - 0.55) / 0.35));
  const coinY = -40 + easeOut(a) * 150;
  const coinOpacity = a < 0.95 ? 1 : 1 - (a - 0.95) / 0.05;
  const pulse = b < 1 ? Math.sin(b * Math.PI) : 0;
  const receiptY = 40 + (1 - easeOut(c)) * 40;
  const receiptO = easeOut(c);

  const phX = 200;
  const phY = 90;
  const phW = 120;
  const phH = 220;
  const slotY = phY + 40;

  return (
    <View style={{ width, height }}>
      <svg viewBox={`160 0 ${VB_W - 140} ${VB_H}`} width={width} height={height} style={{ display: "block", background: CPAY.bg, borderRadius: 16 }}>
        <defs>
          <clipPath id="hf-phone">
            <rect x={phX} y={phY} width={phW} height={phH} rx="16" />
          </clipPath>
        </defs>
        <g opacity="0.6">
          {[...Array(8)].map((_, i) => (
            <line key={i} x1={0} y1={60 + i * 40} x2={VB_W} y2={60 + i * 40} stroke={CPAY.lineSoft} strokeWidth="1" />
          ))}
        </g>
        <ellipse cx={phX + phW / 2} cy={phY + phH + 18} rx="70" ry="8" fill="rgba(11,18,32,0.08)" />
        <rect x={phX - 4} y={phY - 4} width={phW + 8} height={phH + 8} rx="20" fill={CPAY.ink} />
        <rect x={phX} y={phY} width={phW} height={phH} rx="16" fill={CPAY.paper} stroke={CPAY.line} />
        <g clipPath="url(#hf-phone)">
          <rect x={phX} y={phY} width={phW} height={24} fill={CPAY.ink} opacity="0.04" />
          <circle cx={phX + phW / 2} cy={phY + 12} r="3" fill={CPAY.ink} opacity="0.3" />
          <rect x={phX + 16} y={slotY} width={phW - 32} height={50} rx="10" fill={CPAY.emeraldSoft} opacity={0.6 + pulse * 0.4} />
          <rect x={phX + 16} y={slotY} width={phW - 32} height={50} rx="10" fill="none" stroke={CPAY.emerald} strokeWidth="1.5" strokeDasharray="4 4" opacity={0.7} />
          {b > 0 && b < 1 && (
            <g transform={`translate(${phX + phW / 2}, ${slotY + 110})`}>
              <circle r="14" fill="none" stroke={CPAY.emerald} strokeWidth="2" opacity="0.2" />
              <circle r="14" fill="none" stroke={CPAY.emerald} strokeWidth="2" strokeDasharray={`${b * 88} 88`} strokeLinecap="round" transform="rotate(-90)" />
            </g>
          )}
          <g opacity={c} transform={`translate(0, ${(1 - c) * 8})`}>
            <text x={phX + phW / 2} y={slotY + 110} textAnchor="middle" fontSize="11" fontWeight="500" fill={CPAY.muted} fontFamily="'DM Sans', system-ui">PAID</text>
            <text x={phX + phW / 2} y={slotY + 132} textAnchor="middle" fontSize="20" fontWeight="700" fill={CPAY.ink} fontFamily="'DM Sans', system-ui" letterSpacing="-0.5">KES 1,450</text>
          </g>
          {c > 0.6 && (
            <g transform={`translate(${phX + phW / 2}, ${slotY + 170})`} opacity={(c - 0.6) / 0.4}>
              <circle r="16" fill={CPAY.emerald} />
              <path d="M -6 0 L -2 4 L 6 -4" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          )}
        </g>
        <rect x={phX + phW / 2 - 20} y={phY + 6} width="40" height="6" rx="3" fill={CPAY.ink} />
        {a < 1 && (
          <g opacity={coinOpacity}>
            <ellipse cx={phX + phW / 2} cy={phY + coinY + 8} rx="12" ry="2" fill={CPAY.emerald} opacity="0.15" />
            <g>
              <circle cx={phX + phW / 2} cy={phY + coinY} r="18" fill={CPAY.emerald} />
              <circle cx={phX + phW / 2} cy={phY + coinY} r="18" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
              <text x={phX + phW / 2} y={phY + coinY + 3} textAnchor="middle" fontSize="9.4" fontWeight="700" fontFamily="'DM Sans', system-ui" fill="#fff" letterSpacing="-0.3">USDT</text>
            </g>
          </g>
        )}
        <g opacity={receiptO} transform={`translate(${phX + phW + 40}, ${phY + 30})`}>
          <rect x="0" y={receiptY} width="140" height="160" rx="8" fill={CPAY.paper} stroke={CPAY.line} />
          <rect x="0" y={receiptY} width="140" height="28" rx="8" fill={CPAY.emerald} />
          <rect x="0" y={receiptY + 20} width="140" height="8" fill={CPAY.emerald} />
          <text x="70" y={receiptY + 18} textAnchor="middle" fontSize="11" fontWeight="600" fill="#fff" fontFamily="'DM Sans', system-ui" letterSpacing="0.8">M-PESA RECEIPT</text>
          {[
            { l: "Paybill", r: "888 880" },
            { l: "Amount", r: "KES 1,450" },
            { l: "Rate", r: "131.47" },
            { l: "Fee", r: "KES 10" },
          ].map((row, i) => (
            <g key={i}>
              <text x="12" y={receiptY + 52 + i * 20} fontSize="10" fill={CPAY.muted} fontFamily="'DM Sans', system-ui">{row.l}</text>
              <text x="128" y={receiptY + 52 + i * 20} textAnchor="end" fontSize="10" fontWeight="600" fill={CPAY.ink} fontFamily="'DM Sans', system-ui">{row.r}</text>
            </g>
          ))}
        </g>
        <line x1={phX + phW + 8} y1={phY + phH / 2} x2={phX + phW + 36} y2={phY + phH / 2} stroke={CPAY.line} strokeWidth="1" strokeDasharray="2 3" opacity="0.4" />
      </svg>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 2. RateSparkline — USDT/KES 7-day animated draw
// ═══════════════════════════════════════════════════════════════════════
export function RateSparkline({ width = 520, height = 240 }: { width?: number; height?: number }) {
  const points = useMemo(() => {
    const arr: number[] = [];
    let v = 128.9;
    for (let i = 0; i < 60; i++) {
      v += Math.sin(i * 0.7) * 0.25 + Math.cos(i * 0.31) * 0.4 + i * 0.02;
      arr.push(v);
    }
    return arr;
  }, []);

  const pad = 28;
  const chartH = height - 80;
  const min = Math.min(...points) - 0.3;
  const max = Math.max(...points) + 0.3;
  const xOf = (i: number) => pad + (i / (points.length - 1)) * (width - pad * 2);
  const yOf = (v: number) => 50 + (1 - (v - min) / (max - min)) * chartH;

  const t = useLoop(4000);
  if (!isWeb) return <NativeFallback width={width} height={height} label="Sparkline" />;

  const drawN = Math.floor(t * points.length);
  const cursorI = Math.min(drawN, points.length - 1);
  const cursorV = points[cursorI];
  const visible = points.slice(0, drawN + 1);
  const linePath = visible.map((v, i) => `${i === 0 ? "M" : "L"} ${xOf(i)} ${yOf(v)}`).join(" ");
  const areaPath = visible.length > 1 ? `${linePath} L ${xOf(cursorI)} ${height - 20} L ${xOf(0)} ${height - 20} Z` : "";

  return (
    <View style={{ width, height }}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ display: "block", background: CPAY.paper }}>
        <defs>
          <linearGradient id="sp-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CPAY.emerald} stopOpacity="0.22" />
            <stop offset="100%" stopColor={CPAY.emerald} stopOpacity="0" />
          </linearGradient>
        </defs>
        <text x={pad} y="24" fontSize="11" fontWeight="500" fill={CPAY.muted} fontFamily="'DM Sans', system-ui" letterSpacing="1">USDT / KES — LAST 7 DAYS</text>
        <g transform={`translate(${width - pad}, 24)`}>
          <circle cx="-84" cy="-4" r="3" fill={CPAY.emerald} />
          <circle cx="-84" cy="-4" r="3" fill={CPAY.emerald} opacity="0.35">
            <animate attributeName="r" values="3;8;3" dur="1.8s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.5;0;0.5" dur="1.8s" repeatCount="indefinite" />
          </circle>
          <text x="-76" y="0" fontSize="10" fontWeight="500" fill={CPAY.emerald} fontFamily="'DM Sans', system-ui">LIVE</text>
        </g>
        <text x={pad} y="52" fontSize="28" fontWeight="700" fill={CPAY.ink} fontFamily="'DM Sans', system-ui" letterSpacing="-0.8">
          {cursorV.toFixed(2)}
          <tspan fontSize="12" fontWeight="500" fill={CPAY.muted} dx="6">KES</tspan>
        </text>
        {[0.25, 0.5, 0.75].map((p) => (
          <line key={p} x1={pad} x2={width - pad} y1={50 + p * chartH} y2={50 + p * chartH} stroke={CPAY.line} strokeWidth="1" strokeDasharray="2 4" />
        ))}
        {areaPath && <path d={areaPath} fill="url(#sp-area)" />}
        {linePath && <path d={linePath} fill="none" stroke={CPAY.emerald} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        <line x1={xOf(cursorI)} x2={xOf(cursorI)} y1={50} y2={height - 20} stroke={CPAY.emerald} strokeWidth="1" strokeDasharray="3 3" opacity="0.4" />
        <circle cx={xOf(cursorI)} cy={yOf(cursorV)} r="5" fill="#fff" stroke={CPAY.emerald} strokeWidth="2" />
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
          <text key={d} x={pad + (i / 6) * (width - pad * 2)} y={height - 6} textAnchor="middle" fontSize="10" fill={CPAY.muted} fontFamily="'DM Sans', system-ui">{d}</text>
        ))}
      </svg>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 3. RateLockRing — 90-second countdown (9s loop = 10x speed)
// ═══════════════════════════════════════════════════════════════════════
export function RateLockRing({ width = 360, height = 360 }: { width?: number; height?: number }) {
  const t = useLoop(9000);
  if (!isWeb) return <NativeFallback width={width} height={height} label="Rate lock" />;

  const remaining = Math.ceil(90 * (1 - t));
  // Internal viewBox is fixed at 360x360 — the designer's ring radius
  // (110), glow radius (150), and pill offsets all assume this canvas.
  // External `width`/`height` just scale the SVG, so the component is
  // safely responsive without clipping its glow at smaller sizes.
  const VB = 360;
  const cx = VB / 2;
  const cy = VB / 2;
  const r = 110;
  const circ = 2 * Math.PI * r;
  const progress = 1 - t;

  return (
    <View style={{ width, height }}>
      <svg viewBox={`0 0 ${VB} ${VB}`} width={width} height={height} style={{ display: "block", background: CPAY.paper, overflow: "visible" }}>
        <defs>
          <linearGradient id="lock-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={CPAY.emerald} />
            <stop offset="100%" stopColor="#34D399" />
          </linearGradient>
          <radialGradient id="lock-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor={CPAY.emerald} stopOpacity="0.18" />
            <stop offset="100%" stopColor={CPAY.emerald} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r="150" fill="url(#lock-glow)" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={CPAY.lineSoft} strokeWidth="10" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="url(#lock-ring)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${progress * circ} ${circ}`} transform={`rotate(-90 ${cx} ${cy})`} />
        {[...Array(12)].map((_, i) => {
          const ang = (i / 12) * Math.PI * 2 - Math.PI / 2;
          return <line key={i} x1={cx + Math.cos(ang) * (r + 16)} y1={cy + Math.sin(ang) * (r + 16)} x2={cx + Math.cos(ang) * (r + 22)} y2={cy + Math.sin(ang) * (r + 22)} stroke={CPAY.line} strokeWidth="1.5" />;
        })}
        <g transform={`translate(${cx}, ${cy - 52})`}>
          <rect x="-11" y="-4" width="22" height="16" rx="3" fill={CPAY.emerald} />
          <path d="M -7 -4 L -7 -10 a 7 7 0 0 1 14 0 L 7 -4" fill="none" stroke={CPAY.emerald} strokeWidth="2.5" />
          <circle cx="0" cy="4" r="2" fill="#fff" />
        </g>
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize="54" fontWeight="700" fill={CPAY.ink} fontFamily="'DM Sans', system-ui" letterSpacing="-2">
          {remaining}
          <tspan fontSize="16" fontWeight="500" fill={CPAY.muted} dx="4">s</tspan>
        </text>
        <text x={cx} y={cy + 28} textAnchor="middle" fontSize="11" fontWeight="500" fill={CPAY.muted} fontFamily="'DM Sans', system-ui" letterSpacing="1.5">RATE LOCKED</text>
        <g transform={`translate(${cx}, ${cy + 70})`}>
          <rect x="-70" y="-16" width="140" height="32" rx="16" fill={CPAY.emeraldSoft} stroke={CPAY.emerald} strokeOpacity="0.3" />
          <text x="0" y="5" textAnchor="middle" fontSize="14" fontWeight="600" fill={CPAY.emeraldDark} fontFamily="'DM Sans', system-ui">1 USDT = 131.47</text>
        </g>
      </svg>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 4. ChainConverge — USDT/BTC/ETH/SOL → Cpay hub → KES
// ═══════════════════════════════════════════════════════════════════════
export function ChainConverge({ width = 620, height = 380 }: { width?: number; height?: number }) {
  const t = useLoop(3500);
  if (!isWeb) return <NativeFallback width={width} height={height} label="Chain converge" />;

  const hubX = width * 0.55;
  const hubY = height / 2;
  const mpesaX = width - 80;
  const mpesaY = hubY;
  const sources = [
    { label: "USDT", y: 70, color: CPAY.emerald, net: "TRON" },
    { label: "BTC", y: 150, color: "#F59E0B", net: "BITCOIN" },
    { label: "ETH", y: 230, color: "#6366F1", net: "ERC-20" },
    { label: "SOL", y: 310, color: "#A855F7", net: "SOLANA" },
  ];
  const srcX = 80;
  const q = (u: number, p0: number, p1: number, p2: number) => (1 - u) * (1 - u) * p0 + 2 * (1 - u) * u * p1 + u * u * p2;

  return (
    <View style={{ width, height }}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ display: "block", background: CPAY.paper }}>
        <defs>
          <radialGradient id="cc-hub-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor={CPAY.emerald} stopOpacity="0.22" />
            <stop offset="100%" stopColor={CPAY.emerald} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={hubX} cy={hubY} r="80" fill="url(#cc-hub-glow)" />
        {sources.map((s) => (
          <path key={s.label} d={`M ${srcX + 22} ${s.y} Q ${(srcX + hubX) / 2} ${s.y} ${hubX - 28} ${hubY}`} fill="none" stroke={CPAY.line} strokeWidth="1.5" />
        ))}
        <line x1={hubX + 28} y1={hubY} x2={mpesaX - 32} y2={mpesaY} stroke={CPAY.emerald} strokeWidth="2" />
        {sources.map((s, i) => {
          const phase = (t + i * 0.25) % 1;
          const px = q(phase, srcX + 22, (srcX + hubX) / 2, hubX - 28);
          const py = q(phase, s.y, s.y, hubY);
          return (
            <g key={`p-${s.label}`}>
              <circle cx={px} cy={py} r="6" fill={s.color} opacity="0.25" />
              <circle cx={px} cy={py} r="3.5" fill={s.color} />
            </g>
          );
        })}
        <circle cx={hubX + 28 + (mpesaX - 32 - (hubX + 28)) * ((t * 2) % 1)} cy={hubY} r="4" fill={CPAY.emerald} />
        {sources.map((s) => (
          <g key={`n-${s.label}`}>
            <circle cx={srcX} cy={s.y} r="22" fill="#fff" stroke={s.color} strokeWidth="2" />
            <text x={srcX} y={s.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={s.color} fontFamily="'DM Sans', system-ui" letterSpacing="-0.3">{s.label}</text>
            <text x={srcX} y={s.y + 40} textAnchor="middle" fontSize="9" fontWeight="500" fill={CPAY.muted} fontFamily="'DM Sans', system-ui" letterSpacing="1">{s.net}</text>
          </g>
        ))}
        <circle cx={hubX} cy={hubY} r="28" fill={CPAY.emerald} />
        <circle cx={hubX} cy={hubY} r="28" fill="none" stroke="#fff" strokeWidth="2" strokeOpacity="0.3" />
        <text x={hubX} y={hubY + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff" fontFamily="'DM Sans', system-ui" letterSpacing="-0.5">Cpay</text>
        <rect x={mpesaX - 32} y={mpesaY - 22} width="64" height="44" rx="10" fill={CPAY.ink} />
        <text x={mpesaX} y={mpesaY - 4} textAnchor="middle" fontSize="9" fontWeight="500" fill={CPAY.muted} fontFamily="'DM Sans', system-ui" letterSpacing="1">KES</text>
        <text x={mpesaX} y={mpesaY + 12} textAnchor="middle" fontSize="11" fontWeight="600" fill="#fff" fontFamily="'DM Sans', system-ui">Paybill</text>
        <text x={width / 2} y={height - 16} textAnchor="middle" fontSize="10" fontWeight="500" fill={CPAY.muted} fontFamily="'DM Sans', system-ui" letterSpacing="1.5">
          FOUR CHAINS · ONE PAYOUT · &lt; 30 SECONDS
        </text>
      </svg>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 5. PaymentTicker — scrolling settled-tx chips, 20s loop
// ═══════════════════════════════════════════════════════════════════════
export function PaymentTicker({ width = 620, height = 140 }: { width?: number; height?: number }) {
  const t = useLoop(20000);
  if (!isWeb) return <NativeFallback width={width} height={height} label="Payment ticker" />;

  const txs = useMemo(() => {
    const bills = ["KPLC 888880", "Nairobi Water", "Zuku 320320", "DStv 444900", "NHIF 200222", "School Fees", "Rent · 522533", "Safaricom", "KRA 572572", "Till 334567"];
    const assets = ["USDT", "BTC", "ETH", "SOL"];
    const amts = [450, 1200, 2300, 680, 3400, 900, 5800, 1450, 750, 2100, 4200, 1100, 3500, 620, 1850, 2750, 980, 4400, 1600, 3200];
    return amts.map((amt, i) => ({
      id: i,
      paybill: bills[i % bills.length],
      asset: assets[i % assets.length],
      kes: amt,
      ms: ((i * 83) % 21) + 8,
    }));
  }, []);

  const CHIP_W = 220;
  const totalW = txs.length * CHIP_W;
  const offset = -t * totalW;
  const assetColor = (a: string) => (a === "USDT" ? CPAY.emerald : a === "BTC" ? "#F59E0B" : a === "ETH" ? "#6366F1" : "#A855F7");

  return (
    <View style={{ width, height }}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ display: "block", background: CPAY.paper }}>
        <defs>
          <linearGradient id="tk-fade-l" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={CPAY.paper} stopOpacity="1" />
            <stop offset="100%" stopColor={CPAY.paper} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="tk-fade-r" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={CPAY.paper} stopOpacity="0" />
            <stop offset="100%" stopColor={CPAY.paper} stopOpacity="1" />
          </linearGradient>
          <clipPath id="tk-clip">
            <rect x="0" y="40" width={width} height="70" />
          </clipPath>
        </defs>
        <circle cx="24" cy="24" r="3" fill={CPAY.emerald} />
        <circle cx="24" cy="24" r="3" fill={CPAY.emerald} opacity="0.35">
          <animate attributeName="r" values="3;8;3" dur="1.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0;0.5" dur="1.8s" repeatCount="indefinite" />
        </circle>
        <text x="36" y="28" fontSize="11" fontWeight="600" fill={CPAY.ink} fontFamily="'DM Sans', system-ui" letterSpacing="1">LIVE · PAYMENTS SETTLING NOW</text>
        <g clipPath="url(#tk-clip)">
          {[0, 1].map((pass) => (
            <g key={pass} transform={`translate(${offset + pass * totalW}, 0)`}>
              {txs.map((tx, i) => {
                const x = i * CHIP_W + 12;
                return (
                  <g key={`${pass}-${i}`} transform={`translate(${x}, 0)`}>
                    <rect x="0" y="52" width={CHIP_W - 24} height="46" rx="10" fill={CPAY.bg} stroke={CPAY.line} />
                    <circle cx="16" cy="75" r="8" fill={assetColor(tx.asset)} />
                    <text x="16" y="78" textAnchor="middle" fontSize="7" fontWeight="700" fill="#fff" fontFamily="'DM Sans', system-ui">{tx.asset}</text>
                    <text x="32" y="72" fontSize="10" fontWeight="600" fill={CPAY.ink} fontFamily="'DM Sans', system-ui">{tx.paybill}</text>
                    <text x="32" y="86" fontSize="9" fill={CPAY.muted} fontFamily="'DM Sans', system-ui">{tx.ms}s · settled</text>
                    <text x={CHIP_W - 28} y="75" textAnchor="end" fontSize="12" fontWeight="700" fill={CPAY.ink} fontFamily="'DM Sans', system-ui" letterSpacing="-0.3">KES {tx.kes.toLocaleString()}</text>
                    <text x={CHIP_W - 28} y="89" textAnchor="end" fontSize="9" fontWeight="500" fill={CPAY.emerald} fontFamily="'DM Sans', system-ui">✓ paid</text>
                  </g>
                );
              })}
            </g>
          ))}
        </g>
        <rect x="0" y="40" width="60" height="70" fill="url(#tk-fade-l)" />
        <rect x={width - 60} y="40" width="60" height="70" fill="url(#tk-fade-r)" />
        <text x="24" y={height - 12} fontSize="10" fill={CPAY.muted} fontFamily="'DM Sans', system-ui" letterSpacing="0.5">Median settlement</text>
        <text x={width - 24} y={height - 12} textAnchor="end" fontSize="10" fontWeight="700" fill={CPAY.ink} fontFamily="'DM Sans', system-ui">14 seconds</text>
      </svg>
    </View>
  );
}
