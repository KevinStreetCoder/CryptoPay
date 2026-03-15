import { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Animated,
  Platform,
  useWindowDimensions,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getThemeColors, shadows } from "../src/constants/theme";
import { CRYPTO_LOGOS } from "../src/constants/logos";

const isWeb = Platform.OS === "web";

// ── CDN Assets ──────────────────────────────────────────────────────────────
const COIN_ICONS = [
  { key: "USDT", uri: CRYPTO_LOGOS.USDT, color: "#26A17B" },
  { key: "BTC", uri: CRYPTO_LOGOS.BTC, color: "#F7931A" },
  { key: "ETH", uri: CRYPTO_LOGOS.ETH, color: "#627EEA" },
  { key: "SOL", uri: CRYPTO_LOGOS.SOL, color: "#9945FF" },
];

const KENYA_FLAG = "https://flagcdn.com/48x36/ke.png";

// Professional CDN illustrations (Storyset-style from public sources)
const ILLUSTRATIONS = {
  hero: "https://illustrations.popsy.co/emerald/digital-nomad.svg",
  security: "https://illustrations.popsy.co/emerald/secure-login.svg",
  payment: "https://illustrations.popsy.co/emerald/online-payment.svg",
  wallet: "https://illustrations.popsy.co/emerald/bitcoin.svg",
};

// ── FAQ Data ────────────────────────────────────────────────────────────────
const FAQ_DATA = [
  {
    q: "How does CryptoPay work?",
    a: "Deposit crypto (USDT, BTC, ETH, or SOL) to your personal CryptoPay wallet. Choose a payment method \u2014 Paybill, Till number, or phone number \u2014 and we instantly convert and send the payment via M-Pesa.",
  },
  {
    q: "What cryptocurrencies are supported?",
    a: "We support USDT (on Tron and Ethereum), Bitcoin (BTC), Ethereum (ETH), and Solana (SOL). More chains are added regularly.",
  },
  {
    q: "How long does a payment take?",
    a: "Once your crypto deposit is confirmed on-chain, M-Pesa payments are processed in under 30 seconds. Most transactions complete in 10-15 seconds.",
  },
  {
    q: "Is it safe? How is my crypto protected?",
    a: "Absolutely. CryptoPay uses 256-bit encryption, BIP-44 HD wallet architecture, biometric authentication, and 2FA. Your keys are secured using industry-standard practices.",
  },
  {
    q: "What are the fees?",
    a: "CryptoPay charges a small conversion fee that is transparently displayed before every transaction. There are no hidden fees. The rate you see is the rate you get, locked for 30 seconds.",
  },
  {
    q: "Do I need KYC verification?",
    a: "Basic transactions up to KES 5,000/day require only phone verification. Higher tiers (up to KES 1M/day) require ID verification via our simple KYC process.",
  },
];

// ── Comparison Table Data ───────────────────────────────────────────────────
const COMPARISON_ROWS = [
  { label: "Speed", cp: "< 30 seconds", p2p: "15-60 min", otc: "1-24 hours" },
  { label: "Fees", cp: "1-2% transparent", p2p: "2-5% + spread", otc: "3-8% negotiated" },
  { label: "Risk", cp: "Zero counterparty", p2p: "Scam risk", otc: "High trust required" },
  { label: "Bill Payment", cp: "Direct Paybill/Till", p2p: "Not supported", otc: "Not supported" },
  { label: "Automation", cp: "Fully automated", p2p: "Manual matching", otc: "Fully manual" },
];

// ── Features Data ───────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: "flash" as const,
    title: "Pay Bills Instantly",
    desc: "KPLC, DSTV, Water, School fees \u2014 any Paybill number",
  },
  {
    icon: "send" as const,
    title: "Send Money",
    desc: "M-Pesa to any phone number, funded by crypto",
  },
  {
    icon: "layers" as const,
    title: "Multi-Chain Support",
    desc: "USDT (Tron), BTC, ETH, SOL \u2014 choose your chain",
  },
  {
    icon: "trending-up" as const,
    title: "Real-Time Rates",
    desc: "Live exchange rates with 30-second price lock",
  },
  {
    icon: "shield-checkmark" as const,
    title: "Bank-Grade Security",
    desc: "256-bit encryption, biometric auth, 2FA",
  },
  {
    icon: "checkmark-circle" as const,
    title: "KYC Compliant",
    desc: "Tiered limits from KES 5K to KES 1M/day",
  },
];

// ── Stats Data ──────────────────────────────────────────────────────────────
const STATS = [
  { value: "KES 129+", label: "USDT/KES Rate" },
  { value: "5 Chains", label: "Supported" },
  { value: "< 30 sec", label: "Payment Speed" },
  { value: "99.9%", label: "Uptime" },
];

