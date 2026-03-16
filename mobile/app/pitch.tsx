import { useRef, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
  Animated,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, getThemeColors, getThemeShadows } from "../src/constants/theme";

const isWeb = Platform.OS === "web";
const useNative = Platform.OS !== "web";

/* ============================================================================
   Data
   ============================================================================ */

const PROBLEM_STEPS = [
  "Open P2P exchange, wait for a seller",
  "Negotiate rate (3-8% spread)",
  "Send crypto, hope seller sends KES",
  "Receive KES to M-Pesa (if no scam)",
  "Open M-Pesa, manually pay bill",
];

const SOLUTION_STEPS = [
  "Open CryptoPay, select bill",
  "Confirm amount, tap Pay",
  "Done. M-Pesa payment sent.",
];

const MARKET_STATS = [
  { label: "Crypto Users in Kenya", value: "733K+", sub: "5th globally (Chainalysis 2024)" },
  { label: "M-Pesa Annual Volume", value: "KES 40T", sub: "40 trillion KES processed" },
  { label: "Africa Crypto Volume", value: "$205B", sub: "+52% year-over-year growth" },
  { label: "Kenya Stablecoin Txns", value: "KES 426.4B", sub: "Growing rapidly" },
];

const TRACTION_ITEMS = [
  { icon: "checkmark-circle" as const, text: "136 automated tests passing" },
  { icon: "shield-checkmark" as const, text: "57-finding production audit (77% production-ready)" },
  { icon: "globe" as const, text: "Live at cpay.co.ke" },
  { icon: "wallet" as const, text: "First real deposit: 7.88 USDT credited on mainnet" },
  { icon: "link" as const, text: "WalletConnect v2 integrated (MetaMask, Trust, Phantom)" },
];

const REVENUE_MODEL = [
  { item: "Conversion Spread", detail: "1.5% on each crypto-to-KES conversion" },
  { item: "Flat Fee", detail: "KES 10 per transaction" },
  { item: "Example", detail: "KES 5,000 payment = KES 75 spread + KES 10 flat = KES 85 revenue" },
];

const REVENUE_PROJECTIONS = [
  { month: "Month 3", users: "500", txPerDay: "2", avgTx: "KES 3,000", monthlyRev: "KES 2.7M", netRev: "KES 135K" },
  { month: "Month 6", users: "2,000", txPerDay: "3", avgTx: "KES 4,000", monthlyRev: "KES 18M", netRev: "KES 900K" },
  { month: "Month 12", users: "10,000", txPerDay: "4", avgTx: "KES 5,000", monthlyRev: "KES 150M", netRev: "KES 7.5M" },
  { month: "Month 24", users: "50,000", txPerDay: "5", avgTx: "KES 6,000", monthlyRev: "KES 1.1B", netRev: "KES 55M" },
];

const COMPETITIVE_TABLE = {
  headers: ["Feature", "CryptoPay", "Rift Finance", "Yellow Card"],
  rows: [
    ["Speed", "< 30 seconds", "Minutes", "15-60 min"],
    ["Fees", "1.5% + KES 10", "~2-3%", "3-8%"],
    ["Bill Payment", "Direct Paybill/Till", "No", "No"],
    ["Scam Risk", "Zero", "Low", "Medium (P2P)"],
    ["KYC", "Tiered", "Full KYC", "Full KYC"],
    ["Automation", "Fully automated", "Semi-auto", "Manual P2P"],
    ["Supported Crypto", "5 (USDT, BTC, ETH, SOL, USDC)", "Limited", "3-4"],
  ],
};

const USE_OF_FUNDS = [
  { category: "M-Pesa Production + Compliance", percent: "30%", amount: "$75K-$150K" },
  { category: "Engineering (hire 2 devs)", percent: "25%", amount: "$62.5K-$125K" },
  { category: "Liquidity Pool / Float", percent: "20%", amount: "$50K-$100K" },
  { category: "User Acquisition + Marketing", percent: "15%", amount: "$37.5K-$75K" },
  { category: "Operations + Legal", percent: "10%", amount: "$25K-$50K" },
];

/* ============================================================================
   Components
   ============================================================================ */

