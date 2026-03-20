/**
 * UserAvatar — bulletproof avatar for Android + iOS + Web.
 *
 * Uploaded photo: expo-image with native caching.
 * No photo: renders initials as SVG data URI via expo-image
 *           (bypasses Android Text rendering issues entirely).
 * Tier borders: gold=admin, green=verified.
 */

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

function getInitials(name?: string, phone?: string): string {
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

/**
 * Generate an SVG data URI with initials on a colored background.
 * This renders via expo-image's native SVG decoder — no React Native
 * Text component involved, so it works on ALL Android devices.
 */
function generateAvatarSvg(letters: string, bgColor: string, size: number): string {
  const fontSize = Math.round(size * (letters.length > 1 ? 0.38 : 0.45));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="${bgColor}" rx="${Math.round(size * 0.15)}"/>
    <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="${fontSize}" font-weight="700" font-family="Arial,Helvetica,sans-serif" letter-spacing="1">${letters}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
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
  const letters = getInitials(fullName, phone);

  // Use uploaded avatar or generated SVG — both rendered via expo-image
  const imageSource = resolved || generateAvatarSvg(letters, bg, size * 2);

  return (
    <Image
      source={imageSource}
      style={{
        width: size,
        height: size,
        borderRadius: r,
        borderWidth,
        borderColor: border + "60",
        backgroundColor: bg + "30",
      }}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={150}
    />
  );
}
