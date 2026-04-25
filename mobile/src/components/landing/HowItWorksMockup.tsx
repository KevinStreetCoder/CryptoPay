/**
 * HowItWorksMockup · a small phone-shaped card rendering three real
 * product states stacked vertically:
 *
 *   1. Paybill entry    · account number typed, amount filled
 *   2. Rate lock        · "131.47 KES/USDT locked · 1:27 remaining"
 *   3. Confirmation     · green tick, "KES 450 sent"
 *
 * Replaces the generic `credit_card_payment_vzc8.svg` unDraw cartoon in
 * the "How it works" section. Renders with theme tokens so the palette
 * stays consistent with the live app.
 *
 * Motion: entirely static by default. Whole card lifts 4 px and the
 * emerald ring brightens by ~30% on hover · nothing else moves. No
 * internal animations, no ticking countdown, no blinking cursors. The
 * design philosophy is "this is what the product actually looks like",
 * not "here's something vaguely resembling a phone".
 */

import { View, Text, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getThemeColors } from "../../constants/theme";
import { useThemeMode } from "../../stores/theme";

type Props = {
  width?: number;
  /** Aspect ratio controls height; 0.54 is roughly a modern phone. */
  aspect?: number;
};

export function HowItWorksMockup({ width = 280, aspect = 0.54 }: Props) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const height = Math.round(width / aspect);
  const accent = tc.primary[500] || "#10B981";
  const textPrimary = tc.textPrimary;
  const textSecondary = tc.textSecondary;
  const textMuted = tc.textMuted;

  const surface = isDark ? "#0B1628" : "#FFFFFF";
  const surfaceElev = isDark ? "#132238" : "#F5F7FA";
  const divider = isDark ? "rgba(255,255,255,0.05)" : "rgba(10,30,60,0.08)";

  return (
    <View
      // Hover-only lift. RN-web forwards onHoverIn/Out on Pressable but
      // not on View, so we rely on CSS :hover via className for web and
      // a clean static card on native. See the <style> injection below.
      // @ts-expect-error · className is an RN-web-only prop.
      className={Platform.OS === "web" ? "cpay-howitworks-mockup" : undefined}
      style={{
        width,
        height,
        backgroundColor: surface,
        borderRadius: 28,
        borderWidth: 1,
        borderColor: divider,
        overflow: "hidden",
        ...(Platform.OS === "web"
          ? ({
              // Subtle ring, not a glow · production apps don't halo.
              boxShadow: `0 20px 40px rgba(0,0,0,0.35), inset 0 0 0 1px ${divider}`,
              transition: "transform 0.35s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.35s ease",
            } as any)
          : {}),
      }}
    >
      {Platform.OS === "web" ? (
        // Inject the hover rule once per page. Cheaper than styled-components
        // and keeps the transition local to this component's class.
        <style
          // @ts-ignore · raw <style> is web-only and types vary by RN-web version.
          dangerouslySetInnerHTML={{
            __html: `
              .cpay-howitworks-mockup:hover {
                transform: translateY(-4px);
                box-shadow: 0 28px 56px rgba(0,0,0,0.45), inset 0 0 0 1px ${accent}33 !important;
              }
            `,
          }}
        />
      ) : null}

      {/* Status bar · notch + signal/time, very subtle. */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingHorizontal: 22,
          paddingTop: 14,
          paddingBottom: 10,
        }}
      >
        <Text style={{ color: textPrimary, fontSize: 10, fontFamily: "DMSans_600SemiBold", letterSpacing: 0.4 }}>
          9:41
        </Text>
        <View
          style={{
            width: 56,
            height: 18,
            borderRadius: 9,
            backgroundColor: isDark ? "#000" : "#0B1628",
          }}
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <Ionicons name="cellular" size={10} color={textSecondary} />
          <Ionicons name="wifi" size={10} color={textSecondary} />
          <Ionicons name="battery-full" size={12} color={textSecondary} />
        </View>
      </View>

      {/* Three stacked product steps. Each is a real card state the user
          sees in-app, rendered at reduced fidelity. */}
      <View style={{ paddingHorizontal: 16, paddingTop: 4, gap: 10 }}>
        {/* Step 1 · Paybill entry */}
        <StepCard
          index={1}
          title="Enter paybill"
          bg={surfaceElev}
          border={divider}
          textPrimary={textPrimary}
          textMuted={textMuted}
          accent={accent}
          stepActive
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <View>
              <Text style={{ color: textMuted, fontSize: 8, fontFamily: "DMSans_500Medium", letterSpacing: 1 }}>
                PAYBILL
              </Text>
              <Text style={{ color: textPrimary, fontSize: 14, fontFamily: "DMSans_600SemiBold", marginTop: 2 }}>
                123456
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ color: textMuted, fontSize: 8, fontFamily: "DMSans_500Medium", letterSpacing: 1 }}>
                AMOUNT
              </Text>
              <Text style={{ color: textPrimary, fontSize: 14, fontFamily: "DMSans_600SemiBold", marginTop: 2 }}>
                KES 450
              </Text>
            </View>
          </View>
        </StepCard>

        {/* Step 2 · Rate lock */}
        <StepCard
          index={2}
          title="Rate locked"
          bg={surfaceElev}
          border={divider}
          textPrimary={textPrimary}
          textMuted={textMuted}
          accent={accent}
        >
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 8 }}>
            <Text style={{ color: textPrimary, fontSize: 14, fontFamily: "DMSans_700Bold" }}>
              131.47
            </Text>
            <Text style={{ color: textMuted, fontSize: 10, fontFamily: "DMSans_500Medium" }}>
              KES / USDT
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
            <Ionicons name="lock-closed" size={9} color={accent} />
            <Text style={{ color: accent, fontSize: 9, fontFamily: "DMSans_500Medium" }}>
              Locked · 1:27 remaining
            </Text>
          </View>
        </StepCard>

        {/* Step 3 · Confirmation */}
        <StepCard
          index={3}
          title="Paid"
          bg={`${accent}1A`}
          border={`${accent}40`}
          textPrimary={textPrimary}
          textMuted={textMuted}
          accent={accent}
          successIcon
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
            <Ionicons name="checkmark-circle" size={14} color={accent} />
            <Text style={{ color: textPrimary, fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>
              KES 450 sent to 123456
            </Text>
          </View>
          <Text style={{ color: textMuted, fontSize: 9, fontFamily: "DMSans_400Regular", marginTop: 3 }}>
            Ref: CP7HX92L · 18 seconds
          </Text>
        </StepCard>
      </View>

      {/* Subtle bottom home-bar so the card reads as a phone. */}
      <View
        style={{
          position: "absolute",
          bottom: 10,
          left: 0,
          right: 0,
          alignItems: "center",
        }}
      >
        <View
          style={{
            width: 96,
            height: 4,
            borderRadius: 2,
            backgroundColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(10,30,60,0.3)",
          }}
        />
      </View>
    </View>
  );
}

