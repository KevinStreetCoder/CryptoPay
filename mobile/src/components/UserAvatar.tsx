/**
 * UserAvatar — works on ALL platforms including BlueStacks.
 *
 * BlueStacks has a bug where RN Text inside a View with backgroundColor
 * renders invisible. This component uses react-native-svg for the fallback
 * avatar — SVG text is rendered by the native SVG engine, not RN's Text
 * component, so it bypasses the bug entirely. No network needed.
 *
 * For uploaded photos: expo-image with native caching.
 * For generated avatars: react-native-svg with initial letter.
 */

import { View } from "react-native";
import { Image } from "expo-image";
import Svg, { Rect, Text as SvgText } from "react-native-svg";
import { config } from "../constants/config";

const COLORS = ["10B981", "3B82F6", "8B5CF6", "EC4899", "6366F1", "14B8A6", "F59E0B", "EF4444"];
const ADMIN_GOLD = "D4AF37";

function pickColorHex(id: string, admin?: boolean): string {
  if (admin) return ADMIN_GOLD;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return COLORS[Math.abs(h) % COLORS.length];
}

function getInitial(name?: string): string {
  if (name && name.trim()) return name.trim()[0].toUpperCase();
  return "U";
}

function resolveUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  const base = config.apiUrl.replace(/\/api\/v1\/?$/, "");
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

interface Props {
  avatarUrl?: string | null;
  fullName?: string;
  phone?: string;
  userId?: string;
  isStaff?: boolean;
  isSuperuser?: boolean;
  kycTier?: number;
  size: number;
  borderRadius?: number;
  borderWidth?: number;
}

export function UserAvatar({
  avatarUrl, fullName, phone, userId,
  isStaff, isSuperuser, kycTier = 0,
  size, borderRadius, borderWidth = 2,
}: Props) {
  const admin = isStaff || isSuperuser;
  const id = userId || phone || "u";
  const bgHex = pickColorHex(id, admin);
  const borderHex = admin ? ADMIN_GOLD : kycTier >= 1 ? "10B981" : bgHex;
  const r = borderRadius ?? Math.round(size * 0.32);
  const resolved = resolveUrl(avatarUrl);

  if (resolved) {
    return (
      <Image
        source={{ uri: resolved }}
        style={{
          width: size, height: size, borderRadius: r,
          borderWidth, borderColor: `#${borderHex}99`,
          backgroundColor: `#${bgHex}`,
        }}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={150}
      />
    );
  }

  // Fallback: render initial via react-native-svg.
  // SVG text uses the native SVG engine, NOT React Native's Text component,
  // so it bypasses the BlueStacks invisible-text bug. Fully offline.
  const letter = getInitial(fullName);
  const fontSize = Math.round(size * 0.42);
  const rx = Math.round(size * 0.15);

  return (
    <View style={{
      width: size, height: size, borderRadius: r,
      borderWidth, borderColor: `#${borderHex}99`,
      overflow: "hidden",
    }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Rect width={size} height={size} rx={rx} fill={`#${bgHex}`} />
        <SvgText
          x={size / 2}
          y={size * 0.54}
          textAnchor="middle"
          alignmentBaseline="central"
          fill="white"
          fontSize={fontSize}
          fontWeight="700"
          fontFamily="sans-serif"
        >
          {letter}
        </SvgText>
      </Svg>
    </View>
  );
}
