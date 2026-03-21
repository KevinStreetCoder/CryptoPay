/**
 * UserAvatar — works on ALL platforms including BlueStacks.
 *
 * On Android, direct URL image loading fails (Glide + RN Image both fail
 * with Cloudflare CDN). Solution: fetch via axios (same client that works
 * for API calls) and display as base64 data URI.
 *
 * Fallback: Ionicons person silhouette on a colored background.
 */

import { useState, useEffect } from "react";
import { View, Image, Platform } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { config } from "../constants/config";

const COLORS = ["10B981", "3B82F6", "8B5CF6", "EC4899", "6366F1", "14B8A6", "F59E0B", "EF4444"];
const ADMIN_GOLD = "D4AF37";

// Simple in-memory cache for fetched avatar base64 data
const avatarCache: Record<string, string> = {};

function pickColorHex(id: string, admin?: boolean): string {
  if (admin) return ADMIN_GOLD;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return COLORS[Math.abs(h) % COLORS.length];
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

  // On native: fetch avatar via fetch() (same network stack as axios) → base64
  const [base64Uri, setBase64Uri] = useState<string | null>(
    resolved ? avatarCache[resolved] || null : null
  );
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    if (!resolved || Platform.OS === "web") return;
    if (avatarCache[resolved]) {
      setBase64Uri(avatarCache[resolved]);
      return;
    }

    let cancelled = false;
    fetch(resolved)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      })
      .then((dataUri) => {
        if (!cancelled) {
          avatarCache[resolved] = dataUri;
          setBase64Uri(dataUri);
        }
      })
      .catch(() => {
        if (!cancelled) setFetchFailed(true);
      });

    return () => { cancelled = true; };
  }, [resolved]);

  const imgStyle = {
    width: size, height: size, borderRadius: r,
    borderWidth, borderColor: `#${borderHex}99`,
    backgroundColor: `#${bgHex}`,
  };

  // Web: use expo-image directly (no Cloudflare/SSL issues in browsers)
  if (Platform.OS === "web" && resolved) {
    return (
      <ExpoImage
        source={{ uri: resolved }}
        style={imgStyle}
        contentFit="cover"
        cachePolicy="memory"
        transition={150}
        onError={() => {}}
      />
    );
  }

  // Native: show base64 fetched image
  if (base64Uri) {
    return (
      <Image
        source={{ uri: base64Uri }}
        style={{ ...imgStyle, resizeMode: "cover" } as any}
      />
    );
  }

  // Fallback: colored background + Ionicons person silhouette
  const iconSize = Math.round(size * 0.52);

  return (
    <View style={{
      ...imgStyle,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    }}>
      <Ionicons name="person" size={iconSize} color="rgba(255,255,255,0.9)" />
    </View>
  );
}
