/**
 * UserAvatar — colored circle with initial letter.
 *
 * Uses system font only (no fontFamily) — custom DMSans fonts
 * don't load on BlueStacks and some Android devices.
 */

import { View, Text } from "react-native";
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
  const bg = pickColor(id, admin);
  const border = admin ? ADMIN_GOLD : kycTier >= 1 ? "#10B981" : bg;
  const r = borderRadius ?? Math.round(size * 0.32);
  const resolved = resolveUrl(avatarUrl);

  if (resolved) {
    return (
      <Image
        source={{ uri: resolved }}
        style={{
          width: size, height: size, borderRadius: r,
          borderWidth, borderColor: border + "60",
          backgroundColor: bg,
        }}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={150}
      />
    );
  }

  const letter = getInitial(fullName);
  const fs = Math.round(size * 0.4);

  return (
    <View style={{
      width: size, height: size, borderRadius: r,
      borderWidth, borderColor: border + "60",
      backgroundColor: bg,
      alignItems: "center", justifyContent: "center",
    }}>
      <Text
        allowFontScaling={false}
        style={{ color: "#FFF", fontSize: fs, fontWeight: "bold" }}
      >
        {letter}
      </Text>
    </View>
  );
}
