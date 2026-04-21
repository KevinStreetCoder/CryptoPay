/**
 * Cpay wordmark · Coin-C mark + "Cpay" text with the "C" in emerald.
 *
 * Ported from the design handoff (cpay/project/logos.jsx · Wordmark).
 * Visual contract from the design canvas:
 *   - "C" always emerald #10B981
 *   - "pay" is ink #0B1220 on paper backgrounds, pure white #FFFFFF on
 *     ink backgrounds · the dark variant in the design.
 *   - Gap between mark and text = size * 0.24 (tight, as shown in the
 *     Wordmark · light / dark artboards).
 *   - Letter-spacing: -0.02em relative to size.
 *   - Font: DM Sans 700.
 *
 * Props:
 *   - `size`       : pixel height of the mark (text scales with it). Default 36.
 *   - `dark`       : true → "pay" is white. Default false.
 *   - `pill`       : true → wrap in an ink pill (use only when sitting on
 *                    a non-ink background · e.g. an email header inside
 *                    a paper card). Default false.
 *   - `color`      : explicit override for "pay" color. Skip it unless
 *                    you're matching a non-standard chrome tint.
 *   - `textOnly`   : hide the mark. Useful for tight headers where the
 *                    mark would compete with a nearby icon.
 */
import { View, Text, Image, Platform } from "react-native";
import { colors } from "../../constants/theme";

const LOGO_MARK = require("../../../assets/brand-mark.png");

// Brand ink is LOCKED to the design handoff, not the theme's app-bg token.
// Brand assets must not drift with theme tweaks.
const BRAND_INK = "#0B1220";
const BRAND_PAPER = "#FFFFFF";

export interface WordmarkProps {
  size?: number;
  dark?: boolean;
  pill?: boolean;
  color?: string;
  textOnly?: boolean;
  /** Render only the Coin-C mark, no "Cpay" text. Used on tight
   *  surfaces (collapsed sidebar, favicons, push icons). */
  markOnly?: boolean;
}

export function Wordmark({
  size = 36,
  dark = false,
  pill = false,
  color,
  textOnly = false,
  markOnly = false,
}: WordmarkProps) {
  const textColor = color ?? (dark ? BRAND_PAPER : BRAND_INK);
  const pillStyle =
    pill && dark
      ? {
          backgroundColor: BRAND_INK,
          paddingVertical: size * 0.3,
          paddingHorizontal: size * 0.45,
          borderRadius: 12,
        }
      : {};

  // Mark-only → render just the Coin-C, no text + no gap.
  if (markOnly) {
    return (
      <Image
        source={LOGO_MARK}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessibilityLabel="Cpay"
      />
    );
  }

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: size * 0.24,
        ...pillStyle,
      }}
    >
      {!textOnly && (
        <Image
          source={LOGO_MARK}
          style={{ width: size, height: size }}
          resizeMode="contain"
        />
      )}
      <Text
        style={{
          color: textColor,
          fontSize: size * 0.82,
          fontFamily: "DMSans_700Bold",
          letterSpacing: -size * 0.02,
          lineHeight: size * 0.98,
          ...(Platform.OS === "web" ? ({ userSelect: "none" } as any) : {}),
        }}
      >
        <Text style={{ color: colors.primary[500] }}>C</Text>
        <Text>pay</Text>
      </Text>
    </View>
  );
}
