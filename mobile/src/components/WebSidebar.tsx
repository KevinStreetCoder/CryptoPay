import React, { useState, useCallback } from "react";
import { View, Text, Pressable, Platform, useWindowDimensions } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../stores/auth";
import { colors } from "../constants/theme";

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

  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;

  const isActive = (item: (typeof NAV_ITEMS)[0]) => {
    if (item.key === "index") {
      return pathname === "/" || pathname === "/(tabs)" || pathname === "/(tabs)/index";
    }
    if (item.key === "pay") {
      return pathname.includes("/pay") || pathname.includes("/payment");
    }
    return pathname.includes(item.key);
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
        backgroundColor: "#0A1628",
        borderRightWidth: 1,
        borderRightColor: "rgba(255, 255, 255, 0.06)",
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
        <View
          style={{
            paddingHorizontal: collapsed ? 0 : 24,
            paddingBottom: 12,
            flexDirection: "row",
            alignItems: collapsed ? "center" : "center",
            justifyContent: collapsed ? "center" : "flex-start",
            gap: collapsed ? 0 : 12,
          }}
        >
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              backgroundColor: colors.primary[500],
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="flash" size={20} color="#FFFFFF" />
          </View>
          {!collapsed && (
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: "#FFFFFF",
                  fontSize: 18,
                  fontFamily: "Inter_700Bold",
                  letterSpacing: -0.3,
                }}
              >
                CryptoPay
              </Text>
              <Text
                style={{
                  color: colors.textMuted,
                  fontSize: 11,
                  fontFamily: "Inter_400Regular",
                }}
              >
                Dashboard
              </Text>
            </View>
          )}
        </View>

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
                ? "rgba(255, 255, 255, 0.08)"
                : "rgba(255, 255, 255, 0.04)",
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
              color={colors.textMuted}
            />
          </Pressable>
        </View>

        {/* Divider */}
        <View
          style={{
            height: 1,
            backgroundColor: "rgba(255, 255, 255, 0.06)",
            marginHorizontal: collapsed ? 10 : 16,
            marginBottom: 16,
          }}
        />

        {/* Main navigation */}
        <View style={{ paddingHorizontal: collapsed ? 8 : 12, gap: 4 }}>
          {!collapsed && (
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 10,
                fontFamily: "Inter_600SemiBold",
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
                        ? "rgba(255, 255, 255, 0.04)"
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
                        : "rgba(255, 255, 255, 0.04)",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons
                      name={active ? item.iconActive : item.icon}
                      size={20}
                      color={active ? colors.primary[400] : colors.textMuted}
                    />
                  </View>
                  {!collapsed && (
                    <Text
                      style={{
                        color: active ? colors.primary[400] : colors.textSecondary,
                        fontSize: 14,
                        fontFamily: active ? "Inter_600SemiBold" : "Inter_500Medium",
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

        {/* Divider */}
        <View
          style={{
            height: 1,
            backgroundColor: "rgba(255, 255, 255, 0.06)",
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
                color: colors.textMuted,
                fontSize: 10,
                fontFamily: "Inter_600SemiBold",
                letterSpacing: 1.2,
                textTransform: "uppercase",
                paddingHorizontal: 12,
                marginBottom: 8,
              }}
            >
              OTHER
            </Text>
          )}
          {SECONDARY_ITEMS.map((item) => (
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
                  backgroundColor: hovered
                    ? "rgba(255, 255, 255, 0.04)"
                    : "transparent",
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
                    backgroundColor: "rgba(255, 255, 255, 0.04)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name={item.icon} size={18} color={colors.textMuted} />
                </View>
                {!collapsed && (
                  <Text
                    style={{
                      color: colors.textSecondary,
                      fontSize: 13,
                      fontFamily: "Inter_500Medium",
                      ...(Platform.OS === "web"
                        ? ({ whiteSpace: "nowrap" } as any)
                        : {}),
                    }}
                  >
                    {item.label}
                  </Text>
                )}
              </Pressable>
            </NavTooltip>
          ))}
        </View>
      </View>

      {/* Bottom section: User card + Logout */}
      <View style={{ paddingHorizontal: collapsed ? 8 : 12 }}>
        {/* User card */}
        {collapsed ? (
          /* Collapsed: just the avatar */
          <View
            style={{
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                backgroundColor: colors.primary[500] + "30",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  color: colors.primary[400],
                  fontSize: 14,
                  fontFamily: "Inter_700Bold",
                }}
              >
                {getInitials(user?.full_name)}
              </Text>
            </View>
          </View>
        ) : (
          /* Expanded: full user card */
          <View
            style={{
              backgroundColor: "rgba(255, 255, 255, 0.04)",
              borderRadius: 14,
              padding: 14,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              marginBottom: 10,
              borderWidth: 1,
              borderColor: "rgba(255, 255, 255, 0.06)",
            }}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                backgroundColor: colors.primary[500] + "30",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  color: colors.primary[400],
                  fontSize: 14,
                  fontFamily: "Inter_700Bold",
                }}
              >
                {getInitials(user?.full_name)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: "#FFFFFF",
                  fontSize: 13,
                  fontFamily: "Inter_600SemiBold",
                }}
                numberOfLines={1}
              >
                {user?.full_name || "User"}
              </Text>
              <Text
                style={{
                  color: colors.textMuted,
                  fontSize: 11,
                  fontFamily: "Inter_400Regular",
                }}
                numberOfLines={1}
              >
                {user?.phone || ""}
              </Text>
            </View>
          </View>
        )}

        {/* Logout */}
        <Pressable
          onPress={handleLogout}
          style={({ pressed, hovered }: any) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-start",
            gap: collapsed ? 0 : 10,
            paddingHorizontal: collapsed ? 0 : 14,
            paddingVertical: 10,
            borderRadius: 12,
            backgroundColor: hovered
              ? "rgba(239, 68, 68, 0.08)"
              : "transparent",
            opacity: pressed ? 0.8 : 1,
            ...(Platform.OS === "web"
              ? ({
                  cursor: "pointer",
                  transition: "background-color 0.15s ease",
                } as any)
              : {}),
          })}
          accessibilityRole="button"
          accessibilityLabel="Logout"
        >
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: collapsed ? "rgba(239, 68, 68, 0.08)" : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="log-out-outline" size={18} color={colors.error} />
          </View>
          {!collapsed && (
            <Text
              style={{
                color: colors.error,
                fontSize: 13,
                fontFamily: "Inter_500Medium",
              }}
            >
              Logout
            </Text>
          )}
        </Pressable>
      </View>
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

  if (Platform.OS !== "web" || width < 900) {
    return <>{children}</>;
  }

  return (
    <View
      style={{
        flex: 1,
        flexDirection: "row",
        backgroundColor: colors.dark.bg,
        ...(Platform.OS === "web" ? ({ minHeight: "100vh" } as any) : {}),
      }}
    >
      <WebSidebar />
      <View
        style={{
          flex: 1,
          backgroundColor: colors.dark.bg,
          ...(Platform.OS === "web" ? ({ overflow: "auto" } as any) : {}),
        }}
      >
        {children}
      </View>
    </View>
  );
}
