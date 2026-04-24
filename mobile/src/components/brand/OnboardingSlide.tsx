/**
 * OnboardingSlide · 3 slides shown on first cold-start after sign-up.
 *
 * Ported from the design handoff (cpay/project/polish-assets.jsx ·
 * OnboardingSlide). Matches the app's native dark theme · ink background,
 * glass card, per-slide glow tint.
 *
 * Usage:
 *   <OnboardingSlide step={1 | 2 | 3}
 *                    onContinue={() => ...}
 *                    onSkip={() => ...} />
 *
 * 3 steps:
 *   1. WELCOME · Pay any Paybill or Till with crypto.
 *   2. HOW IT WORKS · Any crypto, into Kenyan Shillings.
 *   3. RATE LOCK · Your rate is locked for 90 seconds.
 */
import { View, Text, Pressable, Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OnboardingIcon1, OnboardingIcon2, OnboardingIcon3 } from "./PolishAssets";

type Step = 1 | 2 | 3;

const INK_BG = "#060E1F";
const CARD_BG = "rgba(22, 39, 66, 0.55)";
const BORDER = "rgba(255,255,255,0.08)";
const BORDER_STRONG = "rgba(255,255,255,0.14)";
const TEXT = "#E8EEF7";
const MUTED = "#8396AD";

const SLIDES = {
  1: {
    glow: "#10B981",
    tag: "WELCOME",
    title: "Pay any Paybill or Till with crypto.",
    sub: "Your USDT, BTC, ETH or SOL settles to KES in seconds. No exchange, no waiting.",
  },
  2: {
    glow: "#627EEA",
    tag: "HOW IT WORKS",
    title: "Any crypto, into Kenyan Shillings.",
    sub: "We convert at live market rate through licensed partners. You see the final KES before paying.",
  },
  3: {
    glow: "#F59E0B",
    tag: "RATE LOCK",
    title: "Your rate is locked for 90 seconds.",
    sub: "No surprises at settlement. If the quote expires, we refresh before you confirm.",
  },
} as const;

export interface OnboardingSlideProps {
  step: Step;
  onContinue: () => void;
  onSkip?: () => void;
}

export function OnboardingSlide({ step, onContinue, onSkip }: OnboardingSlideProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const slide = SLIDES[step];
  const Icon = step === 1 ? OnboardingIcon1 : step === 2 ? OnboardingIcon2 : OnboardingIcon3;
  const isLast = step === 3;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: INK_BG,
        // Honour the system safe-area so the Get-Started button + step
        // dots clear the Android gesture bar / 3-button nav. Previous
        // hard-coded `36` clipped behind the system nav on gesture-nav
        // devices where `insets.bottom` is ~24-34 px.
        paddingTop: 56 + (isWeb ? 0 : insets.top),
        paddingBottom: 36 + (isWeb ? 0 : insets.bottom),
        paddingHorizontal: 28,
        position: "relative",
        overflow: "hidden",
        ...((isWeb
          ? {
              // Radial glow tint behind the glass card · per-slide colour.
              background: `radial-gradient(ellipse at 50% 0%, ${slide.glow}22 0%, ${INK_BG} 55%)`,
            }
          : {}) as any),
      }}
    >
      {/* Skip · hidden on last slide since the CTA is the only action */}
      {!isLast && onSkip ? (
        <Pressable
          onPress={onSkip}
          style={({ hovered }: any) => ({
            position: "absolute",
            top: 20,
            right: 24,
            paddingVertical: 6,
            paddingHorizontal: 8,
            opacity: hovered ? 0.7 : 1,
          })}
          accessibilityRole="button"
          accessibilityLabel="Skip onboarding"
        >
          <Text style={{ color: MUTED, fontSize: 12, fontFamily: "DMSans_500Medium", letterSpacing: 0.3 }}>
            Skip
          </Text>
        </Pressable>
      ) : null}

      {/* Glass card with icon */}
      <View
        style={{
          alignSelf: "center",
          marginTop: 24,
          width: 240,
          height: 240,
          borderRadius: 28,
          backgroundColor: CARD_BG,
          borderWidth: 1,
          borderColor: BORDER,
          alignItems: "center",
          justifyContent: "center",
          ...((isWeb
            ? {
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                boxShadow: `0 20px 60px ${slide.glow}33, inset 0 1px 0 ${BORDER_STRONG}`,
              }
            : {
                shadowColor: slide.glow,
                shadowOpacity: 0.2,
                shadowRadius: 20,
                shadowOffset: { width: 0, height: 12 },
                elevation: 8,
              }) as any),
        }}
      >
        <Icon size={170} />
      </View>

      {/* Tag */}
      <Text
        style={{
          marginTop: 34,
          fontSize: 11,
          fontFamily: "DMSans_700Bold",
          color: slide.glow,
          letterSpacing: 2.5,
          textAlign: "center",
        }}
      >
        {slide.tag}
      </Text>

      {/* Title */}
      <Text
        style={{
          marginTop: 10,
          fontSize: 26,
          fontFamily: "DMSans_700Bold",
          color: TEXT,
          letterSpacing: -0.6,
          textAlign: "center",
          lineHeight: 32,
        }}
      >
        {slide.title}
      </Text>

      {/* Sub */}
      <Text
        style={{
          marginTop: 12,
          fontSize: 14,
          color: MUTED,
          fontFamily: "DMSans_400Regular",
          textAlign: "center",
          lineHeight: 22,
          maxWidth: 300,
          alignSelf: "center",
        }}
      >
        {slide.sub}
      </Text>

      {/* Pagination pills */}
      <View style={{ flex: 1 }} />
      <View
        style={{
          flexDirection: "row",
          justifyContent: "center",
          gap: 8,
          marginBottom: 20,
        }}
      >
        {[1, 2, 3].map((n) => (
          <View
            key={n}
            style={{
              width: n === step ? 28 : 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: n === step ? slide.glow : "rgba(255,255,255,0.15)",
              ...((isWeb ? { transition: "all 300ms ease", boxShadow: n === step ? `0 0 12px ${slide.glow}66` : "none" } : {}) as any),
            }}
          />
        ))}
      </View>

      {/* CTA */}
      <Pressable
        onPress={onContinue}
        style={({ hovered, pressed }: any) => ({
          paddingVertical: 16,
          borderRadius: 14,
          backgroundColor: slide.glow,
          opacity: pressed ? 0.85 : 1,
          alignItems: "center",
          justifyContent: "center",
          ...((isWeb
            ? {
                boxShadow: `0 8px 24px ${slide.glow}55, inset 0 1px 0 rgba(255,255,255,0.2)`,
                transform: hovered ? "translateY(-1px)" : "none",
                transition: "all 0.2s ease",
                cursor: "pointer",
              }
            : {}) as any),
        })}
        accessibilityRole="button"
        accessibilityLabel={isLast ? "Get started" : "Continue"}
      >
        <Text style={{ color: "#fff", fontSize: 15, fontFamily: "DMSans_700Bold", letterSpacing: 0.3 }}>
          {isLast ? "Get started" : "Continue"}
        </Text>
      </Pressable>
    </View>
  );
}
