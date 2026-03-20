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

const isWeb = Platform.OS === "web";

// ── CDN Assets ──────────────────────────────────────────────────────────────
const COIN_ICONS = [
  { key: "USDT", uri: CRYPTO_LOGOS.USDT, color: "#26A17B", name: "USDT", network: "Tron TRC-20" },
  { key: "BTC", uri: CRYPTO_LOGOS.BTC, color: "#F7931A", name: "Bitcoin", network: "Bitcoin" },
  { key: "ETH", uri: CRYPTO_LOGOS.ETH, color: "#627EEA", name: "Ethereum", network: "Ethereum" },
  { key: "SOL", uri: CRYPTO_LOGOS.SOL, color: "#9945FF", name: "Solana", network: "Solana" },
  { key: "USDC", uri: CRYPTO_LOGOS.USDC, color: "#2775CA", name: "USDC", network: "Polygon" },
];

const KENYA_FLAG = "https://flagcdn.com/48x36/ke.png";

// ── Real CDN Images (Unsplash — free, hotlink-ready) ────────────────────────
const CDN_IMAGES = {
  cryptoCoins: "https://images.unsplash.com/photo-1622630998477-20aa696ecb05?w=900&q=80",
  nairobiSkyline: "https://images.unsplash.com/photo-1611348524140-53c9a25263d6?w=1200&q=75",
  personPhone: "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=800&q=80",
  securityShield: "https://images.unsplash.com/photo-1633265486064-086b219458ec?w=600&q=80",
  speedTrails: "https://images.unsplash.com/photo-1506443432602-ac2fcd6f54e0?w=800&q=80",
  mobilePayment: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=800&q=80",
  dataViz: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&q=80",
};

// ── Professional SVG Illustrations (unDraw CDN) ─────────────────────────────
const U = "https://42f2671d685f51e10fc6-b9fcecea3e50b3b59bdc28dead054ebc.ssl.cf5.rackcdn.com/illustrations";
const ILLUSTRATIONS = {
  bitcoin: `${U}/bitcoin2_ave7.svg`,
  finance: `${U}/finance_0bdk.svg`,
  wallet: `${U}/wallet_aym5.svg`,
  secureData: `${U}/secure_data_0rwp.svg`,
  fastLoading: `${U}/fast_loading_0lbh.svg`,
  success: `${U}/successful_purchase_uyin.svg`,
  creditCard: `${U}/credit_card_payment_yb88.svg`,
  questions: `${U}/questions_75e0.svg`,
  community: `${U}/design_community_rcft.svg`,
  onlineWorld: `${U}/online_world_mc1t.svg`,
  target: `${U}/target_kriv.svg`,
  safe: `${U}/safe_bnk7.svg`,
};

// SVG image component (uses <img> on web for proper SVG rendering)
function SvgIllustration({ uri, size = 140, style, className }: { uri: string; size?: number; style?: any; className?: string }) {
  if (isWeb) {
    return <img src={uri} alt="" className={className || "cpay-illustration"} style={{ width: size, height: size, objectFit: "contain" as any, opacity: 0.85, ...style }} />;
  }
  return <Image source={{ uri }} style={{ width: size, height: size, opacity: 0.85, ...style }} resizeMode="contain" />;
}

// ── Partner Logos ───────────────────────────────────────────────────────────
const PARTNER_LOGOS = {
  smileIdentity: require("../assets/logos/partners/smile-identity.png"),
  coingecko: require("../assets/logos/partners/coingecko.png"),
  mpesa: require("../assets/logos/partners/mpesa-logo.png"),
  sentry: require("../assets/logos/partners/sentry.png"),
};

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

const SOCIAL_ICONS = {
  twitter: require("../assets/logos/twitter.png"),
  telegram: require("../assets/logos/telegram.png"),
};

const STORE_ICONS = {
  googlePlay: require("../assets/logos/google-play-icon.png"),
  appStore: require("../assets/logos/app-store-icon.png"),
};

// App logo from store listing
const APP_LOGO = require("../assets/icon.png");

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

// ── Testimonials ────────────────────────────────────────────────────────────
const TESTIMONIALS = [
  { quote: "I paid my KPLC bill with USDT in 22 seconds. No more hunting for P2P traders at midnight.", name: "James M.", role: "Freelance Developer", initials: "JM", color: "#26A17B" },
  { quote: "My kid's school fees — sorted from my Binance wallet in under a minute. This is what crypto was supposed to be.", name: "Sarah K.", role: "Software Engineer", initials: "SK", color: "#627EEA" },
  { quote: "The locked rate is everything. I used to lose 3-5% on P2P spreads. Now I see exactly what I'm paying.", name: "David O.", role: "Crypto Trader", initials: "DO", color: "#F7931A" },
  { quote: "Sending money home from the diaspora is finally painless. BTC to M-Pesa, no middlemen, no drama.", name: "Grace W.", role: "Kenyan Diaspora, UK", initials: "GW", color: "#9945FF" },
];

// ── FAQ ─────────────────────────────────────────────────────────────────────
const FAQ_DATA = [
  { q: "How does CryptoPay actually work?", a: "You deposit crypto (USDT, BTC, ETH, or SOL) to your personal CryptoPay wallet. When you want to pay a bill, enter the Paybill or Till number, pick your crypto, and we lock your exchange rate for 90 seconds. Confirm with your PIN, and the payment hits M-Pesa in under 30 seconds." },
  { q: "What crypto can I use?", a: "USDT on Tron (TRC-20), Bitcoin (BTC), Ethereum (ETH), Solana (SOL), and USDC on Polygon. We pick the networks with the lowest fees so more of your money goes where it should." },
  { q: "How fast is the payment?", a: "Once your crypto deposit confirms on-chain, M-Pesa payments process in under 30 seconds. Most finish in 10-15 seconds. You'll see real-time status updates the entire time." },
  { q: "Is my money safe?", a: "Every wallet uses BIP-44 HD architecture — industry-standard key derivation. We add biometric auth, optional TOTP 2FA, and encrypt everything with AES-256. We never hold your private keys." },
  { q: "What does it cost?", a: "A 1.5% conversion spread plus KES 10 flat fee per transaction. No hidden charges. The rate you see on the confirmation screen is exactly what you get — locked for 90 seconds while you decide." },
  { q: "Do I need to verify my identity?", a: "For transactions up to KES 5,000/day, just verify your phone number. Higher limits (up to KES 1M/day) require a quick ID check that takes about 2 minutes through our partner Smile Identity." },
];

// ── Comparison ──────────────────────────────────────────────────────────────
const COMPARISON_ROWS = [
  { label: "Speed", cp: "< 30 seconds", p2p: "15-60 minutes", otc: "1-24 hours" },
  { label: "Fees", cp: "1.5% + KES 10", p2p: "3-8% spread", otc: "5-10% negotiated" },
  { label: "Trust", cp: "Automated, verifiable", p2p: "Depends on trader", otc: "Personal trust" },
  { label: "Bill Payment", cp: "Direct to Paybill/Till", p2p: "Not supported", otc: "Not supported" },
  { label: "Rate Lock", cp: "90 seconds guaranteed", p2p: "None", otc: "None" },
  { label: "KYC", cp: "Tiered (phone → ID)", p2p: "Platform-dependent", otc: "None (risky)" },
];

// ── Features (bento layout) ────────────────────────────────────────────────
const FEATURES = [
  { icon: "flash" as const, title: "Pay any bill, instantly", desc: "KPLC, DSTV, water, school fees — enter the Paybill number and it's done. No manual M-Pesa steps.", size: "large" as const, accent: "#10B981" },
  { icon: "lock-closed" as const, title: "Your rate, locked for 90 seconds", desc: "We freeze your exchange rate. What you see is what you pay. No slippage, no surprises, no anxiety.", size: "large" as const, accent: "#F59E0B" },
  { icon: "send" as const, title: "Send to any phone", desc: "M-Pesa to any number, funded by your crypto balance.", size: "medium" as const, accent: "#3B82F6" },
  { icon: "trending-up" as const, title: "Live rates from CoinGecko", desc: "Real-time pricing. No stale quotes.", size: "medium" as const, accent: "#8B5CF6" },
  { icon: "layers" as const, title: "5 blockchains", desc: "Pick the cheapest network for your transfer.", size: "medium" as const, accent: "#EC4899" },
  { icon: "shield-checkmark" as const, title: "HD wallet security", desc: "BIP-44 architecture, biometric auth, optional TOTP 2FA.", size: "small" as const, accent: "#10B981" },
  { icon: "receipt" as const, title: "Receipts for everything", desc: "PDF receipts, SMS confirmations, full transaction history.", size: "small" as const, accent: "#F59E0B" },
  { icon: "finger-print" as const, title: "PIN + biometric", desc: "Unlock with fingerprint. Confirm with your PIN.", size: "small" as const, accent: "#6366F1" },
];

// ══════════════════════════════════════════════════════════════════════════════
// UTILITY COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════

// ── Scroll-Reveal with VARIANTS ─────────────────────────────────────────────
type RevealVariant = "fade-up" | "slide-left" | "slide-right" | "scale-up" | "fade-in";

function RevealOnScroll({
  children, delay = 0, style, variant = "fade-up",
}: {
  children: React.ReactNode; delay?: number; style?: any; variant?: RevealVariant;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(variant === "fade-up" ? 28 : 0)).current;
  const translateX = useRef(new Animated.Value(
    variant === "slide-left" ? -40 : variant === "slide-right" ? 40 : 0
  )).current;
  const scale = useRef(new Animated.Value(variant === "scale-up" ? 0.92 : 1)).current;
  const [visible, setVisible] = useState(false);
  const viewRef = useRef<View>(null);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      const anims: Animated.CompositeAnimation[] = [
        Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: !isWeb }),
      ];
      if (variant === "fade-up") anims.push(Animated.timing(translateY, { toValue: 0, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: !isWeb }));
      if (variant === "slide-left" || variant === "slide-right") anims.push(Animated.timing(translateX, { toValue: 0, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: !isWeb }));
      if (variant === "scale-up") anims.push(Animated.timing(scale, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: !isWeb }));
      Animated.parallel(anims).start();
    }, delay);
    return () => clearTimeout(t);
  }, [visible, delay]);

  useEffect(() => {
    if (!isWeb) { setVisible(true); return; }
    const node = viewRef.current as any;
    if (node && typeof IntersectionObserver !== "undefined") {
      const t = setTimeout(() => {
        const el = node instanceof HTMLElement ? node : null;
        if (el) {
          const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold: 0.06 });
          obs.observe(el);
          return () => obs.disconnect();
        }
        setVisible(true);
      }, 50);
      return () => clearTimeout(t);
    } else setVisible(true);
  }, []);

  const transform: any[] = [];
  if (variant === "fade-up") transform.push({ translateY });
  if (variant === "slide-left" || variant === "slide-right") transform.push({ translateX });
  if (variant === "scale-up") transform.push({ scale });

  return (
    <Animated.View ref={viewRef as any} style={{ opacity, transform, ...style }}>
      {children}
    </Animated.View>
  );
}

