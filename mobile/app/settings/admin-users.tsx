import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/stores/auth";
import { useToast } from "../../src/components/Toast";
import { normalizeError } from "../../src/utils/apiErrors";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { Spinner } from "../../src/components/brand/Spinner";

const isWeb = Platform.OS === "web";

interface KycDistribution {
  tier: number;
  label: string;
  count: number;
}

interface AdminUser {
  id: string;
  phone: string;
  full_name: string;
  email: string;
  kyc_tier: number;
  kyc_status: string;
  is_active: boolean;
  is_suspended: boolean;
  created_at: string;
  // Presence fields populated by backend heartbeat (≤ 5 min = online).
  is_online?: boolean;
  active_today?: boolean;
  last_activity_at?: string | null;
  last_activity_ip?: string | null;
  last_login_ip?: string | null;
  last_login_country?: string | null;
}

interface PresenceSummary {
  online_now: number;
  active_today: number;
  online_window_minutes: number;
}

/** Human-friendly relative time for last-active timestamps. */
function timeAgo(iso?: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = (Date.now() - then) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

const TIER_COLORS = ["#94A3B8", "#F59E0B", "#3B82F6", "#10B981"];
const TIER_LABELS = ["Phone Only", "ID Verified", "KRA PIN", "Enhanced DD"];

export default function AdminUsersScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const toast = useToast();

  const [distribution, setDistribution] = useState<KycDistribution[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [presence, setPresence] = useState<PresenceSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);

  // Suspend modal state
  const [suspendModal, setSuspendModal] = useState<{ userId: string; phone: string; action: "suspend" | "unsuspend" } | null>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [suspending, setSuspending] = useState(false);

  // Redirect non-staff
  useEffect(() => {
    if (user && !user.is_staff) {
      router.replace("/(tabs)" as any);
    }
  }, [user, router]);

  const fetchData = useCallback(async () => {
    try {
      const params: any = { page, page_size: 20 };
      if (search) params.search = search;
      if (tierFilter !== null) params.tier = tierFilter;

      const { data } = await api.get("/auth/admin/users/", { params });
      setDistribution(data.distribution || []);
      setUsers(data.users || []);
      setTotal(data.total || 0);
      setPresence(data.presence || null);
    } catch (err) {
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, search, tierFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleVerify = async (userId: string, newTier: number) => {
    setVerifying(userId);
    try {
      await api.post(`/auth/admin/users/${userId}/verify/`, { kyc_tier: newTier });
      await fetchData();
    } catch (err) {
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);
    } finally {
      setVerifying(null);
    }
  };

  const handleSuspendAction = async () => {
    if (!suspendModal) return;
    if (suspendModal.action === "suspend" && !suspendReason.trim()) return;

    setSuspending(true);
    try {
      await api.post(`/auth/admin/users/${suspendModal.userId}/suspend/`, {
        action: suspendModal.action,
        reason: suspendReason.trim(),
      });
      setSuspendModal(null);
      setSuspendReason("");
      await fetchData();
    } catch (err) {
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);
    } finally {
      setSuspending(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
  };

  const totalUsers = distribution.reduce((sum, d) => sum + d.count, 0);
  const hPad = isDesktop ? 48 : 20;

  if (!user?.is_staff) return null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[400]} />
        }
        contentContainerStyle={{
          paddingHorizontal: hPad,
          paddingTop: isDesktop ? 12 : 8,
          paddingBottom: 60,
        }}
      >
        {/* Back button */}
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)/profile" as any);
          }}
          style={({ pressed, hovered }: any) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 12,
            backgroundColor: hovered ? tc.glass.highlight : pressed ? tc.dark.elevated : "transparent",
            alignSelf: "flex-start",
            marginBottom: 8,
            opacity: pressed ? 0.9 : 1,
            ...(isWeb ? ({ cursor: "pointer", transition: "all 0.2s ease" } as any) : {}),
          })}
        >
          <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
          <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_500Medium" }}>Back</Text>
        </Pressable>

        {/* Page Title */}
        <View style={{ marginBottom: isDesktop ? 28 : 20, paddingHorizontal: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: isDesktop ? 32 : 26,
                fontFamily: "DMSans_700Bold",
                letterSpacing: -0.5,
              }}
            >
              User Management
            </Text>
            <View
              style={{
                backgroundColor: "#F59E0B20",
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 4,
              }}
            >
              <Text style={{ color: "#F59E0B", fontSize: 12, fontFamily: "DMSans_700Bold" }}>ADMIN</Text>
            </View>
          </View>
          <Text style={{ color: tc.textMuted, fontSize: isDesktop ? 16 : 14, marginTop: 4, lineHeight: 22 }}>
            Verify users, manage KYC tiers, suspend accounts, and view activity
          </Text>
        </View>

        {/* Presence strip — live counts of users active now vs today.
            Wraps on narrow viewports (<420px) so it never overflows. The
            "N-minute window" caption drops below the metrics on mobile to
            keep the tile row intact. */}
        {presence ? (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              columnGap: 16,
              rowGap: 6,
              alignItems: "center",
              backgroundColor: tc.dark.card,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: tc.glass.border,
              paddingVertical: 12,
              paddingHorizontal: 14,
              marginBottom: 16,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success }} />
              <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_700Bold" }}>
                {presence.online_now}
              </Text>
              <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_500Medium", letterSpacing: 0.5 }}>
                online now
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#F59E0B" }} />
              <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_700Bold" }}>
                {presence.active_today}
              </Text>
              <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_500Medium", letterSpacing: 0.5 }}>
                active today
              </Text>
            </View>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 11,
                fontFamily: "DMSans_400Regular",
                marginLeft: isDesktop ? ("auto" as any) : 0,
              }}
            >
              {presence.online_window_minutes}-minute window
            </Text>
          </View>
        ) : null}

        {/* KYC Distribution Cards */}
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 24,
          }}
        >
          {/* Total card */}
          <View
            style={{
              flex: 1,
              minWidth: isDesktop ? 180 : 140,
              backgroundColor: tc.dark.card,
              borderRadius: 16,
              padding: isDesktop ? 20 : 16,
              borderWidth: 1,
              borderColor: tc.glass.border,
              ...ts.sm,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  backgroundColor: colors.primary[500] + "15",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="people" size={16} color={colors.primary[400]} />
              </View>
              <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_500Medium" }}>Total Users</Text>
            </View>
            <Text style={{ color: tc.textPrimary, fontSize: 28, fontFamily: "DMSans_700Bold" }}>
              {totalUsers}
            </Text>
          </View>

          {/* Tier cards */}
          {distribution.map((d) => {
            const tierColor = TIER_COLORS[d.tier] || tc.textMuted;
            const pct = totalUsers > 0 ? ((d.count / totalUsers) * 100).toFixed(0) : "0";
            return (
              <Pressable
                key={d.tier}
                onPress={() => setTierFilter(tierFilter === d.tier ? null : d.tier)}
                style={({ hovered }: any) => ({
                  flex: 1,
                  minWidth: isDesktop ? 180 : 140,
                  backgroundColor: tierFilter === d.tier ? tierColor + "15" : tc.dark.card,
                  borderRadius: 16,
                  padding: isDesktop ? 20 : 16,
                  borderWidth: 1,
                  borderColor: tierFilter === d.tier ? tierColor + "40" : tc.glass.border,
                  ...ts.sm,
                  ...(isWeb ? ({ cursor: "pointer", transition: "all 0.2s ease" } as any) : {}),
                })}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: tierColor,
                    }}
                  />
                  <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_500Medium" }}>
                    T{d.tier}: {d.label}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                  <Text style={{ color: tc.textPrimary, fontSize: 24, fontFamily: "DMSans_700Bold" }}>
                    {d.count}
                  </Text>
                  <Text style={{ color: tierColor, fontSize: 13, fontFamily: "DMSans_600SemiBold" }}>{pct}%</Text>
                </View>
                {/* Progress bar */}
                <View
                  style={{
                    height: 4,
                    backgroundColor: tc.dark.elevated,
                    borderRadius: 2,
                    marginTop: 8,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      height: "100%",
                      width: (`${pct}%`) as any,
                      backgroundColor: tierColor,
                      borderRadius: 2,
                    }}
                  />
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Search & Filter */}
        <View
          style={{
            flexDirection: isDesktop ? "row" : "column",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <View
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: tc.dark.card,
              borderRadius: 14,
              paddingHorizontal: 16,
              borderWidth: 1,
              borderColor: tc.glass.border,
              gap: 10,
            }}
          >
            <Ionicons name="search" size={18} color={tc.textMuted} />
            <TextInput
              value={search}
              onChangeText={(text) => {
                setSearch(text);
                setPage(1);
              }}
              placeholder="Search by name, phone, or email..."
              placeholderTextColor={tc.textMuted}
              style={{
                flex: 1,
                color: tc.textPrimary,
                fontSize: 14,
                fontFamily: "DMSans_400Regular",
                paddingVertical: 14,
                ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
              }}
            />
            {search ? (
              <Pressable onPress={() => { setSearch(""); setPage(1); }}>
                <Ionicons name="close-circle" size={18} color={tc.textMuted} />
              </Pressable>
            ) : null}
          </View>

          {/* Tier filter pills */}
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Pressable
              onPress={() => { setTierFilter(null); setPage(1); }}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 10,
                backgroundColor: tierFilter === null ? colors.primary[500] + "20" : tc.dark.card,
                borderWidth: 1,
                borderColor: tierFilter === null ? colors.primary[500] + "40" : tc.glass.border,
              }}
            >
              <Text
                style={{
                  color: tierFilter === null ? colors.primary[400] : tc.textMuted,
                  fontSize: 13,
                  fontFamily: "DMSans_600SemiBold",
                }}
              >
                All
              </Text>
            </Pressable>
            {[0, 1, 2, 3].map((t) => (
              <Pressable
                key={t}
                onPress={() => { setTierFilter(tierFilter === t ? null : t); setPage(1); }}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor: tierFilter === t ? TIER_COLORS[t] + "20" : tc.dark.card,
                  borderWidth: 1,
                  borderColor: tierFilter === t ? TIER_COLORS[t] + "40" : tc.glass.border,
                }}
              >
                <Text
                  style={{
                    color: tierFilter === t ? TIER_COLORS[t] : tc.textMuted,
                    fontSize: 13,
                    fontFamily: "DMSans_600SemiBold",
                  }}
                >
                  T{t}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* User List */}
        {loading ? (
          <View style={{ padding: 40, alignItems: "center" }}>
            <Spinner size={32} color={colors.primary[400]} />
          </View>
        ) : (
          <View
            style={{
              backgroundColor: tc.dark.card,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: tc.glass.border,
              overflow: "hidden",
              ...ts.sm,
            }}
          >
            {/* Header — only on desktop */}
            {isDesktop && (
              <View
                style={{
                  flexDirection: "row",
                  paddingVertical: 12,
                  paddingHorizontal: 16,
                  backgroundColor: tc.glass.highlight,
                  borderBottomWidth: 1,
                  borderBottomColor: tc.glass.border,
                }}
              >
                <Text style={{ flex: 2, color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8 }}>User</Text>
                <Text style={{ flex: 1, color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8 }}>KYC Tier</Text>
                <Text style={{ flex: 1, color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8 }}>Status</Text>
                <Text style={{ width: 260, color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, textAlign: "center" }}>Actions</Text>
              </View>
            )}

            {users.length === 0 ? (
              <View style={{ padding: 40, alignItems: "center" }}>
                <Ionicons name="people-outline" size={40} color={tc.textMuted} />
                <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_500Medium", marginTop: 12 }}>No users found</Text>
              </View>
            ) : (
              users.map((u, idx) => {
                const tierColor = TIER_COLORS[u.kyc_tier] || tc.textMuted;
                const statusColor = u.is_suspended ? colors.error : u.is_active ? colors.success : tc.textMuted;
                const statusLabel = u.is_suspended ? "Suspended" : u.is_active ? "Active" : "Inactive";

                if (!isDesktop) {
                  // ── MOBILE CARD LAYOUT ──
                  return (
                    <Pressable
                      key={u.id}
                      onPress={() => router.push(`/settings/admin-user-detail?id=${u.id}` as any)}
                      style={{
                        paddingVertical: 14,
                        paddingHorizontal: 16,
                        borderBottomWidth: idx < users.length - 1 ? 1 : 0,
                        borderBottomColor: tc.glass.border,
                      }}
                    >
                      {/* Row 1: Name + Presence dot + Status */}
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                          {/* Online presence dot — green if active in last
                              5 min, amber if active today, grey otherwise.
                              Matches the Slack/Discord convention. */}
                          <View
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 4,
                              backgroundColor: u.is_online
                                ? colors.success
                                : u.active_today
                                  ? "#F59E0B"
                                  : tc.textMuted,
                              opacity: u.is_online ? 1 : 0.6,
                            }}
                            accessibilityLabel={u.is_online ? "Online" : u.active_today ? "Active today" : "Offline"}
                          />
                          <Text numberOfLines={1} style={{ color: tc.textPrimary, fontSize: 15, fontFamily: "DMSans_600SemiBold", flexShrink: 1 }}>
                            {u.full_name || "No name"}
                          </Text>
                          {u.kyc_tier >= 1 && (
                            <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: colors.primary[500], alignItems: "center", justifyContent: "center" }}>
                              <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                            </View>
                          )}
                        </View>
                        <View style={{ backgroundColor: statusColor + "15", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 }}>
                          <Text style={{ color: statusColor, fontSize: 11, fontFamily: "DMSans_600SemiBold" }}>{statusLabel}</Text>
                        </View>
                      </View>

                      {/* Row 1b: presence meta — "Online · KE" / "Active 2h ago" */}
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <Text style={{ color: u.is_online ? colors.success : tc.textMuted, fontSize: 11, fontFamily: "DMSans_500Medium", letterSpacing: 0.2 }}>
                          {u.is_online ? "ONLINE NOW" : `Active ${timeAgo(u.last_activity_at)}`}
                        </Text>
                        {u.last_login_country ? (
                          <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular" }}>
                            · {u.last_login_country}
                          </Text>
                        ) : null}
                      </View>

                      {/* Row 2: Phone + Tier */}
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                        <Text numberOfLines={1} style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_400Regular" }}>
                          {u.phone}{u.email ? ` · ${u.email}` : ""}
                        </Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tierColor }} />
                          <Text style={{ color: tierColor, fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>
                            T{u.kyc_tier} · {TIER_LABELS[u.kyc_tier]}
                          </Text>
                        </View>
                      </View>

                      {/* Row 3: Actions */}
                      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                        {/* Tier buttons */}
                        {verifying === u.id ? (
                          <Spinner size={16} color={colors.primary[400]} />
                        ) : (
                          <View style={{ flexDirection: "row", gap: 4 }}>
                            {[0, 1, 2, 3].map((t) => (
                              <Pressable
                                key={t}
                                onPress={() => handleVerify(u.id, t)}
                                disabled={u.kyc_tier === t}
                                style={{
                                  width: 30,
                                  height: 28,
                                  borderRadius: 8,
                                  backgroundColor: u.kyc_tier === t ? TIER_COLORS[t] + "30" : tc.dark.elevated,
                                  alignItems: "center",
                                  justifyContent: "center",
                                  borderWidth: u.kyc_tier === t ? 1.5 : 1,
                                  borderColor: u.kyc_tier === t ? TIER_COLORS[t] : tc.glass.border,
                                }}
                              >
                                <Text style={{ color: u.kyc_tier === t ? TIER_COLORS[t] : tc.textMuted, fontSize: 11, fontFamily: "DMSans_700Bold" }}>{t}</Text>
                              </Pressable>
                            ))}
                          </View>
                        )}

                        <View style={{ flex: 1 }} />

                        {/* Suspend/View */}
                        <Pressable
                          onPress={() => setSuspendModal({ userId: u.id, phone: u.phone, action: u.is_suspended ? "unsuspend" : "suspend" })}
                          style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: (u.is_suspended ? colors.success : colors.error) + "12" }}
                        >
                          <Ionicons name={u.is_suspended ? "checkmark-circle-outline" : "ban-outline"} size={14} color={u.is_suspended ? colors.success : colors.error} />
                          <Text style={{ color: u.is_suspended ? colors.success : colors.error, fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>
                            {u.is_suspended ? "Restore" : "Suspend"}
                          </Text>
                        </Pressable>

                        <Pressable
                          onPress={() => router.push(`/settings/admin-user-detail?id=${u.id}` as any)}
                          style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primary[500] + "12" }}
                        >
                          <Ionicons name="eye-outline" size={14} color={colors.primary[400]} />
                          <Text style={{ color: colors.primary[400], fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>View</Text>
                        </Pressable>
                      </View>
                    </Pressable>
                  );
                }

                // ── DESKTOP ROW LAYOUT ──
                return (
                  <View
                    key={u.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      paddingVertical: 14,
                      paddingHorizontal: 16,
                      borderBottomWidth: idx < users.length - 1 ? 1 : 0,
                      borderBottomColor: tc.glass.border,
                    }}
                  >
                    {/* User info */}
                    <Pressable
                      onPress={() => router.push(`/settings/admin-user-detail?id=${u.id}` as any)}
                      style={({ hovered }: any) => ({
                        flex: 2,
                        ...(isWeb ? ({ cursor: "pointer" } as any) : {}),
                        opacity: isWeb && hovered ? 0.8 : 1,
                      })}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>
                          {u.full_name || "No name"}
                        </Text>
                        {u.kyc_tier >= 1 && (
                          <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: colors.primary[500], alignItems: "center", justifyContent: "center" }}>
                            <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                          </View>
                        )}
                      </View>
                      <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular", marginTop: 2 }}>{u.phone}</Text>
                      {u.email ? <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular", marginTop: 1 }}>{u.email}</Text> : null}
                    </Pressable>

                    {/* KYC Tier */}
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tierColor }} />
                        <Text style={{ color: tierColor, fontSize: 13, fontFamily: "DMSans_600SemiBold" }}>Tier {u.kyc_tier}</Text>
                      </View>
                      <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular", marginTop: 2 }}>{TIER_LABELS[u.kyc_tier]}</Text>
                    </View>

                    {/* Status */}
                    <View style={{ flex: 1 }}>
                      <View style={{ backgroundColor: statusColor + "15", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" }}>
                        <Text style={{ color: statusColor, fontSize: 11, fontFamily: "DMSans_600SemiBold" }}>{statusLabel}</Text>
                      </View>
                    </View>

                    {/* Actions */}
                    <View style={{ width: 260, flexDirection: "row", gap: 6, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
                      {/* Tier buttons */}
                      {verifying === u.id ? (
                        <Spinner size={16} color={colors.primary[400]} />
                      ) : (
                        [0, 1, 2, 3].map((t) => (
                          <Pressable
                            key={t}
                            onPress={() => handleVerify(u.id, t)}
                            disabled={u.kyc_tier === t}
                            style={({ hovered }: any) => ({
                              width: 28,
                              height: 28,
                              borderRadius: 8,
                              backgroundColor:
                                u.kyc_tier === t
                                  ? TIER_COLORS[t] + "30"
                                  : hovered
                                    ? TIER_COLORS[t] + "20"
                                    : tc.dark.elevated,
                              alignItems: "center",
                              justifyContent: "center",
                              borderWidth: u.kyc_tier === t ? 1.5 : 1,
                              borderColor: u.kyc_tier === t ? TIER_COLORS[t] : tc.glass.border,
                              opacity: u.kyc_tier === t ? 1 : 0.8,
                              ...(isWeb ? ({ cursor: u.kyc_tier === t ? "default" : "pointer", transition: "all 0.15s ease" } as any) : {}),
                            })}
                          >
                            <Text
                              style={{
                                color: u.kyc_tier === t ? TIER_COLORS[t] : tc.textMuted,
                                fontSize: 11,
                                fontFamily: "DMSans_700Bold",
                              }}
                            >
                              {t}
                            </Text>
                          </Pressable>
                        ))
                      )}

                      {/* Suspend / Unsuspend button */}
                      <Pressable
                        onPress={() => {
                          setSuspendModal({
                            userId: u.id,
                            phone: u.phone,
                            action: u.is_suspended ? "unsuspend" : "suspend",
                          });
                          setSuspendReason("");
                        }}
                        style={({ hovered }: any) => ({
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 8,
                          backgroundColor: u.is_suspended
                            ? (hovered ? colors.success + "25" : colors.success + "15")
                            : (hovered ? colors.error + "25" : colors.error + "15"),
                          borderWidth: 1,
                          borderColor: u.is_suspended ? colors.success + "30" : colors.error + "30",
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                          ...(isWeb ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any) : {}),
                        })}
                      >
                        <Ionicons
                          name={u.is_suspended ? "checkmark-circle-outline" : "ban-outline"}
                          size={12}
                          color={u.is_suspended ? colors.success : colors.error}
                        />
                        <Text
                          style={{
                            color: u.is_suspended ? colors.success : colors.error,
                            fontSize: 11,
                            fontFamily: "DMSans_600SemiBold",
                          }}
                        >
                          {u.is_suspended ? "Unsuspend" : "Suspend"}
                        </Text>
                      </Pressable>

                      {/* View detail button */}
                      <Pressable
                        onPress={() => router.push(`/settings/admin-user-detail?id=${u.id}` as any)}
                        style={({ hovered }: any) => ({
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 8,
                          backgroundColor: hovered ? colors.info + "20" : colors.info + "10",
                          borderWidth: 1,
                          borderColor: colors.info + "30",
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                          ...(isWeb ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any) : {}),
                        })}
                      >
                        <Ionicons name="eye-outline" size={12} color={colors.info} />
                        <Text style={{ color: colors.info, fontSize: 11, fontFamily: "DMSans_600SemiBold" }}>
                          View
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })
            )}

            {/* Pagination */}
            {total > 20 && (
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: 16,
                  padding: 16,
                  borderTopWidth: 1,
                  borderTopColor: tc.glass.border,
                }}
              >
                <Pressable
                  onPress={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  style={{ opacity: page <= 1 ? 0.4 : 1 }}
                >
                  <Ionicons name="chevron-back" size={20} color={tc.textSecondary} />
                </Pressable>
                <Text style={{ color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_500Medium" }}>
                  Page {page} of {Math.ceil(total / 20)}
                </Text>
                <Pressable
                  onPress={() => setPage(page + 1)}
                  disabled={page * 20 >= total}
                  style={{ opacity: page * 20 >= total ? 0.4 : 1 }}
                >
                  <Ionicons name="chevron-forward" size={20} color={tc.textSecondary} />
                </Pressable>
              </View>
            )}
          </View>
        )}

        {/* Results count */}
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 12,
            fontFamily: "DMSans_400Regular",
            textAlign: "center",
            marginTop: 16,
          }}
        >
          Showing {users.length} of {total} users
          {tierFilter !== null ? ` (Tier ${tierFilter} filter)` : ""}
          {search ? ` matching "${search}"` : ""}
        </Text>
      </ScrollView>

      {/* ── Suspend / Unsuspend Modal ── */}
      {suspendModal && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setSuspendModal(null)}>
          <Pressable
            onPress={() => setSuspendModal(null)}
            style={{
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.6)",
              justifyContent: "center",
              alignItems: "center",
              padding: 24,
            }}
          >
            <Pressable
              onPress={() => {}}
              style={{
                backgroundColor: tc.dark.card,
                borderRadius: 20,
                padding: 28,
                width: "100%",
                maxWidth: 440,
                borderWidth: 1,
                borderColor: tc.glass.border,
                ...ts.md,
              }}
            >
              {/* Modal header */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 20 }}>
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    backgroundColor: suspendModal.action === "suspend" ? colors.error + "15" : colors.success + "15",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons
                    name={suspendModal.action === "suspend" ? "ban-outline" : "checkmark-circle-outline"}
                    size={24}
                    color={suspendModal.action === "suspend" ? colors.error : colors.success}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: tc.textPrimary, fontSize: 18, fontFamily: "DMSans_700Bold" }}>
                    {suspendModal.action === "suspend" ? "Suspend Account" : "Unsuspend Account"}
                  </Text>
                  <Text style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_400Regular", marginTop: 2 }}>
                    {suspendModal.phone}
                  </Text>
                </View>
              </View>

              {suspendModal.action === "suspend" ? (
                <>
                  <Text style={{ color: tc.textSecondary, fontSize: 14, fontFamily: "DMSans_500Medium", marginBottom: 10 }}>
                    Reason for suspension
                  </Text>
                  <TextInput
                    value={suspendReason}
                    onChangeText={setSuspendReason}
                    placeholder="e.g., Suspected fraudulent activity..."
                    placeholderTextColor={tc.textMuted}
                    multiline
                    numberOfLines={3}
                    style={{
                      backgroundColor: tc.dark.bg,
                      borderRadius: 12,
                      padding: 14,
                      color: tc.textPrimary,
                      fontSize: 14,
                      fontFamily: "DMSans_400Regular",
                      borderWidth: 1,
                      borderColor: tc.glass.border,
                      minHeight: 80,
                      textAlignVertical: "top",
                      ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
                    }}
                  />
                  <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular", marginTop: 8 }}>
                    The user will be blocked from all transactions and profile updates. This action is logged in the audit trail.
                  </Text>
                </>
              ) : (
                <Text style={{ color: tc.textSecondary, fontSize: 14, fontFamily: "DMSans_400Regular", lineHeight: 22 }}>
                  This will restore the user's access to all platform features including transactions and profile updates.
                </Text>
              )}

              {/* Actions */}
              <View style={{ flexDirection: "row", gap: 12, marginTop: 24 }}>
                <Pressable
                  onPress={() => setSuspendModal(null)}
                  style={({ pressed }: any) => ({
                    flex: 1,
                    paddingVertical: 14,
                    borderRadius: 14,
                    backgroundColor: tc.dark.elevated,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: tc.glass.border,
                    opacity: pressed ? 0.8 : 1,
                    ...(isWeb ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any) : {}),
                  })}
                >
                  <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_600SemiBold" }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSuspendAction}
                  disabled={suspending || (suspendModal.action === "suspend" && !suspendReason.trim())}
                  style={({ pressed }: any) => ({
                    flex: 1,
                    paddingVertical: 14,
                    borderRadius: 14,
                    backgroundColor: suspendModal.action === "suspend" ? colors.error : colors.success,
                    alignItems: "center",
                    opacity: (suspending || (suspendModal.action === "suspend" && !suspendReason.trim())) ? 0.5 : pressed ? 0.85 : 1,
                    ...(isWeb ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any) : {}),
                  })}
                >
                  {suspending ? (
                    <Spinner size={16} color="#fff" />
                  ) : (
                    <Text style={{ color: "#fff", fontSize: 15, fontFamily: "DMSans_700Bold" }}>
                      {suspendModal.action === "suspend" ? "Suspend" : "Unsuspend"}
                    </Text>
                  )}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}
