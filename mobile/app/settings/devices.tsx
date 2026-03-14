import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { authApi } from "../../src/api/auth";
import { useToast } from "../../src/components/Toast";

const isWeb = Platform.OS === "web";

// ── Types ────────────────────────────────────────────────────────────────────

interface DeviceSession {
  id: string;
  device_id: string;
  device_name: string;
  platform: string;
  os_version: string;
  ip_address: string | null;
  is_trusted: boolean;
  last_seen: string;
  created_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getDeviceIcon(platform: string): keyof typeof Ionicons.glyphMap {
  const p = platform.toLowerCase();
  if (p.includes("ios") || p.includes("iphone") || p.includes("ipad")) return "phone-portrait-outline";
  if (p.includes("android")) return "phone-portrait-outline";
  if (p.includes("web") || p.includes("browser")) return "globe-outline";
  if (p.includes("mac") || p.includes("windows") || p.includes("linux") || p.includes("desktop")) return "desktop-outline";
  if (p.includes("tablet")) return "tablet-portrait-outline";
  return "hardware-chip-outline";
}

function getDeviceIconColor(platform: string): string {
  const p = platform.toLowerCase();
  if (p.includes("ios") || p.includes("iphone") || p.includes("ipad")) return "#007AFF";
  if (p.includes("android")) return "#3DDC84";
  if (p.includes("web") || p.includes("browser")) return "#60A5FA";
  if (p.includes("mac")) return "#A78BFA";
  if (p.includes("windows")) return "#0078D4";
  return "#06B6D4";
}

function formatLastActive(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ── Device Card ──────────────────────────────────────────────────────────────

function DeviceCard({
  device,
  isCurrent,
  isDesktop,
  tc,
  ts,
  onRemove,
  removing,
}: {
  device: DeviceSession;
  isCurrent: boolean;
  isDesktop: boolean;
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
  onRemove: () => void;
  removing: boolean;
}) {
  const iconName = getDeviceIcon(device.platform);
  const iconColor = getDeviceIconColor(device.platform);

  return (
    <View
      style={{
        backgroundColor: tc.dark.card,
        borderRadius: 18,
        padding: isDesktop ? 22 : 18,
        borderWidth: 1,
        borderColor: isCurrent ? colors.success + "40" : tc.glass.border,
        ...ts.sm,
        ...(isWeb
          ? ({ transition: "all 0.2s ease" } as any)
          : {}),
      }}
    >
      {/* Header row: icon + name + badge */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            backgroundColor: iconColor + "18",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={iconName} size={24} color={iconColor} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 16,
                fontFamily: "DMSans_700Bold",
                letterSpacing: -0.2,
              }}
              numberOfLines={1}
            >
              {device.device_name || device.platform || "Unknown Device"}
            </Text>
            {isCurrent && (
              <View
                style={{
                  backgroundColor: colors.success + "20",
                  borderRadius: 8,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                }}
              >
                <Text
                  style={{
                    color: colors.success,
                    fontSize: 10,
                    fontFamily: "DMSans_700Bold",
                    letterSpacing: 0.3,
                  }}
                >
                  CURRENT DEVICE
                </Text>
              </View>
            )}
          </View>
          {device.platform ? (
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 13,
                marginTop: 2,
              }}
              numberOfLines={1}
            >
              {device.platform}{device.os_version ? ` ${device.os_version}` : ""}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Details row */}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 16,
          marginTop: 14,
          paddingTop: 14,
          borderTopWidth: 1,
          borderTopColor: tc.glass.border,
        }}
      >
        {device.ip_address ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="wifi-outline" size={14} color={tc.textMuted} />
            <Text style={{ color: tc.textSecondary, fontSize: 13 }}>
              {device.ip_address}
            </Text>
          </View>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="time-outline" size={14} color={tc.textMuted} />
          <Text style={{ color: tc.textSecondary, fontSize: 13 }}>
            {formatLastActive(device.last_seen)}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="calendar-outline" size={14} color={tc.textMuted} />
          <Text style={{ color: tc.textSecondary, fontSize: 13 }}>
            Added {new Date(device.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </Text>
        </View>
      </View>

      {/* Remove button — not shown for current device */}
      {!isCurrent && (
        <Pressable
          onPress={onRemove}
          disabled={removing}
          style={({ pressed, hovered }: any) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            marginTop: 14,
            paddingVertical: 10,
            paddingHorizontal: 20,
            borderRadius: 12,
            backgroundColor: hovered
              ? "rgba(239,68,68,0.15)"
              : "rgba(239,68,68,0.08)",
            borderWidth: 1,
            borderColor: hovered
              ? "rgba(239,68,68,0.30)"
              : "rgba(239,68,68,0.15)",
            alignSelf: "flex-start",
            maxWidth: isDesktop ? 360 : undefined,
            opacity: pressed ? 0.7 : removing ? 0.5 : 1,
            ...(isWeb
              ? ({
                  cursor: removing ? "not-allowed" : "pointer",
                  transition: "all 0.2s ease",
                } as any)
              : {}),
          })}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${device.device_name || "device"}`}
        >
          {removing ? (
            <ActivityIndicator size="small" color="#EF4444" />
          ) : (
            <Ionicons name="trash-outline" size={16} color="#EF4444" />
          )}
          <Text style={{ color: "#EF4444", fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>
            {removing ? "Removing..." : "Remove Device"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// ── Main Screen ──────────────────────────────────────────────────────────────

export default function DevicesScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const toast = useToast();

  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const horizontalPadding = isDesktop ? 48 : 16;

  const fetchDevices = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const res = await authApi.getDevices();
      setDevices(res.data);
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Failed to load devices";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  const confirmRemoveDevice = useCallback(
    (device: DeviceSession) => {
      const deviceLabel = device.device_name || device.platform || "this device";

      if (isWeb) {
        const confirmed = window.confirm(
          `Remove "${deviceLabel}"?\n\nThis device will be signed out and will need to verify again to log in.`
        );
        if (confirmed) {
          handleRemoveDevice(device);
        }
      } else {
        Alert.alert(
          "Remove Device",
          `Remove "${deviceLabel}"?\n\nThis device will be signed out and will need to verify again to log in.`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Remove",
              style: "destructive",
              onPress: () => handleRemoveDevice(device),
            },
          ]
        );
      }
    },
    []
  );

  const handleRemoveDevice = useCallback(
    async (device: DeviceSession) => {
      try {
        setRemovingId(device.id);
        await authApi.removeDevice(device.id);
        setDevices((prev) => prev.filter((d) => d.id !== device.id));
        toast.success("Device removed", `${device.device_name || "Device"} has been signed out`);
      } catch (err: any) {
        const msg = err?.response?.data?.error || "Failed to remove device";
        toast.error("Error", msg);
      } finally {
        setRemovingId(null);
      }
    },
    [toast]
  );

  // Identify the current device — the first item with is_trusted or the most recently seen
  // In a real implementation, the backend would mark the current session's device.
  // For now, we use the first device (most recently active, since sorted by -last_seen).
  const currentDeviceId = devices.length > 0 ? devices[0].id : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: horizontalPadding,
          paddingTop: isDesktop ? 12 : 8,
          paddingBottom: 40,
        }}
      >
        {/* Back button */}
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/settings" as any);
          }}
          style={({ pressed, hovered }: any) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 12,
            backgroundColor: hovered
              ? tc.glass.highlight
              : pressed
                ? tc.dark.elevated
                : "transparent",
            alignSelf: "flex-start",
            marginBottom: 8,
            opacity: pressed ? 0.9 : 1,
            ...(isWeb
              ? ({
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  transform: hovered ? "translateX(-2px)" : "translateX(0px)",
                } as any)
              : {}),
          })}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
          <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_500Medium" }}>
            Back
          </Text>
        </Pressable>

        {/* Page Title */}
        <View
          style={{
            marginBottom: isDesktop ? 28 : 20,
            paddingHorizontal: 4,
          }}
        >
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: isDesktop ? 32 : 26,
              fontFamily: "DMSans_700Bold",
              letterSpacing: -0.5,
            }}
          >
            Active Sessions
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: isDesktop ? 16 : 14,
              marginTop: 4,
              lineHeight: 22,
            }}
          >
            Manage devices that are signed in to your account
          </Text>
        </View>

        {/* Summary card */}
        {!loading && !error && devices.length > 0 && (
          <View
            style={{
              backgroundColor: "#06B6D4" + "10",
              borderRadius: 16,
              padding: isDesktop ? 20 : 16,
              borderWidth: 1,
              borderColor: "#06B6D4" + "20",
              marginBottom: 24,
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              ...ts.sm,
            }}
          >
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 13,
                backgroundColor: "#06B6D4" + "20",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="shield-checkmark-outline" size={20} color="#06B6D4" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: tc.textPrimary, fontSize: 15, fontFamily: "DMSans_600SemiBold" }}>
                {devices.length} {devices.length === 1 ? "device" : "devices"} signed in
              </Text>
              <Text style={{ color: tc.textMuted, fontSize: 13, marginTop: 2 }}>
                Remove any device you don't recognize
              </Text>
            </View>
          </View>
        )}

        {/* Loading state */}
        {loading && (
          <View style={{ alignItems: "center", paddingVertical: 60 }}>
            <ActivityIndicator size="large" color={colors.primary[400]} />
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 14,
                marginTop: 16,
                fontFamily: "DMSans_500Medium",
              }}
            >
              Loading devices...
            </Text>
          </View>
        )}

        {/* Error state */}
        {!loading && error && (
          <View
            style={{
              backgroundColor: tc.dark.card,
              borderRadius: 18,
              padding: 32,
              alignItems: "center",
              borderWidth: 1,
              borderColor: tc.glass.border,
              ...ts.sm,
            }}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                backgroundColor: "rgba(239,68,68,0.12)",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <Ionicons name="alert-circle-outline" size={28} color="#EF4444" />
            </View>
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 16,
                fontFamily: "DMSans_600SemiBold",
                marginBottom: 6,
              }}
            >
              Failed to load devices
            </Text>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 14,
                textAlign: "center",
                marginBottom: 20,
              }}
            >
              {error}
            </Text>
            <Pressable
              onPress={fetchDevices}
              style={({ pressed, hovered }: any) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingVertical: 10,
                paddingHorizontal: 24,
                borderRadius: 12,
                backgroundColor: hovered
                  ? colors.primary[500] + "25"
                  : colors.primary[500] + "15",
                borderWidth: 1,
                borderColor: colors.primary[500] + "30",
                maxWidth: isDesktop ? 360 : undefined,
                opacity: pressed ? 0.8 : 1,
                ...(isWeb
                  ? ({
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    } as any)
                  : {}),
              })}
              accessibilityRole="button"
              accessibilityLabel="Retry loading devices"
            >
              <Ionicons name="refresh-outline" size={18} color={colors.primary[400]} />
              <Text style={{ color: colors.primary[400], fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>
                Try Again
              </Text>
            </Pressable>
          </View>
        )}

        {/* Empty state */}
        {!loading && !error && devices.length === 0 && (
          <View
            style={{
              backgroundColor: tc.dark.card,
              borderRadius: 18,
              padding: 40,
              alignItems: "center",
              borderWidth: 1,
              borderColor: tc.glass.border,
              ...ts.sm,
            }}
          >
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 18,
                backgroundColor: tc.glass.highlight,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <Ionicons name="phone-portrait-outline" size={32} color={tc.textMuted} />
            </View>
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 16,
                fontFamily: "DMSans_600SemiBold",
                marginBottom: 6,
              }}
            >
              No devices found
            </Text>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 14,
                textAlign: "center",
              }}
            >
              Devices will appear here when you sign in
            </Text>
          </View>
        )}

        {/* Device list */}
        {!loading && !error && devices.length > 0 && (
          <View
            style={{
              ...(isDesktop
                ? {
                    flexDirection: "row" as const,
                    flexWrap: "wrap" as const,
                    gap: 16,
                  }
                : {
                    gap: 12,
                  }),
            }}
          >
            {devices.map((device) => (
              <View
                key={device.id}
                style={{
                  ...(isDesktop
                    ? { width: "48%", minWidth: 340, flexGrow: 1 } as any
                    : {}),
                }}
              >
                <DeviceCard
                  device={device}
                  isCurrent={device.id === currentDeviceId}
                  isDesktop={isDesktop}
                  tc={tc}
                  ts={ts}
                  onRemove={() => confirmRemoveDevice(device)}
                  removing={removingId === device.id}
                />
              </View>
            ))}
          </View>
        )}

        {/* Footer */}
        <View style={{ alignItems: "center", marginTop: 28, paddingBottom: 8 }}>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 12,
              fontFamily: "DMSans_500Medium",
            }}
          >
            CryptoPay v1.0.0
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