// ── Animated Counter Hook ───────────────────────────────────────────────────
function useAnimatedValue(target: number, duration: number, trigger: boolean) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (trigger) {
      Animated.timing(anim, {
        toValue: target,
        duration,
        useNativeDriver: !isWeb,
      }).start();
    }
  }, [trigger]);
  return anim;
}

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

  // On web, use IntersectionObserver; on native, reveal immediately
  useEffect(() => {
    if (!isWeb) {
      setVisible(true);
      return;
    }
    const node = (viewRef.current as any)?._nativeTag
      ? undefined
      : (viewRef.current as any);
    if (node && typeof IntersectionObserver !== "undefined") {
      // For web, the underlying DOM node
      const tryObserve = () => {
        // expo-router web: viewRef.current might be a View wrapper
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
            { threshold: 0.15 }
          );
          obs.observe(el);
          return () => obs.disconnect();
        }
        // Fallback: just show it
        setVisible(true);
      };
      // Small delay so the DOM node is mounted
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
    // Fade in
    Animated.timing(opacity, {
      toValue: 1,
      duration: 800,
      delay,
      useNativeDriver: !isWeb,
    }).start();

    // Float loop
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(translateY, {
          toValue: -12,
          duration: 2400 + delay,
          useNativeDriver: !isWeb,
        }),
        Animated.timing(translateY, {
          toValue: 12,
          duration: 2400 + delay,
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
          backgroundColor: "rgba(255,255,255,0.05)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.08)",
          ...(isWeb
            ? ({
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                boxShadow: `0 4px 24px ${color}30`,
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
  const heightAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    Animated.parallel([
      Animated.timing(heightAnim, {
        toValue: next ? 1 : 0,
        duration: 300,
        useNativeDriver: false, // height animation can't use native driver
      }),
      Animated.timing(rotateAnim, {
        toValue: next ? 1 : 0,
        duration: 300,
        useNativeDriver: !isWeb,
      }),
    ]).start();
  };

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  return (
    <Pressable
      onPress={toggle}
      style={({ hovered }: any) => ({
        backgroundColor: isWeb && hovered
          ? "rgba(255,255,255,0.04)"
          : "rgba(255,255,255,0.02)",
        borderRadius: 16,
        borderWidth: 1,
        borderColor: open
          ? "rgba(16, 185, 129, 0.2)"
          : "rgba(255,255,255,0.06)",
        paddingHorizontal: 20,
        paddingVertical: 18,
        marginBottom: 12,
        ...(isWeb
          ? ({ transition: "all 0.2s ease", cursor: "pointer" } as any)
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
            color: tc.textPrimary,
            fontSize: 16,
            fontFamily: "DMSans_600SemiBold",
            lineHeight: 24,
            marginRight: 12,
          }}
        >
          {question}
        </Text>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons name="chevron-down" size={20} color={tc.textMuted} />
        </Animated.View>
      </View>
      {open && (
        <Text
          style={{
            color: tc.textSecondary,
            fontSize: 14,
            fontFamily: "DMSans_400Regular",
            lineHeight: 22,
            marginTop: 12,
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
  tc,
}: {
  children: React.ReactNode;
  style?: any;
  tc: ReturnType<typeof getThemeColors>;
}) {
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
              transition: "all 0.3s ease",
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

// ── Primary Button ──────────────────────────────────────────────────────────
function PrimaryButton({
  label,
  onPress,
  tc,
  style,
}: {
  label: string;
  onPress: () => void;
  tc: ReturnType<typeof getThemeColors>;
  style?: any;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => ({
        backgroundColor: hovered ? tc.primary[400] : tc.primary[500],
        borderRadius: 16,
        paddingVertical: 16,
        paddingHorizontal: 32,
        alignItems: "center",
        justifyContent: "center",
        minHeight: 54,
        opacity: pressed ? 0.9 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
        ...(isWeb
          ? ({
              cursor: "pointer",
              transition: "all 0.2s ease",
              boxShadow: hovered
                ? "0 8px 24px rgba(16, 185, 129, 0.35)"
                : "0 4px 16px rgba(16, 185, 129, 0.2)",
            } as any)
          : {}),
        ...style,
      })}
      accessibilityRole="button"
    >
      <Text
        style={{
          color: "#FFFFFF",
          fontSize: 17,
          fontFamily: "DMSans_600SemiBold",
          letterSpacing: 0.3,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function OutlineButton({
  label,
  onPress,
  tc,
  style,
}: {
  label: string;
  onPress: () => void;
  tc: ReturnType<typeof getThemeColors>;
  style?: any;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => ({
        borderRadius: 16,
        paddingVertical: 16,
        paddingHorizontal: 32,
        alignItems: "center",
        justifyContent: "center",
        minHeight: 54,
        borderWidth: 1.5,
        borderColor: hovered
          ? tc.primary[400]
          : "rgba(255,255,255,0.15)",
        backgroundColor: hovered
          ? "rgba(16, 185, 129, 0.08)"
          : "transparent",
        opacity: pressed ? 0.9 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
        ...(isWeb
          ? ({
              cursor: "pointer",
              transition: "all 0.2s ease",
            } as any)
          : {}),
        ...style,
      })}
      accessibilityRole="button"
    >
      <Text
        style={{
          color: tc.textPrimary,
          fontSize: 17,
          fontFamily: "DMSans_600SemiBold",
          letterSpacing: 0.3,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ── Navbar ──────────────────────────────────────────────────────────────────
function Navbar({
  tc,
  isDesktop,
  onSignIn,
  onGetStarted,
}: {
  tc: ReturnType<typeof getThemeColors>;
  isDesktop: boolean;
  onSignIn: () => void;
  onGetStarted: () => void;
}) {
  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: isDesktop ? 48 : 20,
        paddingVertical: 16,
        ...(isWeb
          ? ({
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              backgroundColor: "rgba(6, 14, 31, 0.8)",
              borderBottomWidth: 1,
              borderBottomColor: "rgba(255,255,255,0.05)",
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

      {/* Nav actions */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable
          onPress={onSignIn}
          style={({ pressed, hovered }: any) => ({
            paddingVertical: 10,
            paddingHorizontal: isDesktop ? 20 : 14,
            borderRadius: 12,
            backgroundColor: hovered ? "rgba(255,255,255,0.05)" : "transparent",
            opacity: pressed ? 0.8 : 1,
            ...(isWeb ? ({ cursor: "pointer", transition: "all 0.2s ease" } as any) : {}),
          })}
          accessibilityRole="button"
          accessibilityLabel="Sign In"
        >
          <Text
            style={{
              color: tc.textSecondary,
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
            paddingHorizontal: isDesktop ? 24 : 16,
            borderRadius: 12,
            backgroundColor: hovered ? tc.primary[400] : tc.primary[500],
            opacity: pressed ? 0.9 : 1,
            transform: [{ scale: pressed ? 0.97 : 1 }],
            ...(isWeb
              ? ({
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  boxShadow: hovered
                    ? "0 4px 16px rgba(16, 185, 129, 0.3)"
                    : "0 2px 8px rgba(16, 185, 129, 0.15)",
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
              fontFamily: "DMSans_600SemiBold",
            }}
          >
            Get Started
          </Text>
        </Pressable>
      </View>
    </View>
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

  const howItWorksRef = useRef<View>(null);

  const navigateToLogin = useCallback(() => {
    router.push("/auth/login");
  }, [router]);

  const navigateToRegister = useCallback(() => {
    router.push("/auth/register");
  }, [router]);

  const scrollRef = useRef<ScrollView>(null);

  const scrollToHowItWorks = useCallback(() => {
    // Smooth scroll to the how-it-works section
    if (scrollRef.current && howItWorksRef.current) {
      (howItWorksRef.current as any).measureLayout?.(
        (scrollRef.current as any).getInnerViewNode?.(),
        (_x: number, y: number) => {
          scrollRef.current?.scrollTo({ y: y - 80, animated: true });
        },
        () => {}
      );
    }
  }, []);

  // ── HERO SECTION ──────────────────────────────────────────────────────────
  const heroSection = (
    <View
      style={{
        minHeight: isMobile ? 700 : 800,
        justifyContent: "center",
        alignItems: "center",
        paddingTop: isMobile ? 100 : 120,
        paddingBottom: isMobile ? 60 : 80,
        paddingHorizontal: 20,
        position: "relative",
        overflow: "hidden",
        ...(isWeb
          ? ({
              background:
                "linear-gradient(180deg, #060E1F 0%, #0E1D35 50%, #0A1628 100%)",
            } as any)
          : { backgroundColor: "#060E1F" }),
      }}
    >
      {/* Dot pattern background */}
      {isWeb && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: 0.4,
            ...(isWeb
              ? ({
                  backgroundImage:
                    "radial-gradient(circle, rgba(16,185,129,0.08) 1px, transparent 1px)",
                  backgroundSize: "40px 40px",
                } as any)
              : {}),
          }}
        />
      )}

      {/* Decorative gradient orbs */}
      <View
        style={{
          position: "absolute",
          top: -150,
          right: isMobile ? -100 : -50,
          width: isMobile ? 350 : 500,
          height: isMobile ? 350 : 500,
          borderRadius: 250,
          backgroundColor: "rgba(16, 185, 129, 0.04)",
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: -100,
          left: isMobile ? -120 : -60,
          width: isMobile ? 300 : 400,
          height: isMobile ? 300 : 400,
          borderRadius: 200,
          backgroundColor: "rgba(16, 185, 129, 0.03)",
        }}
      />

      {/* Floating crypto icons */}
      {!isMobile && (
        <>
          <FloatingCoin
            uri={COIN_ICONS[0].uri}
            color={COIN_ICONS[0].color}
            size={72}
            left="8%"
            top="20%"
            delay={0}
          />
          <FloatingCoin
            uri={COIN_ICONS[1].uri}
            color={COIN_ICONS[1].color}
            size={64}
            left="85%"
            top="18%"
            delay={300}
          />
          <FloatingCoin
            uri={COIN_ICONS[2].uri}
            color={COIN_ICONS[2].color}
            size={56}
            left="12%"
            top="65%"
            delay={600}
          />
          <FloatingCoin
            uri={COIN_ICONS[3].uri}
            color={COIN_ICONS[3].color}
            size={60}
            left="82%"
            top="68%"
            delay={900}
          />
        </>
      )}
      {isMobile && (
        <>
          <FloatingCoin
            uri={COIN_ICONS[0].uri}
            color={COIN_ICONS[0].color}
            size={48}
            left="5%"
            top="12%"
            delay={0}
          />
          <FloatingCoin
            uri={COIN_ICONS[1].uri}
            color={COIN_ICONS[1].color}
            size={44}
            left="80%"
            top="10%"
            delay={300}
          />
          <FloatingCoin
            uri={COIN_ICONS[2].uri}
            color={COIN_ICONS[2].color}
            size={40}
            left="2%"
            top="75%"
            delay={600}
          />
          <FloatingCoin
            uri={COIN_ICONS[3].uri}
            color={COIN_ICONS[3].color}
            size={42}
            left="78%"
            top="78%"
            delay={900}
          />
        </>
      )}

      {/* Hero content */}
      <RevealOnScroll>
        <View
          style={{
            flexDirection: isDesktop ? "row" : "column",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            paddingHorizontal: isMobile ? 8 : 40,
            zIndex: 10,
            gap: isDesktop ? 60 : 0,
          }}
        >
        {/* Left: Text content */}
        <View
          style={{
            alignItems: isDesktop ? "flex-start" : "center",
            flex: isDesktop ? 1 : undefined,
            maxWidth: isDesktop ? 640 : undefined,
          }}
        >
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: isMobile ? 32 : isTablet ? 42 : 52,
              fontFamily: "DMSans_700Bold",
              textAlign: isDesktop ? "left" : "center",
              letterSpacing: -1.5,
              lineHeight: isMobile ? 40 : isTablet ? 52 : 64,
              marginBottom: 20,
            }}
          >
            Pay Any Bill in Kenya{"\n"}with Crypto
          </Text>

          <Text
            style={{
              color: tc.textSecondary,
              fontSize: isMobile ? 16 : 18,
              fontFamily: "DMSans_400Regular",
              textAlign: isDesktop ? "left" : "center",
              lineHeight: isMobile ? 24 : 28,
              maxWidth: isMobile ? "100%" : 600,
              marginBottom: 40,
            }}
          >
            Convert USDT, BTC, ETH, or SOL to M-Pesa instantly.{" "}
            Pay Paybill, Till, or send money {"\u2014"} in seconds, not hours.
          </Text>

          {/* CTA Buttons */}
          <View
            style={{
              flexDirection: isMobile ? "column" : "row",
              gap: 16,
              alignItems: "center",
              width: isMobile ? "100%" : undefined,
            }}
          >
            <PrimaryButton
              label="Get Started"
              onPress={navigateToRegister}
              tc={tc}
              style={isMobile ? { width: "100%", maxWidth: 360 } : { minWidth: 180 }}
            />
            <OutlineButton
              label="See How It Works"
              onPress={scrollToHowItWorks}
              tc={tc}
              style={isMobile ? { width: "100%", maxWidth: 360 } : { minWidth: 180 }}
            />
          </View>

          {/* Mobile floating coins row */}
          {isMobile && (
            <View
              style={{
                flexDirection: "row",
                gap: 12,
                marginTop: 36,
                justifyContent: "center",
              }}
            >
              {COIN_ICONS.map((coin) => (
                <View
                  key={coin.key}
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    backgroundColor: "rgba(255,255,255,0.05)",
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.08)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Image
                    source={{ uri: coin.uri }}
                    style={{ width: 28, height: 28 }}
                  />
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Right: Hero visual (desktop only) — app mockup card */}
        {isDesktop && (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <View style={{
              width: 380,
              backgroundColor: tc.glass.bg,
              borderRadius: 24,
              borderWidth: 1,
              borderColor: tc.glass.border,
              padding: 32,
              ...(isWeb ? {
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                boxShadow: "0 24px 64px rgba(0,0,0,0.4), 0 0 0 1px rgba(16,185,129,0.1)",
                transform: "perspective(1000px) rotateY(-5deg) rotateX(2deg)",
              } as any : {}),
            }}>
              {/* Mock payment UI */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 24 }}>
                <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: tc.primary[500], alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="flash" size={22} color="#fff" />
                </View>
                <View>
                  <Text style={{ color: tc.textPrimary, fontSize: 18, fontFamily: "DMSans_700Bold" }}>CryptoPay</Text>
                  <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular" }}>Pay bills instantly</Text>
                </View>
              </View>
              {/* Mock balance */}
              <View style={{ backgroundColor: tc.dark.bg, borderRadius: 16, padding: 20, marginBottom: 16 }}>
                <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_500Medium", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Balance</Text>
                <Text style={{ color: tc.textPrimary, fontSize: 32, fontFamily: "DMSans_700Bold" }}>7.88 <Text style={{ fontSize: 18, color: tc.primary[400] }}>USDT</Text></Text>
                <Text style={{ color: tc.primary[400], fontSize: 13, fontFamily: "DMSans_500Medium", marginTop: 4 }}>≈ KSh 1,018.06</Text>
              </View>
              {/* Mock action buttons */}
              <View style={{ flexDirection: "row", gap: 10 }}>
                {[
                  { icon: "arrow-down", label: "Deposit", color: tc.primary[500] },
                  { icon: "send", label: "Pay Bill", color: "#3B82F6" },
                  { icon: "swap-horizontal", label: "Send", color: "#8B5CF6" },
                ].map((action) => (
                  <View key={action.label} style={{ flex: 1, alignItems: "center", backgroundColor: tc.dark.bg, borderRadius: 12, paddingVertical: 14, gap: 6 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: action.color + "20", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name={action.icon as any} size={18} color={action.color} />
                    </View>
                    <Text style={{ color: tc.textSecondary, fontSize: 11, fontFamily: "DMSans_500Medium" }}>{action.label}</Text>
                  </View>
                ))}
              </View>
              {/* Mock recent tx */}
              <View style={{ marginTop: 16, backgroundColor: tc.dark.bg, borderRadius: 12, padding: 14 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: tc.primary[500] + "20", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="checkmark-circle" size={16} color={tc.primary[400]} />
                    </View>
                    <View>
                      <Text style={{ color: tc.textPrimary, fontSize: 13, fontFamily: "DMSans_600SemiBold" }}>KPLC Paybill</Text>
                      <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular" }}>Just now</Text>
                    </View>
                  </View>
                  <Text style={{ color: tc.primary[400], fontSize: 13, fontFamily: "DMSans_600SemiBold" }}>KSh 500</Text>
                </View>
              </View>
            </View>
          </View>
        )}
        </View>
      </RevealOnScroll>

      {/* Trust bar */}
      <RevealOnScroll delay={400}>
        <View
          style={{
            flexDirection: isMobile ? "column" : "row",
            alignItems: "center",
            justifyContent: "center",
            gap: isMobile ? 12 : 32,
            marginTop: isMobile ? 40 : 60,
            zIndex: 10,
          }}
        >
          {[
            { icon: "lock-closed" as const, text: "256-bit encryption" },
            { icon: "person-circle" as const, text: "KYC verified" },
            { icon: "headset" as const, text: "24/7 support" },
          ].map((item) => (
            <View
              key={item.text}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Ionicons
                name={item.icon}
                size={16}
                color={tc.primary[400]}
              />
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 13,
                  fontFamily: "DMSans_500Medium",
                }}
              >
                {item.text}
              </Text>
            </View>
          ))}
        </View>
      </RevealOnScroll>
    </View>
  );

  // ── HOW IT WORKS SECTION ──────────────────────────────────────────────────
  const howItWorksSection = (
    <View
      ref={howItWorksRef}
      style={{
        paddingVertical: isMobile ? 60 : 100,
        backgroundColor: tc.dark.bg,
      }}
    >
      <Section>
        <RevealOnScroll>
          <Text
            style={{
              color: tc.primary[400],
              fontSize: 14,
              fontFamily: "DMSans_600SemiBold",
              textAlign: "center",
              textTransform: "uppercase",
              letterSpacing: 2,
              marginBottom: 12,
            }}
          >
            How It Works
          </Text>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: isMobile ? 28 : 36,
              fontFamily: "DMSans_700Bold",
              textAlign: "center",
              letterSpacing: -0.8,
              marginBottom: isMobile ? 40 : 60,
            }}
          >
            Three Simple Steps
          </Text>
        </RevealOnScroll>

        <View
          style={{
            flexDirection: isMobile ? "column" : "row",
            gap: isMobile ? 40 : 48,
            alignItems: "flex-start",
            justifyContent: "center",
            width: "100%",
          }}
        >
          {[
            {
              num: "1",
              icon: "arrow-down" as const,
              title: "Deposit Crypto",
              desc: "Send USDT, BTC, ETH or SOL to your personal wallet",
            },
            {
              num: "2",
              icon: "receipt" as const,
              title: "Choose Payment",
              desc: "Select Paybill, Till number, or phone to send to",
            },
            {
              num: "3",
              icon: "flash" as const,
              title: "Instant M-Pesa",
              desc: "Payment arrives via M-Pesa in seconds",
            },
          ].map((step, i) => (
            <RevealOnScroll key={step.num} delay={i * 150} style={{ flex: 1 }}>
              <View
                style={{
                  alignItems: "center",
                  width: "100%",
                  backgroundColor: tc.glass.bg,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: tc.glass.border,
                  padding: isMobile ? 24 : 32,
                  ...(isWeb ? { backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" } as any : {}),
                }}
              >
                {/* Step icon */}
                <View
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 20,
                    backgroundColor: "rgba(16, 185, 129, 0.1)",
                    borderWidth: 1,
                    borderColor: "rgba(16, 185, 129, 0.25)",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                    ...(isWeb
                      ? ({
                          boxShadow: `0 8px 32px rgba(16, 185, 129, 0.15)`,
                          backdropFilter: "blur(8px)",
                        } as any)
                      : {}),
                  }}
                >
                  <Ionicons
                    name={step.icon}
                    size={32}
                    color={tc.primary[400]}
                  />
                </View>

                {/* Step number badge */}
                <View
                  style={{
                    backgroundColor: tc.primary[500],
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 12,
                  }}
                >
                  <Text
                    style={{
                      color: "#FFFFFF",
                      fontSize: 12,
                      fontFamily: "DMSans_700Bold",
                    }}
                  >
                    {step.num}
                  </Text>
                </View>

                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: 20,
                    fontFamily: "DMSans_600SemiBold",
                    textAlign: "center",
                    marginBottom: 8,
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
                    lineHeight: 22,
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

  // ── FEATURES GRID SECTION ─────────────────────────────────────────────────
  const featuresSection = (
    <View
      style={{
        paddingVertical: isMobile ? 60 : 100,
        ...(isWeb
          ? ({
              background:
                "linear-gradient(180deg, #0A1628 0%, #060E1F 100%)",
            } as any)
          : { backgroundColor: "#0A1628" }),
      }}
    >
      <Section>
        <RevealOnScroll>
          <Text
            style={{
              color: tc.primary[400],
              fontSize: 14,
              fontFamily: "DMSans_600SemiBold",
              textAlign: "center",
              textTransform: "uppercase",
              letterSpacing: 2,
              marginBottom: 12,
            }}
          >
            Features
          </Text>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: isMobile ? 28 : 36,
              fontFamily: "DMSans_700Bold",
              textAlign: "center",
              letterSpacing: -0.8,
              marginBottom: isMobile ? 36 : 60,
            }}
          >
            Everything You Need
          </Text>
        </RevealOnScroll>

        <View
          style={{
            ...(isWeb ? {
              display: "grid" as any,
              gridTemplateColumns: isMobile ? "1fr" : isTablet ? "1fr 1fr" : "1fr 1fr 1fr",
              gap: isMobile ? 16 : 24,
            } as any : {
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 16,
            }),
          }}
        >
          {FEATURES.map((feat, i) => (
            <RevealOnScroll key={feat.title} delay={i * 100}>
              <View
                style={{
                  width: "100%",
                }}
              >
                <GlassCard tc={tc}>
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 14,
                      backgroundColor: "rgba(16, 185, 129, 0.1)",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 16,
                    }}
                  >
                    <Ionicons
                      name={feat.icon}
                      size={24}
                      color={tc.primary[400]}
                    />
                  </View>
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 18,
                      fontFamily: "DMSans_600SemiBold",
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
                      lineHeight: 21,
                    }}
                  >
                    {feat.desc}
                  </Text>
                </GlassCard>
              </View>
            </RevealOnScroll>
          ))}
        </View>
      </Section>
    </View>
  );

  // ── STATS / SOCIAL PROOF SECTION ──────────────────────────────────────────
  const statsSection = (
    <View
      style={{
        paddingVertical: isMobile ? 60 : 80,
        backgroundColor: tc.dark.bg,
      }}
    >
      <Section>
        <RevealOnScroll>
          <View
            style={{
              backgroundColor: tc.dark.card,
              borderRadius: 24,
              borderWidth: 1,
              borderColor: "rgba(16, 185, 129, 0.15)",
              padding: isMobile ? 28 : 48,
              ...(isWeb
                ? ({
                    boxShadow: "0 8px 40px rgba(16, 185, 129, 0.06)",
                  } as any)
                : {}),
            }}
          >
            {/* Stats grid */}
            <View
              style={{
                flexDirection: isMobile ? "column" : "row",
                justifyContent: "space-around",
                gap: isMobile ? 28 : 16,
              }}
            >
              {STATS.map((stat) => (
                <View key={stat.label} style={{ alignItems: "center" }}>
                  <Text
                    style={{
                      color: tc.primary[400],
                      fontSize: isMobile ? 28 : 36,
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

            {/* Divider */}
            <View
              style={{
                height: 1,
                backgroundColor: tc.dark.border,
                marginVertical: isMobile ? 24 : 32,
              }}
            />

            {/* Trust line */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
              }}
            >
              <Image
                source={{ uri: KENYA_FLAG }}
                style={{ width: 24, height: 18, borderRadius: 2 }}
              />
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 15,
                  fontFamily: "DMSans_500Medium",
                }}
              >
                Trusted by crypto users across Kenya
              </Text>
            </View>
          </View>
        </RevealOnScroll>
      </Section>
    </View>
  );

  // ── COMPARISON TABLE SECTION ──────────────────────────────────────────────
  const comparisonSection = (
    <View
      style={{
        paddingVertical: isMobile ? 60 : 100,
        ...(isWeb
          ? ({
              background:
                "linear-gradient(180deg, #060E1F 0%, #0A1628 100%)",
            } as any)
          : { backgroundColor: "#0A1628" }),
      }}
    >
      <Section>
        <RevealOnScroll>
          <Text
            style={{
              color: tc.primary[400],
              fontSize: 14,
              fontFamily: "DMSans_600SemiBold",
              textAlign: "center",
              textTransform: "uppercase",
              letterSpacing: 2,
              marginBottom: 12,
            }}
          >
            Compare
          </Text>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: isMobile ? 28 : 36,
              fontFamily: "DMSans_700Bold",
              textAlign: "center",
              letterSpacing: -0.8,
              marginBottom: isMobile ? 36 : 48,
            }}
          >
            Why CryptoPay vs P2P Trading?
          </Text>
        </RevealOnScroll>

        <RevealOnScroll delay={200}>
          {/* Table container */}
          <ScrollView
            horizontal={isMobile}
            showsHorizontalScrollIndicator={false}
          >
            <View
              style={{
                minWidth: isMobile ? 600 : "100%" as any,
                backgroundColor: tc.glass.bg,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: tc.glass.border,
                overflow: "hidden",
                ...(isWeb
                  ? ({
                      backdropFilter: "blur(12px)",
                      WebkitBackdropFilter: "blur(12px)",
                    } as any)
                  : {}),
              }}
            >
              {/* Header row */}
              <View
                style={{
                  flexDirection: "row",
                  borderBottomWidth: 1,
                  borderBottomColor: tc.dark.border,
                }}
              >
                <View
                  style={{
                    flex: 1.2,
                    padding: 16,
                  }}
                >
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 13,
                      fontFamily: "DMSans_600SemiBold",
                      textTransform: "uppercase",
                      letterSpacing: 1,
                    }}
                  >
                    Feature
                  </Text>
                </View>
                <View
                  style={{
                    flex: 1,
                    padding: 16,
                    backgroundColor: "rgba(16, 185, 129, 0.06)",
                    borderLeftWidth: 1,
                    borderLeftColor: "rgba(16, 185, 129, 0.15)",
                    borderRightWidth: 1,
                    borderRightColor: "rgba(16, 185, 129, 0.15)",
                  }}
                >
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
                <View style={{ flex: 1, padding: 16 }}>
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
                <View style={{ flex: 1, padding: 16 }}>
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
                    borderBottomWidth:
                      i < COMPARISON_ROWS.length - 1 ? 1 : 0,
                    borderBottomColor: "rgba(255,255,255,0.04)",
                  }}
                >
                  <View style={{ flex: 1.2, padding: 16 }}>
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
                      flex: 1,
                      padding: 16,
                      backgroundColor: "rgba(16, 185, 129, 0.04)",
                      borderLeftWidth: 1,
                      borderLeftColor: "rgba(16, 185, 129, 0.1)",
                      borderRightWidth: 1,
                      borderRightColor: "rgba(16, 185, 129, 0.1)",
                    }}
                  >
                    <Text
                      style={{
                        color: tc.primary[300],
                        fontSize: 14,
                        fontFamily: "DMSans_600SemiBold",
                      }}
                    >
                      {row.cp}
                    </Text>
                  </View>
                  <View style={{ flex: 1, padding: 16 }}>
                    <Text
                      style={{
                        color: tc.textSecondary,
                        fontSize: 14,
                        fontFamily: "DMSans_400Regular",
                      }}
                    >
                      {row.p2p}
                    </Text>
                  </View>
                  <View style={{ flex: 1, padding: 16 }}>
                    <Text
                      style={{
                        color: tc.textSecondary,
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
        </RevealOnScroll>
      </Section>
    </View>
  );

  // ── FAQ SECTION ───────────────────────────────────────────────────────────
  const faqSection = (
    <View
      style={{
        paddingVertical: isMobile ? 60 : 100,
        backgroundColor: tc.dark.bg,
      }}
    >
      <Section>
        <RevealOnScroll>
          <Text
            style={{
              color: tc.primary[400],
              fontSize: 14,
              fontFamily: "DMSans_600SemiBold",
              textAlign: "center",
              textTransform: "uppercase",
              letterSpacing: 2,
              marginBottom: 12,
            }}
          >
            FAQ
          </Text>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: isMobile ? 28 : 36,
              fontFamily: "DMSans_700Bold",
              textAlign: "center",
              letterSpacing: -0.8,
              marginBottom: isMobile ? 36 : 48,
            }}
          >
            Frequently Asked Questions
          </Text>
        </RevealOnScroll>

        {FAQ_DATA.map((faq, i) => (
          <RevealOnScroll key={i} delay={i * 80}>
            <FAQItem question={faq.q} answer={faq.a} tc={tc} />
          </RevealOnScroll>
        ))}
      </Section>
    </View>
  );

  // ── FINAL CTA SECTION ─────────────────────────────────────────────────────
  const ctaSection = (
    <View
      style={{
        paddingVertical: isMobile ? 60 : 100,
        alignItems: "center",
        ...(isWeb
          ? ({
              background:
                "linear-gradient(180deg, #0A1628 0%, #0E1D35 50%, #060E1F 100%)",
            } as any)
          : { backgroundColor: "#0E1D35" }),
      }}
    >
      <Section>
        <RevealOnScroll>
          <View style={{ alignItems: "center" }}>
            {/* Icon */}
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 20,
                backgroundColor: tc.primary[500],
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 28,
                ...(isWeb
                  ? ({
                      boxShadow: `0 8px 32px ${tc.primary[500]}40`,
                    } as any)
                  : {
                      shadowColor: tc.primary[500],
                      shadowOffset: { width: 0, height: 6 },
                      shadowOpacity: 0.35,
                      shadowRadius: 16,
                    }),
              }}
            >
              <Ionicons name="flash" size={32} color="#FFFFFF" />
            </View>

            <Text
              style={{
                color: tc.textPrimary,
                fontSize: isMobile ? 28 : 36,
                fontFamily: "DMSans_700Bold",
                textAlign: "center",
                letterSpacing: -0.8,
                marginBottom: 16,
              }}
            >
              Ready to pay bills{"\n"}with crypto?
            </Text>

            <Text
              style={{
                color: tc.textSecondary,
                fontSize: 16,
                fontFamily: "DMSans_400Regular",
                textAlign: "center",
                lineHeight: 24,
                maxWidth: 480,
                marginBottom: 36,
              }}
            >
              Join thousands of Kenyans using CryptoPay to convert crypto
              to M-Pesa payments instantly. No middlemen, no delays.
            </Text>

            <PrimaryButton
              label="Create Free Account"
              onPress={navigateToRegister}
              tc={tc}
              style={{
                minWidth: isMobile ? undefined : 240,
                width: isMobile ? "100%" : undefined,
                maxWidth: 360,
                paddingVertical: 18,
              }}
            />

            <Pressable
              onPress={navigateToLogin}
              style={({ pressed, hovered }: any) => ({
                marginTop: 16,
                paddingVertical: 10,
                paddingHorizontal: 20,
                borderRadius: 10,
                backgroundColor: hovered ? "rgba(255,255,255,0.04)" : "transparent",
                opacity: pressed ? 0.7 : 1,
                ...(isWeb ? ({ cursor: "pointer", transition: "all 0.2s ease" } as any) : {}),
              })}
            >
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 14,
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

  // ── FOOTER ────────────────────────────────────────────────────────────────
  const footer = (
    <View
      style={{
        backgroundColor: "#040A14",
        paddingVertical: isMobile ? 32 : 48,
        paddingHorizontal: 20,
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
            gap: isMobile ? 32 : 48,
          }}
        >
          {/* Brand */}
          <View
            style={{
              alignItems: isMobile ? "center" : "flex-start",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
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
                  fontSize: 18,
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
                fontSize: 13,
                fontFamily: "DMSans_400Regular",
                lineHeight: 20,
                textAlign: isMobile ? "center" : "left",
                maxWidth: 280,
              }}
            >
              Convert crypto to M-Pesa payments instantly. Secure, fast,
              and compliant.
            </Text>
          </View>

          {/* Links */}
          <View
            style={{
              flexDirection: "row",
              gap: isMobile ? 40 : 64,
            }}
          >
            <View style={{ gap: 10 }}>
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 13,
                  fontFamily: "DMSans_600SemiBold",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 4,
                }}
              >
                Legal
              </Text>
              {["Privacy Policy", "Terms of Service"].map((link) => (
                <Pressable
                  key={link}
                  style={({ hovered }: any) => ({
                    ...(isWeb
                      ? ({
                          cursor: "pointer",
                          transition: "opacity 0.15s ease",
                        } as any)
                      : {}),
                    opacity: hovered ? 0.7 : 1,
                  })}
                >
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 14,
                      fontFamily: "DMSans_400Regular",
                    }}
                  >
                    {link}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={{ gap: 10 }}>
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 13,
                  fontFamily: "DMSans_600SemiBold",
                  textTransform: "uppercase",
                  letterSpacing: 1,
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
              {/* Social placeholders */}
              <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
                {(
                  [
                    "logo-twitter",
                    "logo-linkedin",
                    "logo-github",
                  ] as const
                ).map((icon) => (
                  <Pressable
                    key={icon}
                    style={({ hovered }: any) => ({
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      backgroundColor: hovered
                        ? "rgba(255,255,255,0.08)"
                        : "rgba(255,255,255,0.04)",
                      alignItems: "center",
                      justifyContent: "center",
                      ...(isWeb
                        ? ({
                            cursor: "pointer",
                            transition: "all 0.2s ease",
                          } as any)
                        : {}),
                    })}
                  >
                    <Ionicons
                      name={icon}
                      size={16}
                      color={tc.textMuted}
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
            marginTop: isMobile ? 32 : 40,
            paddingTop: 20,
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

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <Navbar
        tc={tc}
        isDesktop={isDesktop}
        onSignIn={navigateToLogin}
        onGetStarted={navigateToRegister}
      />

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        {heroSection}
        {howItWorksSection}
        {featuresSection}
        {statsSection}
        {comparisonSection}
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
            backgroundColor: "rgba(6, 14, 31, 0.95)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            borderTopWidth: 1,
            borderTopColor: "rgba(255,255,255,0.06)",
            paddingHorizontal: 20,
            paddingVertical: 12,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          } as any}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>
              Ready to start?
            </Text>
            <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular" }}>
              Pay bills with crypto in seconds
            </Text>
          </View>
          <Pressable
            onPress={navigateToRegister}
            style={{
              backgroundColor: tc.primary[500],
              paddingVertical: 12,
              paddingHorizontal: 24,
              borderRadius: 12,
            }}
          >
            <Text style={{ color: "#fff", fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>
              Get Started
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
