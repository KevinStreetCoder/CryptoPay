import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
  TextInput,
  Modal,
  Image,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { ratesApi, PriceAlert, CreateAlertPayload } from "../../src/api/rates";
import { CRYPTO_LOGOS } from "../../src/constants/logos";
import { useToast } from "../../src/components/Toast";
import { useLocale } from "../../src/hooks/useLocale";

const isWeb = Platform.OS === "web";

const ALERT_CURRENCIES = [
  { code: "BTC", name: "Bitcoin" },
  { code: "ETH", name: "Ethereum" },
  { code: "USDT", name: "Tether" },
  { code: "SOL", name: "Solana" },
];

// ── Alert Card ──────────────────────────────────────────────────────────────

function AlertCard({
  alert,
  isDesktop,
  tc,
  ts,
  onDelete,
}: {
  alert: PriceAlert;
  isDesktop: boolean;
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
  onDelete: (id: string) => void;
}) {
  const directionColor = alert.direction === "above" ? colors.success : colors.error;
  const directionIcon = alert.direction === "above" ? "trending-up" : "trending-down";
  const directionLabel = alert.direction === "above" ? "Above" : "Below";
  const cryptoColor = colors.crypto[alert.currency] || colors.primary[400];

  return (
    <View
      style={{
        backgroundColor: tc.dark.card,
        borderRadius: 16,
        padding: isDesktop ? 18 : 16,
        borderWidth: 1,
        borderColor: alert.is_active ? tc.glass.border : tc.glass.highlight,
        opacity: alert.is_active ? 1 : 0.6,
        ...ts.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        {/* Currency icon */}
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            backgroundColor: cryptoColor + "18",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {CRYPTO_LOGOS[alert.currency] ? (
            <Image
              source={{ uri: CRYPTO_LOGOS[alert.currency] }}
              style={{ width: 28, height: 28 }}
            />
          ) : (
            <Ionicons name="cube-outline" size={22} color={cryptoColor} />
          )}
        </View>

        {/* Alert details */}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 16,
                fontFamily: "DMSans_600SemiBold",
              }}
            >
              {alert.currency}/KES
            </Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                backgroundColor: directionColor + "18",
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 8,
              }}
            >
              <Ionicons name={directionIcon as any} size={12} color={directionColor} />
              <Text
                style={{
                  color: directionColor,
                  fontSize: 11,
                  fontFamily: "DMSans_600SemiBold",
                }}
              >
                {directionLabel}
              </Text>
            </View>
          </View>
          <Text
            style={{
              color: tc.textSecondary,
              fontSize: 14,
              fontFamily: "DMSans_500Medium",
              marginTop: 3,
            }}
          >
            KES {Number(alert.target_rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Text>
        </View>

        {/* Status / Delete */}
        {alert.is_active ? (
          <Pressable
            onPress={() => onDelete(alert.id)}
            style={({ pressed, hovered }: any) => ({
              width: 38,
              height: 38,
              borderRadius: 12,
              backgroundColor: hovered ? colors.error + "20" : tc.dark.elevated,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.8 : 1,
              ...(isWeb ? ({ cursor: "pointer", transition: "all 0.2s ease" } as any) : {}),
            })}
            accessibilityLabel="Delete alert"
            accessibilityRole="button"
          >
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </Pressable>
        ) : (
          <View
            style={{
              backgroundColor: colors.primary[500] + "18",
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 8,
            }}
          >
            <Text
              style={{
                color: colors.primary[400],
                fontSize: 11,
                fontFamily: "DMSans_600SemiBold",
              }}
            >
              Triggered
            </Text>
          </View>
        )}
      </View>

      {/* Triggered info */}
      {alert.triggered_at && (
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 12,
            fontFamily: "DMSans_400Regular",
            marginTop: 8,
            marginLeft: 58,
          }}
        >
          Triggered {new Date(alert.triggered_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Text>
      )}
    </View>
  );
}

// ── Create Alert Modal ──────────────────────────────────────────────────────

