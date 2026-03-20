/**
 * UserAvatar — reliable avatar for all platforms.
 *
 * Uploaded photo: expo-image with native caching.
 * No photo: colored circle with bold white initials.
 * Tier borders: gold=admin, green=verified.
 */

import { View, Text, Platform } from "react-native";
import { Image } from "expo-image";
import { config } from "../constants/config";

const COLORS = ["#10B981", "#3B82F6", "#8B5CF6", "#EC4899", "#6366F1", "#14B8A6", "#F59E0B", "#EF4444"];
const ADMIN_GOLD = "#D4AF37";

function pickColor(id: string, admin?: boolean): string {
  if (admin) return ADMIN_GOLD;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return COLORS[Math.abs(h) % COLORS.length];
}

function initials(name?: string, phone?: string): string {
  if (name && name.trim()) {
    const p = name.trim().split(/\s+/).filter(Boolean);
    if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase();
    if (p.length === 1) return p[0][0].toUpperCase();
  }
  if (phone && phone.length >= 2) return phone.slice(-2);
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
  const bg = pickColor(id, admin);
  const border = admin ? ADMIN_GOLD : kycTier >= 1 ? "#10B981" : bg;
  const r = borderRadius ?? Math.round(size * 0.32);
  const resolved = resolveUrl(avatarUrl);
  const letters = initials(fullName, phone);
  const fs = Math.round(size * (letters.length > 1 ? 0.33 : 0.40));

  if (resolved) {
    return (
      <Image
        source={{ uri: resolved }}
        style={{
          width: size, height: size, borderRadius: r,
          borderWidth, borderColor: border + "60",
          backgroundColor: bg + "30",
        }}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={200}
      />
    );
  }

  return (
    <View style={{
      width: size, height: size, borderRadius: r,
      borderWidth, borderColor: border + "60",
      backgroundColor: bg,
      justifyContent: "center", alignItems: "center",
    }}>
      <Text style={{
        color: "#FFF",
        fontSize: fs,
        fontWeight: Platform.OS === "android" ? "bold" : "800",
        textAlign: "center",
        includeFontPadding: false,
      }}>
        {letters}
      </Text>
    </View>
  );
}
