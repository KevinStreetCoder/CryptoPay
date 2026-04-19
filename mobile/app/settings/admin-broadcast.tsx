import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getThemeColors, getThemeShadows, colors } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { api } from "../../src/api/client";
import { NotificationDetailModal } from "../../src/components/NotificationDetailModal";
import { Spinner } from "../../src/components/brand/Spinner";

const isWeb = Platform.OS === "web";

const CATEGORIES = [
  { key: "update", label: "Update", icon: "megaphone-outline", color: "#10B981" },
  { key: "security", label: "Security", icon: "shield-outline", color: "#EF4444" },
  { key: "maintenance", label: "Maintenance", icon: "construct-outline", color: "#F59E0B" },
  { key: "promotion", label: "Promotion", icon: "gift-outline", color: "#8B5CF6" },
] as const;

const CHANNELS = [
  { key: "email", label: "Email", icon: "mail-outline" },
  { key: "sms", label: "SMS", icon: "chatbubble-outline" },
  { key: "in_app", label: "In-App", icon: "notifications-outline" },
] as const;

const PRIORITIES = [
  { key: "low", label: "Low", color: "#64748B" },
  { key: "normal", label: "Normal", color: "#10B981" },
  { key: "high", label: "High", color: "#F59E0B" },
  { key: "critical", label: "Critical", color: "#EF4444" },
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  update: "#10B981",
  security: "#EF4444",
  maintenance: "#F59E0B",
  promotion: "#8B5CF6",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "#64748B",
  normal: "#10B981",
  high: "#F59E0B",
  critical: "#EF4444",
};

interface BroadcastItem {
  id: string;
  title: string;
  body: string;
  category: string;
  priority: string;
  channels: string[];
  target: string;
  recipient_count: number;
  total_recipients: number;
  read_count: number;
  read_percentage: number;
  channel_breakdown: Record<string, number>;
  created_by_name: string;
  created_at: string;
}

interface BroadcastStats {
  total_broadcasts: number;
  total_recipients: number;
  total_read: number;
  read_rate_percent: number;
  unique_users_reached: number;
  channels: Record<string, number>;
  by_category: Array<{ category: string; count: number; recipients: number }>;
}

