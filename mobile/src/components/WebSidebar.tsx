import React, { useState, useCallback } from "react";
import { View, Text, Pressable, Platform, useWindowDimensions, Image } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../stores/auth";
import { colors, getThemeColors, getThemeShadows } from "../constants/theme";
import { Wordmark } from "./brand/Wordmark";
import { useThemeMode } from "../stores/theme";
import { config } from "../constants/config";
import { TourStep } from "./AppTour";
import { UserAvatar } from "./UserAvatar";

function resolveAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) return url;
  const base = config.apiUrl.replace(/\/api\/v1\/?$/, "");
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

const SIDEBAR_EXPANDED = 260;
const SIDEBAR_COLLAPSED = 68;

const NAV_ITEMS = [
  {
    key: "index",
    label: "Dashboard",
    icon: "grid-outline" as const,
    iconActive: "grid" as const,
    path: "/(tabs)",
  },
  {
    key: "pay",
    label: "Pay",
    icon: "send-outline" as const,
    iconActive: "send" as const,
    path: "/(tabs)/pay",
  },
  {
    key: "wallet",
    label: "Wallet",
    icon: "wallet-outline" as const,
    iconActive: "wallet" as const,
    path: "/(tabs)/wallet",
  },
  {
    key: "profile",
    label: "Profile",
    icon: "person-outline" as const,
    iconActive: "person" as const,
    path: "/(tabs)/profile",
  },
];

const SECONDARY_ITEMS = [
  {
    key: "settings",
    label: "Settings",
    icon: "settings-outline" as const,
    path: "/settings",
  },
  {
    key: "help",
    label: "Help & Support",
    icon: "help-circle-outline" as const,
    path: "/settings/help",
  },
];

function getInitials(name: string | undefined): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0][0].toUpperCase();
}

/** Tooltip wrapper for collapsed nav items on web */
function NavTooltip({
  label,
  collapsed,
  children,
}: {
  label: string;
  collapsed: boolean;
  children: React.ReactNode;
}) {
  if (!collapsed || Platform.OS !== "web") {
    return <>{children}</>;
  }

  return (
    <View
      style={
        Platform.OS === "web"
          ? ({
              position: "relative",
            } as any)
          : {}
      }
    >
      {/* Wrap children to attach CSS group hover via nesting */}
      <View
        // @ts-ignore – web-only className
        dataSet={{ tooltip: label }}
        style={
          Platform.OS === "web"
            ? ({
                position: "relative",
              } as any)
            : {}
        }
      >
        {children}
      </View>
    </View>
  );
}

