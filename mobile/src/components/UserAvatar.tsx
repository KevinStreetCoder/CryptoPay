/**
 * UserAvatar — production-ready avatar component using expo-image.
 *
 * Uses expo-image (not RN Image) for reliable remote URL loading on Android.
 * Falls back to ui-avatars.com generated PNG when no uploaded avatar exists.
 * Tier-colored borders: gold=admin, green=verified, primary=default.
 */

import { View } from "react-native";
import { Image } from "expo-image";
import { colors } from "../constants/theme";
import { config } from "../constants/config";

const AVATAR_COLORS = ["#10B981", "#3B82F6", "#8B5CF6", "#EC4899", "#6366F1", "#14B8A6", "#F59E0B", "#EF4444"];
const ADMIN_GOLD = "#D4AF37";

function getAvatarColor(identifier: string, isAdmin?: boolean): string {
  if (isAdmin) return ADMIN_GOLD;
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) hash = identifier.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function resolveAvatarUrl(url: string | null | undefined): string | null {
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
  const bgColor = getAvatarColor(identifier, isAdmin);
  const borderColor = isAdmin ? ADMIN_GOLD : kycTier >= 1 ? "#10B981" : bgColor;
  const radius = borderRadius ?? Math.round(size * 0.32);

  const resolvedUrl = resolveAvatarUrl(avatarUrl);

  // Generate fallback avatar URL from ui-avatars.com
  const bgHex = bgColor.replace("#", "");
  const name = encodeURIComponent(fullName || phone?.slice(-4) || "U");
  const fallbackUrl = `https://ui-avatars.com/api/?name=${name}&size=${size * 2}&background=${bgHex}&color=fff&bold=true&font-size=0.38&rounded=true&format=png`;

  const imageUrl = resolvedUrl || fallbackUrl;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        borderWidth,
        borderColor: borderColor + "55",
        overflow: "hidden",
        backgroundColor: bgColor + "15",
      }}
    >
      <Image
        source={{ uri: imageUrl }}
        style={{
          width: size - borderWidth * 2,
          height: size - borderWidth * 2,
          borderRadius: radius > 2 ? radius - 2 : radius,
        }}
        contentFit="cover"
        cachePolicy="memory-disk"
        placeholder={null}
        transition={200}
      />
    </View>
  );
}
