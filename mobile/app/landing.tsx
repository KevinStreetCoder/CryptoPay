import { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Animated,
  Easing,
  Platform,
  useWindowDimensions,
  Image,
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getThemeColors, shadows } from "../src/constants/theme";
import { CRYPTO_LOGOS } from "../src/constants/logos";

// Lottie animations — graceful degradation if not available
let LottieView: any = null;
if (Platform.OS !== "web") {
  try {
    LottieView = require("lottie-react-native").default;
  } catch {
    // lottie-react-native not installed — will use static illustrations instead
  }
}

const isWeb = Platform.OS === "web";

// ── Lottie Animation CDN URLs (free, from LottieFiles) ─────────────────────
const LOTTIE_URLS = {
  bitcoinSpin: "https://assets1.lottiefiles.com/packages/lf20_kyu7xb1v.json",
  cryptoWallet: "https://assets8.lottiefiles.com/packages/lf20_bq485nmk.json",
  securityLock: "https://assets6.lottiefiles.com/packages/lf20_uu0x8lqv.json",
  successCheck: "https://assets1.lottiefiles.com/packages/lf20_s2lryxtd.json",
  loadingCoins: "https://assets5.lottiefiles.com/packages/lf20_ystsffqy.json",
  shield: "https://assets2.lottiefiles.com/packages/lf20_xlmz9xwm.json",
};

// ── Testimonials Data ─────────────────────────────────────────────────────
const TESTIMONIALS = [
  {
    quote: "Paid my KPLC bill with USDT in 22 seconds. No more P2P hassle.",
    name: "James M.",
    role: "Freelancer",
    initials: "JM",
    color: "#26A17B",
  },
  {
    quote: "Finally a way to pay school fees directly from my crypto wallet.",
    name: "Sarah K.",
    role: "Developer",
    initials: "SK",
    color: "#627EEA",
  },
  {
    quote: "The locked rate feature is a game changer. No more slippage anxiety.",
    name: "David O.",
    role: "Trader",
    initials: "DO",
    color: "#F7931A",
  },
  {
    quote: "I send money to my family via M-Pesa using BTC. It's instant.",
    name: "Grace W.",
    role: "Diaspora",
    initials: "GW",
    color: "#9945FF",
  },
];

// ── Decorative Section Icons (replaces CDN illustrations with consistent Ionicons) ──
// Each section gets a large glass-circle icon matching the app's design language.
// Professional illustrations from unDraw CDN — ALL verified working URLs
const U = "https://42f2671d685f51e10fc6-b9fcecea3e50b3b59bdc28dead054ebc.ssl.cf5.rackcdn.com/illustrations";
const UNDRAW = {
  // Hero & CTA
  makerLaunch: `${U}/maker_launch_crhe.svg`,
  target: `${U}/target_kriv.svg`,
  welcome: `${U}/welcome_3gvl.svg`,
  // Problem section
  warning: `${U}/warning_cyit.svg`,
  confirmed: `${U}/confirmed_81ex.svg`,
  // How It Works
  userFlow: `${U}/user_flow_vr6w.svg`,
  instantSupport: `${U}/instant_support_elxh.svg`,
  // Crypto
  bitcoin: `${U}/bitcoin2_ave7.svg`,
  btcP2p: `${U}/btc_p2p_lth5.svg`,
  finance: `${U}/finance_0bdk.svg`,
  // Features
  featuresOverview: `${U}/features_overview_jg7a.svg`,
  wallet: `${U}/wallet_aym5.svg`,
  secureData: `${U}/secure_data_0rwp.svg`,
  security: `${U}/security_o890.svg`,
  // Pricing & Compare
  revenue: `${U}/revenue_3osh.svg`,
  pieChart: `${U}/pie_chart_6efe.svg`,
  select: `${U}/select_13cv.svg`,
  // Social proof
  community: `${U}/design_community_rcft.svg`,
  businessDeal: `${U}/business_deal_cpi9.svg`,
  // FAQ & Support
  questions: `${U}/questions_75e0.svg`,
  // Success
  success: `${U}/successful_purchase_uyin.svg`,
  creditCard: `${U}/credit_card_payment_yb88.svg`,
  // Mobile & Speed
  mobileTesting: `${U}/mobile_testing_reah.svg`,
  fastLoading: `${U}/fast_loading_0lbh.svg`,
  // Extra
  onlineWorld: `${U}/online_world_mc1t.svg`,
  safe: `${U}/safe_bnk7.svg`,
  digitalNomad: `${U}/digital_nomad_9kgl.svg`,
  inProgress: `${U}/in_progress_ql66.svg`,
};

// Used via <SectionDecorIcon> component below.

// ── CDN Assets ──────────────────────────────────────────────────────────────
const COIN_ICONS = [
  { key: "USDT", uri: CRYPTO_LOGOS.USDT, color: "#26A17B", name: "USDT", network: "Tron TRC-20" },
  { key: "BTC", uri: CRYPTO_LOGOS.BTC, color: "#F7931A", name: "Bitcoin", network: "Bitcoin" },
  { key: "ETH", uri: CRYPTO_LOGOS.ETH, color: "#627EEA", name: "Ethereum", network: "Ethereum" },
  { key: "SOL", uri: CRYPTO_LOGOS.SOL, color: "#9945FF", name: "Solana", network: "Solana" },
  { key: "USDC", uri: CRYPTO_LOGOS.USDC, color: "#2775CA", name: "USDC", network: "Polygon" },
];

const KENYA_FLAG = "https://flagcdn.com/48x36/ke.png";

// ── Partner Logos (real downloaded images) ───────────────────────────────────
const PARTNER_LOGOS = {
  smileIdentity: require("../assets/logos/partners/smile-identity.png"),
  coingecko: require("../assets/logos/partners/coingecko.png"),
  mpesa: require("../assets/logos/partners/mpesa-logo.png"),
  sentry: require("../assets/logos/partners/sentry.png"),
};

// ── Service Provider Logos (real branded images) ─────────────────────────────
const LANDING_SERVICE_LOGOS = {
  kplc: require("../assets/logos/services/kplc.png"),
  dstv: require("../assets/logos/services/dstv.png"),
  nairobi_water: require("../assets/logos/services/nairobi_water.png"),
  safaricom: require("../assets/logos/services/safaricom.png"),
  mpesa: require("../assets/logos/services/mpesa.png"),
  airtel: require("../assets/logos/services/airtel.png"),
  gotv: require("../assets/logos/services/gotv.png"),
  startimes: require("../assets/logos/services/startimes.png"),
  kra: require("../assets/logos/services/kra.png"),
  nhif: require("../assets/logos/services/nhif.png"),
  zuku: require("../assets/logos/services/zuku.png"),
};

// ── Social Media Icons (real logos) ─────────────────────────────────────────
const SOCIAL_ICONS = {
  twitter: require("../assets/logos/twitter.png"),
  telegram: require("../assets/logos/telegram.png"),
};

// ── App Store Icons (real brand logos) ───────────────────────────────────────
const STORE_ICONS = {
  googlePlay: require("../assets/logos/google-play-icon.png"),
  appStore: require("../assets/logos/app-store-icon.png"),
};

// ── Kenyan Service Providers (real branded logos) ────────────────────────────
const KENYAN_SERVICES = [
  { name: "KPLC", logo: LANDING_SERVICE_LOGOS.kplc, color: "#00529B", desc: "Electricity" },
  { name: "DSTV", logo: LANDING_SERVICE_LOGOS.dstv, color: "#1B365D", desc: "TV" },
  { name: "Nairobi Water", logo: LANDING_SERVICE_LOGOS.nairobi_water, color: "#0066B3", desc: "Water" },
  { name: "Safaricom", logo: LANDING_SERVICE_LOGOS.safaricom, color: "#6CC24A", desc: "Airtime" },
  { name: "M-Pesa", logo: LANDING_SERVICE_LOGOS.mpesa, color: "#00A650", desc: "Send Money" },
  { name: "Airtel", logo: LANDING_SERVICE_LOGOS.airtel, color: "#ED1C24", desc: "Airtime" },
  { name: "GOtv", logo: LANDING_SERVICE_LOGOS.gotv, color: "#F15A22", desc: "TV" },
  { name: "StarTimes", logo: LANDING_SERVICE_LOGOS.startimes, color: "#FDB913", desc: "TV" },
  { name: "KRA", logo: LANDING_SERVICE_LOGOS.kra, color: "#003366", desc: "Tax" },
  { name: "NHIF", logo: LANDING_SERVICE_LOGOS.nhif, color: "#0072CE", desc: "Health" },
  { name: "Zuku", logo: LANDING_SERVICE_LOGOS.zuku, color: "#E30613", desc: "Internet" },
];

// ── FAQ Data ────────────────────────────────────────────────────────────────
const FAQ_DATA = [
  {
    q: "How does CryptoPay work?",
    a: "Deposit crypto (USDT, BTC, ETH, or SOL) to your personal CryptoPay wallet. Choose a payment method \u2014 Paybill, Till number, or phone number \u2014 and we instantly convert and send the payment via M-Pesa. The entire process takes under 30 seconds.",
  },
  {
    q: "What cryptocurrencies are supported?",
    a: "We support USDT on Tron (TRC-20), Bitcoin (BTC), Ethereum (ETH), Solana (SOL), and USDC on Polygon. More chains are added regularly based on user demand.",
  },
  {
    q: "How long does a payment take?",
    a: "Once your crypto deposit is confirmed on-chain, M-Pesa payments are processed in under 30 seconds. Most transactions complete in 10-15 seconds. You get real-time status updates throughout.",
  },
  {
    q: "Is it safe? How is my crypto protected?",
    a: "CryptoPay uses 256-bit AES encryption, BIP-44 HD wallet architecture, biometric authentication, and optional TOTP 2FA. Your deposit addresses are derived from industry-standard hierarchical deterministic wallets. We never hold your private keys.",
  },
  {
    q: "What are the fees?",
    a: "We charge a transparent 1.5% conversion spread plus a flat KES 10 fee per transaction. That is it \u2014 no hidden charges, no surprise deductions. The rate you see is the rate you get, locked for 30 seconds while you confirm.",
  },
  {
    q: "Do I need KYC verification?",
    a: "Basic transactions up to KES 5,000 per day require only phone verification. For higher limits up to KES 1,000,000 per day, you will need to complete our streamlined ID verification process, which takes under 2 minutes.",
  },
];

// ── Comparison Table Data ───────────────────────────────────────────────────
const COMPARISON_ROWS = [
  { label: "Speed", cp: "< 30 seconds", p2p: "15-60 minutes", otc: "1-24 hours", cpIcon: "checkmark-circle" as const },
  { label: "Fees", cp: "1.5% + KES 10", p2p: "3-8% spread", otc: "5-10% negotiated", cpIcon: "checkmark-circle" as const },
  { label: "Scam Risk", cp: "Zero", p2p: "High", otc: "Very high", cpIcon: "checkmark-circle" as const },
  { label: "Bill Payment", cp: "Direct Paybill/Till", p2p: "Not supported", otc: "Not supported", cpIcon: "checkmark-circle" as const },
  { label: "Automation", cp: "Fully automated", p2p: "Manual matching", otc: "Fully manual", cpIcon: "checkmark-circle" as const },
  { label: "KYC", cp: "Tiered verification", p2p: "Platform KYC", otc: "None (risky)", cpIcon: "checkmark-circle" as const },
];

// ── Features Data ───────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: "flash" as const,
    title: "Pay Bills Instantly",
    desc: "KPLC, DSTV, Water, School fees \u2014 any Paybill number in Kenya",
  },
  {
    icon: "send" as const,
    title: "Send Money",
    desc: "M-Pesa to any phone number, funded directly by your crypto balance",
  },
  {
    icon: "trending-up" as const,
    title: "Real-Time Rates",
    desc: "Live exchange rates with a guaranteed 30-second price lock on every quote",
  },
  {
    icon: "layers" as const,
    title: "Multi-Chain",
    desc: "5 blockchains supported \u2014 always pick the cheapest network for your transfer",
  },
  {
    icon: "shield-checkmark" as const,
    title: "Bank-Grade Security",
    desc: "256-bit AES encryption, biometric auth, TOTP 2FA, and HD wallet architecture",
  },
  {
    icon: "checkmark-circle" as const,
    title: "KYC Compliant",
    desc: "Tiered verification: KES 5K/day basic, up to KES 1M/day fully verified",
  },
  {
    icon: "timer" as const,
    title: "90-Second Quote Lock",
    desc: "Your rate is locked for 90 seconds. No slippage, no surprises.",
  },
  {
    icon: "cloud-offline" as const,
    title: "Works Offline",
    desc: "Cached rates let you prepare payments even without internet.",
  },
  {
    icon: "book" as const,
    title: "Full Ledger Transparency",
    desc: "Every transaction recorded with double-entry accounting. Download receipts anytime.",
  },
];

// ── Stats Data ──────────────────────────────────────────────────────────────
const STATS = [
  { value: "KES 129+", label: "USDT/KES Rate" },
  { value: "< 30s", label: "Payment Speed" },
  { value: "5", label: "Chains Supported" },
  { value: "99.9%", label: "Uptime" },
];

// ── Scroll-Reveal Wrapper ───────────────────────────────────────────────────
function RevealOnScroll({
  children,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: any;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(30)).current;
  const [visible, setVisible] = useState(false);
  const viewRef = useRef<View>(null);

  useEffect(() => {
    if (visible) {
      const timeout = setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 600,
            useNativeDriver: !isWeb,
          }),
          Animated.timing(translateY, {
            toValue: 0,
            duration: 600,
            useNativeDriver: !isWeb,
          }),
        ]).start();
      }, delay);
      return () => clearTimeout(timeout);
    }
  }, [visible, delay]);

  useEffect(() => {
    if (!isWeb) {
      setVisible(true);
      return;
    }
    const node = (viewRef.current as any)?._nativeTag
      ? undefined
      : (viewRef.current as any);
    if (node && typeof IntersectionObserver !== "undefined") {
      const tryObserve = () => {
        const el =
          node instanceof HTMLElement
            ? node
            : node?.getNode?.()
            || (node as any)?._nativeTag
            || null;
        if (el instanceof HTMLElement) {
          const obs = new IntersectionObserver(
            ([entry]) => {
              if (entry.isIntersecting) {
                setVisible(true);
                obs.disconnect();
              }
            },
            { threshold: 0.1 }
          );
          obs.observe(el);
          return () => obs.disconnect();
        }
        setVisible(true);
      };
      const t = setTimeout(tryObserve, 100);
      return () => clearTimeout(t);
    } else {
      setVisible(true);
    }
  }, []);

  return (
    <Animated.View
      ref={viewRef as any}
      style={{ opacity, transform: [{ translateY }], ...style }}
    >
      {children}
    </Animated.View>
  );
}

// ── Floating Coin Component ─────────────────────────────────────────────────
function FloatingCoin({
  uri,
  size,
  left,
  top,
  delay,
  color,
}: {
  uri: string;
  size: number;
  left: string;
  top: string;
  delay: number;
  color: string;
}) {
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 0.85,
      duration: 800,
      delay,
      useNativeDriver: !isWeb,
    }).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(translateY, {
          toValue: -8,
          duration: 2000 + delay,
          easing: Easing.bezier(0.37, 0, 0.63, 1),
          useNativeDriver: !isWeb,
        }),
        Animated.timing(translateY, {
          toValue: 8,
          duration: 2000 + delay,
          easing: Easing.bezier(0.37, 0, 0.63, 1),
          useNativeDriver: !isWeb,
        }),
      ])
    );
    const t = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(t);
      loop.stop();
    };
  }, []);

  return (
    <Animated.View
      style={{
        position: "absolute",
        left: left as any,
        top: top as any,
        opacity,
        transform: [{ translateY }],
        zIndex: 2,
      }}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(255,255,255,0.04)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.08)",
          ...(isWeb
            ? ({
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                boxShadow: `0 4px 24px ${color}25`,
                animation: `cpay-coin-rotate ${20 + delay * 5}s linear infinite`,
              } as any)
            : {}),
        }}
      >
        <Image
          source={{ uri }}
          style={{ width: size * 0.55, height: size * 0.55 }}
        />
      </View>
    </Animated.View>
  );
}

