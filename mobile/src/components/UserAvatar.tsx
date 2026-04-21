/**
 * UserAvatar · works on ALL platforms including BlueStacks.
 *
 * The backend returns avatar as a base64 data URI in the profile response,
 * so no network image loading is needed. This bypasses all Android
 * SSL/CDN/Glide issues completely.
 *
 * Fallback: Ionicons person silhouette on a colored background.
 */

import { useState } from "react";
import { View, Image, Platform } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

const COLORS = ["10B981", "3B82F6", "8B5CF6", "EC4899", "6366F1", "14B8A6", "F59E0B", "EF4444"];
const ADMIN_GOLD = "D4AF37";

function pickColorHex(id: string, admin?: boolean): string {
  if (admin) return ADMIN_GOLD;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return COLORS[Math.abs(h) % COLORS.length];
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
  const [imgFailed, setImgFailed] = useState(false);

  // avatarUrl is now a data:image/jpeg;base64,... URI from the backend
  const hasAvatar = !!avatarUrl && !imgFailed;

  if (hasAvatar) {
    const imgStyle = {
      width: size, height: size, borderRadius: r,
      borderWidth, borderColor: `#${borderHex}99`,
      backgroundColor: `#${bgHex}`,
    };

    if (Platform.OS === "web") {
      return (
        <ExpoImage
          source={{ uri: avatarUrl }}
          style={imgStyle}
          contentFit="cover"
          transition={150}
          onError={() => setImgFailed(true)}
        />
      );
    }

    return (
      <Image
        source={{ uri: avatarUrl }}
        style={{ ...imgStyle, resizeMode: "cover" } as any}
        onError={() => setImgFailed(true)}
      />
    );
  }

  // Fallback: colored background + Ionicons person silhouette
  const iconSize = Math.round(size * 0.52);

  return (
    <View style={{
      width: size, height: size, borderRadius: r,
      borderWidth, borderColor: `#${borderHex}99`,
      backgroundColor: `#${bgHex}`,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    }}>
      <Ionicons name="person" size={iconSize} color="rgba(255,255,255,0.9)" />
    </View>
  );
}