// ── Floating Coin ─────────────────────────────────────────────────────────
function FloatingCoin({ uri, size, left, top, delay, color }: {
  uri: string; size: number; left: string; top: string; delay: number; color: string;
}) {
  const ty = useRef(new Animated.Value(0)).current;
  const op = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(op, { toValue: 0.7, duration: 1000, delay, useNativeDriver: !isWeb }).start();
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(ty, { toValue: -10, duration: 2500 + delay, easing: Easing.bezier(0.37, 0, 0.63, 1), useNativeDriver: !isWeb }),
      Animated.timing(ty, { toValue: 10, duration: 2500 + delay, easing: Easing.bezier(0.37, 0, 0.63, 1), useNativeDriver: !isWeb }),
    ]));
    const t = setTimeout(() => loop.start(), delay);
    return () => { clearTimeout(t); loop.stop(); };
  }, []);
  return (
    <Animated.View style={{ position: "absolute", left: left as any, top: top as any, opacity: op, transform: [{ translateY: ty }], zIndex: 2 }}>
      <View style={{
        width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
        ...(isWeb ? { backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", boxShadow: `0 4px 20px ${color}20` } as any : {}),
      }}>
        <Image source={{ uri }} style={{ width: size * 0.5, height: size * 0.5 }} />
      </View>
    </Animated.View>
  );
}

// ── FAQ Accordion with SMOOTH height animation ──────────────────────────────
function FAQItem({ question, answer, tc, index }: {
  question: string; answer: string; tc: ReturnType<typeof getThemeColors>; index: number;
}) {
  const [open, setOpen] = useState(false);
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const toggle = () => {
    setOpen(!open);
    Animated.timing(rotateAnim, { toValue: open ? 0 : 1, duration: 300, useNativeDriver: !isWeb }).start();
  };
  const rotate = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] });

  return (
    <Pressable
      onPress={toggle}
      style={({ hovered }: any) => ({
        backgroundColor: open ? "rgba(16,185,129,0.04)" : isWeb && hovered ? "rgba(255,255,255,0.02)" : "transparent",
        borderRadius: 16, borderWidth: 1, borderColor: open ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.06)",
        paddingHorizontal: 24, paddingVertical: 20, marginBottom: 12,
        ...(isWeb ? { transition: "all 0.3s ease", cursor: "pointer" } as any : {}),
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ flex: 1, color: open ? tc.primary[300] : tc.textPrimary, fontSize: 16, fontFamily: "DMSans_600SemiBold", lineHeight: 24, marginRight: 16 }}>
          {question}
        </Text>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons name="chevron-down" size={20} color={open ? tc.primary[400] : tc.textMuted} />
        </Animated.View>
      </View>
      {/* Smooth height via CSS max-height on web, hard toggle on native */}
      {isWeb ? (
        <div style={{
          maxHeight: open ? 300 : 0, overflow: "hidden",
          transition: "max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease",
          opacity: open ? 1 : 0,
        }}>
          <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_400Regular", lineHeight: 24, marginTop: 14 }}>
            {answer}
          </Text>
        </div>
      ) : open ? (
        <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_400Regular", lineHeight: 24, marginTop: 14 }}>
          {answer}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ── Section Wrapper ─────────────────────────────────────────────────────────
function Section({ children, style }: { children: React.ReactNode; style?: any }) {
  const { width: w } = useWindowDimensions();
  const pad = w >= 1400 ? 80 : w >= 1024 ? 48 : w >= 768 ? 32 : 20;
  return <View style={{ width: "100%", paddingHorizontal: pad, ...style }}>{children}</View>;
}

// ── Animated Counter ────────────────────────────────────────────────────────
function useAnimatedCounter(end: number, duration: number = 2000) {
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);
  const viewRef = useRef<View>(null);
  useEffect(() => {
    if (!started) return;
    let startTime: number | null = null; let raf: number;
    const step = (ts: number) => {
      if (!startTime) startTime = ts;
      const p = Math.min((ts - startTime) / duration, 1);
      setCount(Math.floor((1 - Math.pow(1 - p, 3)) * end));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [started, end, duration]);
  useEffect(() => {
    if (!isWeb) { setStarted(true); return; }
    const node = viewRef.current as any;
    if (node && typeof IntersectionObserver !== "undefined") {
      const t = setTimeout(() => {
        const el = node instanceof HTMLElement ? node : null;
        if (el) {
          const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setStarted(true); obs.disconnect(); } }, { threshold: 0.3 });
          obs.observe(el);
        } else setStarted(true);
      }, 100);
      return () => clearTimeout(t);
    } else setStarted(true);
  }, []);
  return { count, viewRef };
}

// ── Navbar ──────────────────────────────────────────────────────────────────
function Navbar({ tc, isMobile, onSignIn, onGetStarted, onScrollTo }: {
  tc: ReturnType<typeof getThemeColors>; isMobile: boolean;
  onSignIn: () => void; onGetStarted: () => void; onScrollTo: (s: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { width } = useWindowDimensions();
  const pad = width >= 1400 ? 80 : width >= 1024 ? 48 : width >= 768 ? 32 : 20;
  const navLinks = [
    { label: "How It Works", section: "howItWorks", icon: "bulb-outline" as keyof typeof Ionicons.glyphMap },
    { label: "Features", section: "features", icon: "grid-outline" as keyof typeof Ionicons.glyphMap },
    { label: "Pricing", section: "pricing", icon: "pricetag-outline" as keyof typeof Ionicons.glyphMap },
  ];
  return (
    <>
      <View style={{
        position: isWeb ? ("fixed" as any) : "absolute", top: 0, left: 0, right: 0, zIndex: 100,
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        paddingHorizontal: pad, paddingVertical: 14,
        ...(isWeb ? { backgroundColor: "rgba(6,14,31,0.85)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", borderBottom: "1px solid rgba(255,255,255,0.04)" } as any : { backgroundColor: "rgba(6,14,31,0.95)" }),
      }}>
        <Pressable
          onPress={() => onScrollTo("top")}
          style={({ hovered }: any) => ({
            flexDirection: "row", alignItems: "center", gap: 10,
            ...(isWeb ? { cursor: "pointer", transition: "all 0.2s ease", transform: hovered ? "scale(1.03)" : "none" } as any : {}),
          }) as any}
        >
          <Image source={APP_LOGO} style={{ width: 36, height: 36, borderRadius: 10, ...(isWeb ? { boxShadow: "0 2px 12px rgba(16,185,129,0.3)" } as any : {}) }} resizeMode="cover" />
          <Text style={{ color: tc.textPrimary, fontSize: 19, fontFamily: "DMSans_700Bold", letterSpacing: -0.3 }}>CryptoPay</Text>
        </Pressable>
        {!isMobile && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            {navLinks.map((l) => (
              <Pressable key={l.label} onPress={() => onScrollTo(l.section)} style={({ hovered }: any) => ({
                paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8,
                flexDirection: "row", alignItems: "center", gap: 6,
                backgroundColor: hovered ? "rgba(16,185,129,0.06)" : "transparent",
                borderWidth: 1, borderColor: hovered ? "rgba(16,185,129,0.12)" : "transparent",
                ...(isWeb ? { cursor: "pointer", transition: "all 0.25s ease" } as any : {}),
              })}>
                <Ionicons name={l.icon} size={15} color={tc.textMuted} />
                <Text style={{ color: tc.textSecondary, fontSize: 14, fontFamily: "DMSans_500Medium" }}>{l.label}</Text>
              </Pressable>
            ))}
            <Pressable onPress={onSignIn} style={({ hovered }: any) => ({
              paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8,
              flexDirection: "row", alignItems: "center", gap: 6,
              backgroundColor: hovered ? "rgba(255,255,255,0.04)" : "transparent",
              ...(isWeb ? { cursor: "pointer", transition: "all 0.2s ease" } as any : {}),
            })}>
              <Ionicons name="log-in-outline" size={15} color={tc.textMuted} />
              <Text style={{ color: tc.textSecondary, fontSize: 14, fontFamily: "DMSans_500Medium" }}>Sign In</Text>
            </Pressable>
            <Pressable
              ref={(ref: any) => { if (isWeb && ref instanceof HTMLElement) ref.className = "cpay-cta-ripple"; }}
              onPress={onGetStarted}
              style={({ hovered, pressed }: any) => ({
                backgroundColor: hovered ? tc.primary[400] : tc.primary[500], borderRadius: 999,
                paddingVertical: 10, paddingHorizontal: 24,
                flexDirection: "row", alignItems: "center", gap: 8,
                transform: [{ scale: pressed ? 0.95 : hovered ? 1.05 : 1 }],
                ...(isWeb ? { cursor: "pointer", transition: "all 0.25s cubic-bezier(0.34,1.56,0.64,1)", boxShadow: hovered ? "0 8px 28px rgba(16,185,129,0.5)" : "0 4px 12px rgba(16,185,129,0.2)" } as any : {}),
              }) as any}
            >
              <Ionicons name="flash" size={15} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 14, fontFamily: "DMSans_700Bold" }}>Get Started</Text>
            </Pressable>
          </View>
        )}
        {isMobile && (
          <Pressable onPress={() => setMenuOpen(!menuOpen)} style={{ padding: 8 }}>
            <Ionicons name={menuOpen ? "close" : "menu"} size={24} color={tc.textPrimary} />
          </Pressable>
        )}
      </View>
      {isMobile && menuOpen && (
        <View style={{
          position: isWeb ? ("fixed" as any) : "absolute", top: 62, left: 0, right: 0, zIndex: 99,
          paddingVertical: 20, paddingHorizontal: 20, gap: 8,
          ...(isWeb ? { backgroundColor: "rgba(6,14,31,0.97)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", borderBottom: "1px solid rgba(255,255,255,0.06)" } as any : { backgroundColor: "#060E1F" }),
        }}>
          {navLinks.map((l) => (
            <Pressable key={l.label} onPress={() => { onScrollTo(l.section); setMenuOpen(false); }}
              style={{ paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.03)" }}>
              <Text style={{ color: tc.textPrimary, fontSize: 16, fontFamily: "DMSans_500Medium" }}>{l.label}</Text>
            </Pressable>
          ))}
          <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
            <Pressable onPress={() => { onSignIn(); setMenuOpen(false); }} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", alignItems: "center" }}>
              <Text style={{ color: tc.textPrimary, fontSize: 15, fontFamily: "DMSans_600SemiBold" }}>Sign In</Text>
            </Pressable>
            <Pressable onPress={() => { onGetStarted(); setMenuOpen(false); }} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: tc.primary[500], alignItems: "center" }}>
              <Text style={{ color: "#fff", fontSize: 15, fontFamily: "DMSans_700Bold" }}>Get Started</Text>
            </Pressable>
          </View>
        </View>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN LANDING PAGE
// ══════════════════════════════════════════════════════════════════════════════
export default function LandingPage() {
  const router = useRouter();
  const tc = getThemeColors(true);
  const { width, height: winH } = useWindowDimensions();
  const isMobile = width < 768;
  const isTablet = width >= 768 && width < 1024;
  const isDesktop = width >= 1024;

  const scrollRef = useRef<ScrollView>(null);
  const sectionRefs = useRef<Record<string, View | null>>({});

  const navigateToLogin = () => router.push("/auth/login" as any);
  const navigateToRegister = () => router.push("/auth/register" as any);
  const scrollToSection = (section: string) => {
    if (section === "top") { scrollRef.current?.scrollTo({ y: 0, animated: true }); return; }
    const ref = sectionRefs.current[section];
    if (ref && isWeb) {
      (ref as any)?.measureLayout?.(scrollRef.current as any, (_x: number, y: number) => scrollRef.current?.scrollTo({ y: y - 80, animated: true }), () => {});
    }
  };

  // Testimonial carousel
  const slidesPerView = isMobile ? 1 : isTablet ? 2 : 3;
  const [currentSlide, setCurrentSlide] = useState(0);
  const [testimonialHovered, setTestimonialHovered] = useState(false);
  const maxSlide = Math.max(0, TESTIMONIALS.length - slidesPerView);
  useEffect(() => {
    if (testimonialHovered) return;
    const timer = setInterval(() => setCurrentSlide((p) => (p >= maxSlide ? 0 : p + 1)), 4000);
    return () => clearInterval(timer);
  }, [testimonialHovered, maxSlide]);

  // Live rate
  const [liveRate, setLiveRate] = useState<string>("129+");
  useEffect(() => {
    if (!isWeb) return;
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=kes")
      .then(r => r.json()).then(d => { const rate = d?.tether?.kes; if (rate) setLiveRate(`KES ${rate.toFixed(2)}`); }).catch(() => {});
  }, []);

  const usersCounter = useAnimatedCounter(730, 1800);
  const speedCounter = useAnimatedCounter(30, 1200);

  // ── SEO ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isWeb) return;
    document.title = "CryptoPay \u2014 Pay Any Bill in Kenya with Crypto | USDT, BTC, ETH, SOL to M-Pesa";
    const setMeta = (n: string, c: string, p?: boolean) => {
      const a = p ? "property" : "name";
      let el = document.querySelector(`meta[${a}="${n}"]`) as HTMLMetaElement | null;
      if (!el) { el = document.createElement("meta"); el.setAttribute(a, n); document.head.appendChild(el); }
      el.content = c;
    };
    setMeta("description", "Pay any M-Pesa Paybill or Till number directly from cryptocurrency. Convert USDT, BTC, ETH, SOL to KES instantly.");
    setMeta("keywords", "crypto payments Kenya, USDT to M-Pesa, Bitcoin to KES, pay bills with crypto, CryptoPay");
    setMeta("og:title", "CryptoPay \u2014 Pay Any Bill in Kenya with Crypto", true);
    setMeta("og:description", "Convert USDT, BTC, ETH, SOL to M-Pesa payments in 30 seconds.", true);
    setMeta("og:type", "website", true); setMeta("og:url", "https://cpay.co.ke", true);
    setMeta("og:site_name", "CryptoPay", true); setMeta("og:locale", "en_KE", true);
    setMeta("twitter:card", "summary_large_image"); setMeta("twitter:site", "@CPayKenya");
    setMeta("robots", "index, follow"); setMeta("author", "CryptoPay Technologies"); setMeta("theme-color", "#060E1F");
    setMeta("geo.region", "KE"); setMeta("geo.placename", "Nairobi");

    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonical) { canonical = document.createElement("link"); canonical.rel = "canonical"; document.head.appendChild(canonical); }
    canonical.href = "https://cpay.co.ke/";

    // JSON-LD schemas
    const addSchema = (id: string, data: any) => {
      let s = document.querySelector(`script[data-schema="${id}"]`) as HTMLScriptElement | null;
      if (!s) { s = document.createElement("script"); s.type = "application/ld+json"; s.setAttribute("data-schema", id); document.head.appendChild(s); }
      s.textContent = JSON.stringify(data);
    };
    addSchema("faq", { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ_DATA.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
    addSchema("org", { "@context": "https://schema.org", "@type": "Organization", name: "CryptoPay", url: "https://cpay.co.ke", description: "Pay any M-Pesa Paybill or Till number directly from cryptocurrency.", sameAs: ["https://twitter.com/CPayKenya", "https://t.me/cryptopaykenya"] });

    // ── Font preloader: force Ionicons + DM Sans to load reliably ──────
    // This bypasses Cloudflare QUIC partial-content errors by using
    // @font-face with explicit src + link preload in the head
    const fontFixId = "cpay-font-preload";
    if (!document.getElementById(fontFixId)) {
      // Find the actual Ionicons font URL from the page assets
      const ioniconsEl = Array.from(document.querySelectorAll('style')).find(s => s.textContent?.includes('Ionicons'));
      const ioniconsMatch = document.querySelector('link[href*="Ionicons"]') as HTMLLinkElement;
      // Also search for the font URL in existing @font-face rules
      let ioniconsUrl = "";
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules || [])) {
            if (rule instanceof CSSFontFaceRule && rule.cssText.includes("Ionicons")) {
              const m = rule.cssText.match(/url\(["']?([^"')]+)["']?\)/);
              if (m) ioniconsUrl = m[1];
            }
          }
        } catch {}
      }
      if (ioniconsUrl) {
        // Add a preload link to force the browser to download the full file eagerly
        const preload = document.createElement("link");
        preload.id = fontFixId;
        preload.rel = "preload";
        preload.as = "font";
        preload.type = "font/ttf";
        preload.crossOrigin = "anonymous";
        preload.href = ioniconsUrl;
        document.head.appendChild(preload);
      }
    }
  }, []);

  // ── CSS Animations ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isWeb) return;
    const styleId = "cpay-landing-v3";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @keyframes cpay-gradient-text { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
      @keyframes cpay-aurora { 0%,100% { transform: translate(0,0) scale(1); } 25% { transform: translate(40px,30px) scale(1.1); } 50% { transform: translate(-30px,60px) scale(0.9); } 75% { transform: translate(50px,-20px) scale(1.05); } }
      @keyframes cpay-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
      @keyframes cpay-pulse-dot { 0%,100% { opacity:1; box-shadow: 0 0 4px rgba(16,185,129,0.6); } 50% { opacity:0.5; box-shadow: 0 0 12px rgba(16,185,129,0.9); } }
      @keyframes cpay-scroll-left { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
      @keyframes cpay-shine { 0% { left:-100%;opacity:0; } 50% { opacity:0.6; } 100% { left:200%;opacity:0; } }
      @keyframes cpay-particle { 0%,100% { transform: translateY(0) translateX(0); opacity:0.3; } 25% { transform: translateY(-20px) translateX(10px); opacity:0.6; } 50% { transform: translateY(-10px) translateX(-15px); opacity:0.4; } 75% { transform: translateY(-30px) translateX(5px); opacity:0.5; } }
      @keyframes cpay-glow-border { 0%,100% { border-color: rgba(16,185,129,0.15); box-shadow: 0 20px 60px rgba(0,0,0,0.4); } 50% { border-color: rgba(16,185,129,0.3); box-shadow: 0 20px 60px rgba(0,0,0,0.4), 0 0 30px rgba(16,185,129,0.08); } }
      @keyframes cpay-tilt-float { 0%,100% { transform: perspective(1200px) rotateX(2deg) rotateY(-1deg) translateY(0); } 50% { transform: perspective(1200px) rotateX(-1deg) rotateY(1deg) translateY(-8px); } }
      @keyframes cpay-img-reveal { 0% { clip-path: inset(100% 0 0 0); opacity:0; } 100% { clip-path: inset(0 0 0 0); opacity:1; } }
      @keyframes cpay-count-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.04); } }

      .cpay-gradient-headline { background: linear-gradient(135deg, #10B981, #34D399, #F59E0B, #10B981); background-size: 300% 300%; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; animation: cpay-gradient-text 6s ease infinite; }
      .cpay-gradient-headline:hover { animation-duration: 2s; }
      .cpay-carousel-track { display:flex; animation: cpay-scroll-left 35s linear infinite; width: max-content; }
      .cpay-carousel-track:hover { animation-play-state: paused; }
      .cpay-carousel-track-reverse { display:flex; animation: cpay-scroll-left 30s linear infinite reverse; width: max-content; }
      .cpay-carousel-track-reverse:hover { animation-play-state: paused; }

      .cpay-hero-mockup { animation: cpay-tilt-float 6s ease-in-out infinite, cpay-glow-border 4s ease-in-out infinite; transition: transform 0.4s ease, box-shadow 0.4s ease; }
      .cpay-hero-mockup:hover { transform: perspective(1200px) rotateX(0deg) rotateY(0deg) translateY(-12px) scale(1.02) !important; box-shadow: 0 30px 80px rgba(0,0,0,0.5), 0 0 40px rgba(16,185,129,0.12) !important; }

      .cpay-img-accent { animation: cpay-img-reveal 1s cubic-bezier(0.4,0,0.2,1) both; border-radius: 16px; }
      .cpay-stat-number { transition: transform 0.3s ease, text-shadow 0.3s ease; cursor: default; }
      .cpay-stat-number:hover { transform: scale(1.06); text-shadow: 0 0 40px rgba(16,185,129,0.3); }

      .cpay-bento-card { transition: all 0.35s cubic-bezier(0.4,0,0.2,1); position:relative; overflow:hidden; }
      .cpay-bento-card::after { content:''; position:absolute; top:0; left:-100%; width:50%; height:100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent); }
      .cpay-bento-card:hover { transform: translateY(-6px) scale(1.01); }
      .cpay-bento-card:hover::after { animation: cpay-shine 0.8s ease-out; }

      /* Problem card hover lift */
      .cpay-problem-card { transition: all 0.3s cubic-bezier(0.4,0,0.2,1); }
      .cpay-problem-card:hover { transform: translateY(-4px); }

      /* Step card 3D tilt hover */
      .cpay-step-card { transition: all 0.35s cubic-bezier(0.4,0,0.2,1); }
      .cpay-step-card:hover { transform: translateY(-8px) scale(1.02); border-color: rgba(16,185,129,0.25) !important; box-shadow: 0 16px 48px rgba(16,185,129,0.1) !important; }

      /* Crypto coin card hover glow */
      .cpay-crypto-card { transition: all 0.3s cubic-bezier(0.4,0,0.2,1); }
      .cpay-crypto-card:hover { transform: translateY(-8px) scale(1.03); }

      /* Compare row hover */
      .cpay-compare-row { transition: background-color 0.2s ease; }
      .cpay-compare-row:hover { background-color: rgba(255,255,255,0.02); }

      /* Testimonial card hover */
      .cpay-testimonial { transition: all 0.3s ease; }
      .cpay-testimonial:hover { transform: translateY(-4px); border-color: rgba(16,185,129,0.2) !important; box-shadow: 0 12px 36px rgba(16,185,129,0.06) !important; }

      /* FAQ item hover */
      .cpay-faq-item { transition: all 0.25s ease; }
      .cpay-faq-item:hover { border-color: rgba(16,185,129,0.2) !important; }

      /* Service card hover */
      .cpay-service-card { transition: all 0.25s cubic-bezier(0.4,0,0.2,1); }
      .cpay-service-card:hover { transform: translateY(-3px) scale(1.04); border-color: rgba(16,185,129,0.25) !important; box-shadow: 0 8px 24px rgba(16,185,129,0.08); }

      /* Pricing card hover */
      .cpay-pricing-card { transition: all 0.3s ease; }
      .cpay-pricing-card:hover { transform: translateY(-6px); box-shadow: 0 20px 60px rgba(16,185,129,0.08) !important; }

      /* Icon bounce on parent hover */
      .cpay-icon-bounce { transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1); }
      .cpay-bento-card:hover .cpay-icon-bounce,
      .cpay-step-card:hover .cpay-icon-bounce { transform: scale(1.15) rotate(-5deg); }

      /* Illustration animated idle + dramatic hover */
      @keyframes cpay-illus-idle { 0%,100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-6px) rotate(1deg); } }
      .cpay-illustration { animation: cpay-illus-idle 5s ease-in-out infinite; transition: transform 0.4s cubic-bezier(0.34,1.56,0.64,1), filter 0.4s ease; cursor: pointer; }
      .cpay-illustration:hover { animation-play-state: paused; transform: scale(1.15) translateY(-10px) rotate(-3deg); filter: drop-shadow(0 12px 32px rgba(16,185,129,0.25)) brightness(1.1); }

      /* Animated gradient border for featured cards */
      @keyframes cpay-border-glow { 0%,100% { border-color: rgba(16,185,129,0.12); } 50% { border-color: rgba(16,185,129,0.3); } }
      .cpay-glow-border-anim { animation: cpay-border-glow 3s ease-in-out infinite; }

      /* Pill badge pulse */
      @keyframes cpay-badge-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.3); } 50% { box-shadow: 0 0 0 6px rgba(16,185,129,0); } }
      .cpay-badge-pulse { animation: cpay-badge-pulse 2s ease-in-out infinite; }

      /* Feature icon color shift on hover */
      .cpay-bento-card:hover .cpay-feat-icon { transform: scale(1.2) rotate(-8deg); }
      .cpay-feat-icon { transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1); }

      /* CTA button ripple */
      @keyframes cpay-ripple { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,0.4); } 100% { box-shadow: 0 0 0 20px rgba(16,185,129,0); } }
      .cpay-cta-ripple { animation: cpay-ripple 2s ease-out infinite; }

      /* Smooth scroll behavior */
      html { scroll-behavior: smooth; }

      /* Selection color */
      ::selection { background: rgba(16,185,129,0.3); color: #fff; }

      /* Nav link underline on hover */
      .cpay-nav-link { position: relative; }
      .cpay-nav-link::after { content: ''; position: absolute; bottom: 2px; left: 50%; width: 0; height: 2px; background: #10B981; transition: all 0.3s cubic-bezier(0.4,0,0.2,1); transform: translateX(-50%); border-radius: 1px; }
      .cpay-nav-link:hover::after { width: 70%; }
      .cpay-nav-link:hover { color: #10B981 !important; }

      /* Card magnetic tilt on mouse move */
      .cpay-tilt-card { transition: transform 0.15s ease, box-shadow 0.3s ease; will-change: transform; }

      /* Glowing border animation for CTA section */
      @keyframes cpay-glow-sweep { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
      .cpay-glow-ring { background: linear-gradient(90deg, rgba(16,185,129,0.1), rgba(16,185,129,0.4), rgba(245,158,11,0.3), rgba(16,185,129,0.1)); background-size: 200% 100%; animation: cpay-glow-sweep 3s linear infinite; }

      /* Stagger children entrance */
      .cpay-stagger > * { opacity: 0; animation: cpay-stagger-in 0.6s ease forwards; }
      .cpay-stagger > *:nth-child(1) { animation-delay: 0.1s; }
      .cpay-stagger > *:nth-child(2) { animation-delay: 0.2s; }
      .cpay-stagger > *:nth-child(3) { animation-delay: 0.3s; }
      .cpay-stagger > *:nth-child(4) { animation-delay: 0.4s; }
      .cpay-stagger > *:nth-child(5) { animation-delay: 0.5s; }
      .cpay-stagger > *:nth-child(6) { animation-delay: 0.6s; }
      @keyframes cpay-stagger-in { to { opacity: 1; } }

      /* Comparison winner glow */
      .cpay-winner-col { position: relative; }
      .cpay-winner-col::before { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(180deg, rgba(16,185,129,0.04) 0%, rgba(16,185,129,0.01) 100%); pointer-events: none; }
    `;
    document.head.appendChild(style);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: HERO — Full-width 2-col on desktop, stacked on mobile
  // ═══════════════════════════════════════════════════════════════════════
  const heroMockupWidth = isMobile ? Math.min(width - 40, 400) : isTablet ? 420 : Math.min(width * 0.38, 520);
  const heroPad = width >= 1400 ? 80 : width >= 1024 ? 48 : width >= 768 ? 32 : 20;

  const heroSection = (
    <View style={{
      paddingTop: isMobile ? 100 : 130, paddingBottom: isMobile ? 40 : 72,
      position: "relative", overflow: "hidden",
      ...(isWeb ? { background: "linear-gradient(180deg, #060E1F 0%, #0C1A30 40%, #0A1628 100%)" } as any : { backgroundColor: "#060E1F" }),
    }}>
      {/* Background effects */}
      {isWeb && <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.25, ...(isWeb ? { backgroundImage: "radial-gradient(circle, rgba(16,185,129,0.06) 1px, transparent 1px)", backgroundSize: "36px 36px" } as any : {}) }} />}
      {isWeb && <>
        <View style={{ position: "absolute", top: -200, left: -200, width: 700, height: 700, borderRadius: 350, backgroundColor: "#10B981", opacity: 0.1, ...(isWeb ? { filter: "blur(130px)", animation: "cpay-aurora 25s ease infinite", willChange: "transform" } as any : {}) } as any} />
        <View style={{ position: "absolute", bottom: -150, right: -150, width: 550, height: 550, borderRadius: 275, backgroundColor: "#6366F1", opacity: 0.06, ...(isWeb ? { filter: "blur(130px)", animation: "cpay-aurora 30s ease infinite reverse" } as any : {}) } as any} />
        <View style={{ position: "absolute", top: 80, right: -80, width: 400, height: 400, borderRadius: 200, backgroundColor: "#F59E0B", opacity: 0.05, ...(isWeb ? { filter: "blur(130px)", animation: "cpay-aurora 35s ease infinite 3s" } as any : {}) } as any} />
      </>}
      {isWeb && !isMobile && [
        { s: 4, l: "12%", t: "20%", d: "0s", dur: "8s" }, { s: 3, l: "78%", t: "30%", d: "2s", dur: "10s" },
        { s: 5, l: "50%", t: "70%", d: "4s", dur: "12s" }, { s: 3, l: "88%", t: "60%", d: "1s", dur: "9s" },
      ].map((p, i) => (
        <View key={`p-${i}`} style={{ position: "absolute", left: p.l as any, top: p.t as any, width: p.s, height: p.s, borderRadius: p.s / 2, backgroundColor: "#10B981", zIndex: 1, ...(isWeb ? { animation: `cpay-particle ${p.dur} ease-in-out ${p.d} infinite`, opacity: 0.3 } as any : {}) } as any} />
      ))}
      {!isMobile && <>
        <FloatingCoin uri={COIN_ICONS[0].uri} color={COIN_ICONS[0].color} size={64} left="4%" top="15%" delay={0} />
        <FloatingCoin uri={COIN_ICONS[1].uri} color={COIN_ICONS[1].color} size={54} left="92%" top="12%" delay={400} />
        <FloatingCoin uri={COIN_ICONS[2].uri} color={COIN_ICONS[2].color} size={48} left="6%" top="78%" delay={700} />
        <FloatingCoin uri={COIN_ICONS[3].uri} color={COIN_ICONS[3].color} size={52} left="89%" top="75%" delay={1000} />
      </>}
      {isMobile && <>
        <FloatingCoin uri={COIN_ICONS[0].uri} color={COIN_ICONS[0].color} size={40} left="3%" top="6%" delay={0} />
        <FloatingCoin uri={COIN_ICONS[1].uri} color={COIN_ICONS[1].color} size={36} left="85%" top="5%" delay={300} />
      </>}

      {/* ── HERO MAIN CONTENT — 2-col on desktop, centered max-width ── */}
      <View style={{
        flexDirection: isDesktop ? "row" : "column",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: heroPad,
        zIndex: 10, gap: isDesktop ? 56 : 32,
        width: "100%", maxWidth: 1280, alignSelf: "center" as any,
      }}>
        {/* LEFT: Text content */}
        <RevealOnScroll variant="slide-left" style={{ flex: isDesktop ? 1 : undefined, maxWidth: isDesktop ? 620 : undefined }}>
          <View style={{ alignItems: isDesktop ? "flex-start" : "center" }}>
            <Text style={{
              color: tc.textPrimary, fontSize: isMobile ? 34 : isTablet ? 42 : width >= 1400 ? 58 : 50,
              fontFamily: "DMSans_700Bold", textAlign: isDesktop ? "left" : "center", letterSpacing: -1.5,
              lineHeight: isMobile ? 42 : isTablet ? 52 : width >= 1400 ? 68 : 60, marginBottom: 20,
            }}>
              {isWeb ? (
                <>Pay bills in Kenya{"\n"}directly from crypto.{"\n"}<span className="cpay-gradient-headline">No P2P. No waiting.</span></>
              ) : (
                <>Pay bills in Kenya{"\n"}directly from crypto.{"\n"}<Text style={{ color: tc.primary[400] }}>No P2P. No waiting.</Text></>
              )}
            </Text>
            <Text style={{ color: tc.textSecondary, fontSize: isMobile ? 16 : 18, fontFamily: "DMSans_400Regular", textAlign: isDesktop ? "left" : "center", lineHeight: isMobile ? 25 : 28, maxWidth: 500, marginBottom: 24 }}>
              Drop your USDT, BTC, ETH, or SOL — we convert and send KES to any Paybill, Till, or phone number via M-Pesa in under 30 seconds.
            </Text>
            {/* Feature pills */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 28, justifyContent: isDesktop ? "flex-start" : "center" }}>
              {[
                { icon: "lock-closed" as keyof typeof Ionicons.glyphMap, text: "Rate locked 90s" },
                { icon: "flash" as keyof typeof Ionicons.glyphMap, text: "Under 30 seconds" },
                { icon: "shield-checkmark" as keyof typeof Ionicons.glyphMap, text: "HD wallet security" },
              ].map((pill) => (
                <View key={pill.text} style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(16,185,129,0.06)", borderWidth: 1, borderColor: "rgba(16,185,129,0.15)", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14 }}>
                  <Ionicons name={pill.icon} size={13} color={tc.primary[400]} />
                  <Text style={{ color: tc.primary[300], fontSize: 13, fontFamily: "DMSans_500Medium" }}>{pill.text}</Text>
                </View>
              ))}
            </View>
            {/* CTAs */}
            <View style={{ flexDirection: isMobile ? "column" : "row", gap: 14, alignItems: isMobile ? "stretch" : "center", width: isMobile ? "100%" : undefined }}>
              <Pressable onPress={navigateToRegister} style={({ hovered, pressed }: any) => ({
                backgroundColor: hovered ? tc.primary[400] : tc.primary[500], borderRadius: 999,
                paddingVertical: 16, paddingHorizontal: 36, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
                opacity: pressed ? 0.9 : 1,
                ...(isWeb ? { cursor: "pointer", transition: "all 0.25s ease", boxShadow: hovered ? "0 12px 36px rgba(16,185,129,0.45)" : "0 6px 20px rgba(16,185,129,0.25)", transform: hovered ? "translateY(-2px)" : "none" } as any : {}),
                ...(isMobile ? { maxWidth: 400, alignSelf: "center" as any, width: "100%" } : {}),
              })}>
                <Ionicons name="flash" size={18} color="#fff" />
                <Text style={{ color: "#fff", fontSize: 16, fontFamily: "DMSans_700Bold" }}>Get Started Free</Text>
              </Pressable>
              <Pressable onPress={() => scrollToSection("howItWorks")} style={({ hovered, pressed }: any) => ({
                paddingVertical: 14, paddingHorizontal: 28, borderRadius: 999, borderWidth: 1.5,
                borderColor: hovered ? tc.primary[400] : "rgba(255,255,255,0.12)",
                backgroundColor: hovered ? "rgba(16,185,129,0.06)" : "transparent",
                flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, opacity: pressed ? 0.9 : 1,
                ...(isWeb ? { cursor: "pointer", transition: "all 0.25s ease" } as any : {}),
                ...(isMobile ? { maxWidth: 400, alignSelf: "center" as any, width: "100%" } : {}),
              })}>
                <Ionicons name="play-circle-outline" size={17} color={tc.textSecondary} />
                <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_600SemiBold" }}>See How It Works</Text>
              </Pressable>
            </View>
            {/* Sign in + store badges */}
            <Pressable onPress={navigateToLogin} style={({ hovered }: any) => ({ marginTop: 14, flexDirection: "row", alignItems: "center", gap: 6, alignSelf: isDesktop ? "flex-start" as any : "center" as any, backgroundColor: hovered ? "rgba(255,255,255,0.03)" : "transparent", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, ...(isWeb ? { cursor: "pointer", transition: "all 0.2s ease" } as any : {}) })}>
              <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_400Regular" }}>
                Already have an account? <Text style={{ color: tc.primary[300], fontFamily: "DMSans_600SemiBold" }}>Sign In</Text>
              </Text>
            </Pressable>
            <View style={{ flexDirection: "row", gap: 12, marginTop: 14, justifyContent: isDesktop ? "flex-start" : "center" }}>
              <Pressable onPress={() => { const u = `https://cpay.co.ke/download/cryptopay.apk?v=${Date.now()}`; if (isWeb) { window.location.href = u; } else Linking.openURL(u); }}
                style={({ hovered }: any) => ({ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: hovered ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14, ...(isWeb ? { cursor: "pointer", transition: "all 0.2s ease" } as any : {}) })}>
                <Image source={STORE_ICONS.googlePlay} style={{ width: 20, height: 20 }} resizeMode="contain" />
                <View><Text style={{ color: tc.textMuted, fontSize: 8, fontFamily: "DMSans_400Regular" }}>DOWNLOAD</Text><Text style={{ color: tc.textPrimary, fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>Android APK</Text></View>
              </Pressable>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(255,255,255,0.02)", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14, opacity: 0.5 }}>
                <Image source={STORE_ICONS.appStore} style={{ width: 20, height: 20, opacity: 0.7 }} resizeMode="contain" />
                <View><Text style={{ color: tc.textMuted, fontSize: 8, fontFamily: "DMSans_400Regular" }}>Download on the</Text><Text style={{ color: tc.textSecondary, fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>App Store</Text></View>
              </View>
            </View>
          </View>
        </RevealOnScroll>

        {/* RIGHT: App Mockup — 3D float animation */}
        <RevealOnScroll delay={200} variant="slide-right" style={{ alignItems: "center" }}>
          <View
            ref={(ref: any) => { if (isWeb && ref instanceof HTMLElement) ref.className = "cpay-hero-mockup"; }}
            style={{
              width: heroMockupWidth, backgroundColor: "rgba(12,26,46,0.88)",
              borderRadius: 24, borderWidth: 1.5, borderColor: "rgba(16,185,129,0.15)",
              padding: isMobile ? 18 : 24, overflow: "hidden",
              ...(isWeb ? { backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", boxShadow: "0 20px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(16,185,129,0.08)", willChange: "transform" } as any : {}),
            } as any}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 }}>
              <Image source={APP_LOGO} style={{ width: 40, height: 40, borderRadius: 12, ...(isWeb ? { boxShadow: "0 4px 14px rgba(16,185,129,0.3)" } as any : {}) }} resizeMode="cover" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: tc.textPrimary, fontSize: 16, fontFamily: "DMSans_700Bold" }}>CryptoPay</Text>
                <Text style={{ color: tc.textMuted, fontSize: 10, fontFamily: "DMSans_400Regular" }}>Pay bills with crypto</Text>
              </View>
              <Image source={{ uri: CDN_IMAGES.cryptoCoins }} style={{ width: 44, height: 44, borderRadius: 12, opacity: 0.8 }} resizeMode="cover" />
            </View>
            <View style={{ backgroundColor: "#060E1F", borderRadius: 14, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.03)" }}>
              <Text style={{ color: tc.textMuted, fontSize: 9, fontFamily: "DMSans_600SemiBold", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6 }}>Total Balance</Text>
              <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
                <Text style={{ color: tc.textPrimary, fontSize: isMobile ? 26 : 30, fontFamily: "DMSans_700Bold", letterSpacing: -1 }}>
                  7.88 <Text style={{ fontSize: 14, color: tc.primary[400], fontFamily: "DMSans_600SemiBold" }}>USDT</Text>
                </Text>
                <Text style={{ color: tc.primary[400], fontSize: 12, fontFamily: "DMSans_500Medium" }}>{"\u2248"} KSh 1,018</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {[
                { icon: "arrow-down" as const, label: "Deposit", color: tc.primary[500] },
                { icon: "send" as const, label: "Pay Bill", color: "#3B82F6" },
                { icon: "swap-horizontal" as const, label: "Send", color: "#8B5CF6" },
                { icon: "cart" as const, label: "Buy", color: "#F59E0B" },
              ].map((a) => (
                <View key={a.label} style={{ flex: 1, alignItems: "center", backgroundColor: "#060E1F", borderRadius: 10, paddingVertical: 10, gap: 4, borderWidth: 1, borderColor: "rgba(255,255,255,0.02)" }}>
                  <View style={{ width: 28, height: 28, borderRadius: 7, backgroundColor: a.color + "15", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name={a.icon} size={13} color={a.color} />
                  </View>
                  <Text style={{ color: tc.textSecondary, fontSize: 9, fontFamily: "DMSans_500Medium" }}>{a.label}</Text>
                </View>
              ))}
            </View>
            <View style={{ marginTop: 10, gap: 5 }}>
              {[
                { name: "KPLC Electricity", amount: "KSh 2,500", time: "Just now" },
                { name: "Safaricom Airtime", amount: "KSh 100", time: "2 min ago" },
              ].map((tx) => (
                <View key={tx.name} style={{ backgroundColor: "#060E1F", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.02)", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ width: 26, height: 26, borderRadius: 7, backgroundColor: tc.primary[500] + "15", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="checkmark-circle" size={13} color={tc.primary[400]} />
                    </View>
                    <View>
                      <Text style={{ color: tc.textPrimary, fontSize: 11, fontFamily: "DMSans_600SemiBold" }}>{tx.name}</Text>
                      <Text style={{ color: tc.textMuted, fontSize: 9, fontFamily: "DMSans_400Regular" }}>{tx.time}</Text>
                    </View>
                  </View>
                  <Text style={{ color: tc.primary[400], fontSize: 11, fontFamily: "DMSans_700Bold" }}>{tx.amount}</Text>
                </View>
              ))}
            </View>
          </View>
        </RevealOnScroll>
      </View>

      {/* Trusted by — animated partner cards with hover */}
      <RevealOnScroll delay={500} variant="fade-up">
        <View style={{ alignItems: "center", marginTop: isMobile ? 36 : 52, paddingHorizontal: 20, zIndex: 10 }}>
          <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_600SemiBold", textTransform: "uppercase", letterSpacing: 2, marginBottom: 16 }}>
            Trusted Technology
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: isMobile ? 10 : 16 }}>
            {[
              { logo: PARTNER_LOGOS.mpesa, label: "M-Pesa", desc: "Payments", color: "#00A650" },
              { logo: PARTNER_LOGOS.smileIdentity, label: "Smile Identity", desc: "KYC", color: "#10B981" },
              { logo: PARTNER_LOGOS.coingecko, label: "CoinGecko", desc: "Rates", color: "#F59E0B" },
              { logo: PARTNER_LOGOS.sentry, label: "Sentry", desc: "Monitoring", color: "#6366F1" },
            ].map((p) => (
              <Pressable
                key={p.label}
                ref={(ref: any) => { if (isWeb && ref instanceof HTMLElement) ref.className = "cpay-service-card"; }}
                style={({ hovered }: any) => ({
                  flexDirection: "row", alignItems: "center", gap: 12,
                  backgroundColor: isWeb && hovered ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)",
                  borderRadius: 14, borderWidth: 1,
                  borderColor: isWeb && hovered ? p.color + "30" : "rgba(255,255,255,0.06)",
                  paddingVertical: isMobile ? 10 : 14, paddingHorizontal: isMobile ? 14 : 20,
                  ...(isWeb ? {
                    cursor: "default", transition: "all 0.3s ease",
                    boxShadow: hovered ? `0 8px 24px ${p.color}15` : "none",
                  } as any : {}),
                }) as any}
              >
                <Image source={p.logo} style={{ width: isMobile ? 28 : 36, height: isMobile ? 28 : 36, borderRadius: 8 }} resizeMode="contain" />
                <View>
                  <Text style={{ color: tc.textPrimary, fontSize: isMobile ? 13 : 15, fontFamily: "DMSans_700Bold" }}>{p.label}</Text>
                  <Text style={{ color: tc.textMuted, fontSize: isMobile ? 11 : 12, fontFamily: "DMSans_400Regular" }}>{p.desc}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      </RevealOnScroll>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: SERVICES CAROUSEL — slide-right reveal
  // ═══════════════════════════════════════════════════════════════════════
  const serviceCard = (service: typeof KENYAN_SERVICES[0], idx: number) => (
    <View
      key={`${service.name}-${idx}`}
      ref={(ref: any) => { if (isWeb && ref instanceof HTMLElement) ref.className = "cpay-service-card"; }}
      style={{
        alignItems: "center", backgroundColor: "rgba(255,255,255,0.02)", borderRadius: 16,
        borderWidth: 1, borderColor: "rgba(255,255,255,0.05)",
        paddingVertical: isMobile ? 16 : 22, paddingHorizontal: isMobile ? 16 : 28,
        minWidth: isMobile ? 120 : 170, marginRight: isMobile ? 10 : 16,
      } as any}
    >
      <Image source={service.logo} style={{ width: isMobile ? 44 : 52, height: isMobile ? 44 : 52, borderRadius: 14, marginBottom: 10 }} resizeMode="contain" />
      <Text style={{ color: tc.textPrimary, fontSize: isMobile ? 13 : 15, fontFamily: "DMSans_700Bold", textAlign: "center" }} numberOfLines={1}>{service.name}</Text>
      <Text style={{ color: tc.textSecondary, fontSize: isMobile ? 12 : 13, fontFamily: "DMSans_500Medium", marginTop: 3 }}>{service.desc}</Text>
    </View>
  );
  const row1 = KENYAN_SERVICES.slice(0, 6); const row2 = KENYAN_SERVICES.slice(6);
  const doubledRow1 = [...row1, ...row1]; const doubledRow2 = [...row2, ...row2];

  const servicesSection = (
    <View style={{ paddingVertical: isMobile ? 36 : 64, ...(isWeb ? { background: "linear-gradient(180deg, #0A1628 0%, #081420 100%)", borderTop: "1px solid rgba(16,185,129,0.06)" } as any : { backgroundColor: "#0A1628" }) }}>
      <Section>
        <RevealOnScroll variant="slide-right">
          <View style={{ flexDirection: isDesktop ? "row" : "column", alignItems: "center", justifyContent: "center", marginBottom: isMobile ? 28 : 44, gap: isDesktop ? 32 : 16, overflow: "hidden" }}>
            {isDesktop && <SvgIllustration uri={ILLUSTRATIONS.finance} size={100} style={{ opacity: 0.7, flexShrink: 0 }} />}
            <View style={{ alignItems: isDesktop ? "flex-start" : "center", flex: 1 }}>
              <Text style={{ color: tc.primary[400], fontSize: 13, fontFamily: "DMSans_700Bold", textTransform: "uppercase", letterSpacing: 3, marginBottom: 12 }}>Supported Services</Text>
              <Text style={{ color: tc.textPrimary, fontSize: isMobile ? 28 : 40, fontFamily: "DMSans_700Bold", textAlign: isDesktop ? "left" : "center", letterSpacing: -1 }}>Every bill, every provider</Text>
              <Text style={{ color: tc.textSecondary, fontSize: isMobile ? 15 : 17, fontFamily: "DMSans_400Regular", lineHeight: isMobile ? 23 : 26, marginTop: 10, textAlign: isDesktop ? "left" : "center", maxWidth: 500 }}>
                From KPLC electricity tokens to school fees, DSTV subscriptions to Safaricom airtime — if it has a Paybill or Till number, you can pay it with crypto.
              </Text>
            </View>
            {isDesktop && <SvgIllustration uri={ILLUSTRATIONS.onlineWorld} size={100} style={{ opacity: 0.7, flexShrink: 0 }} />}
          </View>
        </RevealOnScroll>

        {/* Desktop: full-width grid of ALL services */}
        {isDesktop && isWeb && (
          <RevealOnScroll variant="fade-up" delay={100}>
            <View style={{
              ...(isWeb ? { display: "grid" as any, gridTemplateColumns: "repeat(6, 1fr)", gap: 20, marginBottom: 24 } as any : {}),
            }}>
              {KENYAN_SERVICES.slice(0, 6).map((service) => (
                <View
                  key={service.name}
                  ref={(ref: any) => { if (isWeb && ref instanceof HTMLElement) ref.className = "cpay-service-card"; }}
                  style={{
                    alignItems: "center", justifyContent: "center",
                    backgroundColor: "rgba(255,255,255,0.02)", borderRadius: 18,
                    borderWidth: 1, borderColor: "rgba(255,255,255,0.05)",
                    paddingVertical: 28, paddingHorizontal: 20,
                  } as any}
                >
                  <Image source={service.logo} style={{ width: 60, height: 60, borderRadius: 16, marginBottom: 14 }} resizeMode="contain" />
                  <Text style={{ color: tc.textPrimary, fontSize: 15, fontFamily: "DMSans_700Bold", textAlign: "center" }}>{service.name}</Text>
                  <Text style={{ color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_500Medium", marginTop: 4 }}>{service.desc}</Text>
                </View>
              ))}
            </View>
            <View style={{
              ...(isWeb ? { display: "grid" as any, gridTemplateColumns: "repeat(5, 1fr)", gap: 20, maxWidth: "85%", marginLeft: "auto", marginRight: "auto" } as any : {}),
            }}>
              {KENYAN_SERVICES.slice(6).map((service) => (
                <View
                  key={service.name}
                  ref={(ref: any) => { if (isWeb && ref instanceof HTMLElement) ref.className = "cpay-service-card"; }}
                  style={{
                    alignItems: "center", justifyContent: "center",
                    backgroundColor: "rgba(255,255,255,0.02)", borderRadius: 18,
                    borderWidth: 1, borderColor: "rgba(255,255,255,0.05)",
                    paddingVertical: 28, paddingHorizontal: 20,
                  } as any}
                >
                  <Image source={service.logo} style={{ width: 60, height: 60, borderRadius: 16, marginBottom: 14 }} resizeMode="contain" />
                  <Text style={{ color: tc.textPrimary, fontSize: 15, fontFamily: "DMSans_700Bold", textAlign: "center" }}>{service.name}</Text>
                  <Text style={{ color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_500Medium", marginTop: 4 }}>{service.desc}</Text>
                </View>
              ))}
            </View>
          </RevealOnScroll>
        )}

        {/* Tablet: carousel */}
        {isWeb && !isDesktop && (
          <RevealOnScroll variant="fade-in">
            <View style={{ overflow: "hidden", width: "100%" } as any}>
              <View style={{ overflow: "hidden", marginBottom: 14 } as any}>
                <View ref={(ref: any) => { if (isWeb && ref instanceof HTMLElement) ref.className = "cpay-carousel-track"; }} style={{ display: "flex", flexDirection: "row", width: "max-content" } as any}>
                  {doubledRow1.map((s, i) => serviceCard(s, i))}
                </View>
              </View>
            </View>
          </RevealOnScroll>
        )}

        {/* Native: horizontal scroll */}
        {!isWeb && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 10 }}>
            {KENYAN_SERVICES.map((s, i) => serviceCard(s, i))}
          </ScrollView>
        )}
      </Section>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: PROBLEM — slide-left/right split + CDN image
  // Background: warmer tint with Unsplash accent image
  // ═══════════════════════════════════════════════════════════════════════
  const problemSection = (
    <View style={{ paddingVertical: isMobile ? 48 : 80, position: "relative", overflow: "hidden", ...(isWeb ? { background: "linear-gradient(180deg, #081420 0%, #0D1825 50%, #0A1628 100%)" } as any : { backgroundColor: "#0D1825" }) }}>
      {/* Background image accent */}
      {isWeb && !isMobile && (
        <View style={{ position: "absolute", top: 0, right: 0, width: "35%", height: "100%", opacity: 0.06, ...(isWeb ? { backgroundImage: `url(${CDN_IMAGES.cryptoCoins})`, backgroundSize: "cover", backgroundPosition: "center", filter: "blur(2px)" } as any : {}) } as any} />
      )}
      <Section>
        <RevealOnScroll variant="fade-up">
          <View style={{ alignItems: "center", marginBottom: isMobile ? 32 : 48 }}>
            <Text style={{ color: "#EF4444", fontSize: 12, fontFamily: "DMSans_700Bold", textTransform: "uppercase", letterSpacing: 3, marginBottom: 12 }}>The Problem</Text>
            <Text style={{ color: tc.textPrimary, fontSize: isMobile ? 28 : 42, fontFamily: "DMSans_700Bold", textAlign: "center", letterSpacing: -1, lineHeight: isMobile ? 36 : 52, maxWidth: 700 }}>
              P2P trading is broken.{"\n"}You already know this.
            </Text>
            <Text style={{ color: tc.textSecondary, fontSize: isMobile ? 15 : 17, fontFamily: "DMSans_400Regular", textAlign: "center", lineHeight: isMobile ? 23 : 26, marginTop: 14, maxWidth: 540 }}>
              Waiting 45 minutes for a trader to release your funds. Getting ghosted mid-trade. Paying 5-8% in hidden spreads. Sound familiar?
            </Text>
          </View>
        </RevealOnScroll>
        <View style={{ flexDirection: isMobile ? "column" : "row", gap: isMobile ? 20 : 28 }}>
          <RevealOnScroll delay={100} variant="slide-left" style={{ flex: 1 }}>
            <View
              ref={(ref: any) => { if (isWeb && ref instanceof HTMLElement) ref.className = "cpay-problem-card"; }}
              style={{ flex: 1, backgroundColor: "rgba(239,68,68,0.03)", borderRadius: 20, borderWidth: 1, borderColor: "rgba(239,68,68,0.12)", padding: isMobile ? 24 : 36 } as any}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(239,68,68,0.12)", alignItems: "center", justifyContent: "center" }}><Ionicons name="close-circle" size={20} color="#EF4444" /></View>
                  <Text style={{ color: "#EF4444", fontSize: 17, fontFamily: "DMSans_700Bold" }}>The old way</Text>
                </View>
                <SvgIllustration uri={ILLUSTRATIONS.bitcoin} size={isMobile ? 50 : 80} style={{ opacity: 0.6 }} />
              </View>
              {["Find a P2P trader on an exchange", "Negotiate rate, hope for the best", "Send crypto and wait for KES", "Go to M-Pesa and manually pay bill", "Pray the trader was honest"].map((s, i) => (
                <View key={i} style={{ flexDirection: "row", gap: 12, marginBottom: 10 }}>
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(239,68,68,0.1)", alignItems: "center", justifyContent: "center", marginTop: 2 }}><Text style={{ color: "#EF4444", fontSize: 11, fontFamily: "DMSans_700Bold" }}>{i + 1}</Text></View>
                  <Text style={{ color: tc.textSecondary, fontSize: 14, fontFamily: "DMSans_400Regular", lineHeight: 22, flex: 1 }}>{s}</Text>
                </View>
              ))}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, backgroundColor: "rgba(239,68,68,0.06)", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 }}>
                <Ionicons name="time" size={16} color="#EF4444" /><Text style={{ color: "#EF4444", fontSize: 14, fontFamily: "DMSans_700Bold" }}>30+ minutes, 5-8% fees</Text>
              </View>
            </View>
          </RevealOnScroll>
          <RevealOnScroll delay={300} variant="slide-right" style={{ flex: 1 }}>
            <View
              ref={(ref: any) => { if (isWeb && ref instanceof HTMLElement) ref.className = "cpay-problem-card"; }}
              style={{ flex: 1, backgroundColor: "rgba(16,185,129,0.03)", borderRadius: 20, borderWidth: 1, borderColor: "rgba(16,185,129,0.12)", padding: isMobile ? 24 : 36, ...(isWeb ? { boxShadow: "0 8px 40px rgba(16,185,129,0.04)" } as any : {}) } as any}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(16,185,129,0.12)", alignItems: "center", justifyContent: "center", ...(isWeb ? { boxShadow: "0 4px 12px rgba(16,185,129,0.15)" } as any : {}) }}><Ionicons name="flash" size={20} color={tc.primary[400]} /></View>
                  <Text style={{ color: tc.primary[400], fontSize: 17, fontFamily: "DMSans_700Bold" }}>With CryptoPay</Text>
                </View>
                <SvgIllustration uri={ILLUSTRATIONS.creditCard} size={isMobile ? 50 : 80} style={{ opacity: 0.7 }} />
              </View>
              {[{ step: "Enter Paybill or Till number", icon: "receipt" as const }, { step: "Rate locks for 90 seconds — no surprises", icon: "lock-closed" as const }, { step: "Confirm with PIN. M-Pesa delivers instantly.", icon: "checkmark-circle" as const }].map((item, i) => (
                <View key={i} style={{ flexDirection: "row", gap: 12, marginBottom: 14 }}>
                  <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(16,185,129,0.1)", alignItems: "center", justifyContent: "center", marginTop: 1 }}><Ionicons name={item.icon} size={14} color={tc.primary[400]} /></View>
                  <Text style={{ color: tc.textPrimary, fontSize: 15, fontFamily: "DMSans_500Medium", lineHeight: 23, flex: 1 }}>{item.step}</Text>
                </View>
              ))}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, backgroundColor: "rgba(16,185,129,0.06)", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 }}>
                <Ionicons name="flash" size={16} color={tc.primary[400]} /><Text style={{ color: tc.primary[400], fontSize: 14, fontFamily: "DMSans_700Bold" }}>30 seconds, 1.5% fee</Text>
              </View>
              {/* Mobile payment image accent */}
              {!isMobile && <Image source={{ uri: CDN_IMAGES.mobilePayment }} style={{ width: "100%", height: 100, borderRadius: 12, marginTop: 16, opacity: 0.15 } as any} resizeMode="cover" />}
            </View>
          </RevealOnScroll>
        </View>
      </Section>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: STATS — scale-up oversized numbers + Nairobi image
  // ═══════════════════════════════════════════════════════════════════════
  const statsSection = (
    <View ref={usersCounter.viewRef as any} style={{
      paddingVertical: isMobile ? 40 : 64, position: "relative", overflow: "hidden",
      ...(isWeb ? { background: "linear-gradient(135deg, rgba(16,185,129,0.06) 0%, #060E1F 40%, rgba(99,102,241,0.04) 100%)", borderTop: "1px solid rgba(16,185,129,0.08)", borderBottom: "1px solid rgba(16,185,129,0.08)" } as any : { backgroundColor: "#060E1F" }),
    }}>
      {/* Nairobi skyline background */}
      {isWeb && !isMobile && <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "60%", opacity: 0.04, ...(isWeb ? { backgroundImage: `url(${CDN_IMAGES.nairobiSkyline})`, backgroundSize: "cover", backgroundPosition: "bottom center", filter: "blur(1px)" } as any : {}) } as any} />}
      <Section>
        <RevealOnScroll variant="scale-up">
          <View style={{ alignItems: "center", marginBottom: isMobile ? 24 : 36 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Image source={{ uri: KENYA_FLAG }} style={{ width: 24, height: 17, borderRadius: 2 }} />
              <Text style={{ color: tc.primary[400], fontSize: 12, fontFamily: "DMSans_700Bold", textTransform: "uppercase", letterSpacing: 2 }}>Kenya Crypto Adoption</Text>
            </View>
            <Text style={{ color: tc.textPrimary, fontSize: isMobile ? 18 : 22, fontFamily: "DMSans_600SemiBold", textAlign: "center", lineHeight: isMobile ? 26 : 32, maxWidth: 600 }}>
              730K+ Kenyans use crypto. None of them can pay their electricity bill with it.{" "}
              <Text style={{ color: tc.primary[400], fontFamily: "DMSans_700Bold" }}>Until now.</Text>
            </Text>
          </View>
        </RevealOnScroll>
        <RevealOnScroll delay={200} variant="scale-up">
          <View style={{ flexDirection: isMobile ? "column" : "row", justifyContent: "space-around", gap: isMobile ? 28 : 16 }}>
            {[
              { value: `${usersCounter.count.toLocaleString()}K+`, label: "Crypto users in Kenya", color: tc.primary[400] },
              { value: liveRate, label: "USDT/KES rate (live)", color: "#F59E0B" },
              { value: `< ${speedCounter.count}s`, label: "Average payment speed", color: "#3B82F6" },
              { value: "1.5%", label: "Transparent fee", color: "#8B5CF6" },
            ].map((stat) => (
              <View key={stat.label} style={{ alignItems: "center" }}>
                {isWeb ? (
                  <span className="cpay-stat-number" style={{ color: stat.color, fontSize: isMobile ? 40 : 56, fontFamily: "DMSans_700Bold", letterSpacing: -2, lineHeight: isMobile ? "48px" : "64px", marginBottom: 6 } as any}>{stat.value}</span>
                ) : (
                  <Text style={{ color: stat.color, fontSize: isMobile ? 40 : 56, fontFamily: "DMSans_700Bold", letterSpacing: -2, marginBottom: 6 }}>{stat.value}</Text>
                )}
                <Text style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_500Medium", textAlign: "center" }}>{stat.label}</Text>
              </View>
            ))}
          </View>
        </RevealOnScroll>
      </Section>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 5: HOW IT WORKS — fade-up staggered + CDN image
  // ═══════════════════════════════════════════════════════════════════════
  const howItWorksSection = (
    <View ref={(ref) => { sectionRefs.current["howItWorks"] = ref; }} style={{
      paddingVertical: isMobile ? 48 : 80,
      ...(isWeb ? { background: "linear-gradient(135deg, #060E1F 0%, #0B1A2E 30%, #0D1F35 60%, #060E1F 100%)" } as any : { backgroundColor: "#0B1A2E" }),
    }}>
      <Section>
        <RevealOnScroll variant="fade-up">
          <View style={{ flexDirection: isDesktop ? "row" : "column", alignItems: "center", justifyContent: "center", gap: isDesktop ? 40 : 16, marginBottom: isMobile ? 36 : 56 }}>
            <SvgIllustration uri={ILLUSTRATIONS.fastLoading} size={isMobile ? 70 : 140} style={{ opacity: 0.75 }} />
            <View style={{ alignItems: isDesktop ? "flex-start" : "center", flex: isDesktop ? 1 : undefined }}>
              <Text style={{ color: tc.primary[400], fontSize: 12, fontFamily: "DMSans_700Bold", textTransform: "uppercase", letterSpacing: 3, marginBottom: 12 }}>How It Works</Text>
              <Text style={{ color: tc.textPrimary, fontSize: isMobile ? 28 : 42, fontFamily: "DMSans_700Bold", textAlign: isDesktop ? "left" : "center", letterSpacing: -1, lineHeight: isMobile ? 36 : 52 }}>Simple as sending a text message</Text>
              <Text style={{ color: tc.textSecondary, fontSize: isMobile ? 15 : 17, fontFamily: "DMSans_400Regular", textAlign: isDesktop ? "left" : "center", marginTop: 12, maxWidth: 480 }}>Deposit, pick a bill, confirm. Your M-Pesa payment arrives before you put your phone down.</Text>
            </View>
          </View>
        </RevealOnScroll>
        <View style={{ flexDirection: isMobile ? "column" : "row", gap: isMobile ? 20 : 28, position: "relative" }}>
          {isDesktop && isWeb && <View style={{ position: "absolute", top: 56, left: "18%", right: "18%", height: 2, zIndex: 0, ...(isWeb ? { background: "linear-gradient(90deg, rgba(16,185,129,0.1) 0%, rgba(16,185,129,0.25) 50%, rgba(16,185,129,0.1) 100%)" } as any : {}) }} />}
          {[
            { num: "01", icon: "wallet" as const, title: "Deposit crypto", desc: "Send USDT, BTC, ETH, or SOL to your personal CryptoPay wallet address.", img: CDN_IMAGES.cryptoCoins, illustration: ILLUSTRATIONS.wallet },
            { num: "02", icon: "receipt" as const, title: "Pick a payment", desc: "Enter a Paybill number, Till number, or phone number. Rate locks for 90 seconds.", img: CDN_IMAGES.mobilePayment, illustration: ILLUSTRATIONS.target },
            { num: "03", icon: "checkmark-circle" as const, title: "Done", desc: "Confirm with your PIN. M-Pesa delivers in under 30 seconds.", img: CDN_IMAGES.speedTrails, illustration: ILLUSTRATIONS.success },
          ].map((step, i) => (
            <RevealOnScroll key={step.num} delay={i * 200} variant="fade-up" style={{ flex: 1, zIndex: 1 }}>
              <View
                ref={(ref: any) => { if (isWeb && ref instanceof HTMLElement) ref.className = "cpay-step-card"; }}
                style={{
                  backgroundColor: "rgba(12,26,46,0.7)", borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
                  padding: isMobile ? 24 : 32, alignItems: "center", overflow: "hidden",
                  ...(isWeb ? { backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" } as any : {}),
                } as any}
              >
                {/* Step image accent */}
                <Image source={{ uri: step.img }} style={{ width: "100%", height: 60, borderRadius: 10, marginBottom: 14, opacity: 0.12 } as any} resizeMode="cover" />
                <Text style={{ color: tc.primary[500] + "20", fontSize: 64, fontFamily: "DMSans_700Bold", letterSpacing: -2, lineHeight: 64, marginBottom: -4 }}>{step.num}</Text>
                <View
                  ref={(ref: any) => { if (isWeb && ref instanceof HTMLElement) ref.className = "cpay-icon-bounce"; }}
                  style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: "rgba(16,185,129,0.08)", borderWidth: 1, borderColor: "rgba(16,185,129,0.15)", alignItems: "center", justifyContent: "center", marginBottom: 14, ...(isWeb ? { boxShadow: "0 6px 24px rgba(16,185,129,0.1)" } as any : {}) } as any}
                >
                  <Ionicons name={step.icon} size={24} color={tc.primary[400]} />
                </View>
                <Text style={{ color: tc.textPrimary, fontSize: 18, fontFamily: "DMSans_700Bold", textAlign: "center", marginBottom: 8 }}>{step.title}</Text>
                <Text style={{ color: tc.textSecondary, fontSize: 14, fontFamily: "DMSans_400Regular", textAlign: "center", lineHeight: 22, maxWidth: 300 }}>{step.desc}</Text>
                {/* Professional illustration */}
                {!isMobile && (
                  <View style={{ marginTop: 16 }}>
                    <SvgIllustration uri={step.illustration} size={isDesktop ? 100 : 80} style={{ opacity: 0.7 }} />
                  </View>
                )}
              </View>
            </RevealOnScroll>
          ))}
        </View>
      </Section>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 6: FEATURES — TRUE bento grid (large cards span 2 cols)
  // ═══════════════════════════════════════════════════════════════════════
  const featuresSection = (
    <View ref={(ref) => { sectionRefs.current["features"] = ref; }} style={{
      paddingVertical: isMobile ? 48 : 80,
      ...(isWeb ? { background: "radial-gradient(ellipse at 30% 50%, rgba(16,185,129,0.04) 0%, transparent 50%), radial-gradient(ellipse at 70% 50%, rgba(245,158,11,0.03) 0%, transparent 50%), linear-gradient(180deg, #060E1F 0%, #081422 50%, #060E1F 100%)" } as any : { backgroundColor: "#081422" }),
    }}>
      <Section>
        <RevealOnScroll variant="scale-up">
          <View style={{ flexDirection: isDesktop ? "row" : "column", alignItems: "center", justifyContent: "center", gap: isDesktop ? 32 : 16, marginBottom: isMobile ? 32 : 52 }}>
            <SvgIllustration uri={ILLUSTRATIONS.wallet} size={isMobile ? 70 : 140} style={{ opacity: 0.8 }} />
            <View style={{ alignItems: isDesktop ? "flex-start" : "center" }}>
              <Text style={{ color: tc.primary[400], fontSize: 12, fontFamily: "DMSans_700Bold", textTransform: "uppercase", letterSpacing: 3, marginBottom: 12 }}>Features</Text>
              <Text style={{ color: tc.textPrimary, fontSize: isMobile ? 28 : 42, fontFamily: "DMSans_700Bold", textAlign: isDesktop ? "left" : "center", letterSpacing: -1, lineHeight: isMobile ? 36 : 52 }}>Everything you need{"\n"}to pay bills with crypto</Text>
            </View>
            <SvgIllustration uri={ILLUSTRATIONS.secureData} size={isMobile ? 70 : 140} style={{ opacity: 0.8 }} />
          </View>
        </RevealOnScroll>
        <View style={{
          ...(isWeb ? { display: "grid" as any, gridTemplateColumns: isMobile ? "1fr" : isTablet ? "1fr 1fr" : "repeat(2, 1fr)", gap: isMobile ? 14 : 20 } as any : { flexDirection: "row", flexWrap: "wrap", gap: 14 }),
        }}>
          {FEATURES.map((feat, i) => (
            <RevealOnScroll key={feat.title} delay={i * 80} variant={i % 2 === 0 ? "fade-up" : "scale-up"}>
              <View
                ref={(ref: any) => { if (isWeb && ref instanceof HTMLElement) ref.className = "cpay-bento-card"; }}
                style={{
                  backgroundColor: "rgba(12,26,46,0.6)", borderRadius: 20, borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.05)",
                  padding: isMobile ? 24 : feat.size === "large" ? 36 : 28,
                  minHeight: feat.size === "large" && !isMobile ? 220 : isMobile ? undefined : 180,
                  ...(isWeb ? {
                    gridColumn: feat.size === "large" && !isMobile && !isTablet ? "span 2" : undefined,
                    backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
                    display: "flex", flexDirection: "column" as any,
                  } as any : {}),
                } as any}
              >
                {/* Icon — centered */}
                <View style={{ alignSelf: "flex-start", marginBottom: 24 }}>
                  <View
                    ref={(ref: any) => { if (isWeb && ref instanceof HTMLElement) ref.className = "cpay-feat-icon"; }}
                    style={{
                      width: feat.size === "large" ? 56 : 48, height: feat.size === "large" ? 56 : 48,
                      borderRadius: feat.size === "large" ? 16 : 14,
                      backgroundColor: feat.accent + "15", borderWidth: 1.5, borderColor: feat.accent + "25",
                      alignItems: "center", justifyContent: "center",
                      ...(isWeb ? { boxShadow: `0 4px 16px ${feat.accent}15` } as any : {}),
                    } as any}
                  >
                    <Ionicons name={feat.icon} size={feat.size === "large" ? 26 : 22} color={feat.accent} />
                  </View>
                </View>

                {/* Title — block level, clear separation */}
                <View style={{ marginBottom: 12 }}>
                  <Text style={{
                    color: tc.textPrimary, fontSize: feat.size === "large" ? 22 : 18,
                    fontFamily: "DMSans_700Bold", lineHeight: feat.size === "large" ? 30 : 26,
                  }}>
                    {feat.title}
                  </Text>
                </View>

                {/* Description — clearly separated */}
                <View style={{ flex: 1 }}>
                  <Text style={{
                    color: tc.textSecondary, fontSize: isMobile ? 14 : 15,
                    fontFamily: "DMSans_400Regular", lineHeight: isMobile ? 22 : 24,
                  }}>
                    {feat.desc}
                  </Text>
                </View>
              </View>
            </RevealOnScroll>
          ))}
        </View>
      </Section>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 7: CRYPTO — slide-left reveal + float animation
  // ═══════════════════════════════════════════════════════════════════════
  const cryptoSection = (
    <View style={{ paddingVertical: isMobile ? 36 : 56, position: "relative", overflow: "hidden", ...(isWeb ? { background: "linear-gradient(180deg, #060E1F 0%, #0B1520 30%, #101820 60%, #060E1F 100%)", borderTop: "1px solid rgba(245,158,11,0.06)", borderBottom: "1px solid rgba(245,158,11,0.06)" } as any : { backgroundColor: "#0B1520" }) }}>
      {/* Decorative crypto background accent */}
      {isWeb && !isMobile && <View style={{ position: "absolute", top: "10%", right: "5%", width: 280, height: 280, borderRadius: 140, backgroundColor: "#F59E0B", opacity: 0.02, ...(isWeb ? { filter: "blur(80px)" } as any : {}) } as any} />}
      <Section>
        <RevealOnScroll variant="slide-left">
          <View style={{ alignItems: "center", marginBottom: isMobile ? 28 : 40 }}>
            <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_700Bold", textTransform: "uppercase", letterSpacing: 3, marginBottom: 10 }}>Supported Chains</Text>
            <Text style={{ color: tc.textPrimary, fontSize: isMobile ? 26 : 36, fontFamily: "DMSans_700Bold", textAlign: "center", letterSpacing: -1 }}>Use the crypto you already hold</Text>
          </View>
        </RevealOnScroll>
        <View style={{ flexDirection: isMobile ? "column" : "row", gap: isMobile ? 10 : 14, justifyContent: "center" }}>
          {COIN_ICONS.map((coin, i) => (
            <RevealOnScroll key={coin.key} delay={i * 100} variant="scale-up" style={{ flex: isMobile ? undefined : 1 }}>
              <Pressable style={({ hovered }: any) => ({
                backgroundColor: "rgba(12,26,46,0.6)", borderRadius: 18, borderWidth: 1,
                borderColor: isWeb && hovered ? coin.color + "40" : "rgba(255,255,255,0.05)",
                padding: isMobile ? 16 : 22, alignItems: "center",
                ...(isWeb ? { transition: "all 0.3s ease", transform: hovered ? "translateY(-6px)" : "none", boxShadow: hovered ? `0 12px 36px ${coin.color}25` : "none", cursor: "default", animation: `cpay-float ${3 + i * 0.5}s ease-in-out infinite ${i * 0.3}s` } as any : {}),
              }) as any}>
                <View style={{ width: isMobile ? 48 : 56, height: isMobile ? 48 : 56, borderRadius: isMobile ? 24 : 28, backgroundColor: coin.color + "10", borderWidth: 2, borderColor: coin.color + "25", alignItems: "center", justifyContent: "center", marginBottom: 12, ...(isWeb ? { boxShadow: `0 0 16px ${coin.color}15` } as any : {}) }}>
                  <Image source={{ uri: coin.uri }} style={{ width: isMobile ? 24 : 28, height: isMobile ? 24 : 28 }} />
                </View>
                <Text style={{ color: tc.textPrimary, fontSize: 15, fontFamily: "DMSans_700Bold", marginBottom: 4 }}>{coin.name}</Text>
                <View style={{ backgroundColor: coin.color + "12", borderRadius: 6, paddingVertical: 3, paddingHorizontal: 10, borderWidth: 1, borderColor: coin.color + "18" }}>
                  <Text style={{ color: coin.color, fontSize: 10, fontFamily: "DMSans_600SemiBold" }}>{coin.network}</Text>
                </View>
              </Pressable>
            </RevealOnScroll>
          ))}
        </View>
      </Section>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 8: PRICING — with illustrations + visual comparison
  // ═══════════════════════════════════════════════════════════════════════
  const pricingSection = (
    <View ref={(ref) => { sectionRefs.current["pricing"] = ref; }} style={{
      paddingVertical: isMobile ? 56 : 96, position: "relative", overflow: "hidden",
      ...(isWeb ? { background: "radial-gradient(ellipse at center top, rgba(245,158,11,0.04) 0%, transparent 40%), linear-gradient(180deg, #0A1628 0%, #0D1825 50%, #060E1F 100%)" } as any : { backgroundColor: "#0A1628" }),
    }}>
      {/* Background accent */}
      {isWeb && <View style={{ position: "absolute", top: "10%", right: "5%", width: 300, height: 300, borderRadius: 150, backgroundColor: "#F59E0B", opacity: 0.02, ...(isWeb ? { filter: "blur(100px)" } as any : {}) } as any} />}
      <Section>
        <RevealOnScroll variant="fade-up">
          <View style={{ flexDirection: isDesktop ? "row" : "column", alignItems: "center", justifyContent: "center", gap: isDesktop ? 40 : 20, marginBottom: isMobile ? 36 : 56 }}>
            <SvgIllustration uri={ILLUSTRATIONS.finance} size={isMobile ? 70 : 130} style={{ opacity: 0.75 }} />
            <View style={{ alignItems: isDesktop ? "flex-start" : "center", flex: isDesktop ? 1 : undefined }}>
              <Text style={{ color: "#F59E0B", fontSize: 13, fontFamily: "DMSans_700Bold", textTransform: "uppercase", letterSpacing: 3, marginBottom: 12 }}>Pricing</Text>
              <Text style={{ color: tc.textPrimary, fontSize: isMobile ? 30 : 44, fontFamily: "DMSans_700Bold", textAlign: isDesktop ? "left" : "center", letterSpacing: -1, lineHeight: isMobile ? 38 : 54 }}>
                You'll always know{"\n"}what you're paying
              </Text>
              <Text style={{ color: tc.textSecondary, fontSize: isMobile ? 15 : 17, fontFamily: "DMSans_400Regular", lineHeight: isMobile ? 23 : 26, marginTop: 12, textAlign: isDesktop ? "left" : "center", maxWidth: 440 }}>
                No hidden spreads, no surprise deductions. The rate on your screen is the rate you get — locked for 90 seconds while you decide.
              </Text>
            </View>
          </View>
        </RevealOnScroll>

        {/* Main pricing card — premium glass */}
        <RevealOnScroll delay={150} variant="scale-up">
          <View
            ref={(ref: any) => { if (isWeb && ref instanceof HTMLElement) ref.className = "cpay-pricing-card"; }}
            style={{
              backgroundColor: "rgba(12,26,46,0.75)", borderRadius: 28, borderWidth: 1.5,
              borderColor: "rgba(16,185,129,0.15)", padding: isMobile ? 36 : 56,
              alignItems: "center", maxWidth: 700, alignSelf: "center" as any, width: "100%",
              position: "relative", overflow: "hidden",
              ...(isWeb ? { backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", boxShadow: "0 12px 60px rgba(16,185,129,0.06)" } as any : {}),
            } as any}
          >
            {/* Decorative gradient sweep inside card */}
            {isWeb && <View style={{ position: "absolute", top: -50, right: -50, width: 200, height: 200, borderRadius: 100, backgroundColor: "#10B981", opacity: 0.04, ...(isWeb ? { filter: "blur(60px)" } as any : {}) } as any} />}
            {isWeb && <View style={{ position: "absolute", bottom: -30, left: -30, width: 150, height: 150, borderRadius: 75, backgroundColor: "#F59E0B", opacity: 0.03, ...(isWeb ? { filter: "blur(50px)" } as any : {}) } as any} />}

            <View style={{ flexDirection: isDesktop ? "row" : "column", alignItems: "center", gap: isDesktop ? 48 : 24, zIndex: 1, width: "100%" }}>
              {/* Left: the big number */}
              <View style={{ alignItems: "center" }}>
                <Text style={{ color: tc.textPrimary, fontSize: isMobile ? 56 : 80, fontFamily: "DMSans_700Bold", letterSpacing: -3 }}>
                  1.5<Text style={{ color: tc.primary[400] }}>%</Text>
                </Text>
                <Text style={{ color: tc.textSecondary, fontSize: isMobile ? 16 : 18, fontFamily: "DMSans_500Medium", marginTop: 4 }}>conversion spread</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
                  <View style={{ width: 32, height: 2, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 1 }} />
                  <Text style={{ color: tc.textMuted, fontSize: 15, fontFamily: "DMSans_400Regular" }}>plus</Text>
                  <View style={{ width: 32, height: 2, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 1 }} />
                </View>
                <Text style={{ color: tc.textPrimary, fontSize: isMobile ? 28 : 36, fontFamily: "DMSans_700Bold", marginTop: 8 }}>
                  KES 10
                </Text>
                <Text style={{ color: tc.textSecondary, fontSize: isMobile ? 14 : 16, fontFamily: "DMSans_500Medium" }}>flat fee per transaction</Text>
              </View>

              {/* Right: benefits list */}
              {isDesktop && (
                <View style={{ flex: 1, gap: 16 }}>
                  {[
                    { icon: "checkmark-circle" as const, text: "Rate locked for 90 seconds — no slippage" },
                    { icon: "eye" as const, text: "See exact amount before confirming" },
                    { icon: "shield-checkmark" as const, text: "No hidden charges, ever" },
                    { icon: "gift" as const, text: "First KES 5,000 — zero fees" },
                  ].map((b) => (
                    <View key={b.text} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(16,185,129,0.1)", alignItems: "center", justifyContent: "center" }}>
                        <Ionicons name={b.icon} size={16} color={tc.primary[400]} />
                      </View>
                      <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_500Medium", flex: 1 }}>{b.text}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Free tier badge */}
            <View style={{
              flexDirection: "row", alignItems: "center", gap: 8, marginTop: 28,
              backgroundColor: "rgba(16,185,129,0.08)", borderRadius: 999,
              paddingVertical: 10, paddingHorizontal: 22, borderWidth: 1, borderColor: "rgba(16,185,129,0.2)",
              ...(isWeb ? { boxShadow: "0 4px 20px rgba(16,185,129,0.08)" } as any : {}),
            }}>
              <Ionicons name="gift" size={18} color={tc.primary[400]} />
              <Text style={{ color: tc.primary[300], fontSize: 15, fontFamily: "DMSans_600SemiBold" }}>First KES 5,000 — zero fees</Text>
            </View>
          </View>
        </RevealOnScroll>

        {/* Fee comparison cards */}
        <RevealOnScroll delay={300} variant="fade-up">
          <View style={{ flexDirection: isMobile ? "column" : "row", gap: isMobile ? 14 : 20, marginTop: 36, justifyContent: "center" }}>
            {[
              { name: "CryptoPay", fee: "1.5%", hl: true, desc: "Transparent" },
              { name: "Binance P2P", fee: "3-8%", hl: false, desc: "Hidden spreads" },
              { name: "Manual OTC", fee: "5-10%", hl: false, desc: "Negotiated" },
            ].map((item) => (
              <Pressable key={item.name} style={({ hovered }: any) => ({
                flex: isMobile ? undefined : 1, maxWidth: isMobile ? undefined : 240,
                backgroundColor: item.hl ? "rgba(16,185,129,0.06)" : "rgba(255,255,255,0.02)",
                borderRadius: 20, borderWidth: item.hl ? 2 : 1,
                borderColor: item.hl ? "rgba(16,185,129,0.25)" : "rgba(255,255,255,0.05)",
                padding: isMobile ? 24 : 28, alignItems: "center",
                ...(isWeb ? {
                  transition: "all 0.3s ease", cursor: "default",
                  transform: hovered ? "translateY(-4px)" : "none",
                  boxShadow: item.hl && hovered ? "0 12px 40px rgba(16,185,129,0.1)" : "none",
                } as any : {}),
              }) as any}>
                <Text style={{ color: item.hl ? tc.primary[400] : tc.textMuted, fontSize: 14, fontFamily: "DMSans_600SemiBold", marginBottom: 8 }}>{item.name}</Text>
                <Text style={{ color: item.hl ? tc.textPrimary : tc.textMuted, fontSize: 32, fontFamily: "DMSans_700Bold", letterSpacing: -1 }}>{item.fee}</Text>
                <Text style={{ color: item.hl ? tc.primary[300] : tc.textMuted, fontSize: 13, fontFamily: "DMSans_500Medium", marginTop: 6 }}>{item.desc}</Text>
              </Pressable>
            ))}
          </View>
        </RevealOnScroll>
      </Section>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 9: COMPARISON — with illustrations + hover effects
  // ═══════════════════════════════════════════════════════════════════════
  const comparisonSection = (
    <View style={{
      paddingVertical: isMobile ? 56 : 88, position: "relative", overflow: "hidden",
      ...(isWeb ? { background: "linear-gradient(180deg, #081420 0%, #0C1C30 50%, #060E1F 100%)", borderTop: "1px solid rgba(99,102,241,0.06)" } as any : { backgroundColor: "#0C1C30" }),
    }}>
      {isWeb && <View style={{ position: "absolute", bottom: "10%", left: "10%", width: 250, height: 250, borderRadius: 125, backgroundColor: "#6366F1", opacity: 0.02, ...(isWeb ? { filter: "blur(80px)" } as any : {}) } as any} />}
      <Section>
        <RevealOnScroll variant="slide-right">
          <View style={{ flexDirection: isDesktop ? "row" : "column", alignItems: "center", justifyContent: "center", gap: isDesktop ? 40 : 20, marginBottom: isMobile ? 32 : 52 }}>
            <View style={{ alignItems: isDesktop ? "flex-start" : "center", flex: isDesktop ? 1 : undefined }}>
              <Text style={{ color: "#818CF8", fontSize: 13, fontFamily: "DMSans_700Bold", textTransform: "uppercase", letterSpacing: 3, marginBottom: 12 }}>Compare</Text>
              <Text style={{ color: tc.textPrimary, fontSize: isMobile ? 28 : 42, fontFamily: "DMSans_700Bold", textAlign: isDesktop ? "left" : "center", letterSpacing: -1, lineHeight: isMobile ? 36 : 52 }}>
                See the difference yourself
              </Text>
              <Text style={{ color: tc.textSecondary, fontSize: isMobile ? 15 : 17, fontFamily: "DMSans_400Regular", lineHeight: isMobile ? 23 : 26, marginTop: 10, textAlign: isDesktop ? "left" : "center", maxWidth: 440 }}>
                We put the numbers next to each other. You decide what makes sense for your money.
              </Text>
            </View>
            <SvgIllustration uri={ILLUSTRATIONS.target} size={isMobile ? 80 : 140} style={{ opacity: 0.75 }} />
          </View>
        </RevealOnScroll>

        <RevealOnScroll delay={150} variant="fade-up">
          <ScrollView horizontal={isMobile} showsHorizontalScrollIndicator={false}>
            <View style={{
              minWidth: isMobile ? 640 : ("100%" as any),
              backgroundColor: "rgba(12,26,46,0.6)", borderRadius: 24,
              borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", overflow: "hidden",
              ...(isWeb ? { backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" } as any : {}),
            }}>
              {/* Header row */}
              <View style={{ flexDirection: "row", borderBottomWidth: 2, borderBottomColor: "rgba(255,255,255,0.06)", backgroundColor: "rgba(255,255,255,0.01)" }}>
                <View style={{ flex: 1.3, padding: isMobile ? 14 : 20 }}>
                  <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_700Bold", textTransform: "uppercase", letterSpacing: 1.5 }}>Feature</Text>
                </View>
                <View style={{ flex: 1.2, padding: isMobile ? 14 : 20, backgroundColor: "rgba(16,185,129,0.05)", borderLeftWidth: 1, borderLeftColor: "rgba(16,185,129,0.12)", borderRightWidth: 1, borderRightColor: "rgba(16,185,129,0.12)" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Image source={APP_LOGO} style={{ width: 20, height: 20, borderRadius: 6 }} resizeMode="cover" />
                    <Text style={{ color: tc.primary[400], fontSize: 14, fontFamily: "DMSans_700Bold" }}>CryptoPay</Text>
                  </View>
                </View>
                <View style={{ flex: 1, padding: isMobile ? 14 : 20 }}>
                  <Text style={{ color: tc.textSecondary, fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>Binance P2P</Text>
                </View>
                <View style={{ flex: 1, padding: isMobile ? 14 : 20 }}>
                  <Text style={{ color: tc.textSecondary, fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>Manual OTC</Text>
                </View>
              </View>

              {/* Data rows */}
              {COMPARISON_ROWS.map((row, i) => (
                <View key={row.label} style={{
                  flexDirection: "row",
                  borderBottomWidth: i < COMPARISON_ROWS.length - 1 ? 1 : 0,
                  borderBottomColor: "rgba(255,255,255,0.04)",
                  ...(isWeb ? { transition: "background-color 0.2s ease" } as any : {}),
                }}>
                  <View style={{ flex: 1.3, padding: isMobile ? 14 : 18, justifyContent: "center" }}>
                    <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>{row.label}</Text>
                  </View>
                  <View style={{
                    flex: 1.2, padding: isMobile ? 14 : 18,
                    backgroundColor: "rgba(16,185,129,0.03)",
                    borderLeftWidth: 1, borderLeftColor: "rgba(16,185,129,0.08)",
                    borderRightWidth: 1, borderRightColor: "rgba(16,185,129,0.08)",
                    flexDirection: "row", alignItems: "center", gap: 8,
                  }}>
                    <Ionicons name="checkmark-circle" size={15} color={tc.primary[400]} />
                    <Text style={{ color: tc.primary[300], fontSize: 14, fontFamily: "DMSans_600SemiBold", flex: 1 }}>{row.cp}</Text>
                  </View>
                  <View style={{ flex: 1, padding: isMobile ? 14 : 18, justifyContent: "center" }}>
                    <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_400Regular" }}>{row.p2p}</Text>
                  </View>
                  <View style={{ flex: 1, padding: isMobile ? 14 : 18, justifyContent: "center" }}>
                    <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_400Regular" }}>{row.otc}</Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
          {isMobile && <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular", textAlign: "center", marginTop: 12 }}>Swipe to see full comparison {"\u2192"}</Text>}
        </RevealOnScroll>
      </Section>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 10: TESTIMONIALS — premium card design
  // ═══════════════════════════════════════════════════════════════════════
  const testimonialsSection = (
    <View style={{
      paddingVertical: isMobile ? 56 : 88, position: "relative", overflow: "hidden",
      ...(isWeb ? { background: "linear-gradient(180deg, #060E1F 0%, #0C1A2E 50%, #0A1628 100%)" } as any : { backgroundColor: "#060E1F" }),
    }}>
      {/* Decorative glow */}
      {isWeb && <View style={{ position: "absolute", top: "20%", left: "50%", width: 600, height: 400, borderRadius: 200, ...(isWeb ? { background: "radial-gradient(circle, rgba(16,185,129,0.03) 0%, transparent 70%)", transform: "translateX(-50%)" } as any : {}) } as any} />}
      <Section>
        <RevealOnScroll variant="slide-left">
          <View style={{ flexDirection: isDesktop ? "row" : "column", alignItems: "center", justifyContent: "space-between", marginBottom: isMobile ? 36 : 56, gap: 20 }}>
            <SvgIllustration uri={ILLUSTRATIONS.community} size={isMobile ? 70 : 130} style={{ opacity: 0.75 }} />
            <View style={{ alignItems: isDesktop ? "flex-start" : "center", flex: 1 }}>
              <Text style={{ color: tc.primary[400], fontSize: 13, fontFamily: "DMSans_700Bold", textTransform: "uppercase", letterSpacing: 3, marginBottom: 12 }}>Testimonials</Text>
              <Text style={{ color: tc.textPrimary, fontSize: isMobile ? 28 : 42, fontFamily: "DMSans_700Bold", textAlign: isDesktop ? "left" : "center", letterSpacing: -1, lineHeight: isMobile ? 36 : 52 }}>
                People who switched are not going back
              </Text>
              <Text style={{ color: tc.textSecondary, fontSize: isMobile ? 15 : 17, fontFamily: "DMSans_400Regular", marginTop: 10, textAlign: isDesktop ? "left" : "center", lineHeight: isMobile ? 23 : 26 }}>
                Once you pay your first bill in 30 seconds, P2P trading feels like dial-up internet.
              </Text>
            </View>
          </View>
        </RevealOnScroll>

        <View style={{ position: "relative" }} {...(isWeb ? { onMouseEnter: () => setTestimonialHovered(true), onMouseLeave: () => setTestimonialHovered(false) } as any : {})}>
          <View style={{ overflow: "hidden", marginHorizontal: isMobile ? 0 : 44 }}>
            <View style={{ flexDirection: "row", ...(isWeb ? { transition: "transform 0.5s cubic-bezier(0.4,0,0.2,1)", transform: `translateX(-${currentSlide * (100 / slidesPerView)}%)` } as any : {}) } as any}>
              {TESTIMONIALS.map((t, i) => (
                <View key={i} style={{ width: `${100 / slidesPerView}%` as any, paddingHorizontal: 10, flexShrink: 0 }}>
                  <View
                    ref={(ref: any) => { if (isWeb && ref instanceof HTMLElement) ref.className = "cpay-testimonial"; }}
                    style={{
                      backgroundColor: "rgba(12,26,46,0.7)", borderRadius: 22,
                      borderWidth: 1, borderColor: t.color + "15",
                      padding: isMobile ? 28 : 36, height: "100%",
                      borderLeftWidth: 3, borderLeftColor: t.color + "40",
                      ...(isWeb ? { backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" } as any : {}),
                    } as any}
                  >
                    {/* Large decorative quote mark */}
                    <Text style={{ color: t.color, fontSize: isMobile ? 40 : 52, fontFamily: "DMSans_700Bold", lineHeight: isMobile ? 40 : 52, marginBottom: 16, opacity: 0.6 }}>
                      {"\u201C"}
                    </Text>
                    {/* Quote text — bigger, more readable */}
                    <Text style={{
                      color: tc.textPrimary, fontSize: isMobile ? 16 : 18,
                      fontFamily: "DMSans_500Medium", lineHeight: isMobile ? 26 : 30,
                      marginBottom: 28, minHeight: isMobile ? 80 : 90,
                    }}>
                      {t.quote}
                    </Text>
                    {/* Author — larger, clearer */}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginTop: "auto", paddingTop: 16, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.04)" } as any}>
                      <View style={{
                        width: 48, height: 48, borderRadius: 24,
                        backgroundColor: t.color + "18", borderWidth: 2, borderColor: t.color + "30",
                        alignItems: "center", justifyContent: "center",
                        ...(isWeb ? { boxShadow: `0 4px 16px ${t.color}20` } as any : {}),
                      }}>
                        <Text style={{ color: t.color, fontSize: 16, fontFamily: "DMSans_700Bold" }}>{t.initials}</Text>
                      </View>
                      <View>
                        <Text style={{ color: tc.textPrimary, fontSize: 16, fontFamily: "DMSans_700Bold" }}>{t.name}</Text>
                        <Text style={{ color: tc.textSecondary, fontSize: 14, fontFamily: "DMSans_500Medium", marginTop: 2 }}>{t.role}</Text>
                      </View>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
          {/* Navigation arrows */}
          {currentSlide > 0 && (
            <Pressable onPress={() => setCurrentSlide((p) => Math.max(0, p - 1))} style={{
              position: "absolute", left: isMobile ? -4 : 0, top: "50%", marginTop: -24,
              width: 48, height: 48, borderRadius: 24,
              backgroundColor: "rgba(16,185,129,0.1)", borderWidth: 1, borderColor: "rgba(16,185,129,0.2)",
              alignItems: "center", justifyContent: "center", zIndex: 10,
              ...(isWeb ? { backdropFilter: "blur(12px)", cursor: "pointer", transition: "all 0.2s ease", boxShadow: "0 4px 16px rgba(0,0,0,0.3)" } as any : {}),
            } as any}>
              <Ionicons name="chevron-back" size={22} color={tc.primary[400]} />
            </Pressable>
          )}
          {currentSlide < maxSlide && (
            <Pressable onPress={() => setCurrentSlide((p) => Math.min(maxSlide, p + 1))} style={{
              position: "absolute", right: isMobile ? -4 : 0, top: "50%", marginTop: -24,
              width: 48, height: 48, borderRadius: 24,
              backgroundColor: "rgba(16,185,129,0.1)", borderWidth: 1, borderColor: "rgba(16,185,129,0.2)",
              alignItems: "center", justifyContent: "center", zIndex: 10,
              ...(isWeb ? { backdropFilter: "blur(12px)", cursor: "pointer", transition: "all 0.2s ease", boxShadow: "0 4px 16px rgba(0,0,0,0.3)" } as any : {}),
            } as any}>
              <Ionicons name="chevron-forward" size={22} color={tc.primary[400]} />
            </Pressable>
          )}
        </View>
        {/* Dots */}
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 32 }}>
          {Array.from({ length: maxSlide + 1 }).map((_, i) => (
            <Pressable key={i} onPress={() => setCurrentSlide(i)} style={{
              width: currentSlide === i ? 28 : 8, height: 8, borderRadius: 4,
              backgroundColor: currentSlide === i ? tc.primary[500] : "rgba(255,255,255,0.1)",
              ...(isWeb ? { transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)", cursor: "pointer" } as any : {}),
            } as any} />
          ))}
        </View>
      </Section>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 11: FAQ — two-column layout on desktop
  // ═══════════════════════════════════════════════════════════════════════
  const faqSection = (
    <View style={{
      paddingVertical: isMobile ? 56 : 88,
      ...(isWeb ? { background: "linear-gradient(180deg, #0A1628 0%, #081420 50%, #060E1F 100%)", borderTop: "1px solid rgba(255,255,255,0.03)" } as any : { backgroundColor: "#0A1628" }),
    }}>
      <Section>
        <RevealOnScroll variant="fade-up">
          <View style={{ flexDirection: isDesktop ? "row" : "column", alignItems: isDesktop ? "flex-start" : "center", gap: isDesktop ? 60 : 32, marginBottom: isMobile ? 36 : 0 }}>
            {/* Left: heading + illustration (sticky on desktop) */}
            <View style={{ alignItems: isDesktop ? "flex-start" : "center", ...(isDesktop ? { position: "sticky" as any, top: 120, width: 320 } : {}) }}>
              <Text style={{ color: tc.primary[400], fontSize: 13, fontFamily: "DMSans_700Bold", textTransform: "uppercase", letterSpacing: 3, marginBottom: 12 }}>FAQ</Text>
              <Text style={{ color: tc.textPrimary, fontSize: isMobile ? 28 : 40, fontFamily: "DMSans_700Bold", textAlign: isDesktop ? "left" : "center", letterSpacing: -1, lineHeight: isMobile ? 36 : 50 }}>
                Got questions? We've got answers
              </Text>
              <Text style={{ color: tc.textSecondary, fontSize: isMobile ? 15 : 17, fontFamily: "DMSans_400Regular", lineHeight: isMobile ? 23 : 26, marginTop: 12, textAlign: isDesktop ? "left" : "center" }}>
                First-timers ask these the most. If yours isn't here, email support@cpay.co.ke and we'll reply the same day.
              </Text>
              <View style={{ marginTop: 24 }}>
                <SvgIllustration uri={ILLUSTRATIONS.questions} size={isMobile ? 100 : 200} style={{ opacity: 0.75 }} />
              </View>
              {isDesktop && (
                <View style={{ marginTop: 24 }}>
                  <SvgIllustration uri={ILLUSTRATIONS.safe} size={140} style={{ opacity: 0.6 }} />
                </View>
              )}
            </View>

            {/* Right: FAQ items — full width */}
            <View style={{ flex: 1, width: "100%" }}>
              {FAQ_DATA.map((faq, i) => (
                <RevealOnScroll key={i} delay={i * 60} variant="fade-up">
                  <FAQItem question={faq.q} answer={faq.a} tc={tc} index={i} />
                </RevealOnScroll>
              ))}
            </View>
          </View>
        </RevealOnScroll>
      </Section>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 12: CTA — premium with illustrations + animated elements
  // ═══════════════════════════════════════════════════════════════════════
  const ctaSection = (
    <View style={{
      paddingVertical: isMobile ? 64 : 100, position: "relative", overflow: "hidden",
      ...(isWeb ? { background: "radial-gradient(ellipse at center, rgba(16,185,129,0.08) 0%, transparent 40%), linear-gradient(180deg, #0E1D35 0%, #0C1A2E 40%, #060E1F 100%)", borderTop: "1px solid rgba(16,185,129,0.08)" } as any : { backgroundColor: "#0E1D35" }),
    }}>
      {/* Multiple background effects */}
      {isWeb && <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.03, ...(isWeb ? { backgroundImage: `url(${CDN_IMAGES.dataViz})`, backgroundSize: "cover", backgroundPosition: "center" } as any : {}) } as any} />}
      {isWeb && <View style={{ position: "absolute", top: "20%", left: "50%", width: 600, height: 600, borderRadius: 300, ...(isWeb ? { background: "radial-gradient(circle, rgba(16,185,129,0.06) 0%, transparent 60%)", transform: "translateX(-50%)", animation: "cpay-aurora 20s ease infinite" } as any : {}) } as any} />}
      {isWeb && <View style={{ position: "absolute", bottom: -100, right: -100, width: 400, height: 400, borderRadius: 200, backgroundColor: "#F59E0B", opacity: 0.02, ...(isWeb ? { filter: "blur(100px)" } as any : {}) } as any} />}

      <Section>
        <RevealOnScroll variant="scale-up">
          <View style={{
            alignItems: "center", zIndex: 1,
            backgroundColor: "rgba(12,26,46,0.5)", borderRadius: 32,
            borderWidth: 1, borderColor: "rgba(16,185,129,0.1)",
            padding: isMobile ? 36 : 64, maxWidth: 900, alignSelf: "center" as any, width: "100%",
            ...(isWeb ? { backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", boxShadow: "0 20px 80px rgba(0,0,0,0.3)" } as any : {}),
          }}>
            {/* Illustrations row */}
            <View style={{ flexDirection: "row", justifyContent: "center", gap: isMobile ? 16 : 40, marginBottom: isMobile ? 24 : 32 }}>
              <SvgIllustration uri={ILLUSTRATIONS.onlineWorld} size={isMobile ? 60 : 100} style={{ opacity: 0.7 }} />
              <View style={{
                width: isMobile ? 64 : 80, height: isMobile ? 64 : 80, borderRadius: isMobile ? 20 : 24,
                backgroundColor: tc.primary[500], alignItems: "center", justifyContent: "center",
                ...(isWeb ? { boxShadow: `0 16px 48px ${tc.primary[500]}50`, animation: "cpay-float 4s ease-in-out infinite" } as any : {}),
              }}>
                <Ionicons name="flash" size={isMobile ? 28 : 36} color="#fff" />
              </View>
              <SvgIllustration uri={ILLUSTRATIONS.success} size={isMobile ? 60 : 100} style={{ opacity: 0.7 }} />
            </View>

            <Text style={{ color: tc.textPrimary, fontSize: isMobile ? 30 : 46, fontFamily: "DMSans_700Bold", textAlign: "center", letterSpacing: -1.5, lineHeight: isMobile ? 38 : 56, marginBottom: 16 }}>
              {isWeb ? (
                <>Ready to <span className="cpay-gradient-headline">ditch P2P?</span></>
              ) : (
                <>Ready to <Text style={{ color: tc.primary[400] }}>ditch P2P?</Text></>
              )}
            </Text>
            <Text style={{ color: tc.textSecondary, fontSize: isMobile ? 16 : 19, fontFamily: "DMSans_400Regular", textAlign: "center", lineHeight: isMobile ? 25 : 30, maxWidth: 520, marginBottom: 36 }}>
              Two minutes to set up. Pick a bill, confirm with your PIN, and your M-Pesa receipt arrives before you put your phone down. Seriously.
            </Text>

            {/* 3 value props */}
            <View style={{ flexDirection: isMobile ? "column" : "row", gap: isMobile ? 12 : 24, marginBottom: 32, width: "100%" }}>
              {[
                { icon: "timer-outline" as const, text: "2 min setup", color: tc.primary[400] },
                { icon: "flash" as const, text: "30 sec payments", color: "#F59E0B" },
                { icon: "gift" as const, text: "Free for first KES 5K", color: "#8B5CF6" },
              ].map((v) => (
                <View key={v.text} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.05)" }}>
                  <Ionicons name={v.icon} size={18} color={v.color} />
                  <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>{v.text}</Text>
                </View>
              ))}
            </View>

            {/* CTA button with ripple */}
            <Pressable
              ref={(ref: any) => { if (isWeb && ref instanceof HTMLElement) ref.className = "cpay-cta-ripple"; }}
              onPress={navigateToRegister}
              style={({ hovered, pressed }: any) => ({
                backgroundColor: hovered ? tc.primary[400] : tc.primary[500], borderRadius: 999,
                paddingVertical: 20, paddingHorizontal: 48, flexDirection: "row", alignItems: "center", gap: 12,
                justifyContent: "center", opacity: pressed ? 0.9 : 1,
                transform: [{ scale: pressed ? 0.96 : hovered ? 1.04 : 1 }],
                ...(isWeb ? { cursor: "pointer", transition: "all 0.3s cubic-bezier(0.34,1.56,0.64,1)", boxShadow: hovered ? "0 16px 48px rgba(16,185,129,0.5)" : "0 8px 24px rgba(16,185,129,0.3)" } as any : {}),
                ...(isMobile ? { width: "100%", maxWidth: 400 } : { minWidth: 300 }),
              }) as any}
            >
              <Ionicons name="rocket" size={20} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 18, fontFamily: "DMSans_700Bold" }}>Create Free Account</Text>
            </Pressable>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, backgroundColor: "rgba(245,158,11,0.06)", borderRadius: 999, paddingVertical: 8, paddingHorizontal: 18, borderWidth: 1, borderColor: "rgba(245,158,11,0.15)" }}>
              <Ionicons name="time" size={14} color="#F59E0B" />
              <Text style={{ color: "#F59E0B", fontSize: 13, fontFamily: "DMSans_600SemiBold" }}>Limited beta spots available</Text>
            </View>

            <Pressable onPress={navigateToLogin} style={({ hovered }: any) => ({ marginTop: 18, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, backgroundColor: hovered ? "rgba(255,255,255,0.04)" : "transparent", ...(isWeb ? { cursor: "pointer", transition: "all 0.2s ease" } as any : {}) })}>
              <Text style={{ color: tc.textMuted, fontSize: 15, fontFamily: "DMSans_500Medium" }}>
                Already have an account? <Text style={{ color: tc.primary[300], fontFamily: "DMSans_600SemiBold" }}>Sign In</Text>
              </Text>
            </Pressable>
          </View>
        </RevealOnScroll>
      </Section>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // FOOTER
  // ═══════════════════════════════════════════════════════════════════════
  const footer = (
    <View style={{ backgroundColor: "#030810", paddingVertical: isMobile ? 36 : 52, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.04)" }}>
      <Section>
        <View style={{ flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", alignItems: isMobile ? "center" : "flex-start", gap: isMobile ? 32 : 48 }}>
          <View style={{ alignItems: isMobile ? "center" : "flex-start", maxWidth: 280 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <Image source={APP_LOGO} style={{ width: 32, height: 32, borderRadius: 8 }} resizeMode="cover" />
              <Text style={{ color: tc.textPrimary, fontSize: 18, fontFamily: "DMSans_700Bold", letterSpacing: -0.3 }}>CryptoPay</Text>
            </View>
            <Text style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_400Regular", lineHeight: 20, textAlign: isMobile ? "center" : "left" }}>Convert crypto to M-Pesa payments instantly. Secure, fast, transparent.</Text>
          </View>
          <View style={{ flexDirection: "row", gap: isMobile ? 48 : 64 }}>
            <View style={{ gap: 10 }}>
              <Text style={{ color: tc.textSecondary, fontSize: 11, fontFamily: "DMSans_700Bold", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>Legal</Text>
              {[{ label: "Privacy Policy", href: "/privacy" }, { label: "Terms of Service", href: "/terms" }].map((l) => (
                <Pressable key={l.label} onPress={() => { if (isWeb) window.location.href = l.href; else router.push(l.href as any); }}>
                  <Text style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_400Regular" }}>{l.label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={{ gap: 10 }}>
              <Text style={{ color: tc.textSecondary, fontSize: 11, fontFamily: "DMSans_700Bold", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>Support</Text>
              <Text style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_400Regular" }}>support@cpay.co.ke</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                {[{ image: SOCIAL_ICONS.twitter, label: "Twitter", url: "https://twitter.com/CPayKenya" }, { image: SOCIAL_ICONS.telegram, label: "Telegram", url: "https://t.me/cryptopaykenya" }].map((s) => (
                  <Pressable key={s.label} onPress={() => { if (isWeb) (window as any).open(s.url, "_blank"); else Linking.openURL(s.url); }}
                    style={({ hovered }: any) => ({ width: 34, height: 34, borderRadius: 9, backgroundColor: hovered ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)", alignItems: "center", justifyContent: "center", ...(isWeb ? { cursor: "pointer", transition: "all 0.2s ease" } as any : {}) })}>
                    <Image source={s.image} style={{ width: 18, height: 18, borderRadius: 3 }} resizeMode="contain" />
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        </View>
        <View style={{ marginTop: isMobile ? 32 : 44, paddingTop: 20, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.03)", alignItems: "center" }}>
          <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular", textAlign: "center", opacity: 0.7 }}>{"\u00A9"} 2026 CryptoPay Technologies {"\u00B7"} Nairobi, Kenya</Text>
        </View>
      </Section>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <View style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <Navbar tc={tc} isMobile={isMobile} onSignIn={navigateToLogin} onGetStarted={navigateToRegister} onScrollTo={scrollToSection} />
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
        {heroSection}
        {servicesSection}
        {problemSection}
        {statsSection}
        {howItWorksSection}
        {featuresSection}
        {cryptoSection}
        {pricingSection}
        {comparisonSection}
        {testimonialsSection}
        {faqSection}
        {ctaSection}
        {footer}
      </ScrollView>
      {isMobile && isWeb && (
        <View style={{
          position: "fixed" as any, bottom: 0, left: 0, right: 0, zIndex: 200,
          paddingHorizontal: 20, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12,
          ...(isWeb ? { backgroundColor: "rgba(6,14,31,0.95)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderTop: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 -4px 20px rgba(0,0,0,0.3)" } as any : { backgroundColor: "rgba(6,14,31,0.95)" }),
        } as any}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: tc.textPrimary, fontSize: 13, fontFamily: "DMSans_700Bold" }}>Pay bills with crypto</Text>
            <Text style={{ color: tc.textMuted, fontSize: 10, fontFamily: "DMSans_400Regular" }}>M-Pesa in 30 seconds</Text>
          </View>
          <Pressable onPress={navigateToRegister} style={({ pressed }: any) => ({ backgroundColor: tc.primary[500], paddingVertical: 11, paddingHorizontal: 22, borderRadius: 999, opacity: pressed ? 0.9 : 1, ...(isWeb ? { cursor: "pointer", boxShadow: "0 2px 12px rgba(16,185,129,0.3)" } as any : {}) })}>
            <Text style={{ color: "#fff", fontSize: 13, fontFamily: "DMSans_700Bold" }}>Get Started</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