function CreateAlertModal({
  visible,
  onClose,
  onCreate,
  isDesktop,
  tc,
  ts,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (data: CreateAlertPayload) => void;
  isDesktop: boolean;
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
}) {
  const [currency, setCurrency] = useState("BTC");
  const [targetRate, setTargetRate] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [duration, setDuration] = useState<string>("30d");
  const [cooldown, setCooldown] = useState<number>(60);
  const [submitting, setSubmitting] = useState(false);

  const DURATION_OPTIONS = [
    { label: "1 Day", value: "1d" },
    { label: "1 Week", value: "7d" },
    { label: "1 Month", value: "30d" },
    { label: "3 Months", value: "90d" },
    { label: "Forever", value: "forever" },
  ];

  const COOLDOWN_OPTIONS = [
    { label: "Every time", value: 2 },
    { label: "Hourly", value: 60 },
    { label: "Daily", value: 1440 },
  ];

  const getExpiresAt = (): string | null => {
    if (duration === "forever") return null;
    const days = parseInt(duration);
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString();
  };

  const handleSubmit = () => {
    if (!targetRate || isNaN(Number(targetRate)) || Number(targetRate) <= 0) return;
    setSubmitting(true);
    onCreate({
      currency,
      target_rate: targetRate,
      direction,
      expires_at: getExpiresAt(),
      cooldown_minutes: cooldown,
    });
  };

  // Reset on close
  useEffect(() => {
    if (!visible) {
      setCurrency("BTC");
      setTargetRate("");
      setDirection("above");
      setDuration("30d");
      setCooldown(60);
      setSubmitting(false);
    }
  }, [visible]);

  const cryptoColor = colors.crypto[currency] || colors.primary[400];
  const isValid = targetRate && !isNaN(Number(targetRate)) && Number(targetRate) > 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.6)",
          justifyContent: "center",
          alignItems: "center",
          padding: 20,
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: tc.dark.card,
            borderRadius: 24,
            padding: isDesktop ? 32 : 24,
            width: "100%",
            maxWidth: 440,
            borderWidth: 1,
            borderColor: tc.glass.borderStrong,
            ...ts.lg,
          }}
        >
          {/* Header */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 20,
                fontFamily: "DMSans_700Bold",
                letterSpacing: -0.3,
              }}
            >
              New Price Alert
            </Text>
            <Pressable
              onPress={onClose}
              style={({ pressed }: any) => ({
                width: 36,
                height: 36,
                borderRadius: 12,
                backgroundColor: tc.dark.elevated,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.7 : 1,
                ...(isWeb ? ({ cursor: "pointer" } as any) : {}),
              })}
              accessibilityLabel="Close"
              accessibilityRole="button"
            >
              <Ionicons name="close" size={20} color={tc.textSecondary} />
            </Pressable>
          </View>

          {/* Currency Picker */}
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 11,
              fontFamily: "DMSans_600SemiBold",
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 10,
            }}
          >
            Currency
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            {ALERT_CURRENCIES.map((c) => {
              const isSelected = currency === c.code;
              const cc = colors.crypto[c.code] || colors.primary[400];
              return (
                <Pressable
                  key={c.code}
                  onPress={() => setCurrency(c.code)}
                  style={({ pressed, hovered }: any) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 12,
                    borderWidth: 1.5,
                    borderColor: isSelected ? cc : tc.glass.border,
                    backgroundColor: isSelected ? cc + "15" : hovered ? tc.glass.highlight : "transparent",
                    opacity: pressed ? 0.8 : 1,
                    ...(isWeb ? ({ cursor: "pointer", transition: "all 0.2s ease" } as any) : {}),
                  })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                >
                  {CRYPTO_LOGOS[c.code] ? (
                    <Image source={{ uri: CRYPTO_LOGOS[c.code] }} style={{ width: 20, height: 20 }} />
                  ) : null}
                  <Text
                    style={{
                      color: isSelected ? cc : tc.textSecondary,
                      fontSize: 14,
                      fontFamily: isSelected ? "DMSans_600SemiBold" : "DMSans_500Medium",
                    }}
                  >
                    {c.code}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Target Price */}
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 11,
              fontFamily: "DMSans_600SemiBold",
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 10,
            }}
          >
            Target Price (KES)
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: tc.dark.elevated,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: tc.glass.border,
              paddingHorizontal: 16,
              height: 52,
              marginBottom: 20,
            }}
          >
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 16,
                fontFamily: "DMSans_600SemiBold",
                marginRight: 8,
              }}
            >
              KES
            </Text>
            <TextInput
              value={targetRate}
              onChangeText={setTargetRate}
              placeholder="0.00"
              placeholderTextColor={tc.textMuted}
              keyboardType="numeric"
              style={{
                flex: 1,
                color: tc.textPrimary,
                fontSize: 18,
                fontFamily: "DMSans_600SemiBold",
                ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
              }}
              accessibilityLabel="Target price in KES"
            />
          </View>

          {/* Direction Toggle */}
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 11,
              fontFamily: "DMSans_600SemiBold",
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 10,
            }}
          >
            Alert When Price Goes
          </Text>
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 28 }}>
            {(["above", "below"] as const).map((dir) => {
              const isSelected = direction === dir;
              const dirColor = dir === "above" ? colors.success : colors.error;
              const dirIcon = dir === "above" ? "trending-up" : "trending-down";
              return (
                <Pressable
                  key={dir}
                  onPress={() => setDirection(dir)}
                  style={({ pressed, hovered }: any) => ({
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    paddingVertical: 14,
                    borderRadius: 14,
                    borderWidth: 1.5,
                    borderColor: isSelected ? dirColor : tc.glass.border,
                    backgroundColor: isSelected ? dirColor + "15" : hovered ? tc.glass.highlight : "transparent",
                    opacity: pressed ? 0.8 : 1,
                    ...(isWeb ? ({ cursor: "pointer", transition: "all 0.2s ease" } as any) : {}),
                  })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Ionicons name={dirIcon as any} size={18} color={isSelected ? dirColor : tc.textMuted} />
                  <Text
                    style={{
                      color: isSelected ? dirColor : tc.textSecondary,
                      fontSize: 15,
                      fontFamily: isSelected ? "DMSans_600SemiBold" : "DMSans_500Medium",
                      textTransform: "capitalize",
                    }}
                  >
                    {dir}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Duration */}
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 11,
              fontFamily: "DMSans_600SemiBold",
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 10,
            }}
          >
            Active For
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {DURATION_OPTIONS.map((opt) => {
                const sel = duration === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setDuration(opt.value)}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: sel ? colors.primary[400] + "60" : tc.glass.border,
                      backgroundColor: sel ? colors.primary[400] + "15" : "transparent",
                    }}
                  >
                    <Text style={{
                      color: sel ? colors.primary[400] : tc.textSecondary,
                      fontSize: 13,
                      fontFamily: sel ? "DMSans_600SemiBold" : "DMSans_400Regular",
                    }}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          {/* Notify Frequency */}
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 11,
              fontFamily: "DMSans_600SemiBold",
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 10,
            }}
          >
            Notify Me
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 28 }}>
            {COOLDOWN_OPTIONS.map((opt) => {
              const sel = cooldown === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setCooldown(opt.value)}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: sel ? colors.primary[400] + "60" : tc.glass.border,
                    backgroundColor: sel ? colors.primary[400] + "15" : "transparent",
                    alignItems: "center",
                  }}
                >
                  <Text style={{
                    color: sel ? colors.primary[400] : tc.textSecondary,
                    fontSize: 12,
                    fontFamily: sel ? "DMSans_600SemiBold" : "DMSans_400Regular",
                  }}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Create Button */}
          <Pressable
            onPress={handleSubmit}
            disabled={!isValid || submitting}
            style={({ pressed, hovered }: any) => ({
              backgroundColor: isValid && !submitting ? colors.primary[500] : tc.dark.elevated,
              borderRadius: 14,
              paddingVertical: 16,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.9 : !isValid || submitting ? 0.5 : 1,
              ...(isWeb && isValid && !submitting
                ? ({
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    transform: hovered ? "translateY(-1px)" : "translateY(0px)",
                  } as any)
                : {}),
            })}
            accessibilityRole="button"
            accessibilityLabel="Create alert"
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text
                style={{
                  color: "#FFFFFF",
                  fontSize: 16,
                  fontFamily: "DMSans_600SemiBold",
                }}
              >
                Create Alert
              </Text>
            )}
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Empty State ─────────────────────────────────────────────────────────────