// Private sub-component · a single labelled step card. Kept in the same
// file because it's only meaningful inside the mockup and keeps the
// import story tight.
function StepCard({
  index,
  title,
  children,
  bg,
  border,
  textPrimary,
  textMuted,
  accent,
  stepActive,
  successIcon,
}: {
  index: number;
  title: string;
  children: React.ReactNode;
  bg: string;
  border: string;
  textPrimary: string;
  textMuted: string;
  accent: string;
  stepActive?: boolean;
  successIcon?: boolean;
}) {
  return (
    <View
      style={{
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
        borderRadius: 14,
        paddingVertical: 10,
        paddingHorizontal: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View
            style={{
              width: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: stepActive || successIcon ? accent : `${accent}22`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                color: stepActive || successIcon ? "#0B1628" : accent,
                fontSize: 10,
                fontFamily: "DMSans_700Bold",
              }}
            >
              {index}
            </Text>
          </View>
          <Text style={{ color: textPrimary, fontSize: 11, fontFamily: "DMSans_600SemiBold", letterSpacing: 0.2 }}>
            {title}
          </Text>
        </View>
        {successIcon ? (
          <Ionicons name="shield-checkmark" size={12} color={accent} />
        ) : (
          <Text style={{ color: textMuted, fontSize: 9, fontFamily: "DMSans_500Medium", letterSpacing: 0.6 }}>
            STEP {index}
          </Text>
        )}
      </View>
      {children}
    </View>
  );
}