function SectionTitle({ title, subtitle, label, tc }: { title: string; subtitle?: string; label?: string; tc: any }) {
  return (
    <View style={{ marginBottom: 24, marginTop: 48 }}>
      {label && (
        <Text
          style={{
            color: colors.primary[400],
            fontSize: 12,
            fontFamily: "DMSans_700Bold",
            textTransform: "uppercase",
            letterSpacing: 2.5,
            marginBottom: 10,
          }}
        >
          {label}
        </Text>
      )}
      <Text style={{ color: tc.textPrimary, fontSize: 28, fontFamily: "DMSans_700Bold", letterSpacing: -0.5, lineHeight: 36 }}>
        {title}
      </Text>
      {subtitle && (
        <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_400Regular", marginTop: 8, lineHeight: 24 }}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

function GlassBox({ children, tc, style }: { children: React.ReactNode; tc: any; style?: any }) {
  return (
    <View
      style={[
        {
          backgroundColor: tc.glass.bg,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: tc.glass.border,
          padding: 24,
          ...(isWeb ? { backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" } as any : {}),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function StatCard({ stat, tc, ts }: { stat: typeof MARKET_STATS[0]; tc: any; ts: any }) {
  return (
    <View
      style={{
        backgroundColor: tc.glass.bg,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.primary[500] + "30",
        padding: 20,
        flex: 1,
        minWidth: 200,
        ...(isWeb ? { backdropFilter: "blur(12px)" } as any : {}),
        ...ts.sm,
      }}
    >
      <Text style={{ color: colors.primary[400], fontSize: 28, fontFamily: "DMSans_700Bold", marginBottom: 6 }}>
        {stat.value}
      </Text>
      <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_600SemiBold", marginBottom: 4 }}>
        {stat.label}
      </Text>
      <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular" }}>
        {stat.sub}
      </Text>
    </View>
  );
}

/* ============================================================================
   Main Page
   ============================================================================ */

export default function PitchPage() {
  const tc = getThemeColors(true); // Pitch always uses dark theme
  const ts = getThemeShadows(true);
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const isTablet = width >= 768 && width < 1024;
  const isDesktop = isWeb && width >= 1024;

  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 800, useNativeDriver: useNative }),
      Animated.spring(slideUp, { toValue: 0, tension: 50, friction: 12, useNativeDriver: useNative }),
    ]).start();
  }, []);

  const px = isDesktop ? 80 : isTablet ? 40 : 20;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tc.dark.bg }}
      contentContainerStyle={{
        paddingHorizontal: px,
        paddingTop: isDesktop ? 48 : 24,
        paddingBottom: 80,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Header ──────────────────────────────────────────────── */}
      <Animated.View
        style={{
          opacity: fadeIn,
          transform: [{ translateY: slideUp }],
          alignItems: "center",
          marginBottom: 32,
        }}
      >
        {/* Logo */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              backgroundColor: colors.primary[500] + "20",
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: colors.primary[500] + "40",
            }}
          >
            <Ionicons name="flash" size={26} color={colors.primary[400]} />
          </View>
          <Text style={{ color: tc.textPrimary, fontSize: 28, fontFamily: "DMSans_700Bold", letterSpacing: -0.5 }}>
            CryptoPay
          </Text>
        </View>

        {/* Badge */}
        <View
          style={{
            backgroundColor: colors.primary[500] + "15",
            borderRadius: 20,
            paddingHorizontal: 16,
            paddingVertical: 6,
            borderWidth: 1,
            borderColor: colors.primary[500] + "30",
          }}
        >
          <Text style={{ color: colors.primary[400], fontSize: 13, fontFamily: "DMSans_600SemiBold", letterSpacing: 0.5 }}>
            INVESTOR OVERVIEW
          </Text>
        </View>

        <Text
          style={{
            color: tc.textPrimary,
            fontSize: isDesktop ? 36 : 28,
            fontFamily: "DMSans_700Bold",
            textAlign: "center",
            marginTop: 24,
            letterSpacing: -0.5,
            lineHeight: isDesktop ? 44 : 36,
          }}
        >
          Pay any bill in Kenya with crypto.{"\n"}In 30 seconds.
        </Text>
        <Text
          style={{
            color: tc.textSecondary,
            fontSize: 16,
            fontFamily: "DMSans_400Regular",
            textAlign: "center",
            marginTop: 12,
            lineHeight: 24,
            maxWidth: 600,
          }}
        >
          CryptoPay bridges crypto wallets to M-Pesa, enabling instant bill payments, money transfers, and merchant
          payments for 733,000+ crypto users in Kenya.
        </Text>
      </Animated.View>

      {/* ── Executive Summary ──────────────────────────────────── */}
      <SectionTitle
        label="Executive Summary"
        title="Key Metrics"
        tc={tc}
      />
      <View
        style={{
          flexDirection: isDesktop ? "row" : isMobile ? "column" : "row",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        {[
          { value: "733K+", label: "Target Market", sub: "Crypto users in Kenya" },
          { value: "< 30s", label: "Payment Speed", sub: "Crypto to M-Pesa" },
          { value: "1.5%", label: "Revenue Model", sub: "Spread + KES 10 flat" },
          { value: "$250K", label: "Pre-Seed Ask", sub: "18-month runway" },
        ].map((metric, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              minWidth: isMobile ? undefined : 180,
              backgroundColor: tc.glass.bg,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.primary[500] + "25",
              padding: 20,
              ...(isWeb ? { backdropFilter: "blur(12px)" } as any : {}),
            }}
          >
            <Text style={{ color: colors.primary[400], fontSize: 28, fontFamily: "DMSans_700Bold", marginBottom: 6, letterSpacing: -0.5 }}>
              {metric.value}
            </Text>
            <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_600SemiBold", marginBottom: 3 }}>
              {metric.label}
            </Text>
            <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular" }}>
              {metric.sub}
            </Text>
          </View>
        ))}
      </View>

      {/* ── Problem ─────────────────────────────────────────────── */}
      <SectionTitle
        label="Problem"
        title="The 30-Minute Problem"
        subtitle="Currently, paying a bill with crypto in Kenya requires 5 manual steps and 15-60 minutes."
        tc={tc}
      />
      <GlassBox tc={tc}>
        {PROBLEM_STEPS.map((step, i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: i < PROBLEM_STEPS.length - 1 ? 14 : 0 }}>
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: colors.error + "18",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: colors.error, fontSize: 13, fontFamily: "DMSans_700Bold" }}>{i + 1}</Text>
            </View>
            <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_400Regular", flex: 1 }}>{step}</Text>
          </View>
        ))}
      </GlassBox>

      {/* ── Solution ────────────────────────────────────────────── */}
      <SectionTitle
        label="Solution"
        title="The 30-Second Solution"
        subtitle="CryptoPay automates the entire flow. One tap from crypto to M-Pesa."
        tc={tc}
      />
      <GlassBox tc={tc} style={{ borderColor: colors.primary[500] + "40" }}>
        {SOLUTION_STEPS.map((step, i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: i < SOLUTION_STEPS.length - 1 ? 14 : 0 }}>
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: colors.primary[500] + "20",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="checkmark" size={16} color={colors.primary[400]} />
            </View>
            <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_500Medium", flex: 1 }}>{step}</Text>
          </View>
        ))}
      </GlassBox>

      {/* ── Market Data ─────────────────────────────────────────── */}
      <SectionTitle
        label="Market"
        title="Market Opportunity"
        subtitle="Kenya is Africa's crypto hub with massive M-Pesa infrastructure."
        tc={tc}
      />
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        {MARKET_STATS.map((stat, i) => (
          <StatCard key={i} stat={stat} tc={tc} ts={ts} />
        ))}
      </View>

      {/* ── Traction ────────────────────────────────────────────── */}
      <SectionTitle
        label="Traction"
        title="Traction & Milestones"
        subtitle="Built and launched by a solo founder in under 3 months."
        tc={tc}
      />
      <GlassBox tc={tc}>
        {TRACTION_ITEMS.map((item, i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: i < TRACTION_ITEMS.length - 1 ? 14 : 0 }}>
            <Ionicons name={item.icon} size={20} color={colors.primary[400]} />
            <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_400Regular", flex: 1 }}>{item.text}</Text>
          </View>
        ))}
      </GlassBox>

      {/* ── Revenue Model ───────────────────────────────────────── */}
      <SectionTitle
        label="Revenue"
        title="Revenue Model"
        subtitle="Simple, transparent pricing. Revenue from day one."
        tc={tc}
      />
      <GlassBox tc={tc}>
        {REVENUE_MODEL.map((row, i) => (
          <View key={i} style={{ marginBottom: i < REVENUE_MODEL.length - 1 ? 16 : 0 }}>
            <Text style={{ color: colors.primary[400], fontSize: 13, fontFamily: "DMSans_600SemiBold", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
              {row.item}
            </Text>
            <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_400Regular" }}>{row.detail}</Text>
          </View>
        ))}
      </GlassBox>

      {/* ── Revenue Projections ──────────────────────────────────── */}
      <SectionTitle
        label="Projections"
        title="Revenue Projections"
        subtitle="Conservative estimates based on 1.5% spread + KES 10 flat fee."
        tc={tc}
      />
      <GlassBox tc={tc} style={{ padding: 0, overflow: "hidden" }}>
        {/* Table header */}
        <View
          style={{
            flexDirection: "row",
            backgroundColor: colors.primary[500] + "10",
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderBottomWidth: 1,
            borderBottomColor: tc.glass.border,
          }}
        >
          {["Period", "Users", "Tx/Day", "Avg Tx", "Monthly Vol", "Net Revenue"].map((h, i) => (
            <Text
              key={i}
              style={{
                flex: i === 0 ? 1.2 : 1,
                color: tc.textMuted,
                fontSize: 11,
                fontFamily: "DMSans_600SemiBold",
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {h}
            </Text>
          ))}
        </View>
        {/* Table rows */}
        {REVENUE_PROJECTIONS.map((row, i) => (
          <View
            key={i}
            style={{
              flexDirection: "row",
              paddingVertical: 12,
              paddingHorizontal: 16,
              borderBottomWidth: i < REVENUE_PROJECTIONS.length - 1 ? 1 : 0,
              borderBottomColor: tc.glass.border,
            }}
          >
            <Text style={{ flex: 1.2, color: tc.textPrimary, fontSize: 13, fontFamily: "DMSans_600SemiBold" }}>{row.month}</Text>
            <Text style={{ flex: 1, color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_400Regular" }}>{row.users}</Text>
            <Text style={{ flex: 1, color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_400Regular" }}>{row.txPerDay}</Text>
            <Text style={{ flex: 1, color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_400Regular" }}>{row.avgTx}</Text>
            <Text style={{ flex: 1, color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_400Regular" }}>{row.monthlyRev}</Text>
            <Text style={{ flex: 1, color: colors.primary[400], fontSize: 13, fontFamily: "DMSans_700Bold" }}>{row.netRev}</Text>
          </View>
        ))}
      </GlassBox>

      {/* ── Competitive Advantage ───────────────────────────────── */}
      <SectionTitle
        label="Competition"
        title="Competitive Advantage"
        subtitle="CryptoPay vs. existing alternatives in the Kenyan market."
        tc={tc}
      />
      <GlassBox tc={tc} style={{ padding: 0, overflow: "hidden" }}>
        {/* Table header */}
        <View
          style={{
            flexDirection: "row",
            backgroundColor: colors.primary[500] + "10",
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderBottomWidth: 1,
            borderBottomColor: tc.glass.border,
          }}
        >
          {COMPETITIVE_TABLE.headers.map((h, i) => (
            <Text
              key={i}
              style={{
                flex: i === 0 ? 1.2 : 1,
                color: i === 1 ? colors.primary[400] : tc.textMuted,
                fontSize: 11,
                fontFamily: "DMSans_600SemiBold",
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {h}
            </Text>
          ))}
        </View>
        {COMPETITIVE_TABLE.rows.map((row, i) => (
          <View
            key={i}
            style={{
              flexDirection: "row",
              paddingVertical: 12,
              paddingHorizontal: 16,
              borderBottomWidth: i < COMPETITIVE_TABLE.rows.length - 1 ? 1 : 0,
              borderBottomColor: tc.glass.border,
            }}
          >
            {row.map((cell, j) => (
              <Text
                key={j}
                style={{
                  flex: j === 0 ? 1.2 : 1,
                  color: j === 1 ? colors.primary[400] : j === 0 ? tc.textPrimary : tc.textSecondary,
                  fontSize: 13,
                  fontFamily: j === 1 ? "DMSans_600SemiBold" : j === 0 ? "DMSans_500Medium" : "DMSans_400Regular",
                }}
              >
                {cell}
              </Text>
            ))}
          </View>
        ))}
      </GlassBox>

      {/* ── Team ────────────────────────────────────────────────── */}
      <SectionTitle label="Team" title="Team" tc={tc} />
      <GlassBox tc={tc}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: colors.primary[500] + "20",
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 2,
              borderColor: colors.primary[500] + "40",
            }}
          >
            <Ionicons name="person" size={28} color={colors.primary[400]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: tc.textPrimary, fontSize: 18, fontFamily: "DMSans_700Bold" }}>
              Kevin Isaac Kareithi
            </Text>
            <Text style={{ color: colors.primary[400], fontSize: 14, fontFamily: "DMSans_500Medium", marginTop: 2 }}>
              Full-Stack Developer & Solo Founder
            </Text>
          </View>
        </View>
        <Text
          style={{
            color: tc.textSecondary,
            fontSize: 14,
            fontFamily: "DMSans_400Regular",
            marginTop: 16,
            lineHeight: 22,
          }}
        >
          Built the entire CryptoPay stack solo: Django backend with payment saga orchestration, React Native mobile
          app with glassmorphism UI, blockchain listeners for 5 networks, M-Pesa Daraja integration, Docker deployment,
          and production infrastructure on a VPS. 136 automated tests, 57-finding security audit, live at cpay.co.ke
          with real USDT deposits credited.
        </Text>
      </GlassBox>

      {/* ── The Ask ─────────────────────────────────────────────── */}
      <SectionTitle
        label="The Ask"
        title="The Ask"
        subtitle="Pre-seed round: $250,000 - $500,000"
        tc={tc}
      />
      <GlassBox tc={tc} style={{ borderColor: colors.accent + "40" }}>
        <Text
          style={{
            color: colors.accent,
            fontSize: 13,
            fontFamily: "DMSans_600SemiBold",
            textTransform: "uppercase",
            letterSpacing: 0.5,
            marginBottom: 16,
          }}
        >
          Use of Funds
        </Text>
        {USE_OF_FUNDS.map((item, i) => (
          <View
            key={i}
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              paddingVertical: 10,
              borderBottomWidth: i < USE_OF_FUNDS.length - 1 ? 1 : 0,
              borderBottomColor: tc.glass.border,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_500Medium" }}>
                {item.category}
              </Text>
            </View>
            <Text style={{ color: colors.accent, fontSize: 14, fontFamily: "DMSans_700Bold", marginRight: 16 }}>
              {item.percent}
            </Text>
            <Text style={{ color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_400Regular", minWidth: 100, textAlign: "right" }}>
              {item.amount}
            </Text>
          </View>
        ))}
      </GlassBox>

      {/* ── CTA ─────────────────────────────────────────────────── */}
      <View style={{ marginTop: 56, alignItems: "center", gap: 16 }}>
        <Pressable
          onPress={() => Linking.openURL("mailto:kevinisaackareithi@gmail.com?subject=CryptoPay%20Investment%20Inquiry")}
          style={({ pressed, hovered }: any) => ({
            backgroundColor: hovered ? colors.primary[400] : colors.primary[500],
            paddingVertical: 18,
            paddingHorizontal: 40,
            borderRadius: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            opacity: pressed ? 0.9 : 1,
            transform: [{ scale: pressed ? 0.97 : hovered ? 1.02 : 1 }],
            maxWidth: 400,
            width: "100%",
            justifyContent: "center",
            ...(isWeb ? {
              cursor: "pointer",
              transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
              boxShadow: hovered
                ? "0 12px 40px rgba(16, 185, 129, 0.4)"
                : "0 4px 20px rgba(16, 185, 129, 0.2)",
            } as any : {}),
          })}
          accessibilityRole="button"
          accessibilityLabel="Schedule a call"
        >
          <Ionicons name="mail-outline" size={20} color="#FFFFFF" />
          <Text style={{ color: "#FFFFFF", fontSize: 16, fontFamily: "DMSans_700Bold" }}>Schedule a Call</Text>
        </Pressable>

        <Pressable
          onPress={() => Linking.openURL("https://cpay.co.ke")}
          style={({ pressed, hovered }: any) => ({
            backgroundColor: "transparent",
            paddingVertical: 16,
            paddingHorizontal: 40,
            borderRadius: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            borderWidth: 1,
            borderColor: hovered ? colors.primary[400] : tc.glass.borderStrong,
            opacity: pressed ? 0.85 : 1,
            transform: [{ scale: pressed ? 0.97 : hovered ? 1.02 : 1 }],
            maxWidth: 400,
            width: "100%",
            justifyContent: "center",
            ...(isWeb ? {
              cursor: "pointer",
              transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
            } as any : {}),
          })}
          accessibilityRole="link"
          accessibilityLabel="View live product"
        >
          <Ionicons name="open-outline" size={20} color={colors.primary[400]} />
          <Text style={{ color: colors.primary[400], fontSize: 16, fontFamily: "DMSans_600SemiBold" }}>
            View Live Product
          </Text>
        </Pressable>

        <Text
          style={{
            color: tc.textMuted,
            fontSize: 12,
            fontFamily: "DMSans_400Regular",
            textAlign: "center",
            marginTop: 16,
          }}
        >
          kevinisaackareithi@gmail.com | cpay.co.ke
        </Text>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