export default function AdminBroadcastScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);

  // Form state
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<string>("update");
  const [priority, setPriority] = useState<string>("normal");
  const [selectedChannels, setSelectedChannels] = useState<string[]>(["email", "in_app"]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  // History & stats state
  const [stats, setStats] = useState<BroadcastStats | null>(null);
  const [history, setHistory] = useState<BroadcastItem[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Which broadcast is open in the admin detail+edit modal (null = closed).
  // Distinct from expandedId because the modal shows *server-fetched*
  // per-broadcast stats and the inline edit form.
  const [adminEditId, setAdminEditId] = useState<string | null>(null);

  const toggleChannel = (key: string) => {
    setSelectedChannels((prev) =>
      prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]
    );
  };

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get("/notifications/admin/stats/");
      setStats(res.data);
    } catch {
      // silently fail
    } finally {
      setLoadingStats(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await api.get("/notifications/admin/list/");
      setHistory(res.data.results || res.data || []);
    } catch {
      // silently fail
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchHistory();
  }, [fetchStats, fetchHistory]);

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) {
      setError("Title and message are required");
      return;
    }
    if (selectedChannels.length === 0) {
      setError("Select at least one channel");
      return;
    }
    setSending(true);
    setError("");
    try {
      await api.post("/notifications/admin/broadcast/", {
        title: title.trim(),
        body: body.trim(),
        category,
        priority,
        channels: selectedChannels,
      });
      setSent(true);
      // Refresh data
      fetchStats();
      fetchHistory();
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const inputStyle = {
    backgroundColor: tc.dark.elevated,
    borderRadius: 12,
    padding: 14,
    color: tc.textPrimary,
    fontSize: 15,
    fontFamily: "DMSans_400Regular",
    borderWidth: 1,
    borderColor: tc.glass.border,
    ...(isWeb ? { outlineStyle: "none" as any } : {}),
  };

  const cardStyle = {
    backgroundColor: tc.dark.elevated,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: tc.glass.border,
    padding: 20,
    marginBottom: 16,
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  if (sent) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
          <View style={{
            width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primary[500] + "20",
            alignItems: "center", justifyContent: "center", marginBottom: 20,
          }}>
            <Ionicons name="checkmark-circle" size={48} color={colors.primary[500]} />
          </View>
          <Text style={{ color: tc.textPrimary, fontSize: 24, fontFamily: "DMSans_700Bold", marginBottom: 8 }}>
            Notification Sent
          </Text>
          <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_400Regular", textAlign: "center", marginBottom: 24 }}>
            Your broadcast has been delivered to all users via {selectedChannels.join(", ")}.
          </Text>
          <Pressable
            onPress={() => { setSent(false); setTitle(""); setBody(""); }}
            style={{
              backgroundColor: colors.primary[500],
              paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12,
            }}
          >
            <Text style={{ color: "#fff", fontSize: 15, fontFamily: "DMSans_600SemiBold" }}>Send Another</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <ScrollView
        contentContainerStyle={{
          padding: isDesktop ? 48 : 20,
        }}
      >
        {/* Back */}
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace("/profile" as any)}
          style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 }}
        >
          <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
          <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_500Medium" }}>Back</Text>
        </Pressable>

        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <View style={{
            width: 48, height: 48, borderRadius: 14, backgroundColor: "#8B5CF6" + "20",
            alignItems: "center", justifyContent: "center",
          }}>
            <Ionicons name="megaphone" size={24} color="#8B5CF6" />
          </View>
          <View>
            <Text style={{ color: tc.textPrimary, fontSize: 24, fontFamily: "DMSans_700Bold" }}>
              Broadcast Notification
            </Text>
            <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_400Regular" }}>
              Send announcements to all Cpay users
            </Text>
          </View>
        </View>

        {/* ═══ STATS CARDS ═══ */}
        {loadingStats ? (
          <Spinner size={20} color={colors.primary[500]} style={{ marginBottom: 24 }} />
        ) : stats ? (
          <View style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 28,
          }}>
            {/* Total Broadcasts */}
            <View style={{
              ...cardStyle,
              flex: 1,
              minWidth: isDesktop ? 200 : 140,
              marginBottom: 0,
            }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <View style={{
                  width: 32, height: 32, borderRadius: 8,
                  backgroundColor: "#8B5CF6" + "20",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Ionicons name="megaphone" size={16} color="#8B5CF6" />
                </View>
              </View>
              <Text style={{ color: tc.textPrimary, fontSize: 28, fontFamily: "DMSans_700Bold", marginBottom: 2 }}>
                {stats.total_broadcasts}
              </Text>
              <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_500Medium" }}>
                Total Broadcasts
              </Text>
            </View>

            {/* Total Delivered */}
            <View style={{
              ...cardStyle,
              flex: 1,
              minWidth: isDesktop ? 200 : 140,
              marginBottom: 0,
            }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <View style={{
                  width: 32, height: 32, borderRadius: 8,
                  backgroundColor: colors.primary[500] + "20",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Ionicons name="paper-plane" size={16} color={colors.primary[500]} />
                </View>
              </View>
              <Text style={{ color: tc.textPrimary, fontSize: 28, fontFamily: "DMSans_700Bold", marginBottom: 2 }}>
                {stats.total_recipients.toLocaleString()}
              </Text>
              <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_500Medium" }}>
                Total Delivered
              </Text>
              <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular", marginTop: 4 }}>
                {Object.entries(stats.channels || {}).map(([k, v]) => `${k}: ${v}`).join(" / ")}
              </Text>
            </View>

            {/* Average Read Rate */}
            <View style={{
              ...cardStyle,
              flex: 1,
              minWidth: isDesktop ? 200 : 140,
              marginBottom: 0,
            }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <View style={{
                  width: 32, height: 32, borderRadius: 8,
                  backgroundColor: "#F59E0B" + "20",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Ionicons name="eye" size={16} color="#F59E0B" />
                </View>
              </View>
              <Text style={{ color: tc.textPrimary, fontSize: 28, fontFamily: "DMSans_700Bold", marginBottom: 2 }}>
                {stats.read_rate_percent}%
              </Text>
              <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_500Medium" }}>
                Average Read Rate
              </Text>
              <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular", marginTop: 4 }}>
                {stats.total_read.toLocaleString()} of {stats.total_recipients.toLocaleString()} read
              </Text>
            </View>

            {/* Unique Users Reached */}
            <View style={{
              ...cardStyle,
              flex: 1,
              minWidth: isDesktop ? 200 : 140,
              marginBottom: 0,
            }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <View style={{
                  width: 32, height: 32, borderRadius: 8,
                  backgroundColor: "#3B82F6" + "20",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Ionicons name="people" size={16} color="#3B82F6" />
                </View>
              </View>
              <Text style={{ color: tc.textPrimary, fontSize: 28, fontFamily: "DMSans_700Bold", marginBottom: 2 }}>
                {stats.unique_users_reached.toLocaleString()}
              </Text>
              <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_500Medium" }}>
                Active Users Reached
              </Text>
            </View>
          </View>
        ) : null}

        {/* ═══ BROADCAST FORM ═══ */}
        <View style={{
          ...cardStyle,
          marginBottom: 32,
        }}>
          <Text style={{ color: tc.textPrimary, fontSize: 16, fontFamily: "DMSans_700Bold", marginBottom: 16 }}>
            New Broadcast
          </Text>

          {/* Title */}
          <Text style={{ color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_600SemiBold", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Title *
          </Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. System Maintenance Notice"
            placeholderTextColor={tc.textMuted}
            style={{ ...inputStyle, marginBottom: 16 }}
          />

          {/* Message */}
          <Text style={{ color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_600SemiBold", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Message *
          </Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Write your announcement..."
            placeholderTextColor={tc.textMuted}
            multiline
            numberOfLines={5}
            style={{ ...inputStyle, minHeight: 120, textAlignVertical: "top", marginBottom: 20 }}
          />

          {/* Category */}
          <Text style={{ color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_600SemiBold", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Category
          </Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
            {CATEGORIES.map((cat) => (
              <Pressable
                key={cat.key}
                onPress={() => setCategory(cat.key)}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 8,
                  paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
                  backgroundColor: category === cat.key ? cat.color + "20" : tc.dark.elevated,
                  borderWidth: 1,
                  borderColor: category === cat.key ? cat.color + "50" : tc.glass.border,
                  ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
                }}
              >
                <Ionicons name={cat.icon as any} size={16} color={category === cat.key ? cat.color : tc.textMuted} />
                <Text style={{
                  color: category === cat.key ? cat.color : tc.textSecondary,
                  fontSize: 13, fontFamily: "DMSans_600SemiBold",
                }}>
                  {cat.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Priority */}
          <Text style={{ color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_600SemiBold", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Priority
          </Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
            {PRIORITIES.map((p) => (
              <Pressable
                key={p.key}
                onPress={() => setPriority(p.key)}
                style={{
                  paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
                  backgroundColor: priority === p.key ? p.color + "20" : tc.dark.elevated,
                  borderWidth: 1,
                  borderColor: priority === p.key ? p.color + "50" : tc.glass.border,
                  ...(isWeb ? { cursor: "pointer" } as any : {}),
                }}
              >
                <Text style={{
                  color: priority === p.key ? p.color : tc.textSecondary,
                  fontSize: 13, fontFamily: "DMSans_600SemiBold",
                }}>
                  {p.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Channels */}
          <Text style={{ color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_600SemiBold", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Delivery Channels
          </Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
            {CHANNELS.map((ch) => {
              const selected = selectedChannels.includes(ch.key);
              return (
                <Pressable
                  key={ch.key}
                  onPress={() => toggleChannel(ch.key)}
                  style={{
                    flexDirection: "row", alignItems: "center", gap: 8,
                    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
                    backgroundColor: selected ? colors.primary[500] + "20" : tc.dark.elevated,
                    borderWidth: 1,
                    borderColor: selected ? colors.primary[500] + "50" : tc.glass.border,
                    ...(isWeb ? { cursor: "pointer" } as any : {}),
                  }}
                >
                  <Ionicons name={selected ? "checkmark-circle" : (ch.icon as any)} size={16} color={selected ? colors.primary[500] : tc.textMuted} />
                  <Text style={{
                    color: selected ? colors.primary[400] : tc.textSecondary,
                    fontSize: 13, fontFamily: "DMSans_600SemiBold",
                  }}>
                    {ch.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Error */}
          {error ? (
            <View style={{ backgroundColor: "#EF4444" + "15", borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: "#EF4444" + "30" }}>
              <Text style={{ color: "#EF4444", fontSize: 13, fontFamily: "DMSans_500Medium" }}>{error}</Text>
            </View>
          ) : null}

          {/* Send Button */}
          <Pressable
            onPress={handleSend}
            disabled={sending}
            style={({ pressed }: any) => ({
              backgroundColor: sending ? tc.textMuted : colors.primary[500],
              paddingVertical: 16, borderRadius: 14, alignItems: "center",
              flexDirection: "row", justifyContent: "center", gap: 8,
              opacity: pressed ? 0.9 : 1,
              maxWidth: isDesktop ? 400 : undefined,
              ...(isWeb ? { cursor: sending ? "not-allowed" : "pointer", transition: "all 0.15s ease" } as any : {}),
            })}
          >
            {sending ? (
              <Spinner size={16} color="#fff" />
            ) : (
              <>
                <Ionicons name="send" size={18} color="#fff" />
                <Text style={{ color: "#fff", fontSize: 16, fontFamily: "DMSans_700Bold" }}>
                  Send to All Users
                </Text>
              </>
            )}
          </Pressable>

          <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular", textAlign: "center", marginTop: 12 }}>
            This will send to all active users. Make sure the message is correct.
          </Text>
        </View>

        {/* ═══ BROADCAST HISTORY ═══ */}
        <View style={{ marginBottom: 40 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <Ionicons name="time-outline" size={20} color={tc.textSecondary} />
            <Text style={{ color: tc.textPrimary, fontSize: 18, fontFamily: "DMSans_700Bold" }}>
              Broadcast History
            </Text>
          </View>

          {loadingHistory ? (
            <Spinner size={20} color={colors.primary[500]} style={{ marginVertical: 24 }} />
          ) : history.length === 0 ? (
            <View style={{
              ...cardStyle,
              alignItems: "center",
              paddingVertical: 40,
            }}>
              <Ionicons name="megaphone-outline" size={40} color={tc.textMuted} style={{ marginBottom: 12 }} />
              <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_500Medium" }}>
                No broadcasts sent yet
              </Text>
            </View>
          ) : (
            history.map((item) => {
              const isExpanded = expandedId === item.id;
              const catColor = CATEGORY_COLORS[item.category] || "#64748B";
              const prioColor = PRIORITY_COLORS[item.priority] || "#64748B";
              const readPct = item.read_percentage || 0;

              return (
                <Pressable
                  key={item.id}
                  onPress={() => setExpandedId(isExpanded ? null : item.id)}
                  style={{
                    ...cardStyle,
                    ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
                  }}
                >
                  {/* Top Row: Title + Badges + Date */}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <View style={{ flex: 1, marginRight: 12 }}>
                      <Text style={{ color: tc.textPrimary, fontSize: 15, fontFamily: "DMSans_600SemiBold", marginBottom: 6 }}>
                        {item.title}
                      </Text>
                      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                        {/* Category Badge */}
                        <View style={{
                          backgroundColor: catColor + "20",
                          paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
                        }}>
                          <Text style={{ color: catColor, fontSize: 10, fontFamily: "DMSans_700Bold", textTransform: "uppercase", letterSpacing: 0.5 }}>
                            {item.category}
                          </Text>
                        </View>
                        {/* Priority Badge */}
                        <View style={{
                          backgroundColor: prioColor + "20",
                          paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
                        }}>
                          <Text style={{ color: prioColor, fontSize: 10, fontFamily: "DMSans_700Bold", textTransform: "uppercase", letterSpacing: 0.5 }}>
                            {item.priority}
                          </Text>
                        </View>
                      </View>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular" }}>
                        {formatDate(item.created_at)}
                      </Text>
                      <Ionicons
                        name={isExpanded ? "chevron-up" : "chevron-down"}
                        size={16}
                        color={tc.textMuted}
                        style={{ marginTop: 4 }}
                      />
                    </View>
                  </View>

                  {/* Delivery Stats */}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Ionicons name="paper-plane-outline" size={13} color={tc.textMuted} />
                      <Text style={{ color: tc.textSecondary, fontSize: 12, fontFamily: "DMSans_500Medium" }}>
                        Sent to {item.recipient_count} users
                      </Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Ionicons name="eye-outline" size={13} color={tc.textMuted} />
                      <Text style={{ color: tc.textSecondary, fontSize: 12, fontFamily: "DMSans_500Medium" }}>
                        {item.read_count} of {item.total_recipients} read
                      </Text>
                    </View>
                  </View>

                  {/* Read Percentage Bar */}
                  <View style={{
                    height: 4, borderRadius: 2,
                    backgroundColor: tc.glass.border,
                    overflow: "hidden",
                    marginBottom: isExpanded ? 16 : 0,
                  }}>
                    <View style={{
                      height: "100%",
                      width: `${readPct}%`,
                      backgroundColor: readPct >= 70 ? colors.primary[500] : readPct >= 40 ? "#F59E0B" : "#EF4444",
                      borderRadius: 2,
                    }} />
                  </View>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <View>
                      {/* Body */}
                      <View style={{
                        backgroundColor: tc.dark.bg,
                        borderRadius: 10,
                        padding: 12,
                        marginBottom: 12,
                      }}>
                        <Text style={{ color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_400Regular", lineHeight: 20 }}>
                          {item.body}
                        </Text>
                      </View>

                      {/* Channel Breakdown */}
                      <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_600SemiBold", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                        Channel Breakdown
                      </Text>
                      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                        {item.channels.map((ch) => {
                          const count = item.channel_breakdown?.[ch] || 0;
                          return (
                            <View
                              key={ch}
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 6,
                                backgroundColor: tc.dark.bg,
                                paddingHorizontal: 10,
                                paddingVertical: 6,
                                borderRadius: 8,
                              }}
                            >
                              <Ionicons
                                name={ch === "email" ? "mail-outline" : ch === "sms" ? "chatbubble-outline" : "notifications-outline"}
                                size={14}
                                color={colors.primary[400]}
                              />
                              <Text style={{ color: tc.textSecondary, fontSize: 12, fontFamily: "DMSans_500Medium" }}>
                                {ch}: {count}
                              </Text>
                            </View>
                          );
                        })}
                      </View>

                      {/* Meta */}
                      <View style={{ flexDirection: "row", gap: 16, marginBottom: 12 }}>
                        <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular" }}>
                          Target: {item.target}
                        </Text>
                        <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular" }}>
                          By: {item.created_by_name}
                        </Text>
                      </View>

                      {/* Open-in-modal action. Admin can see detailed open/
                          read counts distinct from "in list" read status,
                          plus edit the broadcast in a single surface. */}
                      <Pressable
                        onPress={(e: any) => {
                          e?.stopPropagation?.();
                          setAdminEditId(item.id);
                        }}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                          paddingVertical: 10,
                          paddingHorizontal: 14,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: "rgba(16,185,129,0.35)",
                          opacity: pressed ? 0.75 : 1,
                        })}
                      >
                        <Ionicons name="create-outline" size={14} color={colors.primary[400]} />
                        <Text style={{ color: colors.primary[300], fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>
                          View full stats & edit
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </Pressable>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* Admin detail + edit modal. Opened from any history card's
          "View full stats & edit" action. Fires onEdited to refetch the
          history list so edited titles/bodies refresh immediately. */}
      <NotificationDetailModal
        notificationId={adminEditId}
        adminMode
        onClose={() => setAdminEditId(null)}
        onEdited={() => {
          fetchStats();
          fetchHistory();
        }}
      />
    </SafeAreaView>
  );
}
