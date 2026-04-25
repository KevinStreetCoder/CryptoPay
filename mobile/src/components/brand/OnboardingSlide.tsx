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
 *
 * Copy lives in i18n (`onboarding.*` keys) so the language toggle on the
 * splash flips it via the LanguageContext re-render. Skip button sits
 * top-right per the design (matches the user-reported expectation that
 * "skip is on top"). Last slide drops the skip and exposes "Get started".
 */
import { View, Text, Pressable, Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OnboardingIcon1, OnboardingIcon2, OnboardingIcon3 } from "./PolishAssets";
import { useLocale } from "../../hooks/useLocale";

type Step = 1 | 2 | 3;

const INK_BG = "#060E1F";
const CARD_BG = "rgba(22, 39, 66, 0.55)";
const BORDER = "rgba(255,255,255,0.08)";
const BORDER_STRONG = "rgba(255,255,255,0.14)";
const TEXT = "#E8EEF7";
const MUTED = "#8396AD";

// Per-slide glow colour drives the radial backdrop, the card shadow,
// the tag, the active pagination pill, and the CTA. Matches the design
// hex values so the visuals stay 1:1 with the handoff renders.
const SLIDE_GLOWS: Record<Step, string> = {
  1: "#10B981", // emerald
  2: "#627EEA", // ETH blue
  3: "#F59E0B", // amber
};

export interface OnboardingSlideProps {
  step: Step;
  onContinue: () => void;
  onSkip?: () => void;
}

export function OnboardingSlide({ step, onContinue, onSkip }: OnboardingSlideProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { t } = useLocale();
  const glow = SLIDE_GLOWS[step];
  const tag = t(`onboarding.slide${step}Tag` as any);
  const title = t(`onboarding.slide${step}Title` as any);
  const sub = t(`onboarding.slide${step}Sub` as any);
  const Icon = step === 1 ? OnboardingIcon1 : step === 2 ? OnboardingIcon2 : OnboardingIcon3;
  const isLast = step === 3;
  // The design constrains the slide to 360 px on web; on mobile we let
  // the SafeArea fill the screen so the layout matches a phone bezel.
  const innerWidth = isWeb && width >= 768 ? 360 : width;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: INK_BG,
        paddingTop: 56 + (isWeb ? 0 : insets.top),
        paddingBottom: 36 + (isWeb ? 0 : insets.bottom),
        paddingHorizontal: 28,
        position: "relative",
        overflow: "hidden",
        ...((isWeb
          ? {
              // Radial glow tint behind the glass card · per-slide colour.
              background: `radial-gradient(ellipse at 50% 0%, ${glow}22 0%, ${INK_BG} 55%)`,
            }
          : {}) as any),
      }}
    >
      {/* Skip · top right per design. Hidden on the last slide so the
          single CTA ("Get started") is the only action.  */}
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
            zIndex: 5,
          })}
          accessibilityRole="button"
          accessibilityLabel={t("onboarding.skip" as any)}
        >
          <Text
            style={{
              color: MUTED,
              fontSize: 12,
              fontFamily: "DMSans_500Medium",
              letterSpacing: 0.3,
            }}
          >
            {t("onboarding.skip" as any)}
          </Text>
        </Pressable>
      ) : null}

      {/* Glass card with icon + inner ring */}
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
          position: "relative",
          overflow: "hidden",
          ...((isWeb
            ? {
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                boxShadow: `0 20px 60px ${glow}33, inset 0 1px 0 ${BORDER_STRONG}`,
              }
            : {
                shadowColor: glow,
                shadowOpacity: 0.2,
                shadowRadius: 20,
                shadowOffset: { width: 0, height: 12 },
                elevation: 8,
              }) as any),
        }}
      >
        {/* Inner glow ring · matches the design's radial-gradient overlay
            (line 694-697 of polish-assets.jsx). On native we approximate
            with a solid-tinted absolute layer at low opacity since RN
            doesn't ship a radial-gradient primitive without an extra dep. */}
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 20,
            left: 20,
            right: 20,
            bottom: 20,
            borderRadius: 20,
            ...((isWeb
              ? {
                  background: `radial-gradient(circle at 50% 40%, ${glow}26 0%, transparent 70%)`,
                }
              : {
                  backgroundColor: glow + "12",
                  opacity: 0.7,
                }) as any),
          }}
        />
        <View style={{ zIndex: 1 }}>
          <Icon size={170} />
        </View>
      </View>

      {/* Tag */}
      <Text
        style={{
          marginTop: 34,
          fontSize: 11,
          fontFamily: "DMSans_700Bold",
          color: glow,
          letterSpacing: 2.5,
          textAlign: "center",
        }}
      >
        {tag}
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
          maxWidth: innerWidth - 56,
          alignSelf: "center",
        }}
      >
        {title}
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
        {sub}
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
              backgroundColor: n === step ? glow : "rgba(255,255,255,0.15)",
              ...((isWeb
                ? {
                    transition: "all 300ms ease",
                    boxShadow: n === step ? `0 0 12px ${glow}66` : "none",
                  }
                : {}) as any),
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
          backgroundColor: glow,
          opacity: pressed ? 0.85 : 1,
          alignItems: "center",
          justifyContent: "center",
          ...((isWeb
            ? {
                boxShadow: `0 8px 24px ${glow}55, inset 0 1px 0 rgba(255,255,255,0.2)`,
                transform: hovered ? "translateY(-1px)" : "none",
                transition: "all 0.2s ease",
                cursor: "pointer",
              }
            : {}) as any),
        })}
        accessibilityRole="button"
        accessibilityLabel={
          isLast ? t("onboarding.getStarted" as any) : t("onboarding.continue" as any)
        }
      >
        <Text
          style={{
            color: "#fff",
            fontSize: 15,
            fontFamily: "DMSans_700Bold",
            letterSpacing: 0.3,
          }}
        >
          {isLast ? t("onboarding.getStarted" as any) : t("onboarding.continue" as any)}
        </Text>
      </Pressable>
    </View>
  );
}