export function WebSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);

  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;

  const isActive = (item: (typeof NAV_ITEMS)[0]) => {
    if (item.key === "index") {
      return pathname === "/" || pathname === "/(tabs)" || pathname === "/(tabs)/index";
    }
    if (item.key === "pay") {
      return pathname.includes("/pay") || pathname.includes("/payment");
    }
    if (item.key === "profile") {
      // Only match exact profile path, not /settings/edit-profile
      return pathname === "/(tabs)/profile" || pathname === "/profile";
    }
    if (item.key === "wallet") {
      return pathname === "/(tabs)/wallet" || pathname === "/wallet";
    }
    return pathname === `/(tabs)/${item.key}` || pathname === `/${item.key}`;
  };

  const isSecondaryActive = (item: (typeof SECONDARY_ITEMS)[0]) => {
    if (item.key === "help") {
      return pathname === "/settings/help";
    }
    if (item.key === "settings") {
      return pathname.startsWith("/settings") && pathname !== "/settings/help";
    }
    return pathname === item.path;
  };

  const handleLogout = async () => {
    await logout();
    router.replace("/auth/login");
  };

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  return (
    <View
      style={{
        width: sidebarWidth,
        backgroundColor: isDark ? "#0A1628" : "#FFFFFF",
        borderRightWidth: 1,
        borderRightColor: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.08)",
        paddingTop: 24,
        paddingBottom: 20,
        justifyContent: "space-between",
        ...(Platform.OS === "web"
          ? ({
              height: "100vh",
              position: "sticky",
              top: 0,
              transition: "width 0.2s ease",
              overflow: "hidden",
            } as any)
          : {}),
      }}
    >
      {/* Top section */}
      <View>
        {/* Logo + toggle */}
        <Pressable
          onPress={() => router.push("/(tabs)" as any)}
          style={{
            paddingHorizontal: collapsed ? 0 : 24,
            paddingBottom: 12,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-start",
            gap: collapsed ? 0 : 12,
            ...(Platform.OS === "web" ? { cursor: "pointer" } as any : {}),
          }}
        >
          {/* Brand Wordmark — Coin-C + "Cpay". Collapses to Coin-C-only on narrow sidebar. */}
          {collapsed ? (
            <Wordmark size={28} dark textOnly={false} />
          ) : (
            <Wordmark size={32} dark />
          )}
        </Pressable>

        {/* Toggle button */}
        <View
          style={{
            paddingHorizontal: collapsed ? 0 : 16,
            alignItems: collapsed ? "center" : "flex-end",
            marginBottom: 12,
          }}
        >
          <Pressable
            onPress={toggleCollapsed}
            style={({ pressed, hovered }: any) => ({
              width: 32,
              height: 32,
              borderRadius: 8,
              backgroundColor: hovered
                ? isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"
                : isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.03)",
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.7 : 1,
              ...(Platform.OS === "web"
                ? ({ cursor: "pointer", transition: "background-color 0.15s ease" } as any)
                : {}),
            })}
            accessibilityRole="button"
            accessibilityLabel={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Ionicons
              name={collapsed ? "chevron-forward" : "chevron-back"}
              size={16}
              color={tc.textMuted}
            />
          </Pressable>
        </View>

        {/* Divider */}
        <View
          style={{
            height: 1,
            backgroundColor: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.06)",
            marginHorizontal: collapsed ? 10 : 16,
            marginBottom: 16,
          }}
        />

        {/* Main navigation */}
        <View style={{ paddingHorizontal: collapsed ? 8 : 12, gap: 4 }}>
          <TourStep nameKey="tour.step5Title" textKey="tour.step5Text" order={5}>
          <View>
          {!collapsed && (
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 10,
                fontFamily: "DMSans_600SemiBold",
                letterSpacing: 1.2,
                textTransform: "uppercase",
                paddingHorizontal: 12,
                marginBottom: 8,
              }}
            >
              MAIN MENU
            </Text>
          )}
          {NAV_ITEMS.map((item) => {
            const active = isActive(item);
            return (
              <NavTooltip key={item.key} label={item.label} collapsed={collapsed}>
                <Pressable
                  onPress={() => router.push(item.path as any)}
                  style={({ pressed, hovered }: any) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: collapsed ? "center" : "flex-start",
                    gap: collapsed ? 0 : 12,
                    paddingHorizontal: collapsed ? 0 : 14,
                    paddingVertical: 12,
                    borderRadius: 12,
                    backgroundColor: active
                      ? "rgba(16, 185, 129, 0.12)"
                      : hovered
                        ? isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.04)"
                        : "transparent",
                    borderWidth: active ? 1 : 0,
                    borderColor: active ? "rgba(16, 185, 129, 0.2)" : "transparent",
                    opacity: pressed ? 0.8 : 1,
                    ...(Platform.OS === "web"
                      ? ({
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        } as any)
                      : {}),
                  })}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      backgroundColor: active
                        ? colors.primary[500] + "20"
                        : isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.04)",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons
                      name={active ? item.iconActive : item.icon}
                      size={20}
                      color={active ? colors.primary[400] : tc.textMuted}
                    />
                  </View>
                  {!collapsed && (
                    <Text
                      style={{
                        color: active ? colors.primary[400] : tc.textSecondary,
                        fontSize: 14,
                        fontFamily: active ? "DMSans_600SemiBold" : "DMSans_500Medium",
                        ...(Platform.OS === "web"
                          ? ({ whiteSpace: "nowrap" } as any)
                          : {}),
                      }}
                    >
                      {item.label}
                    </Text>
                  )}
                  {active && !collapsed && (
                    <View
                      style={{
                        marginLeft: "auto",
                        width: 4,
                        height: 20,
                        borderRadius: 2,
                        backgroundColor: colors.primary[500],
                      }}
                    />
                  )}
                </Pressable>
              </NavTooltip>
            );
          })}
          </View>
          </TourStep>
        </View>

        {/* Divider */}
        <View
          style={{
            height: 1,
            backgroundColor: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.06)",
            marginHorizontal: collapsed ? 10 : 16,
            marginTop: 16,
            marginBottom: 16,
          }}
        />

        {/* Secondary navigation */}
        <View style={{ paddingHorizontal: collapsed ? 8 : 12, gap: 2 }}>
          {!collapsed && (
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 10,
                fontFamily: "DMSans_600SemiBold",
                letterSpacing: 1.2,
                textTransform: "uppercase",
                paddingHorizontal: 12,
                marginBottom: 8,
              }}
            >
              OTHER
            </Text>
          )}
          {SECONDARY_ITEMS.map((item) => {
            const active = isSecondaryActive(item);
            return (
              <NavTooltip key={item.key} label={item.label} collapsed={collapsed}>
                <Pressable
                  onPress={() => item.path && router.push(item.path as any)}
                  style={({ pressed, hovered }: any) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: collapsed ? "center" : "flex-start",
                    gap: collapsed ? 0 : 12,
                    paddingHorizontal: collapsed ? 0 : 14,
                    paddingVertical: 10,
                    borderRadius: 12,
                    backgroundColor: active
                      ? "rgba(16, 185, 129, 0.12)"
                      : hovered
                        ? isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.04)"
                        : "transparent",
                    borderWidth: active ? 1 : 0,
                    borderColor: active ? "rgba(16, 185, 129, 0.2)" : "transparent",
                    opacity: pressed ? 0.8 : 1,
                    ...(Platform.OS === "web"
                      ? ({
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        } as any)
                      : {}),
                  })}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      backgroundColor: active
                        ? colors.primary[500] + "20"
                        : isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.04)",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name={item.icon} size={18} color={active ? colors.primary[400] : tc.textMuted} />
                  </View>
                  {!collapsed && (
                    <Text
                      style={{
                        color: active ? colors.primary[400] : tc.textSecondary,
                        fontSize: 13,
                        fontFamily: active ? "DMSans_600SemiBold" : "DMSans_500Medium",
                        ...(Platform.OS === "web"
                          ? ({ whiteSpace: "nowrap" } as any)
                          : {}),
                      }}
                    >
                      {item.label}
                    </Text>
                  )}
                  {active && !collapsed && (
                    <View
                      style={{
                        marginLeft: "auto",
                        width: 4,
                        height: 20,
                        borderRadius: 2,
                        backgroundColor: colors.primary[500],
                      }}
                    />
                  )}
                </Pressable>
              </NavTooltip>
            );
          })}
        </View>
      </View>

      {/* Bottom section: User card + Logout.
          Redesigned 2026-04-17 — enterprise-grade minimal footer that
          (a) shows KYC verification at a glance via the same emerald tick
          used on the dashboard header, (b) turns the tier into a quiet pill
          (KYC 1/2/3/ADMIN) instead of just a coloured avatar border, and
          (c) demotes the Logout row to a small ghost button so the user
          row is the visual primary. Logout only colours red on hover. */}
      {(() => {
        const tier = user?.kyc_tier ?? 0;
        const isAdmin = !!(user?.is_staff || user?.is_superuser);
        const isVerified = tier >= 1; // same threshold the dashboard uses
        const tierLabel = isAdmin
          ? "ADMIN"
          : tier === 0
            ? "UNVERIFIED"
            : `TIER ${tier}`;
        const tierTone = isAdmin
          ? "#F59E0B" // gold — matches admin border on avatars
          : isVerified
            ? colors.primary[400]
            : "#64748B"; // muted slate for unverified

        return (
          <View style={{ paddingHorizontal: collapsed ? 8 : 12 }}>
            {/* User card */}
            {collapsed ? (
              /* Collapsed: avatar + small verified/admin dot in the corner */
              <Pressable
                onPress={() => router.push("/(tabs)/profile" as any)}
                style={({ hovered }: any) => ({
                  alignItems: "center",
                  marginBottom: 8,
                  opacity: hovered ? 0.85 : 1,
                  ...(Platform.OS === "web"
                    ? ({ cursor: "pointer", transition: "opacity 0.15s ease" } as any)
                    : {}),
                })}
                accessibilityRole="button"
                accessibilityLabel={`Profile — ${tierLabel}`}
              >
                <View style={{ position: "relative" }}>
                  <UserAvatar
                    avatarUrl={user?.avatar_url}
                    fullName={user?.full_name}
                    phone={user?.phone}
                    userId={user?.id}
                    isStaff={user?.is_staff}
                    isSuperuser={user?.is_superuser}
                    kycTier={user?.kyc_tier}
                    size={42}
                    borderRadius={12}
                  />
                  {(isVerified || isAdmin) && (
                    <View
                      style={{
                        position: "absolute",
                        right: -2,
                        bottom: -2,
                        width: 16,
                        height: 16,
                        borderRadius: 8,
                        backgroundColor: tierTone,
                        borderWidth: 2,
                        borderColor: tc.dark.bg,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                    </View>
                  )}
                </View>
              </Pressable>
            ) : (
              /* Expanded: avatar + name with verified tick + tier pill below. */
              <Pressable
                onPress={() => router.push("/(tabs)/profile" as any)}
                style={({ hovered }: any) => ({
                  backgroundColor: hovered
                    ? (isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.04)")
                    : "transparent",
                  borderRadius: 14,
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 6,
                  borderWidth: 1,
                  borderColor: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.06)",
                  ...(Platform.OS === "web"
                    ? ({ cursor: "pointer", transition: "background-color 0.15s ease" } as any)
                    : {}),
                })}
                accessibilityRole="button"
                accessibilityLabel={`Open profile — ${tierLabel}`}
              >
                <UserAvatar
                  avatarUrl={user?.avatar_url}
                  fullName={user?.full_name}
                  phone={user?.phone}
                  userId={user?.id}
                  isStaff={user?.is_staff}
                  isSuperuser={user?.is_superuser}
                  kycTier={user?.kyc_tier}
                  size={36}
                  borderRadius={10}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  {/* Row 1: name + verified tick (mirrors dashboard header). */}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text
                      style={{
                        flexShrink: 1,
                        color: tc.textPrimary,
                        fontSize: 13,
                        fontFamily: "DMSans_600SemiBold",
                        letterSpacing: -0.1,
                      }}
                      numberOfLines={1}
                    >
                      {user?.full_name || "User"}
                    </Text>
                    {(isVerified || isAdmin) && (
                      <View
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 7,
                          backgroundColor: tierTone,
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                        accessibilityLabel={isAdmin ? "Admin" : "Verified"}
                      >
                        <Ionicons name="checkmark" size={9} color="#FFFFFF" />
                      </View>
                    )}
                  </View>
                  {/* Row 2: tier pill. Always present so layout is stable. */}
                  <Text
                    style={{
                      color: tierTone,
                      fontSize: 10,
                      fontFamily: "DMSans_700Bold",
                      letterSpacing: 0.9,
                      marginTop: 2,
                    }}
                  >
                    {tierLabel}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={tc.textMuted} />
              </Pressable>
            )}

            {/* Logout — ghost button style, quiet at rest, red on hover. */}
            <Pressable
              onPress={handleLogout}
              style={({ pressed, hovered }: any) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: collapsed ? "center" : "flex-start",
                gap: collapsed ? 0 : 10,
                paddingHorizontal: collapsed ? 0 : 12,
                paddingVertical: 9,
                borderRadius: 10,
                backgroundColor: hovered ? "rgba(239, 68, 68, 0.08)" : "transparent",
                opacity: pressed ? 0.75 : 1,
                ...(Platform.OS === "web"
                  ? ({
                      cursor: "pointer",
                      transition: "background-color 0.15s ease",
                    } as any)
                  : {}),
              })}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="log-out-outline" size={16} color={tc.textMuted} />
              </View>
              {!collapsed && (
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 12,
                    fontFamily: "DMSans_500Medium",
                    letterSpacing: 0.1,
                  }}
                >
                  Sign out
                </Text>
              )}
            </Pressable>
          </View>
        );
      })()}
    </View>
  );
}

/**
 * Dashboard wrapper for web desktop.
 * Renders sidebar + main content side by side.
 * On mobile/native, renders children directly.
 */
export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);

  if (Platform.OS !== "web" || width < 900) {
    return <>{children}</>;
  }

  return (
    <View
      style={{
        flex: 1,
        flexDirection: "row",
        backgroundColor: tc.dark.bg,
        ...(Platform.OS === "web" ? ({ minHeight: "100vh" } as any) : {}),
      }}
    >
      <WebSidebar />
      <View
        style={{
          flex: 1,
          backgroundColor: tc.dark.bg,
          ...(Platform.OS === "web" ? ({ overflow: "auto" } as any) : {}),
        }}
      >
        {children}
      </View>
    </View>
  );
}