function EmptyState({
  tc,
  onAdd,
}: {
  tc: ReturnType<typeof getThemeColors>;
  onAdd: () => void;
}) {
  return (
    <View style={{ alignItems: "center", paddingTop: 60, paddingHorizontal: 32 }}>
      <View
        style={{
          width: 80,
          height: 80,
          borderRadius: 24,
          backgroundColor: colors.accent + "15",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 20,
        }}
      >
        <Ionicons name="notifications-outline" size={36} color={colors.accent} />
      </View>
      <Text
        style={{
          color: tc.textPrimary,
          fontSize: 20,
          fontFamily: "DMSans_700Bold",
          textAlign: "center",
          marginBottom: 8,
        }}
      >
        No Price Alerts
      </Text>
      <Text
        style={{
          color: tc.textMuted,
          fontSize: 14,
          fontFamily: "DMSans_400Regular",
          textAlign: "center",
          lineHeight: 22,
          marginBottom: 28,
        }}
      >
        Set up alerts to get notified when crypto prices hit your target. Never miss a trading opportunity.
      </Text>
      <Pressable
        onPress={onAdd}
        style={({ pressed, hovered }: any) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: colors.primary[500],
          paddingHorizontal: 24,
          paddingVertical: 14,
          borderRadius: 14,
          opacity: pressed ? 0.9 : 1,
          ...(isWeb
            ? ({
                cursor: "pointer",
                transition: "all 0.2s ease",
                transform: hovered ? "translateY(-1px)" : "translateY(0px)",
              } as any)
            : {}),
        })}
        accessibilityRole="button"
        accessibilityLabel="Add your first alert"
      >
        <Ionicons name="add-circle-outline" size={20} color="#FFFFFF" />
        <Text style={{ color: "#FFFFFF", fontSize: 15, fontFamily: "DMSans_600SemiBold" }}>
          Add Your First Alert
        </Text>
      </Pressable>
    </View>
  );
}