// ── FAQ Accordion Item ──────────────────────────────────────────────────────
function FAQItem({
  question,
  answer,
  tc,
}: {
  question: string;
  answer: string;
  tc: ReturnType<typeof getThemeColors>;
}) {
  const [open, setOpen] = useState(false);
  const rotateAnim = useRef(new Animated.Value(0)).current;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    Animated.timing(rotateAnim, {
      toValue: next ? 1 : 0,
      duration: 300,
      useNativeDriver: !isWeb,
    }).start();
  };

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  return (
    <Pressable
      onPress={toggle}
      style={({ hovered }: any) => ({
        backgroundColor: open
          ? "rgba(16, 185, 129, 0.04)"
          : isWeb && hovered
            ? "rgba(255,255,255,0.03)"
            : "rgba(255,255,255,0.02)",
        borderRadius: 16,
        borderWidth: 1,
        borderColor: open
          ? "rgba(16, 185, 129, 0.2)"
          : "rgba(255,255,255,0.06)",
        paddingHorizontal: 24,
        paddingVertical: 20,
        marginBottom: 12,
        ...(isWeb
          ? ({ transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)", cursor: "pointer" } as any)
          : {}),
      })}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text
          style={{
            flex: 1,
            color: open ? tc.primary[300] : tc.textPrimary,
            fontSize: 16,
            fontFamily: "DMSans_600SemiBold",
            lineHeight: 24,
            marginRight: 16,
          }}
        >
          {question}
        </Text>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons
            name="chevron-down"
            size={20}
            color={open ? tc.primary[400] : tc.textMuted}
          />
        </Animated.View>
      </View>
      {open && (
        <Text
          style={{
            color: tc.textSecondary,
            fontSize: 15,
            fontFamily: "DMSans_400Regular",
            lineHeight: 24,
            marginTop: 14,
          }}
        >
          {answer}
        </Text>
      )}
    </Pressable>
  );
}

// ── Glass Card ──────────────────────────────────────────────────────────────
function GlassCard({
  children,
  style,
  hoverGlow,
}: {
  children: React.ReactNode;
  style?: any;
  hoverGlow?: string;
}) {
  const tc = getThemeColors(true);
  return (
    <View
      style={{
        backgroundColor: tc.glass.bg,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: tc.glass.border,
        padding: 24,
        ...(isWeb
          ? ({
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
            } as any)
          : {}),
        ...shadows.md,
        ...style,
      }}
    >
      {children}
    </View>
  );
}

// ── Animated Counter Hook ─────────────────────────────────────────────────
function useAnimatedCounter(end: number, duration: number = 2000, prefix: string = "", suffix: string = "") {
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);
  const viewRef = useRef<View>(null);

  useEffect(() => {
    if (!started) return;
    let startTime: number | null = null;
    let raf: number;
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      setCount(Math.floor(eased * end));
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [started, end, duration]);

  useEffect(() => {
    if (!isWeb) { setStarted(true); return; }
    const node = (viewRef.current as any);
    if (node && typeof IntersectionObserver !== "undefined") {
      const tryObserve = () => {
        const el = node instanceof HTMLElement ? node : null;
        if (el) {
          const obs = new IntersectionObserver(
            ([entry]) => { if (entry.isIntersecting) { setStarted(true); obs.disconnect(); } },
            { threshold: 0.3 }
          );
          obs.observe(el);
          return () => obs.disconnect();
        }
        setStarted(true);
      };
      const t = setTimeout(tryObserve, 100);
      return () => clearTimeout(t);
    } else {
      setStarted(true);
    }
  }, []);

  return { count, viewRef, display: `${prefix}${count.toLocaleString()}${suffix}` };
}

// ── 3D Tilt Card (web only) ──────────────────────────────────────────────
function TiltCard({
  children,
  style,
  glowColor,
}: {
  children: React.ReactNode;
  style?: any;
  glowColor?: string;
}) {
  const tc = getThemeColors(true);
  const cardRef = useRef<View>(null);
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0 });
  const [hovered, setHovered] = useState(false);

  const handleMouseMove = useCallback((e: any) => {
    if (!isWeb || !cardRef.current) return;
    const el = cardRef.current as any;
    if (!(el instanceof HTMLElement)) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = ((y - centerY) / centerY) * -8;
    const rotateY = ((x - centerX) / centerX) * 8;
    setTilt({ rotateX, rotateY });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTilt({ rotateX: 0, rotateY: 0 });
    setHovered(false);
  }, []);

  const handleMouseEnter = useCallback(() => {
    setHovered(true);
  }, []);

  const glow = glowColor || tc.primary[500];

  return (
    <View
      ref={cardRef}
      {...(isWeb ? {
        onMouseMove: handleMouseMove,
        onMouseLeave: handleMouseLeave,
        onMouseEnter: handleMouseEnter,
      } as any : {})}
      style={{
        backgroundColor: tc.glass.bg,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: hovered ? `${glow}30` : tc.glass.border,
        padding: 24,
        ...(isWeb
          ? ({
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              transform: `perspective(1000px) rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg)`,
              transition: hovered ? "border-color 0.25s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1)" : "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
              boxShadow: hovered
                ? `0 8px 32px ${glow}20, 0 0 0 1px ${glow}15`
                : "0 4px 16px rgba(0,0,0,0.2)",
              willChange: "transform",
            } as any)
          : {}),
        ...shadows.md,
        ...style,
      }}
    >
      {children}
    </View>
  );
}

// ── Section Wrapper ─────────────────────────────────────────────────────────
function Section({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: any;
}) {
  const { width: w } = useWindowDimensions();
  const pad = w >= 1400 ? 80 : w >= 1024 ? 48 : w >= 768 ? 32 : 20;
  return (
    <View
      style={{
        width: "100%",
        paddingHorizontal: pad,
        ...style,
      }}
    >
      {children}
    </View>
  );
}

// ── SVG Image Component (uses <img> on web for SVG support) ─────────────────
function SvgImage({ uri, size = 160, style, alt = "" }: { uri: string; size?: number; style?: any; alt?: string }) {
  if (isWeb) {
    return (
      <img
        src={uri}
        alt={alt}
        style={{
          width: size,
          height: size,
          objectFit: "contain" as any,
          opacity: 0.85,
          ...style,
        }}
      />
    );
  }
  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, opacity: 0.85, ...style }}
      resizeMode="contain"
    />
  );
}

// ── Lottie Animation Component (with fallback to static illustration) ─────
function LottieAnimation({
  url,
  fallbackUri,
  size = 160,
  style,
}: {
  url: string;
  fallbackUri?: string;
  size?: number;
  style?: any;
}) {
  if (isWeb) {
    // On web, use an iframe or img fallback since lottie-react-native doesn't work on web
    // Use the static unDraw illustration as fallback
    if (fallbackUri) {
      return (
        <Image
          source={{ uri: fallbackUri }}
          style={{ width: size, height: size, opacity: 0.85, ...style }}
          resizeMode="contain"
        />
      );
    }
    return null;
  }
  // On native, use LottieView if available
  if (LottieView) {
    return (
      <LottieView
        source={{ uri: url }}
        autoPlay
        loop
        style={{ width: size, height: size, ...style }}
      />
    );
  }
  // Fallback to static image
  if (fallbackUri) {
    return (
      <Image
        source={{ uri: fallbackUri }}
        style={{ width: size, height: size, opacity: 0.85, ...style }}
        resizeMode="contain"
      />
    );
  }
  return null;
}

// ── Section Decoration Icon (glass circle with Ionicon) ──────────────────
function SectionDecorIcon({
  icon,
  size = 80,
  iconSize = 40,
  color = "rgba(16, 185, 129, 0.15)",
  borderColor = "rgba(16, 185, 129, 0.25)",
  iconColor = "#10B981",
  glowColor = "rgba(16, 185, 129, 0.12)",
}: {
  icon: keyof typeof Ionicons.glyphMap;
  size?: number;
  iconSize?: number;
  color?: string;
  borderColor?: string;
  iconColor?: string;
  glowColor?: string;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        borderWidth: 1,
        borderColor: borderColor,
        alignItems: "center",
        justifyContent: "center",
        ...(isWeb
          ? ({
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              boxShadow: `0 8px 32px ${glowColor}`,
            } as any)
          : {}),
      }}
    >
      <Ionicons name={icon} size={iconSize} color={iconColor} />
    </View>
  );
}

// ── Primary CTA Button ─────────────────────────────────────────────────────
function PrimaryButton({
  label,
  onPress,
  tc,
  style,
  icon,
}: {
  label: string;
  onPress: () => void;
  tc: ReturnType<typeof getThemeColors>;
  style?: any;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => ({
        backgroundColor: hovered ? tc.primary[400] : tc.primary[500],
        borderRadius: 16,
        paddingVertical: 17,
        paddingHorizontal: 36,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 10,
        minHeight: 56,
        opacity: pressed ? 0.9 : 1,
        transform: [{ scale: pressed ? 0.97 : hovered ? 1.02 : 1 }],
        ...(isWeb
          ? ({
              cursor: "pointer",
              transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
              boxShadow: hovered
                ? "0 12px 40px rgba(16, 185, 129, 0.5), 0 0 0 2px rgba(16, 185, 129, 0.2)"
                : "0 4px 20px rgba(16, 185, 129, 0.25)",
            } as any)
          : {}),
        ...style,
      })}
      accessibilityRole="button"
    >
      {icon && <Ionicons name={icon} size={20} color="#FFFFFF" />}
      <Text
        style={{
          color: "#FFFFFF",
          fontSize: 17,
          fontFamily: "DMSans_700Bold",
          letterSpacing: 0.3,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ── Section Title Component ─────────────────────────────────────────────────
function SectionTitle({
  label,
  title,
  subtitle,
  tc,
  isMobile,
}: {
  label: string;
  title: string;
  subtitle?: string;
  tc: ReturnType<typeof getThemeColors>;
  isMobile: boolean;
}) {
  return (
    <View style={{ alignItems: "center", marginBottom: isMobile ? 36 : 56 }}>
      <Text
        style={{
          color: tc.primary[400],
          fontSize: 13,
          fontFamily: "DMSans_700Bold",
          textAlign: "center",
          textTransform: "uppercase",
          letterSpacing: 3,
          marginBottom: 14,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: tc.textPrimary,
          fontSize: isMobile ? 28 : 40,
          fontFamily: "DMSans_700Bold",
          textAlign: "center",
          letterSpacing: -1,
          lineHeight: isMobile ? 36 : 50,
          maxWidth: 700,
        }}
      >
        {title}
      </Text>
      {subtitle && (
        <Text
          style={{
            color: tc.textSecondary,
            fontSize: isMobile ? 15 : 17,
            fontFamily: "DMSans_400Regular",
            textAlign: "center",
            lineHeight: isMobile ? 22 : 26,
            marginTop: 14,
            maxWidth: 560,
          }}
        >
          {subtitle}
        </Text>
      )}
    </View>
  );
}

// ── Navbar ──────────────────────────────────────────────────────────────────
function Navbar({
  tc,
  isMobile,
  isDesktop,
  onSignIn,
  onGetStarted,
  onScrollTo,
}: {
  tc: ReturnType<typeof getThemeColors>;
  isMobile: boolean;
  isDesktop: boolean;
  onSignIn: () => void;
  onGetStarted: () => void;
  onScrollTo: (section: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { width } = useWindowDimensions();
  const pad = width >= 1400 ? 80 : width >= 1024 ? 48 : width >= 768 ? 32 : 20;

  const navLinks = [
    { label: "How It Works", section: "howItWorks" },
    { label: "Features", section: "features" },
    { label: "Pricing", section: "pricing" },
  ];

  return (
    <>
      <View
        style={{
          position: isWeb ? ("fixed" as any) : "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: pad,
          paddingVertical: 14,
          ...(isWeb
            ? ({
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                backgroundColor: "rgba(6, 14, 31, 0.85)",
                borderBottomWidth: 1,
                borderBottomColor: "rgba(255,255,255,0.06)",
                transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
              } as any)
            : { backgroundColor: "rgba(6, 14, 31, 0.95)" }),
        }}
      >
        {/* Logo */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: tc.primary[500],
              alignItems: "center",
              justifyContent: "center",
              ...(isWeb
                ? ({ boxShadow: "0 2px 12px rgba(16, 185, 129, 0.3)" } as any)
                : {}),
            }}
          >
            <Ionicons name="flash" size={18} color="#FFFFFF" />
          </View>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 22,
              fontFamily: "DMSans_700Bold",
              letterSpacing: -0.5,
            }}
          >
            CryptoPay
          </Text>
        </View>

        {/* Desktop nav links + actions */}
        {isDesktop ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {navLinks.map((link) => (
              <Pressable
                key={link.section}
                onPress={() => onScrollTo(link.section)}
                style={({ hovered }: any) => ({
                  paddingVertical: 8,
                  paddingHorizontal: 16,
                  borderRadius: 10,
                  backgroundColor: hovered ? "rgba(255,255,255,0.04)" : "transparent",
                  ...(isWeb ? ({ cursor: "pointer", transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)" } as any) : {}),
                })}
              >
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 14,
                    fontFamily: "DMSans_500Medium",
                  }}
                >
                  {link.label}
                </Text>
              </Pressable>
            ))}

            <View style={{ width: 1, height: 20, backgroundColor: tc.dark.border, marginHorizontal: 8 }} />

            <Pressable
              onPress={onSignIn}
              style={({ pressed, hovered }: any) => ({
                paddingVertical: 10,
                paddingHorizontal: 20,
                borderRadius: 12,
                backgroundColor: hovered ? "rgba(255,255,255,0.05)" : "transparent",
                opacity: pressed ? 0.8 : 1,
                ...(isWeb ? ({ cursor: "pointer", transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)" } as any) : {}),
              })}
              accessibilityRole="button"
              accessibilityLabel="Sign In"
            >
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 15,
                  fontFamily: "DMSans_600SemiBold",
                }}
              >
                Sign In
              </Text>
            </Pressable>

            <Pressable
              onPress={onGetStarted}
              style={({ pressed, hovered }: any) => ({
                paddingVertical: 10,
                paddingHorizontal: 24,
                borderRadius: 12,
                backgroundColor: hovered ? tc.primary[400] : tc.primary[500],
                opacity: pressed ? 0.9 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
                ...(isWeb
                  ? ({
                      cursor: "pointer",
                      transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                      boxShadow: hovered
                        ? "0 4px 20px rgba(16, 185, 129, 0.35)"
                        : "0 2px 12px rgba(16, 185, 129, 0.2)",
                    } as any)
                  : {}),
              })}
              accessibilityRole="button"
              accessibilityLabel="Get Started"
            >
              <Text
                style={{
                  color: "#FFFFFF",
                  fontSize: 15,
                  fontFamily: "DMSans_700Bold",
                }}
              >
                Get Started
              </Text>
            </Pressable>
          </View>
        ) : (
          /* Mobile hamburger */
          <Pressable
            onPress={() => setMenuOpen(!menuOpen)}
            style={({ pressed }: any) => ({
              width: 40,
              height: 40,
              borderRadius: 10,
              backgroundColor: "rgba(255,255,255,0.05)",
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.7 : 1,
              ...(isWeb ? ({ cursor: "pointer" } as any) : {}),
            })}
          >
            <Ionicons
              name={menuOpen ? "close" : "menu"}
              size={22}
              color={tc.textPrimary}
            />
          </Pressable>
        )}
      </View>

      {/* Mobile dropdown menu */}
      {!isDesktop && menuOpen && (
        <View
          style={{
            position: isWeb ? ("fixed" as any) : "absolute",
            top: 64,
            left: 0,
            right: 0,
            zIndex: 99,
            backgroundColor: "rgba(6, 14, 31, 0.97)",
            borderBottomWidth: 1,
            borderBottomColor: "rgba(255,255,255,0.06)",
            paddingVertical: 8,
            paddingHorizontal: 20,
            ...(isWeb
              ? ({
                  backdropFilter: "blur(20px)",
                  WebkitBackdropFilter: "blur(20px)",
                } as any)
              : {}),
          }}
        >
          {navLinks.map((link) => (
            <Pressable
              key={link.section}
              onPress={() => {
                setMenuOpen(false);
                onScrollTo(link.section);
              }}
              style={({ hovered }: any) => ({
                paddingVertical: 14,
                paddingHorizontal: 12,
                borderRadius: 10,
                backgroundColor: hovered ? "rgba(255,255,255,0.03)" : "transparent",
                ...(isWeb ? ({ cursor: "pointer" } as any) : {}),
              })}
            >
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 15,
                  fontFamily: "DMSans_500Medium",
                }}
              >
                {link.label}
              </Text>
            </Pressable>
          ))}
          <View style={{ height: 1, backgroundColor: tc.dark.border, marginVertical: 8 }} />
          <Pressable
            onPress={() => {
              setMenuOpen(false);
              onSignIn();
            }}
            style={{ paddingVertical: 14, paddingHorizontal: 12 }}
          >
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 15,
                fontFamily: "DMSans_600SemiBold",
              }}
            >
              Sign In
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setMenuOpen(false);
              onGetStarted();
            }}
            style={{
              marginVertical: 8,
              backgroundColor: tc.primary[500],
              paddingVertical: 14,
              borderRadius: 12,
              alignItems: "center",
            }}
          >
            <Text
              style={{
                color: "#FFFFFF",
                fontSize: 15,
                fontFamily: "DMSans_700Bold",
              }}
            >
              Get Started
            </Text>
          </Pressable>
        </View>
      )}
    </>
  );
}

