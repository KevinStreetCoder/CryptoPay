/**
 * UserAvatar — modern fintech-style avatar (Revolut/Cash App inspired).
 *
 * Uploaded avatar: rendered via expo-image with native caching.
 * No avatar: colorful circle with bold initials + decorative inner ring.
 * Tier-colored: gold border=admin, green=verified, primary=default.
 *
 * No network dependency for fallback — renders locally.
 */

import { View, Text } from "react-native";
import { Image } from "expo-image";
import { config } from "../constants/config";

// Vibrant gradient-inspired solid colors for avatar backgrounds
const AVATAR_PALETTES = [
  { bg: "#10B981", accent: "#34D399" },  // Emerald
  { bg: "#3B82F6", accent: "#60A5FA" },  // Blue
  { bg: "#8B5CF6", accent: "#A78BFA" },  // Purple
  { bg: "#EC4899", accent: "#F472B6" },  // Pink
  { bg: "#6366F1", accent: "#818CF8" },  // Indigo
  { bg: "#14B8A6", accent: "#2DD4BF" },  // Teal
  { bg: "#F59E0B", accent: "#FBBF24" },  // Amber
  { bg: "#EF4444", accent: "#F87171" },  // Red
];
const ADMIN_GOLD = "#D4AF37";
const ADMIN_ACCENT = "#F5D77A";

function getPalette(identifier: string, isAdmin?: boolean) {
  if (isAdmin) return { bg: ADMIN_GOLD, accent: ADMIN_ACCENT };
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) hash = identifier.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length];
}

function getInitials(name?: string, phone?: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    if (parts.length === 1) return parts[0][0].toUpperCase();
  }
  if (phone && phone.length >= 4) return phone.slice(-2);
  return "U";
}

function resolveUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const base = config.apiUrl.replace(/\/api\/v1\/?$/, "");
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

interface UserAvatarProps {
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
  avatarUrl,
  fullName,
  phone,
  userId,
  isStaff,
  isSuperuser,
  kycTier = 0,
  size,
  borderRadius,
  borderWidth = 2,
}: UserAvatarProps) {
  const isAdmin = isStaff || isSuperuser;
  const identifier = userId || phone || "user";
  const palette = getPalette(identifier, isAdmin);
  const borderClr = isAdmin ? ADMIN_GOLD : kycTier >= 1 ? "#10B981" : palette.bg;
  const radius = borderRadius ?? Math.round(size * 0.32);
  const resolved = resolveUrl(avatarUrl);
  const initials = getInitials(fullName, phone);
  const fontSize = size * (initials.length > 1 ? 0.33 : 0.40);

  // Uploaded avatar — use expo-image for reliable cross-platform rendering
  if (resolved) {
    return (
      <Image
        source={{ uri: resolved }}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          borderWidth,
          borderColor: borderClr + "60",
          backgroundColor: palette.bg + "30",
        }}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={200}
      />
    );
  }

  // Generated avatar — modern fintech style with decorative elements
  const ringSize = size * 0.75;
  const ringBorder = Math.max(1, size * 0.03);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        borderWidth,
        borderColor: borderClr + "60",
        backgroundColor: palette.bg,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {/* Decorative inner ring — adds depth like Revolut avatars */}
      <View
        style={{
          position: "absolute",
          width: ringSize,
          height: ringSize,
          borderRadius: ringSize / 2,
          borderWidth: ringBorder,
          borderColor: palette.accent + "30",
        }}
      />
      {/* Subtle top-left highlight for 3D feel */}
      <View
        style={{
          position: "absolute",
          top: -size * 0.15,
          left: -size * 0.15,
          width: size * 0.6,
          height: size * 0.6,
          borderRadius: size * 0.3,
          backgroundColor: "rgba(255,255,255,0.12)",
        }}
      />
      {/* Initials — use fontWeight as primary (always works on Android) */}
      <Text
        style={{
          color: "#FFFFFF",
          fontSize,
          fontWeight: "800",
          letterSpacing: initials.length > 1 ? 1.5 : 0.5,
          includeFontPadding: false,
          textAlignVertical: "center",
          lineHeight: fontSize * 1.1,
        }}
      >
        {initials}
      </Text>
    </View>
  );
}