// ── Main Screen ─────────────────────────────────────────────────────────────

export default function PriceAlertsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const toast = useToast();
  const { t } = useLocale();

  const isDesktop = isWeb && width >= 768;

  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      const { data } = await ratesApi.getAlerts();
      setAlerts(data);
    } catch {
      toast.error("Error", "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const handleCreate = async (payload: CreateAlertPayload) => {
    try {
      const { data } = await ratesApi.createAlert(payload);
      setAlerts((prev) => [data, ...prev]);
      setShowModal(false);
      toast.success("Created", "Price alert set");
    } catch (err: any) {
      const msg = err?.response?.data?.non_field_errors?.[0]
        || err?.response?.data?.target_rate?.[0]
        || "Failed to create alert";
      toast.error("Failed", msg);
    }
  };

  const handleDelete = async (id: string) => {
    const confirmDelete = () => {
      ratesApi.deleteAlert(id).then(() => {
        setAlerts((prev) => prev.filter((a) => a.id !== id));
        toast.success("Deleted", "Alert removed");
      }).catch(() => {
        toast.error("Error", "Failed to delete alert");
      });
    };

    if (isWeb) {
      confirmDelete();
    } else {
      Alert.alert("Delete Alert", "Are you sure you want to delete this price alert?", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: confirmDelete },
      ]);
    }
  };

  const activeAlerts = alerts.filter((a) => a.is_active);
  const triggeredAlerts = alerts.filter((a) => !a.is_active);

  const content = (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingBottom: 40,
        paddingHorizontal: isDesktop ? 48 : 16,
      }}
    >
      {loading ? (
        <View style={{ paddingTop: 80, alignItems: "center" }}>
          <ActivityIndicator size="large" color={colors.primary[500]} />
        </View>
      ) : alerts.length === 0 ? (
        <EmptyState tc={tc} onAdd={() => setShowModal(true)} />
      ) : (
        <>
          {/* Active Alerts */}
          {activeAlerts.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingHorizontal: 4 }}>
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 11,
                    fontFamily: "DMSans_600SemiBold",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  Active ({activeAlerts.length}/20)
                </Text>
              </View>
              <View style={isDesktop ? { flexDirection: "row", flexWrap: "wrap", gap: 12 } : { gap: 10 }}>
                {activeAlerts.map((alert) => (
                  <View key={alert.id} style={isDesktop ? { width: "48%", minWidth: 320 } : {}}>
                    <AlertCard
                      alert={alert}
                      isDesktop={isDesktop}
                      tc={tc}
                      ts={ts}
                      onDelete={handleDelete}
                    />
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Triggered Alerts */}
          {triggeredAlerts.length > 0 && (
            <View style={{ marginTop: 28 }}>
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 11,
                  fontFamily: "DMSans_600SemiBold",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  paddingHorizontal: 4,
                  marginBottom: 12,
                }}
              >
                Triggered
              </Text>
              <View style={isDesktop ? { flexDirection: "row", flexWrap: "wrap", gap: 12 } : { gap: 10 }}>
                {triggeredAlerts.map((alert) => (
                  <View key={alert.id} style={isDesktop ? { width: "48%", minWidth: 320 } : {}}>
                    <AlertCard
                      alert={alert}
                      isDesktop={isDesktop}
                      tc={tc}
                      ts={ts}
                      onDelete={handleDelete}
                    />
                  </View>
                ))}
              </View>
            </View>
          )}
        </>
      )}

      {/* Info footer */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          marginTop: 28,
          paddingHorizontal: 4,
          gap: 8,
        }}
      >
        <Ionicons name="information-circle-outline" size={16} color={tc.textMuted} style={{ marginTop: 1 }} />
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 12,
            fontFamily: "DMSans_400Regular",
            lineHeight: 18,
            flex: 1,
          }}
        >
          Alerts are checked every 2 minutes when rates refresh. You will receive push, email, and SMS notifications when triggered. Maximum 20 active alerts.
        </Text>
      </View>
    </ScrollView>
  );

  // FAB (only when alerts exist)
  const fab = !loading && alerts.length > 0 && (
    <Pressable
      onPress={() => setShowModal(true)}
      style={({ pressed, hovered }: any) => ({
        position: "absolute",
        bottom: isDesktop ? 32 : 24,
        right: isDesktop ? 48 : 20,
        width: 56,
        height: 56,
        borderRadius: 18,
        backgroundColor: colors.primary[500],
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.9 : 1,
        ...ts.lg,
        ...(isWeb
          ? ({
              cursor: "pointer",
              transition: "all 0.2s ease",
              transform: hovered ? "scale(1.05)" : "scale(1)",
            } as any)
          : {}),
      })}
      accessibilityRole="button"
      accessibilityLabel="Add price alert"
    >
      <Ionicons name="add" size={28} color="#FFFFFF" />
    </Pressable>
  );

  const backButton = (
    <Pressable
      onPress={() => {
        if (router.canGoBack()) router.back();
        else router.replace("/settings" as any);
      }}
      style={({ pressed, hovered }: any) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 6,
        paddingHorizontal: 8,
        borderRadius: 10,
        backgroundColor: hovered ? tc.glass.highlight : pressed ? tc.dark.elevated : "transparent",
        alignSelf: "flex-start",
        opacity: pressed ? 0.9 : 1,
        ...(isWeb ? ({ cursor: "pointer", transition: "all 0.2s ease" } as any) : {}),
      })}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
      <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_500Medium" }}>
        {t("common.back")}
      </Text>
    </Pressable>
  );

  // Desktop layout
  if (isDesktop) {
    return (
      <View style={{ flex: 1, backgroundColor: tc.dark.bg }}>
        <View style={{ paddingHorizontal: 24, paddingTop: 24 }}>
          {backButton}
        </View>
        <View style={{ paddingHorizontal: 48, paddingTop: 16, paddingBottom: 8 }}>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 28,
              fontFamily: "DMSans_700Bold",
              letterSpacing: -0.5,
            }}
          >
            Price Alerts
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 15,
              fontFamily: "DMSans_400Regular",
              marginTop: 6,
            }}
          >
            Get notified when crypto rates hit your target price
          </Text>
        </View>
        {content}
        {fab}
        <CreateAlertModal
          visible={showModal}
          onClose={() => setShowModal(false)}
          onCreate={handleCreate}
          isDesktop={isDesktop}
          tc={tc}
          ts={ts}
        />
      </View>
    );
  }

  // Mobile layout
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 }}>
        {backButton}
      </View>
      <View style={{ paddingHorizontal: 16, marginBottom: 8, marginTop: 4 }}>
        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 24,
            fontFamily: "DMSans_700Bold",
            letterSpacing: -0.3,
          }}
        >
          Price Alerts
        </Text>
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 14,
            fontFamily: "DMSans_400Regular",
            marginTop: 4,
            lineHeight: 20,
          }}
        >
          Get notified when crypto rates hit your target price
        </Text>
      </View>
      {content}
      {fab}
      <CreateAlertModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        onCreate={handleCreate}
        isDesktop={isDesktop}
        tc={tc}
        ts={ts}
      />
    </SafeAreaView>
  );
}