// =============================================================================
// ── MAIN LANDING PAGE ───────────────────────────────────────────────────────
// =============================================================================
export default function LandingPage() {
  const router = useRouter();
  const tc = getThemeColors(true); // Landing always uses dark theme
  const { width } = useWindowDimensions();

  const isMobile = width < 768;
  const isTablet = width >= 768 && width < 1024;
  const isDesktop = width >= 1024;

  const scrollRef = useRef<ScrollView>(null);
  const sectionRefs = useRef<Record<string, View | null>>({});

  const navigateToLogin = useCallback(() => {
    router.push("/auth/login");
  }, [router]);

  const navigateToRegister = useCallback(() => {
    router.push("/auth/register");
  }, [router]);

  const scrollToSection = useCallback((section: string) => {
    const ref = sectionRefs.current[section];
    if (ref && scrollRef.current) {
      (ref as any).measureLayout?.(
        (scrollRef.current as any).getInnerViewNode?.(),
        (_x: number, y: number) => {
          scrollRef.current?.scrollTo({ y: y - 70, animated: true });
        },
        () => {}
      );
    }
  }, []);

  // ── Testimonial Carousel State ──────────────────────────────────────────
  const [currentSlide, setCurrentSlide] = useState(0);
  const [testimonialHovered, setTestimonialHovered] = useState(false);
  const slidesPerView = isMobile ? 1 : isTablet ? 2 : 3;
  const maxSlide = Math.max(0, TESTIMONIALS.length - slidesPerView);

  useEffect(() => {
    if (testimonialHovered) return;
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev >= maxSlide ? 0 : prev + 1));
    }, 5000);
    return () => clearInterval(timer);
  }, [testimonialHovered, maxSlide]);

  // ── SEO Meta Tags (web only) ─────────────────────────────────────────────
  useEffect(() => {
    if (!isWeb) return;
    document.title = "CryptoPay \u2014 Pay Any Bill in Kenya with Crypto | USDT, BTC, ETH, SOL to M-Pesa";

    // Meta description
    const setMeta = (name: string, content: string, property?: boolean) => {
      const attr = property ? "property" : "name";
      let el = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.content = content;
    };

    setMeta("description", "Pay any M-Pesa Paybill or Till number directly from cryptocurrency. Convert USDT, BTC, ETH, SOL to KES instantly. No P2P, no waiting. Secure, fast, and fully compliant.");
    setMeta("keywords", "crypto payments Kenya, USDT to M-Pesa, Bitcoin to KES, pay bills with crypto, CryptoPay, crypto to M-Pesa, Paybill crypto, Till number crypto");

    // Open Graph
    setMeta("og:title", "CryptoPay \u2014 Pay Any Bill in Kenya with Crypto", true);
    setMeta("og:description", "Convert USDT, BTC, ETH, SOL to M-Pesa payments in 30 seconds. Pay any Paybill or Till number directly from crypto.", true);
    setMeta("og:type", "website", true);
    setMeta("og:url", "https://cpay.co.ke", true);
    setMeta("og:site_name", "CryptoPay", true);
    setMeta("og:locale", "en_KE", true);

    // Twitter Card
    setMeta("twitter:card", "summary_large_image");
    setMeta("twitter:site", "@CPayKenya");
    setMeta("twitter:title", "CryptoPay \u2014 Pay Any Bill in Kenya with Crypto");
    setMeta("twitter:description", "USDT, BTC, ETH, SOL to M-Pesa Paybill & Till. Locked rates, zero slippage, instant delivery.");

    // Additional SEO meta tags
    setMeta("robots", "index, follow");
    setMeta("author", "CryptoPay Technologies");
    setMeta("theme-color", "#060E1F");
    setMeta("apple-mobile-web-app-capable", "yes");
    setMeta("apple-mobile-web-app-status-bar-style", "black-translucent");

    // Canonical link
    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = "https://cpay.co.ke/";

    // FAQ JSON-LD Schema
    const faqSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ_DATA.map((faq) => ({
        "@type": "Question",
        name: faq.q,
        acceptedAnswer: { "@type": "Answer", text: faq.a },
      })),
    };
    let scriptEl = document.querySelector('script[data-schema="faq"]') as HTMLScriptElement | null;
    if (!scriptEl) {
      scriptEl = document.createElement("script");
      scriptEl.type = "application/ld+json";
      scriptEl.setAttribute("data-schema", "faq");
      document.head.appendChild(scriptEl);
    }
    scriptEl.textContent = JSON.stringify(faqSchema);

    // Organization JSON-LD
    const orgSchema = {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "CryptoPay",
      url: "https://cpay.co.ke",
      description: "Pay any M-Pesa Paybill or Till number directly from cryptocurrency.",
      sameAs: ["https://twitter.com/CPayKenya", "https://t.me/cryptopaykenya"],
    };
    let orgScript = document.querySelector('script[data-schema="org"]') as HTMLScriptElement | null;
    if (!orgScript) {
      orgScript = document.createElement("script");
      orgScript.type = "application/ld+json";
      orgScript.setAttribute("data-schema", "org");
      document.head.appendChild(orgScript);
    }
    orgScript.textContent = JSON.stringify(orgSchema);

    // SoftwareApplication Schema (for app stores)
    const appSchema = {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "CryptoPay",
      operatingSystem: "Android, iOS, Web",
      applicationCategory: "FinanceApplication",
      description: "Pay any M-Pesa Paybill or Till number directly from cryptocurrency (USDT, BTC, ETH, SOL). Instant delivery, locked rates, zero slippage.",
      url: "https://cpay.co.ke",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "KES",
      },
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: "4.8",
        ratingCount: "50",
        bestRating: "5",
      },
    };
    let appScript = document.querySelector('script[data-schema="app"]') as HTMLScriptElement | null;
    if (!appScript) {
      appScript = document.createElement("script");
      appScript.type = "application/ld+json";
      appScript.setAttribute("data-schema", "app");
      document.head.appendChild(appScript);
    }
    appScript.textContent = JSON.stringify(appSchema);

    // Geo targeting for Kenya
    setMeta("geo.region", "KE");
    setMeta("geo.placename", "Nairobi");
    setMeta("geo.position", "-1.2921;36.8219");
    setMeta("ICBM", "-1.2921, 36.8219");
    setMeta("content-language", "en-KE");

    // Additional structured SEO
    setMeta("application-name", "CryptoPay");
    setMeta("msapplication-TileColor", "#060E1F");
    setMeta("format-detection", "telephone=no");
  }, []);

  // ── Animated Counters for Stats ─────────────────────────────────────────
  const usersCounter = useAnimatedCounter(730, 1800);

  // ── Live CoinGecko Rate ───────────────────────────────────────────────
  const [liveRate, setLiveRate] = useState<string>("129+");
  useEffect(() => {
    if (!isWeb) return;
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=kes")
      .then(r => r.json())
      .then(d => {
        const rate = d?.tether?.kes;
        if (rate) setLiveRate(`KES ${rate.toFixed(2)}`);
      })
      .catch(() => {}); // silently fail, keep default
  }, []);

  // ── Inject carousel CSS keyframes (web only) ───────────────────────────
  useEffect(() => {
    if (!isWeb) return;
    const styleId = "cpay-landing-animations";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      /* ── Keyframe Animations ─────────────────────────── */
      @keyframes cpay-scroll-left {
        0% { transform: translateX(0); }
        100% { transform: translateX(-50%); }
      }
      @keyframes cpay-aurora {
        0%, 100% { transform: translate(0, 0) scale(1); }
        25% { transform: translate(40px, 30px) scale(1.1); }
        50% { transform: translate(-30px, 60px) scale(0.9); }
        75% { transform: translate(50px, -20px) scale(1.05); }
      }
      @keyframes cpay-float-bob {
        0% { transform: translateY(0px); }
        25% { transform: translateY(-3px); }
        50% { transform: translateY(-5px); }
        75% { transform: translateY(-3px); }
        100% { transform: translateY(0px); }
      }
      @keyframes cpay-coin-rotate {
        0% { transform: rotateY(0deg); }
        100% { transform: rotateY(360deg); }
      }
      @keyframes cpay-pulse-green {
        0%, 100% { opacity: 1; box-shadow: 0 0 4px rgba(16,185,129,0.6); }
        50% { opacity: 0.5; box-shadow: 0 0 12px rgba(16,185,129,0.9); }
      }
      @keyframes cpay-glow-pulse {
        0%, 100% { box-shadow: 0 0 20px rgba(16,185,129,0.2); }
        50% { box-shadow: 0 0 40px rgba(16,185,129,0.4), 0 0 80px rgba(16,185,129,0.1); }
      }
      @keyframes cpay-shine-sweep {
        0% { left: -100%; }
        100% { left: 200%; }
      }
      @keyframes cpay-hero-grid {
        0% { opacity: 0.03; }
        50% { opacity: 0.06; }
        100% { opacity: 0.03; }
      }

      /* ── Aurora & Carousel ───────────────────────────── */
      .cpay-aurora-blob { will-change: transform; }
      .cpay-carousel-track {
        display: flex;
        animation: cpay-scroll-left 40s linear infinite;
        width: max-content;
      }
      .cpay-carousel-track:hover { animation-play-state: paused; }

      /* ── Card Hover: Lift + Glow + Shine ─────────────── */
      .cpay-tilt-card {
        transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }
      .cpay-tilt-card::after {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 60%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent);
        transition: none;
      }
      .cpay-tilt-card:hover {
        transform: translateY(-6px) !important;
        border-color: rgba(16, 185, 129, 0.3) !important;
        box-shadow: 0 16px 48px rgba(16, 185, 129, 0.15), 0 0 0 1px rgba(16, 185, 129, 0.1) !important;
      }
      .cpay-tilt-card:hover::after {
        animation: cpay-shine-sweep 0.8s ease-out;
      }

      /* ── Glass Card Hover (all sections) ─────────────── */
      [data-glass="true"] {
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }
      [data-glass="true"]::after {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 50%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.02), transparent);
      }
      [data-glass="true"]:hover {
        transform: translateY(-4px);
        border-color: rgba(16, 185, 129, 0.25);
        box-shadow: 0 12px 36px rgba(16, 185, 129, 0.1), 0 0 0 1px rgba(16,185,129,0.08);
      }
      [data-glass="true"]:hover::after {
        animation: cpay-shine-sweep 0.7s ease-out;
      }

      /* ── Nav Link Hover ──────────────────────────────── */
      .cpay-nav-link {
        transition: all 0.2s ease;
        position: relative;
      }
      .cpay-nav-link::after {
        content: '';
        position: absolute;
        bottom: -2px;
        left: 50%;
        width: 0;
        height: 2px;
        background: #10B981;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        transform: translateX(-50%);
        border-radius: 1px;
      }
      .cpay-nav-link:hover::after {
        width: 80%;
      }
      .cpay-nav-link:hover {
        color: #10B981 !important;
      }

      /* ── Button Glow Pulse ───────────────────────────── */
      .cpay-cta-glow {
        animation: cpay-glow-pulse 3s ease-in-out infinite;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .cpay-cta-glow:hover {
        transform: scale(1.03) translateY(-2px);
        box-shadow: 0 8px 32px rgba(16,185,129,0.4), 0 0 60px rgba(16,185,129,0.15) !important;
      }
      .cpay-cta-glow:active {
        transform: scale(0.97);
      }

      /* ── Icon Hover Bounce ───────────────────────────── */
      .cpay-icon-hover {
        transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      .cpay-icon-hover:hover {
        transform: scale(1.15) rotate(-5deg);
      }

      /* ── Illustration Hover ──────────────────────────── */
      img[alt*="illustration"], img[alt*="Illustration"] {
        transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), filter 0.5s ease;
      }
      img[alt*="illustration"]:hover, img[alt*="Illustration"]:hover {
        transform: scale(1.06) translateY(-4px);
        filter: drop-shadow(0 8px 24px rgba(16,185,129,0.2));
      }

      /* ── Hero Background Grid ────────────────────────── */
      .cpay-hero-grid {
        background-image:
          linear-gradient(rgba(16,185,129,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(16,185,129,0.03) 1px, transparent 1px);
        background-size: 60px 60px;
        animation: cpay-hero-grid 8s ease-in-out infinite;
      }

      /* ── Crypto Card Glow on Hover ───────────────────── */
      .cpay-crypto-card {
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .cpay-crypto-card:hover {
        transform: translateY(-8px) scale(1.02);
        box-shadow: 0 16px 48px var(--glow-color, rgba(16,185,129,0.2));
      }

      /* ── Service Logo Hover ──────────────────────────── */
      .cpay-service-logo {
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .cpay-service-logo:hover {
        transform: scale(1.08);
        border-color: rgba(16,185,129,0.3) !important;
        box-shadow: 0 4px 16px rgba(16,185,129,0.1);
      }

      /* ── Step Card Lift ──────────────────────────────── */
      .cpay-step-card {
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .cpay-step-card:hover {
        transform: translateY(-6px);
        border-color: rgba(16,185,129,0.3) !important;
        box-shadow: 0 12px 40px rgba(16,185,129,0.12);
      }

      /* ── FAQ Item Hover ──────────────────────────────── */
      .cpay-faq-item {
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .cpay-faq-item:hover {
        border-color: rgba(16,185,129,0.25) !important;
        background-color: rgba(255,255,255,0.03) !important;
      }

      /* ── Testimonial Card ────────────────────────────── */
      .cpay-testimonial {
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .cpay-testimonial:hover {
        transform: translateY(-4px);
        border-color: rgba(16,185,129,0.2) !important;
        box-shadow: 0 8px 32px rgba(16,185,129,0.08);
      }

      /* ── Partner Badge Hover ─────────────────────────── */
      .cpay-partner-badge {
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .cpay-partner-badge:hover {
        transform: translateY(-3px);
        border-color: rgba(16,185,129,0.3) !important;
        box-shadow: 0 6px 20px rgba(16,185,129,0.1);
      }
    `;
    document.head.appendChild(style);
  }, []);

  // ── 1. HERO SECTION ────────────────────────────────────────────────────────
  const heroSection = (
    <View
      accessibilityLabel="CryptoPay hero section"
      style={{
        minHeight: isMobile ? 750 : 850,
        justifyContent: "center",
        alignItems: "center",
        paddingTop: isMobile ? 100 : 130,
        paddingBottom: isMobile ? 60 : 80,
        position: "relative",
        overflow: "hidden",
        ...(isWeb
          ? ({
              background:
                "linear-gradient(180deg, #060E1F 0%, #0C1A30 40%, #0A1628 100%)",
            } as any)
          : { backgroundColor: "#060E1F" }),
      }}
    >
      {/* Dot pattern */}
      {isWeb && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: 0.35,
            ...(isWeb
              ? ({
                  backgroundImage:
                    "radial-gradient(circle, rgba(16,185,129,0.07) 1px, transparent 1px)",
                  backgroundSize: "32px 32px",
                } as any)
              : {}),
          }}
        />
      )}

      {/* Hero grid pattern overlay */}
      {isWeb && (
        <View
          className="cpay-hero-grid"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 0,
          } as any}
        />
      )}

      {/* Aurora mesh gradient background */}
      {isWeb && (
        <>
          {/* Aurora glow - emerald */}
          <View style={{
            position: "absolute",
            top: -200,
            left: -200,
            width: 720,
            height: 720,
            borderRadius: 360,
            backgroundColor: "#10B981",
            opacity: 0.12,
            ...(isWeb ? {
              filter: "blur(120px)",
              animation: "cpay-aurora 25s cubic-bezier(0.4, 0, 0.2, 1) infinite",
              willChange: "transform",
            } as any : {}),
          } as any} />
          {/* Aurora glow - indigo */}
          <View style={{
            position: "absolute",
            bottom: -150,
            right: -150,
            width: 600,
            height: 600,
            borderRadius: 300,
            backgroundColor: "#6366F1",
            opacity: 0.08,
            ...(isWeb ? {
              filter: "blur(120px)",
              animation: "cpay-aurora 30s cubic-bezier(0.4, 0, 0.2, 1) infinite reverse",
              willChange: "transform",
            } as any : {}),
          } as any} />
          {/* Aurora glow - amber */}
          <View style={{
            position: "absolute",
            top: 100,
            right: -100,
            width: 480,
            height: 480,
            borderRadius: 240,
            backgroundColor: "#F59E0B",
            opacity: 0.06,
            ...(isWeb ? {
              filter: "blur(120px)",
              animation: "cpay-aurora 35s cubic-bezier(0.4, 0, 0.2, 1) infinite 3s",
              willChange: "transform",
            } as any : {}),
          } as any} />
        </>
      )}

      {/* Gradient orbs */}
      <View
        style={{
          position: "absolute",
          top: -200,
          right: isMobile ? -150 : "10%",
          width: isMobile ? 400 : 600,
          height: isMobile ? 400 : 600,
          borderRadius: 300,
          ...(isWeb
            ? ({
                background:
                  "radial-gradient(circle, rgba(16, 185, 129, 0.06) 0%, transparent 70%)",
              } as any)
            : { backgroundColor: "rgba(16, 185, 129, 0.03)" }),
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: -150,
          left: isMobile ? -150 : "-5%",
          width: isMobile ? 350 : 500,
          height: isMobile ? 350 : 500,
          borderRadius: 250,
          ...(isWeb
            ? ({
                background:
                  "radial-gradient(circle, rgba(245, 158, 11, 0.04) 0%, transparent 70%)",
              } as any)
            : { backgroundColor: "rgba(245, 158, 11, 0.02)" }),
        }}
      />

      {/* Floating crypto icons (desktop) */}
      {!isMobile && (
        <>
          <FloatingCoin uri={COIN_ICONS[0].uri} color={COIN_ICONS[0].color} size={72} left="6%" top="22%" delay={0} />
          <FloatingCoin uri={COIN_ICONS[1].uri} color={COIN_ICONS[1].color} size={64} left="88%" top="16%" delay={400} />
          <FloatingCoin uri={COIN_ICONS[2].uri} color={COIN_ICONS[2].color} size={56} left="10%" top="70%" delay={700} />
          <FloatingCoin uri={COIN_ICONS[3].uri} color={COIN_ICONS[3].color} size={60} left="84%" top="72%" delay={1000} />
        </>
      )}
      {/* Floating crypto icons (mobile) */}
      {isMobile && (
        <>
          <FloatingCoin uri={COIN_ICONS[0].uri} color={COIN_ICONS[0].color} size={44} left="3%" top="11%" delay={0} />
          <FloatingCoin uri={COIN_ICONS[1].uri} color={COIN_ICONS[1].color} size={40} left="82%" top="9%" delay={300} />
          <FloatingCoin uri={COIN_ICONS[2].uri} color={COIN_ICONS[2].color} size={36} left="1%" top="80%" delay={600} />
          <FloatingCoin uri={COIN_ICONS[3].uri} color={COIN_ICONS[3].color} size={38} left="80%" top="82%" delay={900} />
        </>
      )}

      {/* Hero content */}
      <RevealOnScroll>
        <View
          style={{
            flexDirection: isDesktop ? "row" : "column",
            alignItems: "center",
            justifyContent: isDesktop ? "space-between" : "center",
            width: "100%",
            paddingHorizontal: isMobile ? 20 : width >= 1400 ? 100 : isDesktop ? 60 : 40,
            zIndex: 10,
            gap: isDesktop ? 48 : 0,
          }}
        >
          {/* Left: Text content (60%) */}
          <View
            style={{
              alignItems: isDesktop ? "flex-start" : "center",
              flex: isDesktop ? 1 : undefined,
              minWidth: isDesktop ? 400 : undefined,
            }}
          >
            {/* Pain-first headline */}
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: isMobile ? 30 : isTablet ? 40 : width >= 1400 ? 58 : 50,
                fontFamily: "DMSans_700Bold",
                textAlign: isDesktop ? "left" : "center",
                letterSpacing: -1.5,
                lineHeight: isMobile ? 38 : isTablet ? 50 : 62,
                marginBottom: 24,
              }}
            >
              Stop Waiting for P2P Scams.{"\n"}
              <Text style={{ color: tc.primary[400] }}>
                Pay Any Kenyan Bill{"\n"}with Crypto in 30 Seconds.
              </Text>
            </Text>

            {/* Subheadline */}
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: isMobile ? 16 : 18,
                fontFamily: "DMSans_400Regular",
                textAlign: isDesktop ? "left" : "center",
                lineHeight: isMobile ? 24 : 28,
                maxWidth: isMobile ? 380 : 560,
                marginBottom: 36,
              }}
            >
              Convert your crypto to M-Pesa payments instantly. Pay any Paybill, Till, or send to any phone number.
            </Text>

            {/* Feature pills */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 32, justifyContent: isDesktop ? "flex-start" : "center" }}>
              {[
                { icon: "lock-closed" as keyof typeof Ionicons.glyphMap, text: "Locked rates" },
                { icon: "shield-checkmark" as keyof typeof Ionicons.glyphMap, text: "Zero slippage" },
                { icon: "finger-print" as keyof typeof Ionicons.glyphMap, text: "PIN + biometric" },
                { icon: "flash" as keyof typeof Ionicons.glyphMap, text: "Under 30 seconds" },
              ].map((pill) => (
                <View
                  key={pill.text}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    backgroundColor: "rgba(16, 185, 129, 0.08)",
                    borderWidth: 1,
                    borderColor: "rgba(16, 185, 129, 0.2)",
                    borderRadius: 20,
                    paddingVertical: 6,
                    paddingHorizontal: 14,
                    ...(isWeb ? { transition: "all 0.2s ease", cursor: "default" } as any : {}),
                  }}
                >
                  <Ionicons name={pill.icon} size={14} color={tc.primary[400]} />
                  <Text style={{ color: tc.primary[300], fontSize: 13, fontFamily: "DMSans_500Medium" }}>
                    {pill.text}
                  </Text>
                </View>
              ))}
            </View>

            {/* CTA Buttons with glow ring */}
            <View
              style={{
                flexDirection: isMobile ? "column" : "row",
                gap: 16,
                alignItems: isMobile ? "stretch" : "center",
                width: isMobile ? "100%" : undefined,
                position: "relative",
              }}
            >
              {/* Decorative glow behind CTA */}
              {isWeb && (
                <View style={{
                  position: "absolute",
                  top: -20,
                  left: isMobile ? "10%" : -30,
                  width: isMobile ? "80%" : 280,
                  height: 80,
                  borderRadius: 40,
                  backgroundColor: "rgba(16, 185, 129, 0.06)",
                  ...(isWeb ? { filter: "blur(30px)" } as any : {}),
                } as any} />
              )}
              <PrimaryButton
                label="Get Started Free"
                onPress={navigateToRegister}
                tc={tc}
                icon="flash"
                style={isMobile ? { maxWidth: 400, alignSelf: "center", width: "100%" } : { minWidth: 220 }}
              />
              {/* Outline "See How It Works" button */}
              <Pressable
                onPress={() => scrollToSection("howItWorks")}
                style={({ hovered, pressed }: any) => ({
                  paddingVertical: 14,
                  paddingHorizontal: 28,
                  borderRadius: 16,
                  borderWidth: 1.5,
                  borderColor: hovered ? tc.primary[400] : "rgba(255,255,255,0.15)",
                  backgroundColor: hovered ? "rgba(16,185,129,0.08)" : "transparent",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  opacity: pressed ? 0.9 : 1,
                  ...(isWeb ? {
                    cursor: "pointer",
                    transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                  } as any : {}),
                  ...(isMobile ? { maxWidth: 400, alignSelf: "center", width: "100%" } : {}),
                })}
              >
                <Ionicons name="play-circle-outline" size={18} color={tc.textSecondary} />
                <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_600SemiBold" }}>
                  See How It Works
                </Text>
              </Pressable>
            </View>

            {/* Secondary: Sign In link with arrow hover */}
            <Pressable
              onPress={navigateToLogin}
              style={({ hovered }: any) => ({
                marginTop: 16,
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 8,
                alignSelf: isDesktop ? "flex-start" : "center",
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                backgroundColor: hovered ? "rgba(255,255,255,0.04)" : "transparent",
                ...(isWeb ? { cursor: "pointer", transition: "all 0.2s ease" } as any : {}),
              })}
            >
              <Ionicons name="log-in-outline" size={16} color={tc.textMuted} />
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 14,
                  fontFamily: "DMSans_400Regular",
                }}
              >
                Already have an account?{" "}
                <Text
                  style={{
                    color: tc.primary[300],
                    fontFamily: "DMSans_600SemiBold",
                  }}
                >
                  Sign In
                </Text>
              </Text>
              <Ionicons name="arrow-forward" size={14} color={tc.primary[400]} />
            </Pressable>

            {/* App Store badges */}
            <View
              style={{
                flexDirection: "row",
                gap: 12,
                marginTop: 24,
                alignItems: isDesktop ? "flex-start" : "center",
                justifyContent: isDesktop ? "flex-start" : "center",
              }}
            >
              {/* Google Play badge */}
              <Pressable
                onPress={() => {
                  const url = "https://play.google.com/store/apps/details?id=com.cpay.cryptopay";
                  if (isWeb) (window as any).open(url, "_blank");
                  else Linking.openURL(url);
                }}
                style={({ hovered }: any) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  backgroundColor: hovered ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.15)",
                  borderRadius: 12,
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  ...(isWeb ? { cursor: "pointer", transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)" } as any : {}),
                })}
                accessibilityLabel="Get it on Google Play"
              >
                <Image source={STORE_ICONS.googlePlay} style={{ width: 24, height: 24 }} resizeMode="contain" />
                <View>
                  <Text style={{ color: tc.textMuted, fontSize: 9, fontFamily: "DMSans_400Regular" }}>GET IT ON</Text>
                  <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>Google Play</Text>
                </View>
              </Pressable>
              {/* App Store badge — Coming Soon */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  backgroundColor: "rgba(255,255,255,0.03)",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.10)",
                  borderRadius: 12,
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  opacity: 0.6,
                }}
                accessibilityLabel="App Store — Coming Soon"
              >
                <View style={{ position: "relative" }}>
                  <Image source={STORE_ICONS.appStore} style={{ width: 24, height: 24, opacity: 0.7 }} resizeMode="contain" />
                  <View style={{ position: "absolute", bottom: -2, right: -2, width: 12, height: 12, borderRadius: 6, backgroundColor: "rgba(6, 14, 31, 0.9)", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="time-outline" size={9} color={tc.textMuted} />
                  </View>
                </View>
                <View>
                  <Text style={{ color: tc.textMuted, fontSize: 9, fontFamily: "DMSans_400Regular" }}>Download on the</Text>
                  <Text style={{ color: tc.textSecondary, fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>App Store</Text>
                  <Text style={{ color: tc.primary[400], fontSize: 9, fontFamily: "DMSans_600SemiBold", letterSpacing: 0.5 }}>COMING SOON</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Right: App mockup card (40%, desktop only) */}
          {isDesktop && (
            <View
              style={{
                flex: 0,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Pressable
                style={({ hovered }: any) => ({
                  width: width >= 1400 ? 440 : 380,
                  backgroundColor: tc.glass.bg,
                  borderRadius: 28,
                  borderWidth: 1,
                  borderColor: hovered ? "rgba(16,185,129,0.3)" : tc.glass.borderStrong,
                  padding: 28,
                  ...(isWeb
                    ? ({
                        backdropFilter: "blur(24px)",
                        WebkitBackdropFilter: "blur(24px)",
                        boxShadow: hovered
                          ? "0 40px 100px rgba(0,0,0,0.6), 0 0 0 1px rgba(16,185,129,0.2), 0 0 40px rgba(16,185,129,0.1)"
                          : "0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(16,185,129,0.08), inset 0 1px 0 rgba(255,255,255,0.05)",
                        transform: hovered
                          ? "perspective(1200px) rotateY(-2deg) rotateX(1deg) translateY(-8px)"
                          : "perspective(1200px) rotateY(-4deg) rotateX(2deg)",
                        transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
                        cursor: "pointer",
                      } as any)
                    : {}),
                })}
              >
                {/* Header */}
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: 24,
                  }}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 14,
                      backgroundColor: tc.primary[500],
                      alignItems: "center",
                      justifyContent: "center",
                      ...(isWeb
                        ? ({ boxShadow: "0 4px 16px rgba(16, 185, 129, 0.3)" } as any)
                        : {}),
                    }}
                  >
                    <Ionicons name="flash" size={22} color="#fff" />
                  </View>
                  <View>
                    <Text
                      style={{
                        color: tc.textPrimary,
                        fontSize: 18,
                        fontFamily: "DMSans_700Bold",
                      }}
                    >
                      CryptoPay
                    </Text>
                    <Text
                      style={{
                        color: tc.textMuted,
                        fontSize: 12,
                        fontFamily: "DMSans_400Regular",
                      }}
                    >
                      Your crypto, Kenya's bills
                    </Text>
                  </View>
                </View>

                {/* Balance card */}
                <View
                  style={{
                    backgroundColor: tc.dark.bg,
                    borderRadius: 18,
                    padding: 22,
                    marginBottom: 16,
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.04)",
                  }}
                >
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 11,
                      fontFamily: "DMSans_600SemiBold",
                      textTransform: "uppercase",
                      letterSpacing: 1.5,
                      marginBottom: 10,
                    }}
                  >
                    Total Balance
                  </Text>
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 34,
                      fontFamily: "DMSans_700Bold",
                      letterSpacing: -1,
                    }}
                  >
                    7.88{" "}
                    <Text
                      style={{
                        fontSize: 18,
                        color: tc.primary[400],
                        fontFamily: "DMSans_600SemiBold",
                      }}
                    >
                      USDT
                    </Text>
                  </Text>
                  <Text
                    style={{
                      color: tc.primary[400],
                      fontSize: 14,
                      fontFamily: "DMSans_500Medium",
                      marginTop: 6,
                    }}
                  >
                    {"\u2248"} KSh 1,018.06
                  </Text>
                </View>

                {/* Action buttons */}
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {[
                    { icon: "arrow-down" as const, label: "Deposit", color: tc.primary[500] },
                    { icon: "send" as const, label: "Pay Bill", color: "#3B82F6" },
                    { icon: "swap-horizontal" as const, label: "Send", color: "#8B5CF6" },
                  ].map((action) => (
                    <View
                      key={action.label}
                      style={{
                        flex: 1,
                        alignItems: "center",
                        backgroundColor: tc.dark.bg,
                        borderRadius: 14,
                        paddingVertical: 14,
                        gap: 6,
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.03)",
                      }}
                    >
                      <View
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          backgroundColor: action.color + "18",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name={action.icon} size={18} color={action.color} />
                      </View>
                      <Text
                        style={{
                          color: tc.textSecondary,
                          fontSize: 11,
                          fontFamily: "DMSans_500Medium",
                        }}
                      >
                        {action.label}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* Recent transaction */}
                <View
                  style={{
                    marginTop: 14,
                    backgroundColor: tc.dark.bg,
                    borderRadius: 14,
                    padding: 16,
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.03)",
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <View
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 10,
                          backgroundColor: tc.primary[500] + "18",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name="checkmark-circle" size={17} color={tc.primary[400]} />
                      </View>
                      <View>
                        <Text
                          style={{
                            color: tc.textPrimary,
                            fontSize: 13,
                            fontFamily: "DMSans_600SemiBold",
                          }}
                        >
                          KPLC Paybill
                        </Text>
                        <Text
                          style={{
                            color: tc.textMuted,
                            fontSize: 11,
                            fontFamily: "DMSans_400Regular",
                          }}
                        >
                          Just now
                        </Text>
                      </View>
                    </View>
                    <Text
                      style={{
                        color: tc.primary[400],
                        fontSize: 14,
                        fontFamily: "DMSans_700Bold",
                      }}
                    >
                      KSh 500
                    </Text>
                  </View>
                </View>
              </Pressable>
            </View>
          )}
        </View>
      </RevealOnScroll>

      {/* Trust bar */}
      <RevealOnScroll delay={400}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            flexWrap: "wrap",
            gap: isMobile ? 8 : 20,
            marginTop: isMobile ? 40 : 56,
            paddingHorizontal: 20,
            zIndex: 10,
          }}
        >
          {[
            "KYC Verified",
            "VASP Compliant",
            "M-Pesa Official",
            "SSL Encrypted",
          ].map((badge, i) => (
            <View
              key={badge}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                backgroundColor: "rgba(255,255,255,0.03)",
                borderRadius: 20,
                paddingVertical: 6,
                paddingHorizontal: 14,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.06)",
              }}
            >
              <Ionicons
                name="shield-checkmark"
                size={13}
                color={tc.primary[400]}
              />
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 12,
                  fontFamily: "DMSans_500Medium",
                }}
              >
                {badge}
              </Text>
            </View>
          ))}
        </View>
      </RevealOnScroll>

      {/* Live ticker */}
      <RevealOnScroll delay={600}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            marginTop: isMobile ? 16 : 24,
            paddingHorizontal: 20,
            zIndex: 10,
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: tc.primary[400],
              ...(isWeb
                ? ({ boxShadow: `0 0 8px ${tc.primary[400]}`, animation: "cpay-pulse-green 2s ease-in-out infinite" } as any)
                : {}),
            }}
          />
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 13,
              fontFamily: "DMSans_500Medium",
            }}
          >
            Live on{" "}
            <Text style={{ color: tc.primary[300], fontFamily: "DMSans_700Bold" }}>
              cpay.co.ke
            </Text>
            {" "}{"\u2014"} Try it free
          </Text>
        </View>
      </RevealOnScroll>
    </View>
  );

  // ── NEW: PROBLEM / WHY NOW SECTION ────────────────────────────────────────
  const problemSection = (
    <View
      style={{
        paddingVertical: isMobile ? 40 : 64,
        ...(isWeb
          ? ({
              background: "linear-gradient(180deg, #0A1628 0%, #060E1F 100%)",
            } as any)
          : { backgroundColor: "#0A1628" }),
      }}
    >
      <Section>
        <RevealOnScroll>
          <SectionTitle
            label="Why CryptoPay"
            title="The Fastest Way to Pay Bills with Crypto"
            subtitle="Tired of P2P delays, scams, and manual transfers? There's a better way."
            tc={tc}
            isMobile={isMobile}
          />
        </RevealOnScroll>

        <View
          style={{
            flexDirection: isMobile ? "column" : "row",
            gap: isMobile ? 24 : 32,
            alignItems: "stretch",
          }}
        >
          {/* Left: The Problem */}
          <RevealOnScroll delay={100} style={{ flex: 1 }}>
            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(239, 68, 68, 0.04)",
                borderRadius: 24,
                borderWidth: 1,
                borderColor: "rgba(239, 68, 68, 0.15)",
                padding: isMobile ? 24 : 36,
                ...(isWeb
                  ? ({
                      backdropFilter: "blur(12px)",
                      WebkitBackdropFilter: "blur(12px)",
                    } as any)
                  : {}),
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Ionicons name="close-circle" size={24} color="#EF4444" />
                  <Text
                    style={{
                      color: "#EF4444",
                      fontSize: 18,
                      fontFamily: "DMSans_700Bold",
                    }}
                  >
                    The Old Way
                  </Text>
                </View>
              </View>
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 15,
                  fontFamily: "DMSans_500Medium",
                  lineHeight: 24,
                  marginBottom: 20,
                }}
              >
                Paying a bill with crypto today takes 5 steps and 30+ minutes:
              </Text>
              {[
                "Find a P2P trader on an exchange",
                "Negotiate rate, hope they don't scam you",
                "Send crypto and wait for KES in M-Pesa",
                "Now go to M-Pesa and manually pay the bill",
                "Pray the trader was honest about the rate",
              ].map((step, i) => (
                <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      backgroundColor: "rgba(239, 68, 68, 0.15)",
                      alignItems: "center",
                      justifyContent: "center",
                      marginTop: 1,
                    }}
                  >
                    <Text style={{ color: "#EF4444", fontSize: 12, fontFamily: "DMSans_700Bold" }}>{i + 1}</Text>
                  </View>
                  <Text style={{ color: tc.textSecondary, fontSize: 14, fontFamily: "DMSans_400Regular", lineHeight: 22, flex: 1 }}>
                    {step}
                  </Text>
                </View>
              ))}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                <Ionicons name="time" size={18} color="#EF4444" />
                <Text style={{ color: "#EF4444", fontSize: 16, fontFamily: "DMSans_700Bold" }}>30+ minutes, high risk</Text>
              </View>
              {/* Bitcoin illustration */}
              <View style={{ alignItems: "center", marginTop: 20 }}>
                <SvgImage uri={UNDRAW.bitcoin} size={isDesktop ? 180 : isTablet ? 140 : 100} style={{ opacity: 0.8 }} alt="Old way illustration" />
              </View>
            </View>
          </RevealOnScroll>

          {/* Right: CryptoPay Way */}
          <RevealOnScroll delay={300} style={{ flex: 1 }}>
            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(16, 185, 129, 0.04)",
                borderRadius: 24,
                borderWidth: 1,
                borderColor: "rgba(16, 185, 129, 0.15)",
                padding: isMobile ? 24 : 36,
                ...(isWeb
                  ? ({
                      backdropFilter: "blur(12px)",
                      WebkitBackdropFilter: "blur(12px)",
                      boxShadow: "0 8px 48px rgba(16, 185, 129, 0.06)",
                    } as any)
                  : {}),
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <Ionicons name="flash" size={24} color={tc.primary[400]} />
                <Text
                  style={{
                    color: tc.primary[400],
                    fontSize: 18,
                    fontFamily: "DMSans_700Bold",
                  }}
                >
                  The CryptoPay Way
                </Text>
              </View>
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 15,
                  fontFamily: "DMSans_500Medium",
                  lineHeight: 24,
                  marginBottom: 20,
                }}
              >
                With CryptoPay, it takes 30 seconds:
              </Text>
              {[
                { step: "Enter Paybill/Till number and amount", icon: "receipt" as const },
                { step: "Confirm at a locked rate \u2014 no slippage", icon: "lock-closed" as const },
                { step: "Done. M-Pesa payment delivered instantly.", icon: "checkmark-circle" as const },
              ].map((item, i) => (
                <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      backgroundColor: "rgba(16, 185, 129, 0.15)",
                      alignItems: "center",
                      justifyContent: "center",
                      marginTop: 1,
                      ...(isWeb ? ({ boxShadow: "0 4px 12px rgba(16, 185, 129, 0.15)" } as any) : {}),
                    }}
                  >
                    <Ionicons name={item.icon} size={16} color={tc.primary[400]} />
                  </View>
                  <Text style={{ color: tc.textPrimary, fontSize: 15, fontFamily: "DMSans_500Medium", lineHeight: 24, flex: 1 }}>
                    {item.step}
                  </Text>
                </View>
              ))}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
                <Ionicons name="flash" size={18} color={tc.primary[400]} />
                <Text style={{ color: tc.primary[400], fontSize: 16, fontFamily: "DMSans_700Bold" }}>30 seconds, zero risk</Text>
              </View>

              {/* CryptoPay Way illustration */}
              <View style={{ alignItems: "center", marginTop: 20 }}>
                <SvgImage uri={UNDRAW.creditCard} size={isDesktop ? 180 : isTablet ? 140 : 100} style={{ opacity: 0.85 }} alt="CryptoPay instant payment" />
              </View>
            </View>
          </RevealOnScroll>
        </View>
      </Section>
    </View>
  );

  // ── 2. SOCIAL PROOF / STATS BANNER ──────────────────────────────────────────
  const statsSection = (
    <View
      style={{
        paddingVertical: isMobile ? 32 : 48,
        backgroundColor: tc.dark.bg,
      }}
    >
      <Section>
        <RevealOnScroll>
          <View
            style={{
              backgroundColor: "rgba(16, 185, 129, 0.04)",
              borderRadius: 24,
              borderWidth: 1,
              borderColor: "rgba(16, 185, 129, 0.12)",
              padding: isMobile ? 28 : 48,
              ...(isWeb
                ? ({
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    boxShadow: "0 8px 48px rgba(16, 185, 129, 0.06)",
                  } as any)
                : {}),
            }}
          >
            {/* Headline stat */}
            <View style={{ alignItems: "center", marginBottom: isMobile ? 28 : 36 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <Image
                  source={{ uri: KENYA_FLAG }}
                  style={{ width: 28, height: 20, borderRadius: 3 }}
                />
                <Text
                  style={{
                    color: tc.primary[400],
                    fontSize: 13,
                    fontFamily: "DMSans_700Bold",
                    textTransform: "uppercase",
                    letterSpacing: 2,
                  }}
                >
                  Kenya Crypto Adoption
                </Text>
              </View>
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: isMobile ? 20 : 24,
                  fontFamily: "DMSans_600SemiBold",
                  textAlign: "center",
                  lineHeight: isMobile ? 28 : 34,
                  maxWidth: 680,
                }}
              >
                730K+ Kenyans use crypto. None can pay their electricity bill with it.{" "}
                <Text style={{ color: tc.primary[400], fontFamily: "DMSans_700Bold" }}>
                  Until now.
                </Text>
              </Text>
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 12,
                  fontFamily: "DMSans_400Regular",
                  marginTop: 8,
                }}
              >
                Source: Chainalysis Global Crypto Adoption Index
              </Text>
            </View>

            {/* Divider */}
            <View
              style={{
                height: 1,
                backgroundColor: "rgba(16, 185, 129, 0.1)",
                marginBottom: isMobile ? 28 : 36,
              }}
            />

            {/* Key value propositions + real stat */}
            <View
              ref={usersCounter.viewRef as any}
              style={{
                flexDirection: isMobile ? "column" : "row",
                justifyContent: "space-around",
                gap: isMobile ? 24 : 16,
                marginBottom: isMobile ? 28 : 36,
              }}
            >
              <View style={{ alignItems: "center" }}>
                <Ionicons name="flash" size={isMobile ? 28 : 34} color={tc.primary[400]} style={{ marginBottom: 6 }} />
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: isMobile ? 18 : 22,
                    fontFamily: "DMSans_700Bold",
                    letterSpacing: -0.5,
                    marginBottom: 4,
                  }}
                >
                  Instant Settlement
                </Text>
                <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_500Medium" }}>
                  No waiting for P2P
                </Text>
              </View>
              <View style={{ alignItems: "center" }}>
                <Ionicons name="eye" size={isMobile ? 28 : 34} color={tc.primary[400]} style={{ marginBottom: 6 }} />
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: isMobile ? 18 : 22,
                    fontFamily: "DMSans_700Bold",
                    letterSpacing: -0.5,
                    marginBottom: 4,
                  }}
                >
                  Transparent Fees
                </Text>
                <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_500Medium" }}>
                  1.5% + KES 10, that's it
                </Text>
              </View>
              <View style={{ alignItems: "center" }}>
                <Text
                  style={{
                    color: tc.primary[400],
                    fontSize: isMobile ? 30 : 38,
                    fontFamily: "DMSans_700Bold",
                    letterSpacing: -0.5,
                    marginBottom: 4,
                  }}
                >
                  {usersCounter.count.toLocaleString()}K+
                </Text>
                <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_500Medium" }}>
                  Crypto Users in Kenya
                </Text>
              </View>
            </View>

            {/* Divider */}
            <View
              style={{
                height: 1,
                backgroundColor: "rgba(16, 185, 129, 0.1)",
                marginBottom: isMobile ? 28 : 36,
              }}
            />

            {/* Static stats grid */}
            <View
              style={{
                flexDirection: isMobile ? "column" : "row",
                justifyContent: "space-around",
                gap: isMobile ? 24 : 16,
              }}
            >
              {STATS.map((stat) => (
                <View key={stat.label} style={{ alignItems: "center" }}>
                  <Text
                    style={{
                      color: tc.primary[400],
                      fontSize: isMobile ? 30 : 38,
                      fontFamily: "DMSans_700Bold",
                      letterSpacing: -0.5,
                      marginBottom: 4,
                    }}
                  >
                    {stat.value}
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 14,
                      fontFamily: "DMSans_500Medium",
                    }}
                  >
                    {stat.label}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </RevealOnScroll>
      </Section>
    </View>
  );

  // ── 3. SUPPORTED SERVICES (Sliding Carousel) ──────────────────────────────
  const serviceCard = (service: typeof KENYAN_SERVICES[0], idx: number) => (
    <Pressable
      key={`${service.name}-${idx}`}
      style={({ hovered }: any) => ({
        alignItems: "center",
        backgroundColor: isWeb && hovered ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)",
        borderRadius: 16,
        borderWidth: 1,
        borderColor: isWeb && hovered ? service.color + "40" : "rgba(255,255,255,0.06)",
        paddingVertical: isMobile ? 16 : 20,
        paddingHorizontal: isMobile ? 16 : 24,
        minWidth: isMobile ? 120 : 150,
        marginRight: isMobile ? 12 : 16,
        ...(isWeb
          ? ({
              transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
              cursor: "default",
              boxShadow: hovered ? `0 4px 20px ${service.color}15` : "none",
            } as any)
          : {}),
      }) as any}
    >
      <Image
        source={service.logo}
        style={{
          width: isMobile ? 40 : 48,
          height: isMobile ? 40 : 48,
          borderRadius: isMobile ? 12 : 14,
          marginBottom: 10,
        }}
        resizeMode="contain"
      />
      <Text
        style={{
          color: tc.textPrimary,
          fontSize: isMobile ? 11 : 13,
          fontFamily: "DMSans_600SemiBold",
          textAlign: "center",
        }}
        numberOfLines={1}
      >
        {service.name}
      </Text>
      <Text
        style={{
          color: tc.textMuted,
          fontSize: isMobile ? 10 : 11,
          fontFamily: "DMSans_400Regular",
          marginTop: 2,
        }}
      >
        {service.desc}
      </Text>
    </Pressable>
  );

  // Double the services array for seamless infinite scroll (exactly 2x for translateX(-50%))
  const row1 = KENYAN_SERVICES.slice(0, 6);
  const row2 = KENYAN_SERVICES.slice(6);
  const doubledRow1 = [...row1, ...row1];
  const doubledRow2 = [...row2, ...row2];

  const servicesSection = (
    <View
      style={{
        paddingVertical: isMobile ? 40 : 64,
        ...(isWeb
          ? ({
              background: "linear-gradient(180deg, #060E1F 0%, #0A1628 100%)",
            } as any)
          : { backgroundColor: "#0A1628" }),
      }}
    >
      <Section>
        <RevealOnScroll>
          <SectionTitle
            label="Supported Services"
            title="Pay Any Bill in Kenya"
            subtitle="From electricity to school fees, pay any Paybill or Till number in Kenya directly with crypto."
            tc={tc}
            isMobile={isMobile}
          />
        </RevealOnScroll>

        {/* Carousel - web uses CSS animation, native uses ScrollView */}
        {isWeb ? (
          <RevealOnScroll>
            <View style={{ overflow: "hidden", width: "100%" } as any}>
              {/* Row 1 */}
              <View
                style={{
                  overflow: "hidden",
                  marginBottom: 16,
                } as any}
              >
                <View
                  ref={(ref: any) => {
                    if (isWeb && ref instanceof HTMLElement) ref.className = "cpay-carousel-track";
                  }}
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    animation: "cpay-scroll-left 35s linear infinite",
                    width: "max-content",
                  } as any}
                >
                  {doubledRow1.map((s, i) => serviceCard(s, i))}
                </View>
              </View>
              {/* Row 2 (desktop only) */}
              {!isMobile && (
                <View
                  style={{
                    overflow: "hidden",
                  } as any}
                >
                  <View
                    ref={(ref: any) => {
                      if (isWeb && ref instanceof HTMLElement) ref.className = "cpay-carousel-track";
                    }}
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      animation: "cpay-scroll-left 30s linear infinite reverse",
                      width: "max-content",
                    } as any}
                  >
                    {doubledRow2.map((s, i) => serviceCard(s, i + 100))}
                  </View>
                </View>
              )}
            </View>
          </RevealOnScroll>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 12, gap: 12 }}
          >
            {KENYAN_SERVICES.map((s, i) => serviceCard(s, i))}
          </ScrollView>
        )}
      </Section>
    </View>
  );

  // ── 4. HOW IT WORKS ────────────────────────────────────────────────────────
  const howItWorksSection = (
    <View
      ref={(ref) => { sectionRefs.current["howItWorks"] = ref; }}
      style={{
        paddingVertical: isMobile ? 40 : 64,
        backgroundColor: tc.dark.bg,
      }}
    >
      <Section>
        <RevealOnScroll>
          <View style={{ flexDirection: isDesktop ? "row" : "column", alignItems: "center", justifyContent: "center", gap: isDesktop ? 40 : 16 }}>
            <View style={{ flex: isDesktop ? 1 : undefined }}>
              <SectionTitle
                label="How It Works"
                title="Three Steps. Thirty Seconds."
                subtitle="No P2P matching. No waiting. No counterparty risk."
                tc={tc}
                isMobile={isMobile}
              />
            </View>
            <SvgImage uri={UNDRAW.fastLoading} size={isDesktop ? 180 : isTablet ? 140 : 100} style={{ opacity: 0.75 }} alt="Fast loading illustration" />
          </View>
        </RevealOnScroll>

        <View
          style={{
            flexDirection: isMobile ? "column" : "row",
            gap: isMobile ? 24 : 32,
            alignItems: "stretch",
            justifyContent: "center",
            width: "100%",
            position: "relative",
          }}
        >
          {/* Connecting line (desktop only) */}
          {isDesktop && isWeb && (
            <View
              style={{
                position: "absolute",
                top: 60,
                left: "18%",
                right: "18%",
                height: 2,
                zIndex: 0,
                ...(isWeb
                  ? ({
                      background: "linear-gradient(90deg, rgba(16,185,129,0.15) 0%, rgba(16,185,129,0.3) 50%, rgba(16,185,129,0.15) 100%)",
                    } as any)
                  : { backgroundColor: "rgba(16, 185, 129, 0.15)" }),
              }}
            />
          )}

          {[
            {
              num: "01",
              icon: "wallet" as const,
              title: "Deposit Crypto",
              desc: "Send USDT, BTC, ETH or SOL to your personal CryptoPay wallet address. Each chain has a unique deposit address.",
            },
            {
              num: "02",
              icon: "receipt" as const,
              title: "Enter Payment Details",
              desc: "Choose Paybill, Till number, or phone number. See the exact amount with a locked 90-second rate quote.",
            },
            {
              num: "03",
              icon: "flash" as const,
              title: "Instant M-Pesa Delivery",
              desc: "Confirm with your PIN. Payment arrives via M-Pesa in under 30 seconds. Get a receipt instantly.",
            },
          ].map((step, i) => (
            <RevealOnScroll key={step.num} delay={i * 200} style={{ flex: 1, zIndex: 1 }}>
              <View
                style={{
                  width: "100%",
                  backgroundColor: tc.glass.bg,
                  borderRadius: 24,
                  borderWidth: 1,
                  borderColor: tc.glass.border,
                  padding: isMobile ? 24 : 32,
                  alignItems: "center",
                  ...(isWeb
                    ? ({
                        backdropFilter: "blur(16px)",
                        WebkitBackdropFilter: "blur(16px)",
                        transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                      } as any)
                    : {}),
                }}
              >
                {/* Large step number */}
                <Text
                  style={{
                    color: tc.primary[500] + "25",
                    fontSize: 72,
                    fontFamily: "DMSans_700Bold",
                    letterSpacing: -2,
                    lineHeight: 72,
                    marginBottom: -8,
                  }}
                >
                  {step.num}
                </Text>

                {/* Step icon */}
                <View
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 20,
                    backgroundColor: "rgba(16, 185, 129, 0.1)",
                    borderWidth: 1,
                    borderColor: "rgba(16, 185, 129, 0.2)",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 20,
                    ...(isWeb
                      ? ({
                          boxShadow: "0 8px 32px rgba(16, 185, 129, 0.12)",
                        } as any)
                      : {}),
                  }}
                >
                  <Ionicons name={step.icon} size={28} color={tc.primary[400]} />
                </View>

                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: 20,
                    fontFamily: "DMSans_700Bold",
                    textAlign: "center",
                    marginBottom: 10,
                  }}
                >
                  {step.title}
                </Text>
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 15,
                    fontFamily: "DMSans_400Regular",
                    textAlign: "center",
                    lineHeight: 23,
                    maxWidth: 300,
                  }}
                >
                  {step.desc}
                </Text>
              </View>
            </RevealOnScroll>
          ))}
        </View>
      </Section>
    </View>
  );

  // ── 5. SUPPORTED CRYPTO (Enhanced with hover/bob) ────────────────────────
  const cryptoSection = (
    <View
      style={{
        paddingVertical: isMobile ? 32 : 48,
        ...(isWeb
          ? ({
              background: "linear-gradient(180deg, #060E1F 0%, #0A1628 100%)",
            } as any)
          : { backgroundColor: "#0A1628" }),
      }}
    >
      <Section>
        <RevealOnScroll>
          <View style={{ flexDirection: isDesktop ? "row" : "column", alignItems: "center", justifyContent: "space-between", gap: isDesktop ? 0 : 16 }}>
            <SvgImage uri={UNDRAW.finance} size={isDesktop ? 180 : isTablet ? 140 : 100} style={{ opacity: 0.75 }} alt="Crypto chains illustration" />
            <View style={{ flex: 1 }}>
              <SectionTitle
                label="Supported Cryptocurrencies"
                title="Five Chains. Your Choice."
                tc={tc}
                isMobile={isMobile}
              />
            </View>
          </View>
        </RevealOnScroll>

        <View
          style={{
            flexDirection: isMobile ? "column" : "row",
            gap: isMobile ? 12 : 16,
            justifyContent: "center",
            alignItems: "stretch",
          }}
        >
          {COIN_ICONS.map((coin, i) => (
            <RevealOnScroll key={coin.key} delay={i * 100} style={{ flex: isMobile ? undefined : 1 }}>
              <Pressable
                style={({ hovered }: any) => ({
                  backgroundColor: tc.glass.bg,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: isWeb && hovered ? coin.color + "40" : tc.glass.border,
                  padding: isMobile ? 16 : 24,
                  alignItems: "center",
                  ...(isWeb
                    ? ({
                        backdropFilter: "blur(12px)",
                        WebkitBackdropFilter: "blur(12px)",
                        transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1), transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                        boxShadow: hovered
                          ? `0 12px 40px ${coin.color}30, 0 0 0 1px ${coin.color}20`
                          : `0 4px 24px ${coin.color}10`,
                        transform: hovered ? "translateY(-8px)" : "translateY(0)",
                        cursor: "default",
                        animation: `cpay-float-bob ${3 + i * 0.5}s ease-in-out infinite ${i * 0.3}s`,
                      } as any)
                    : {}),
                }) as any}
              >
                {/* Glow ring around coin logo */}
                <View
                  style={{
                    width: isMobile ? 56 : 64,
                    height: isMobile ? 56 : 64,
                    borderRadius: isMobile ? 28 : 32,
                    backgroundColor: coin.color + "10",
                    borderWidth: 2,
                    borderColor: coin.color + "30",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 14,
                    ...(isWeb
                      ? ({
                          boxShadow: `0 0 20px ${coin.color}25, inset 0 0 12px ${coin.color}10`,
                        } as any)
                      : {}),
                  }}
                >
                  <Image
                    source={{ uri: coin.uri }}
                    style={{
                      width: isMobile ? 28 : 32,
                      height: isMobile ? 28 : 32,
                    }}
                  />
                </View>
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: 16,
                    fontFamily: "DMSans_700Bold",
                    marginBottom: 4,
                  }}
                >
                  {coin.name}
                </Text>
                {/* Network badge */}
                <View
                  style={{
                    backgroundColor: coin.color + "15",
                    borderRadius: 8,
                    paddingVertical: 4,
                    paddingHorizontal: 12,
                    borderWidth: 1,
                    borderColor: coin.color + "20",
                  }}
                >
                  <Text
                    style={{
                      color: coin.color,
                      fontSize: 11,
                      fontFamily: "DMSans_600SemiBold",
                    }}
                  >
                    {coin.network}
                  </Text>
                </View>
              </Pressable>
            </RevealOnScroll>
          ))}
        </View>
      </Section>
    </View>
  );

  // ── 6. FEATURES GRID ──────────────────────────────────────────────────────
  const featuresSection = (
    <View
      ref={(ref) => { sectionRefs.current["features"] = ref; }}
      accessibilityLabel="CryptoPay features"
      style={{
        paddingVertical: isMobile ? 40 : 64,
        backgroundColor: tc.dark.bg,
      }}
    >
      <Section>
        <RevealOnScroll>
          <View style={{ flexDirection: isDesktop ? "row" : "column", alignItems: "center", justifyContent: "center", gap: isDesktop ? 40 : 16 }}>
            <View style={{ flex: isDesktop ? 1 : undefined }}>
              <SectionTitle
                label="Features"
                title="Everything You Need to Pay Bills with Crypto"
                tc={tc}
                isMobile={isMobile}
              />
            </View>
            <SvgImage uri={UNDRAW.wallet} size={isDesktop ? 180 : isTablet ? 140 : 100} style={{ opacity: 0.75 }} alt="Wallet illustration" />
          </View>
        </RevealOnScroll>

        <View
          style={{
            ...(isWeb
              ? ({
                  display: "grid" as any,
                  gridTemplateColumns: isMobile ? "1fr" : isTablet ? "1fr 1fr" : "1fr 1fr 1fr",
                  gap: isMobile ? 16 : 24,
                } as any)
              : {
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 16,
                }),
          }}
        >
          {FEATURES.map((feat, i) => (
            <RevealOnScroll key={feat.title} delay={i * 100}>
              <TiltCard
                style={{
                  height: "100%",
                }}
              >
                <View
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 16,
                    backgroundColor: "rgba(16, 185, 129, 0.08)",
                    borderWidth: 1,
                    borderColor: "rgba(16, 185, 129, 0.15)",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 18,
                    ...(isWeb
                      ? ({
                          boxShadow: "0 4px 16px rgba(16, 185, 129, 0.1)",
                        } as any)
                      : {}),
                  }}
                >
                  <Ionicons name={feat.icon} size={24} color={tc.primary[400]} />
                </View>
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: 18,
                    fontFamily: "DMSans_700Bold",
                    marginBottom: 8,
                  }}
                >
                  {feat.title}
                </Text>
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 14,
                    fontFamily: "DMSans_400Regular",
                    lineHeight: 22,
                  }}
                >
                  {feat.desc}
                </Text>
              </TiltCard>
            </RevealOnScroll>
          ))}
        </View>
      </Section>
    </View>
  );

  // ── 7. PRICING / FEE TRANSPARENCY ─────────────────────────────────────────
  const pricingSection = (
    <View
      ref={(ref) => { sectionRefs.current["pricing"] = ref; }}
      style={{
        paddingVertical: isMobile ? 40 : 64,
        ...(isWeb
          ? ({
              background: "linear-gradient(180deg, #0A1628 0%, #060E1F 100%)",
            } as any)
          : { backgroundColor: "#0A1628" }),
      }}
    >
      <Section>
        <RevealOnScroll>
          <View style={{ flexDirection: isDesktop ? "row" : "column", alignItems: "center", justifyContent: "space-between", gap: isDesktop ? 0 : 16 }}>
            <SvgImage uri={UNDRAW.revenue} size={isDesktop ? 180 : isTablet ? 140 : 100} style={{ opacity: 0.8 }} alt="Pricing illustration" />
            <View style={{ flex: 1 }}>
              <SectionTitle
                label="Pricing"
                title="Simple, Transparent Pricing"
                subtitle="No hidden fees. The rate you see is the rate you get, locked for 30 seconds."
                tc={tc}
                isMobile={isMobile}
              />
            </View>
          </View>
        </RevealOnScroll>

        <RevealOnScroll delay={200}>
          {/* Main pricing card */}
          <View
            style={{
              backgroundColor: tc.glass.bg,
              borderRadius: 28,
              borderWidth: 1,
              borderColor: "rgba(16, 185, 129, 0.15)",
              padding: isMobile ? 28 : 48,
              alignItems: "center",
              marginBottom: 32,
              ...(isWeb
                ? ({
                    backdropFilter: "blur(20px)",
                    WebkitBackdropFilter: "blur(20px)",
                    boxShadow: "0 8px 48px rgba(16, 185, 129, 0.06)",
                  } as any)
                : {}),
            }}
          >
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: isMobile ? 28 : 40,
                fontFamily: "DMSans_700Bold",
                textAlign: "center",
                letterSpacing: -1,
                marginBottom: 8,
              }}
            >
              1.5%{" "}
              <Text style={{ color: tc.textSecondary, fontSize: isMobile ? 18 : 22, fontFamily: "DMSans_400Regular" }}>
                conversion spread
              </Text>
            </Text>
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: isMobile ? 18 : 22,
                fontFamily: "DMSans_400Regular",
                textAlign: "center",
                marginBottom: 4,
              }}
            >
              + KES 10 flat fee per transaction
            </Text>
            <Text
              style={{
                color: tc.primary[400],
                fontSize: 16,
                fontFamily: "DMSans_600SemiBold",
                marginTop: 16,
              }}
            >
              That's it.
            </Text>

            {/* Try free badge */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                marginTop: 20,
                backgroundColor: "rgba(16, 185, 129, 0.08)",
                borderRadius: 24,
                paddingVertical: 10,
                paddingHorizontal: 20,
                borderWidth: 1,
                borderColor: "rgba(16, 185, 129, 0.2)",
                ...(isWeb
                  ? ({
                      backdropFilter: "blur(8px)",
                      WebkitBackdropFilter: "blur(8px)",
                      boxShadow: "0 4px 16px rgba(16, 185, 129, 0.08)",
                    } as any)
                  : {}),
              }}
            >
              <Ionicons name="gift" size={18} color={tc.primary[400]} />
              <Text
                style={{
                  color: tc.primary[300],
                  fontSize: 14,
                  fontFamily: "DMSans_600SemiBold",
                }}
              >
                First KES 5,000 — zero fees
              </Text>
            </View>
          </View>
        </RevealOnScroll>

        {/* Comparison row */}
        <RevealOnScroll delay={400}>
          <View
            style={{
              flexDirection: isMobile ? "column" : "row",
              gap: isMobile ? 12 : 20,
              justifyContent: "center",
            }}
          >
            {[
              { name: "CryptoPay", fee: "1.5%", highlight: true, icon: "flash" as const },
              { name: "Binance P2P", fee: "3-8%", highlight: false, icon: "swap-horizontal" as const },
              { name: "Manual OTC", fee: "5-10%", highlight: false, icon: "people" as const },
            ].map((item) => (
              <View
                key={item.name}
                style={{
                  flex: isMobile ? undefined : 1,
                  backgroundColor: item.highlight
                    ? "rgba(16, 185, 129, 0.06)"
                    : "rgba(255,255,255,0.02)",
                  borderRadius: 20,
                  borderWidth: item.highlight ? 2 : 1,
                  borderColor: item.highlight
                    ? "rgba(16, 185, 129, 0.25)"
                    : "rgba(255,255,255,0.06)",
                  padding: 24,
                  alignItems: "center",
                  ...(isWeb && item.highlight
                    ? ({
                        boxShadow: "0 4px 24px rgba(16, 185, 129, 0.1)",
                      } as any)
                    : {}),
                }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    backgroundColor: item.highlight ? tc.primary[500] + "20" : "rgba(255,255,255,0.04)",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 14,
                  }}
                >
                  <Ionicons
                    name={item.icon}
                    size={22}
                    color={item.highlight ? tc.primary[400] : tc.textMuted}
                  />
                </View>
                <Text
                  style={{
                    color: item.highlight ? tc.primary[400] : tc.textSecondary,
                    fontSize: 14,
                    fontFamily: "DMSans_600SemiBold",
                    marginBottom: 6,
                  }}
                >
                  {item.name}
                </Text>
                <Text
                  style={{
                    color: item.highlight ? tc.textPrimary : tc.textMuted,
                    fontSize: 28,
                    fontFamily: "DMSans_700Bold",
                    letterSpacing: -0.5,
                  }}
                >
                  {item.fee}
                </Text>
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 12,
                    fontFamily: "DMSans_400Regular",
                    marginTop: 4,
                  }}
                >
                  typical fees
                </Text>
              </View>
            ))}
          </View>
        </RevealOnScroll>
      </Section>
    </View>
  );

  // ── 8. COMPARISON TABLE ────────────────────────────────────────────────────
  const comparisonSection = (
    <View
      style={{
        paddingVertical: isMobile ? 40 : 64,
        backgroundColor: tc.dark.bg,
      }}
    >
      <Section>
        <RevealOnScroll>
          <View style={{ flexDirection: isDesktop ? "row" : "column", alignItems: "center", justifyContent: "space-between", gap: isDesktop ? 0 : 16 }}>
            <SvgImage uri={UNDRAW.pieChart} size={isDesktop ? 180 : isTablet ? 140 : 100} style={{ opacity: 0.8 }} alt="Comparison illustration" />
            <View style={{ flex: 1 }}>
              <SectionTitle
                label="Compare"
                title="Why CryptoPay vs P2P Trading?"
                subtitle="Side-by-side comparison so you can decide for yourself."
                tc={tc}
                isMobile={isMobile}
              />
            </View>
          </View>
        </RevealOnScroll>

        <RevealOnScroll delay={200}>
          <ScrollView
            horizontal={isMobile}
            showsHorizontalScrollIndicator={false}
          >
            <View
              style={{
                minWidth: isMobile ? 640 : ("100%" as any),
                backgroundColor: tc.glass.bg,
                borderRadius: 24,
                borderWidth: 1,
                borderColor: tc.glass.border,
                overflow: "hidden",
                ...(isWeb
                  ? ({
                      backdropFilter: "blur(16px)",
                      WebkitBackdropFilter: "blur(16px)",
                    } as any)
                  : {}),
              }}
            >
              {/* Header row */}
              <View
                style={{
                  flexDirection: "row",
                  borderBottomWidth: 1,
                  borderBottomColor: "rgba(255,255,255,0.06)",
                }}
              >
                <View style={{ flex: 1.3, padding: 18 }}>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 12,
                      fontFamily: "DMSans_700Bold",
                      textTransform: "uppercase",
                      letterSpacing: 1.5,
                    }}
                  >
                    Feature
                  </Text>
                </View>
                <View
                  style={{
                    flex: 1.2,
                    padding: 18,
                    backgroundColor: "rgba(16, 185, 129, 0.06)",
                    borderLeftWidth: 1,
                    borderLeftColor: "rgba(16, 185, 129, 0.12)",
                    borderRightWidth: 1,
                    borderRightColor: "rgba(16, 185, 129, 0.12)",
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="flash" size={14} color={tc.primary[400]} />
                    <Text
                      style={{
                        color: tc.primary[400],
                        fontSize: 14,
                        fontFamily: "DMSans_700Bold",
                      }}
                    >
                      CryptoPay
                    </Text>
                  </View>
                </View>
                <View style={{ flex: 1, padding: 18 }}>
                  <Text
                    style={{
                      color: tc.textSecondary,
                      fontSize: 14,
                      fontFamily: "DMSans_600SemiBold",
                    }}
                  >
                    Binance P2P
                  </Text>
                </View>
                <View style={{ flex: 1, padding: 18 }}>
                  <Text
                    style={{
                      color: tc.textSecondary,
                      fontSize: 14,
                      fontFamily: "DMSans_600SemiBold",
                    }}
                  >
                    Manual OTC
                  </Text>
                </View>
              </View>

              {/* Data rows */}
              {COMPARISON_ROWS.map((row, i) => (
                <View
                  key={row.label}
                  style={{
                    flexDirection: "row",
                    borderBottomWidth: i < COMPARISON_ROWS.length - 1 ? 1 : 0,
                    borderBottomColor: "rgba(255,255,255,0.04)",
                  }}
                >
                  <View style={{ flex: 1.3, padding: 16, justifyContent: "center" }}>
                    <Text
                      style={{
                        color: tc.textPrimary,
                        fontSize: 14,
                        fontFamily: "DMSans_500Medium",
                      }}
                    >
                      {row.label}
                    </Text>
                  </View>
                  <View
                    style={{
                      flex: 1.2,
                      padding: 16,
                      backgroundColor: "rgba(16, 185, 129, 0.03)",
                      borderLeftWidth: 1,
                      borderLeftColor: "rgba(16, 185, 129, 0.08)",
                      borderRightWidth: 1,
                      borderRightColor: "rgba(16, 185, 129, 0.08)",
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <Ionicons
                      name={row.cpIcon}
                      size={15}
                      color={tc.primary[400]}
                    />
                    <Text
                      style={{
                        color: tc.primary[300],
                        fontSize: 14,
                        fontFamily: "DMSans_600SemiBold",
                        flex: 1,
                      }}
                    >
                      {row.cp}
                    </Text>
                  </View>
                  <View style={{ flex: 1, padding: 16, justifyContent: "center" }}>
                    <Text
                      style={{
                        color: tc.textMuted,
                        fontSize: 14,
                        fontFamily: "DMSans_400Regular",
                      }}
                    >
                      {row.p2p}
                    </Text>
                  </View>
                  <View style={{ flex: 1, padding: 16, justifyContent: "center" }}>
                    <Text
                      style={{
                        color: tc.textMuted,
                        fontSize: 14,
                        fontFamily: "DMSans_400Regular",
                      }}
                    >
                      {row.otc}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>

          {isMobile && (
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 11,
                fontFamily: "DMSans_400Regular",
                textAlign: "center",
                marginTop: 12,
              }}
            >
              Swipe to see full comparison {"\u2192"}
            </Text>
          )}
        </RevealOnScroll>
      </Section>
    </View>
  );

  // ── PLATFORM STATS (Live Data) ────────────────────────────────────────────
  const platformStatsSection = (
    <View
      style={{
        paddingVertical: isMobile ? 40 : 64,
        ...(isWeb
          ? ({
              background: "linear-gradient(180deg, #060E1F 0%, #0A1628 100%)",
            } as any)
          : { backgroundColor: "#060E1F" }),
      }}
    >
      <Section>
        <RevealOnScroll>
          <SectionTitle
            label="Platform Stats"
            title="Real-Time Platform Data"
            subtitle="Live numbers powering your payments."
            tc={tc}
            isMobile={isMobile}
          />
        </RevealOnScroll>

        <RevealOnScroll delay={200}>
          <View
            style={{
              flexDirection: isMobile ? "column" : "row",
              gap: isMobile ? 16 : 24,
              justifyContent: "center",
            }}
          >
            {/* Card 1: Live USDT Rate */}
            <View
              style={{
                flex: isMobile ? undefined : 1,
                backgroundColor: tc.glass.bg,
                borderRadius: 24,
                borderWidth: 1,
                borderColor: "rgba(16, 185, 129, 0.15)",
                padding: isMobile ? 24 : 32,
                alignItems: "center",
                ...(isWeb
                  ? ({
                      backdropFilter: "blur(16px)",
                      WebkitBackdropFilter: "blur(16px)",
                      boxShadow: "0 8px 32px rgba(16, 185, 129, 0.06)",
                      transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                    } as any)
                  : {}),
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: "#10B981",
                    ...(isWeb
                      ? ({
                          animation: "cpay-pulse-green 2s ease-in-out infinite",
                        } as any)
                      : {}),
                  }}
                />
                <View
                  style={{
                    backgroundColor: "rgba(16, 185, 129, 0.12)",
                    borderRadius: 8,
                    paddingVertical: 3,
                    paddingHorizontal: 8,
                  }}
                >
                  <Text style={{ color: "#10B981", fontSize: 10, fontFamily: "DMSans_700Bold", letterSpacing: 1.5, textTransform: "uppercase" }}>
                    LIVE
                  </Text>
                </View>
              </View>
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 18,
                  backgroundColor: "rgba(16, 185, 129, 0.1)",
                  borderWidth: 1,
                  borderColor: "rgba(16, 185, 129, 0.2)",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 16,
                }}
              >
                <Ionicons name="trending-up" size={28} color={tc.primary[400]} />
              </View>
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: isMobile ? 26 : 32,
                  fontFamily: "DMSans_700Bold",
                  letterSpacing: -0.5,
                  marginBottom: 6,
                }}
              >
                {liveRate}
              </Text>
              <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_500Medium" }}>
                USDT/KES Exchange Rate
              </Text>
              <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular", marginTop: 4, opacity: 0.7 }}>
                via CoinGecko
              </Text>
            </View>

            {/* Card 2: Supported Chains */}
            <View
              style={{
                flex: isMobile ? undefined : 1,
                backgroundColor: tc.glass.bg,
                borderRadius: 24,
                borderWidth: 1,
                borderColor: tc.glass.border,
                padding: isMobile ? 24 : 32,
                alignItems: "center",
                ...(isWeb
                  ? ({
                      backdropFilter: "blur(16px)",
                      WebkitBackdropFilter: "blur(16px)",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
                      transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                    } as any)
                  : {}),
              }}
            >
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 18,
                  backgroundColor: "rgba(99, 102, 241, 0.1)",
                  borderWidth: 1,
                  borderColor: "rgba(99, 102, 241, 0.2)",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 16,
                  marginTop: isMobile ? 0 : 34,
                }}
              >
                <Ionicons name="layers" size={28} color="#818CF8" />
              </View>
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: isMobile ? 26 : 32,
                  fontFamily: "DMSans_700Bold",
                  letterSpacing: -0.5,
                  marginBottom: 6,
                }}
              >
                5 Chains
              </Text>
              <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_500Medium" }}>
                Supported Blockchains
              </Text>
              <View style={{ flexDirection: "row", gap: 6, marginTop: 12, flexWrap: "wrap", justifyContent: "center" }}>
                {COIN_ICONS.map((coin) => (
                  <Image
                    key={coin.key}
                    source={{ uri: coin.uri }}
                    style={{ width: 24, height: 24, borderRadius: 12 }}
                  />
                ))}
              </View>
            </View>

            {/* Card 3: Payment Speed */}
            <View
              style={{
                flex: isMobile ? undefined : 1,
                backgroundColor: tc.glass.bg,
                borderRadius: 24,
                borderWidth: 1,
                borderColor: tc.glass.border,
                padding: isMobile ? 24 : 32,
                alignItems: "center",
                ...(isWeb
                  ? ({
                      backdropFilter: "blur(16px)",
                      WebkitBackdropFilter: "blur(16px)",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
                      transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                    } as any)
                  : {}),
              }}
            >
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 18,
                  backgroundColor: "rgba(245, 158, 11, 0.1)",
                  borderWidth: 1,
                  borderColor: "rgba(245, 158, 11, 0.2)",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 16,
                  marginTop: isMobile ? 0 : 34,
                }}
              >
                <Ionicons name="flash" size={28} color="#F59E0B" />
              </View>
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: isMobile ? 26 : 32,
                  fontFamily: "DMSans_700Bold",
                  letterSpacing: -0.5,
                  marginBottom: 6,
                }}
              >
                {"< 30s"}
              </Text>
              <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_500Medium" }}>
                Average Payment Speed
              </Text>
              <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular", marginTop: 4, opacity: 0.7 }}>
                Crypto to M-Pesa delivery
              </Text>
            </View>
          </View>
        </RevealOnScroll>
      </Section>
    </View>
  );

  // ── TRUSTED TECHNOLOGY (Partner Logos) ──────────────────────────────────────
  const partnerLogosSection = (
    <View
      style={{
        paddingVertical: isMobile ? 32 : 48,
        backgroundColor: tc.dark.bg,
      }}
    >
      <Section>
        <RevealOnScroll>
          <View style={{ alignItems: "center", marginBottom: isMobile ? 28 : 40 }}>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 12,
                fontFamily: "DMSans_700Bold",
                textTransform: "uppercase",
                letterSpacing: 3,
                marginBottom: 8,
              }}
            >
              Trusted Technology
            </Text>
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: isMobile ? 14 : 15,
                fontFamily: "DMSans_400Regular",
                textAlign: "center",
              }}
            >
              Built on industry-leading infrastructure
            </Text>
          </View>
        </RevealOnScroll>

        <RevealOnScroll delay={100}>
          <View
            style={{
              flexDirection: isMobile ? "column" : "row",
              gap: isMobile ? 12 : 16,
              justifyContent: "center",
              alignItems: "stretch",
              flexWrap: "wrap",
            }}
          >
            {[
              { logo: PARTNER_LOGOS.smileIdentity, label: "Smile Identity", color: "#10B981", desc: "KYC Verification" },
              { logo: PARTNER_LOGOS.coingecko, label: "CoinGecko", color: "#F59E0B", desc: "Live Rates" },
              { logo: PARTNER_LOGOS.mpesa, label: "M-Pesa", color: "#00A650", desc: "Payments" },
              { logo: PARTNER_LOGOS.sentry, label: "Sentry", color: "#6366F1", desc: "Error Tracking" },
            ].map((partner) => (
              <View
                key={partner.label}
                style={{
                  width: isMobile ? "47%" : undefined,
                  flex: isMobile ? undefined : 1,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  backgroundColor: tc.glass.bg,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: tc.glass.border,
                  paddingVertical: 14,
                  paddingHorizontal: 16,
                  ...(isWeb
                    ? ({
                        backdropFilter: "blur(12px)",
                        WebkitBackdropFilter: "blur(12px)",
                        transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                      } as any)
                    : {}),
                }}
              >
                <Image
                  source={partner.logo}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                  }}
                  resizeMode="contain"
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 13,
                      fontFamily: "DMSans_600SemiBold",
                    }}
                  >
                    {partner.label}
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 11,
                      fontFamily: "DMSans_400Regular",
                    }}
                  >
                    {partner.desc}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </RevealOnScroll>
      </Section>
    </View>
  );

  // ── NEW: TESTIMONIALS / SOCIAL PROOF SECTION ──────────────────────────────
  const testimonialsSection = (
    <View
      style={{
        paddingVertical: isMobile ? 40 : 64,
        ...(isWeb
          ? ({
              background: "linear-gradient(180deg, #060E1F 0%, #0A1628 100%)",
            } as any)
          : { backgroundColor: "#060E1F" }),
      }}
    >
      <Section>
        <RevealOnScroll>
          <SectionTitle
            label="Social Proof"
            title="What Users Are Saying"
            subtitle="Real feedback from our beta testers across Kenya and the diaspora."
            tc={tc}
            isMobile={isMobile}
          />
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 12,
              fontFamily: "DMSans_500Medium",
              textAlign: "center",
              marginTop: -24,
              marginBottom: 32,
              fontStyle: "italic",
              letterSpacing: 0.3,
              opacity: 0.7,
            }}
          >
            From our early access program
          </Text>
        </RevealOnScroll>

        {/* Carousel container */}
        <View
          style={{ position: "relative" }}
          {...(isWeb ? {
            onMouseEnter: () => setTestimonialHovered(true),
            onMouseLeave: () => setTestimonialHovered(false),
          } as any : {})}
        >
          {/* Overflow wrapper */}
          <View style={{ overflow: "hidden", marginHorizontal: isMobile ? 0 : 40 }}>
            {/* Sliding track */}
            <View
              style={{
                flexDirection: "row",
                ...(isWeb ? {
                  transition: "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
                  transform: `translateX(-${currentSlide * (100 / slidesPerView)}%)`,
                } as any : {}),
              } as any}
            >
              {TESTIMONIALS.map((t, i) => (
                <View
                  key={i}
                  style={{
                    width: `${100 / slidesPerView}%` as any,
                    paddingHorizontal: 10,
                    flexShrink: 0,
                  }}
                >
                  <Pressable
                    style={({ hovered: cardHovered }: any) => ({
                      backgroundColor: tc.glass.bg,
                      borderRadius: 20,
                      borderWidth: 1,
                      borderColor: isWeb && cardHovered ? t.color + "30" : tc.glass.border,
                      padding: isMobile ? 24 : 28,
                      height: "100%",
                      ...(isWeb
                        ? ({
                            backdropFilter: "blur(12px)",
                            WebkitBackdropFilter: "blur(12px)",
                            transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                            transform: cardHovered ? "translateY(-4px)" : "translateY(0)",
                            boxShadow: cardHovered
                              ? `0 12px 40px ${t.color}15`
                              : "0 4px 16px rgba(0,0,0,0.2)",
                            cursor: "default",
                          } as any)
                        : {}),
                    }) as any}
                  >
                    {/* Quote icon */}
                    <Text style={{ color: tc.primary[400], fontSize: isMobile ? 32 : 36, fontFamily: "DMSans_700Bold", lineHeight: isMobile ? 32 : 36, marginBottom: isMobile ? 12 : 16 }}>
                      {"\u201C"}
                    </Text>
                    <Text
                      style={{
                        color: tc.textSecondary,
                        fontSize: 15,
                        fontFamily: "DMSans_400Regular",
                        lineHeight: 24,
                        marginBottom: isMobile ? 20 : 24,
                        minHeight: 72,
                      }}
                    >
                      {t.quote}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: "auto" } as any}>
                      <View
                        style={{
                          width: isMobile ? 40 : 44,
                          height: isMobile ? 40 : 44,
                          borderRadius: isMobile ? 20 : 22,
                          backgroundColor: t.color + "20",
                          borderWidth: 1,
                          borderColor: t.color + "30",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text style={{ color: t.color, fontSize: isMobile ? 14 : 15, fontFamily: "DMSans_700Bold" }}>{t.initials}</Text>
                      </View>
                      <View>
                        <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>{t.name}</Text>
                        <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular" }}>{t.role}</Text>
                      </View>
                    </View>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>

          {/* Left arrow */}
          {currentSlide > 0 && (
            <Pressable
              onPress={() => setCurrentSlide((prev) => Math.max(0, prev - 1))}
              style={{
                position: "absolute",
                left: isMobile ? -4 : 0,
                top: "50%",
                marginTop: -22,
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: "rgba(255,255,255,0.08)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.12)",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 10,
                ...(isWeb ? {
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                } as any : {}),
              } as any}
            >
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </Pressable>
          )}

          {/* Right arrow */}
          {currentSlide < maxSlide && (
            <Pressable
              onPress={() => setCurrentSlide((prev) => Math.min(maxSlide, prev + 1))}
              style={{
                position: "absolute",
                right: isMobile ? -4 : 0,
                top: "50%",
                marginTop: -22,
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: "rgba(255,255,255,0.08)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.12)",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 10,
                ...(isWeb ? {
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                } as any : {}),
              } as any}
            >
              <Ionicons name="chevron-forward" size={22} color="#fff" />
            </Pressable>
          )}
        </View>

        {/* Dot indicators */}
        <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 28, gap: 8 }}>
          {Array.from({ length: maxSlide + 1 }).map((_, i) => (
            <Pressable
              key={i}
              onPress={() => setCurrentSlide(i)}
              style={{
                width: currentSlide === i ? 24 : 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: currentSlide === i ? "#10B981" : "rgba(255,255,255,0.15)",
                ...(isWeb ? {
                  transition: "all 0.3s ease",
                  cursor: "pointer",
                } as any : {}),
              } as any}
            />
          ))}
        </View>
      </Section>
    </View>
  );

  // ── 9. FAQ ─────────────────────────────────────────────────────────────────
  const faqSection = (
    <View
      accessibilityLabel="Frequently asked questions"
      style={{
        paddingVertical: isMobile ? 40 : 64,
        ...(isWeb
          ? ({
              background: "linear-gradient(180deg, #060E1F 0%, #0A1628 100%)",
            } as any)
          : { backgroundColor: "#0A1628" }),
      }}
    >
      <Section>
        <RevealOnScroll>
          <View style={{ flexDirection: isDesktop ? "row" : "column", alignItems: "center", justifyContent: "space-between", gap: isDesktop ? 0 : 16 }}>
            <View style={{ flex: 1 }}>
              <SectionTitle
                label="FAQ"
                title="Frequently Asked Questions"
                tc={tc}
                isMobile={isMobile}
              />
            </View>
            <SvgImage uri={UNDRAW.questions} size={isDesktop ? 180 : isTablet ? 140 : 100} style={{ opacity: 0.8 }} alt="FAQ illustration" />
          </View>
        </RevealOnScroll>

        <View style={{ maxWidth: 800, width: "100%", alignSelf: "center" as any }}>
          {FAQ_DATA.map((faq, i) => (
            <RevealOnScroll key={i} delay={i * 80}>
              <FAQItem question={faq.q} answer={faq.a} tc={tc} />
            </RevealOnScroll>
          ))}
        </View>
      </Section>
    </View>
  );

  // ── 10. FINAL CTA ─────────────────────────────────────────────────────────
  const ctaSection = (
    <View
      style={{
        paddingVertical: isMobile ? 56 : 80,
        alignItems: "center",
        position: "relative",
        overflow: "hidden",
        ...(isWeb
          ? ({
              background:
                "linear-gradient(180deg, #0A1628 0%, #0E1D35 50%, #060E1F 100%)",
            } as any)
          : { backgroundColor: "#0E1D35" }),
      }}
    >
      {/* Background glow */}
      <View
        style={{
          position: "absolute",
          top: "20%",
          left: "50%",
          width: 600,
          height: 600,
          borderRadius: 300,
          ...(isWeb
            ? ({
                background: "radial-gradient(circle, rgba(16,185,129,0.06) 0%, transparent 70%)",
                transform: "translateX(-50%)",
              } as any)
            : { backgroundColor: "rgba(16,185,129,0.03)" }),
        }}
      />

      <Section>
        <RevealOnScroll>
          <View style={{ alignItems: "center", zIndex: 1 }}>
            {/* Flash icon */}
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 22,
                backgroundColor: tc.primary[500],
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 32,
                ...(isWeb
                  ? ({
                      boxShadow: `0 12px 40px ${tc.primary[500]}50`,
                    } as any)
                  : {
                      shadowColor: tc.primary[500],
                      shadowOffset: { width: 0, height: 8 },
                      shadowOpacity: 0.4,
                      shadowRadius: 20,
                    }),
              }}
            >
              <Ionicons name="flash" size={36} color="#FFFFFF" />
            </View>

            {/* Success illustration */}
            <SvgImage uri={UNDRAW.success} size={isDesktop ? 180 : isTablet ? 140 : 100} style={{ opacity: 0.7, marginBottom: 12 }} alt="Success illustration" />

            <Text
              style={{
                color: tc.textPrimary,
                fontSize: isMobile ? 30 : 42,
                fontFamily: "DMSans_700Bold",
                textAlign: "center",
                letterSpacing: -1,
                lineHeight: isMobile ? 38 : 52,
                marginBottom: 18,
              }}
            >
              Ready to pay bills{"\n"}with crypto?
            </Text>

            <Text
              style={{
                color: tc.textSecondary,
                fontSize: isMobile ? 16 : 18,
                fontFamily: "DMSans_400Regular",
                textAlign: "center",
                lineHeight: isMobile ? 24 : 28,
                maxWidth: 520,
                marginBottom: 40,
              }}
            >
              Join our early access program. First 500 users get zero fees for 30 days.
              No middlemen, no delays, no scam risk.
            </Text>

            <PrimaryButton
              label="Create Free Account"
              onPress={navigateToRegister}
              tc={tc}
              icon="rocket"
              style={{
                minWidth: isMobile ? undefined : 280,
                width: isMobile ? "100%" : undefined,
                maxWidth: 400,
                paddingVertical: 20,
              }}
            />

            {/* Limited beta badge */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                marginTop: 16,
                backgroundColor: "rgba(245, 158, 11, 0.08)",
                borderRadius: 20,
                paddingVertical: 8,
                paddingHorizontal: 16,
                borderWidth: 1,
                borderColor: "rgba(245, 158, 11, 0.2)",
              }}
            >
              <Ionicons name="time" size={14} color="#F59E0B" />
              <Text
                style={{
                  color: "#F59E0B",
                  fontSize: 13,
                  fontFamily: "DMSans_600SemiBold",
                }}
              >
                Limited beta spots available
              </Text>
            </View>

            <Pressable
              onPress={navigateToLogin}
              style={({ pressed, hovered }: any) => ({
                marginTop: 20,
                paddingVertical: 10,
                paddingHorizontal: 24,
                borderRadius: 12,
                backgroundColor: hovered ? "rgba(255,255,255,0.04)" : "transparent",
                opacity: pressed ? 0.7 : 1,
                ...(isWeb ? ({ cursor: "pointer", transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)" } as any) : {}),
              })}
            >
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 15,
                  fontFamily: "DMSans_500Medium",
                }}
              >
                Already have an account?{" "}
                <Text
                  style={{
                    color: tc.primary[300],
                    fontFamily: "DMSans_600SemiBold",
                  }}
                >
                  Sign In
                </Text>
              </Text>
            </Pressable>
          </View>
        </RevealOnScroll>
      </Section>
    </View>
  );

  // ── 11. FOOTER ─────────────────────────────────────────────────────────────
  const footer = (
    <View
      style={{
        backgroundColor: "#030810",
        paddingVertical: isMobile ? 40 : 56,
        borderTopWidth: 1,
        borderTopColor: "rgba(255,255,255,0.04)",
      }}
    >
      <Section>
        <View
          style={{
            flexDirection: isMobile ? "column" : "row",
            justifyContent: "space-between",
            alignItems: isMobile ? "center" : "flex-start",
            gap: isMobile ? 36 : 48,
          }}
        >
          {/* Brand */}
          <View
            style={{
              alignItems: isMobile ? "center" : "flex-start",
              maxWidth: 300,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  backgroundColor: tc.primary[500],
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="flash" size={16} color="#FFFFFF" />
              </View>
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 20,
                  fontFamily: "DMSans_700Bold",
                  letterSpacing: -0.3,
                }}
              >
                CryptoPay
              </Text>
            </View>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 14,
                fontFamily: "DMSans_400Regular",
                lineHeight: 22,
                textAlign: isMobile ? "center" : "left",
              }}
            >
              Convert crypto to M-Pesa payments instantly.
              Secure, fast, and fully compliant.
            </Text>
          </View>

          {/* Footer links */}
          <View
            style={{
              flexDirection: "row",
              gap: isMobile ? 48 : 72,
            }}
          >
            {/* Legal */}
            <View style={{ gap: 12 }}>
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 12,
                  fontFamily: "DMSans_700Bold",
                  textTransform: "uppercase",
                  letterSpacing: 1.5,
                  marginBottom: 4,
                }}
              >
                Legal
              </Text>
              {[
                { label: "Privacy Policy", route: "/privacy" },
                { label: "Terms of Service", route: "/terms" },
              ].map((link) => (
                <Pressable
                  key={link.label}
                  onPress={() => {
                    // Placeholder: these routes can be added later
                  }}
                  style={({ hovered }: any) => ({
                    ...(isWeb
                      ? ({
                          cursor: "pointer",
                          transition: "color 0.15s ease",
                        } as any)
                      : {}),
                  })}
                >
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 14,
                      fontFamily: "DMSans_400Regular",
                    }}
                  >
                    {link.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Support */}
            <View style={{ gap: 12 }}>
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 12,
                  fontFamily: "DMSans_700Bold",
                  textTransform: "uppercase",
                  letterSpacing: 1.5,
                  marginBottom: 4,
                }}
              >
                Support
              </Text>
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 14,
                  fontFamily: "DMSans_400Regular",
                }}
              >
                support@cpay.co.ke
              </Text>
              {/* Social icons (real brand logos) */}
              <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                {([
                  { image: SOCIAL_ICONS.twitter, label: "Twitter / X", url: "https://twitter.com/CPayKenya" },
                  { image: SOCIAL_ICONS.telegram, label: "Telegram", url: "https://t.me/cryptopaykenya" },
                ]).map((social) => (
                  <Pressable
                    key={social.label}
                    onPress={() => {
                      if (isWeb) {
                        (window as any).open(social.url, "_blank");
                      } else {
                        Linking.openURL(social.url);
                      }
                    }}
                    style={({ hovered }: any) => ({
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      backgroundColor: hovered
                        ? "rgba(255,255,255,0.08)"
                        : "rgba(255,255,255,0.04)",
                      alignItems: "center",
                      justifyContent: "center",
                      ...(isWeb
                        ? ({
                            cursor: "pointer",
                            transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                          } as any)
                        : {}),
                    })}
                    accessibilityLabel={social.label}
                  >
                    <Image
                      source={social.image}
                      style={{ width: 20, height: 20, borderRadius: 4 }}
                      resizeMode="contain"
                    />
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* Copyright */}
        <View
          style={{
            marginTop: isMobile ? 36 : 48,
            paddingTop: 24,
            borderTopWidth: 1,
            borderTopColor: "rgba(255,255,255,0.04)",
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 13,
              fontFamily: "DMSans_400Regular",
              textAlign: "center",
            }}
          >
            {"\u00A9"} 2026 CryptoPay Technologies {"\u00B7"} Nairobi, Kenya
          </Text>
        </View>
      </Section>
    </View>
  );

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <Navbar
        tc={tc}
        isMobile={isMobile}
        isDesktop={isDesktop}
        onSignIn={navigateToLogin}
        onGetStarted={navigateToRegister}
        onScrollTo={scrollToSection}
      />

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        {heroSection}
        {problemSection}
        {statsSection}
        {servicesSection}
        {howItWorksSection}
        {cryptoSection}
        {featuresSection}
        {pricingSection}
        {comparisonSection}
        {platformStatsSection}
        {partnerLogosSection}
        {testimonialsSection}
        {faqSection}
        {ctaSection}
        {footer}
      </ScrollView>

      {/* Sticky mobile CTA bar */}
      {isMobile && isWeb && (
        <View
          style={{
            position: "fixed" as any,
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 200,
            paddingHorizontal: 20,
            paddingVertical: 12,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            ...(isWeb
              ? ({
                  backgroundColor: "rgba(6, 14, 31, 0.95)",
                  backdropFilter: "blur(20px)",
                  WebkitBackdropFilter: "blur(20px)",
                  borderTopWidth: 1,
                  borderTopColor: "rgba(255,255,255,0.06)",
                  boxShadow: "0 -4px 24px rgba(0,0,0,0.3)",
                } as any)
              : { backgroundColor: "rgba(6, 14, 31, 0.95)" }),
          } as any}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 14,
                fontFamily: "DMSans_700Bold",
              }}
            >
              Pay bills with crypto
            </Text>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 11,
                fontFamily: "DMSans_400Regular",
              }}
            >
              M-Pesa delivery in 30 seconds
            </Text>
          </View>
          <Pressable
            onPress={navigateToRegister}
            style={({ pressed }: any) => ({
              backgroundColor: tc.primary[500],
              paddingVertical: 12,
              paddingHorizontal: 24,
              borderRadius: 12,
              opacity: pressed ? 0.9 : 1,
              ...(isWeb
                ? ({
                    cursor: "pointer",
                    boxShadow: "0 2px 12px rgba(16, 185, 129, 0.3)",
                  } as any)
                : {}),
            })}
          >
            <Text
              style={{
                color: "#fff",
                fontSize: 14,
                fontFamily: "DMSans_700Bold",
              }}
            >
              Get Started
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
