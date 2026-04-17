import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Modal,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/stores/auth";
import { useToast } from "../../src/components/Toast";
import { normalizeError } from "../../src/utils/apiErrors";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";

const isWeb = Platform.OS === "web";

const TIER_COLORS = ["#94A3B8", "#F59E0B", colors.info, colors.success];
const TIER_LABELS = ["Phone Only", "ID Verified", "KRA PIN", "Enhanced DD"];

const STATUS_COLORS: Record<string, string> = {
  completed: colors.success,
  pending: "#F59E0B",
  failed: colors.error,
  processing: colors.info,
  cancelled: "#94A3B8",
};

const DOC_STATUS_COLORS: Record<string, string> = {
  approved: colors.success,
  pending: "#F59E0B",
  rejected: colors.error,
};

interface UserDetail {
  id: string;
  phone: string;
  full_name: string;
  email: string | null;
  email_verified: boolean;
  kyc_tier: number;
  kyc_status: string;
  is_active: boolean;
  is_suspended: boolean;
  suspension_reason: string;
  suspended_at: string | null;
  suspended_by: string | null;
  totp_enabled: boolean;
  last_login_ip: string | null;
  last_login_country?: string | null;
  last_activity_at?: string | null;
  last_activity_ip?: string | null;
  is_online?: boolean;
  created_at: string;
  updated_at: string;
}

interface WalletInfo {
  currency: string;
  balance: string;
  locked_balance: string;
  available_balance: string;
}

interface Transaction {
  id: string;
  type: string;
  status: string;
  source_amount: string;
  source_currency: string;
  dest_amount: string;
  dest_currency: string;
  created_at: string;
}

interface DeviceInfo {
  device_name: string;
  platform: string;
  ip_address: string | null;
  is_trusted: boolean;
  last_seen: string;
}

interface AuditEntry {
  action: string;
  details: Record<string, any>;
  admin: string | null;
  created_at: string;
}

interface KycDoc {
  id: string;
  document_type: string;
  status: string;
  rejection_reason: string;
  file_url: string;
  created_at: string;
}

export default function AdminUserDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user: currentUser } = useAuth();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userData, setUserData] = useState<UserDetail | null>(null);
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [kycDocs, setKycDocs] = useState<KycDoc[]>([]);
  // Presence + activity — surfaced via the new admin-detail endpoint
  // additions. `currentDevice` is populated only when the user is online
  // RIGHT NOW (≤ 5 min) so admins see what they're using live.
  const [currentDevice, setCurrentDevice] = useState<DeviceInfo | null>(null);
  const [activityLog, setActivityLog] = useState<Array<{ action: string; ip: string | null; user_agent: string; created_at: string }>>([]);
  const [loginHistory, setLoginHistory] = useState<Array<{ action: string; ip: string | null; details: any; created_at: string }>>([]);

  // Suspend modal
  const [suspendModal, setSuspendModal] = useState<"suspend" | "unsuspend" | null>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [suspending, setSuspending] = useState(false);

  // KYC review
  const [kycRejectingId, setKycRejectingId] = useState<string | null>(null);
  const [kycRejectReasons, setKycRejectReasons] = useState<Record<string, string>>({});
  const [kycReviewingId, setKycReviewingId] = useState<string | null>(null);

  // Active tab
  const [activeTab, setActiveTab] = useState<"overview" | "transactions" | "devices" | "audit">("overview");

  useEffect(() => {
    if (currentUser && !currentUser.is_staff) {
      router.replace("/(tabs)" as any);
    }
  }, [currentUser, router]);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const { data } = await api.get(`/auth/admin/users/${id}/detail/`);
      setUserData(data.user);
      setWallets(data.wallets || []);
      setTransactions(data.recent_transactions || []);
      setDevices(data.devices || []);
      setAuditLog(data.audit_log || []);
      setKycDocs(data.kyc_documents || []);
      setCurrentDevice(data.current_device || null);
      setActivityLog(data.activity_log || []);
      setLoginHistory(data.login_history || []);
    } catch (err) {
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSuspendAction = async () => {
    if (!suspendModal || !id) return;
    if (suspendModal === "suspend" && !suspendReason.trim()) return;

    setSuspending(true);
    try {
      await api.post(`/auth/admin/users/${id}/suspend/`, {
        action: suspendModal,
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

  const handleKycReview = async (docId: string, action: "approve" | "reject") => {
    if (action === "reject" && !kycRejectReasons[docId]?.trim()) return;
    setKycReviewingId(docId);
    try {
      const body: any = { action };
      if (action === "reject") body.reason = kycRejectReasons[docId].trim();
      await api.post(`/auth/admin/kyc/${docId}/review/`, body);
      setKycRejectingId(null);
      setKycRejectReasons((prev) => ({ ...prev, [docId]: "" }));
      await fetchData();
    } catch (err) {
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);
    } finally {
      setKycReviewingId(null);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
  };

  const hPad = isDesktop ? 48 : 20;

  if (!currentUser?.is_staff) return null;

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={colors.primary[400]} />
      </SafeAreaView>
    );
  }

  if (!userData) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg, justifyContent: "center", alignItems: "center" }}>
        <Ionicons name="person-outline" size={48} color={tc.textMuted} />
        <Text style={{ color: tc.textMuted, fontSize: 16, fontFamily: "DMSans_500Medium", marginTop: 16 }}>User not found</Text>
      </SafeAreaView>
    );
  }

  const tierColor = TIER_COLORS[userData.kyc_tier] || tc.textMuted;
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const cardStyle = {
    backgroundColor: tc.dark.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: tc.glass.border,
    overflow: "hidden" as const,
    ...ts.sm,
  };

  const sectionTitle = (title: string, icon: string, iconColor: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14, marginTop: 28 }}>
      <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: iconColor + "15", alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon as any} size={16} color={iconColor} />
      </View>
      <Text style={{ color: tc.textPrimary, fontSize: 18, fontFamily: "DMSans_700Bold" }}>{title}</Text>
    </View>
  );

  const tabs = [
    { key: "overview", label: "Overview", icon: "person-outline" },
    { key: "transactions", label: "Transactions", icon: "swap-horizontal-outline" },
    { key: "devices", label: "Devices", icon: "phone-portrait-outline" },
    { key: "audit", label: "Audit Log", icon: "time-outline" },
  ] as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[400]} />}
        contentContainerStyle={{
          paddingHorizontal: hPad,
          paddingTop: isDesktop ? 12 : 8,
          paddingBottom: 60,
        }}
      >
        {/* Back */}
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/settings/admin-users" as any);
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
          <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_500Medium" }}>User Management</Text>
        </Pressable>

        {/* ── User Header Card ── */}
        <View style={{ ...cardStyle, padding: isDesktop ? 28 : 20, marginBottom: 4 }}>
          <View style={{ flexDirection: isDesktop ? "row" : "column", gap: isDesktop ? 28 : 20 }}>
            {/* Left: Avatar + basic info */}
            <View style={{ alignItems: isDesktop ? "flex-start" : "center", minWidth: isDesktop ? 200 : undefined }}>
              {/* Avatar placeholder */}
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 22,
                  backgroundColor: colors.primary[500] + "18",
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 3,
                  borderColor: userData.is_suspended ? colors.error + "40" : colors.primary[500] + "30",
                }}
              >
                <Text style={{ color: colors.primary[400], fontSize: 24, fontFamily: "DMSans_700Bold" }}>
                  {userData.full_name ? userData.full_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) : "?"}
                </Text>
              </View>

              <Text style={{ color: tc.textPrimary, fontSize: 20, fontFamily: "DMSans_700Bold", marginTop: 14 }}>
                {userData.full_name || "No name"}
              </Text>
              <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_400Regular", marginTop: 4 }}>
                {userData.phone}
              </Text>
              {userData.email ? (
                <Text style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_400Regular", marginTop: 2 }}>
                  {userData.email} {userData.email_verified ? "  (verified)" : "  (unverified)"}
                </Text>
              ) : null}
              <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular", marginTop: 6 }}>
                Joined {formatDate(userData.created_at)}
              </Text>
            </View>

            {/* Right: Status badges + action buttons */}
            <View style={{ flex: 1 }}>
              {/* Status row */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
                {/* KYC Tier */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: tierColor + "15", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tierColor }} />
                  <Text style={{ color: tierColor, fontSize: 13, fontFamily: "DMSans_600SemiBold" }}>
                    Tier {userData.kyc_tier}: {TIER_LABELS[userData.kyc_tier]}
                  </Text>
                </View>

                {/* Account status */}
                <View
                  style={{
                    backgroundColor: userData.is_suspended ? colors.error + "15" : colors.success + "15",
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                  }}
                >
                  <Text style={{ color: userData.is_suspended ? colors.error : colors.success, fontSize: 13, fontFamily: "DMSans_600SemiBold" }}>
                    {userData.is_suspended ? "Suspended" : "Active"}
                  </Text>
                </View>

                {/* TOTP */}
                {userData.totp_enabled && (
                  <View style={{ backgroundColor: colors.info + "15", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Ionicons name="key-outline" size={12} color={colors.info} />
                    <Text style={{ color: colors.info, fontSize: 13, fontFamily: "DMSans_600SemiBold" }}>2FA</Text>
                  </View>
                )}
              </View>

              {/* Suspension banner */}
              {userData.is_suspended && (
                <View
                  style={{
                    backgroundColor: colors.error + "0A",
                    borderRadius: 12,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: colors.error + "20",
                    marginBottom: 16,
                  }}
                >
                  <Text style={{ color: colors.error, fontSize: 13, fontFamily: "DMSans_600SemiBold", marginBottom: 4 }}>
                    Suspension Reason
                  </Text>
                  <Text style={{ color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_400Regular", lineHeight: 20 }}>
                    {userData.suspension_reason || "No reason provided"}
                  </Text>
                  <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
                    {userData.suspended_at ? (
                      <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular" }}>
                        Since: {formatDate(userData.suspended_at)}
                      </Text>
                    ) : null}
                    {userData.suspended_by ? (
                      <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular" }}>
                        By: {userData.suspended_by}
                      </Text>
                    ) : null}
                  </View>
                </View>
              )}

              {/* Action buttons */}
              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                <Pressable
                  onPress={() => {
                    setSuspendModal(userData.is_suspended ? "unsuspend" : "suspend");
                    setSuspendReason("");
                  }}
                  style={({ pressed, hovered }: any) => ({
                    paddingHorizontal: 18,
                    paddingVertical: 10,
                    borderRadius: 12,
                    backgroundColor: userData.is_suspended
                      ? (hovered ? colors.success + "25" : colors.success + "15")
                      : (hovered ? colors.error + "25" : colors.error + "15"),
                    borderWidth: 1,
                    borderColor: userData.is_suspended ? colors.success + "30" : colors.error + "30",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                    ...(isWeb ? ({ cursor: "pointer", transition: "all 0.2s ease" } as any) : {}),
                  })}
                >
                  <Ionicons
                    name={userData.is_suspended ? "checkmark-circle-outline" : "ban-outline"}
                    size={16}
                    color={userData.is_suspended ? colors.success : colors.error}
                  />
                  <Text style={{ color: userData.is_suspended ? colors.success : colors.error, fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>
                    {userData.is_suspended ? "Unsuspend Account" : "Suspend Account"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>

        {/* ── Tab Bar ── */}
        <View style={{ flexDirection: "row", gap: 4, marginTop: 20, marginBottom: 4 }}>
          {tabs.map((tab) => (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={({ hovered }: any) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderRadius: 12,
                backgroundColor: activeTab === tab.key ? colors.primary[500] + "18" : hovered ? tc.glass.highlight : "transparent",
                borderWidth: 1,
                borderColor: activeTab === tab.key ? colors.primary[500] + "30" : "transparent",
                ...(isWeb ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any) : {}),
              })}
            >
              <Ionicons
                name={tab.icon as any}
                size={16}
                color={activeTab === tab.key ? colors.primary[400] : tc.textMuted}
              />
              <Text
                style={{
                  color: activeTab === tab.key ? colors.primary[400] : tc.textMuted,
                  fontSize: 13,
                  fontFamily: activeTab === tab.key ? "DMSans_600SemiBold" : "DMSans_500Medium",
                }}
              >
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ── Tab Content ── */}

        {activeTab === "overview" && (
          <>
            {/* Presence + activity — enterprise admin signal. Shows
                whether user is online right now, on which device, where
                from, and their recent activity / login history. */}
            {sectionTitle("Presence & activity", "pulse-outline", colors.success)}
            <View style={cardStyle}>
              {/* Live status row */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 18, borderBottomWidth: 1, borderBottomColor: tc.glass.border }}>
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: (userData?.last_activity_at && (Date.now() - new Date(userData.last_activity_at).getTime() < 5 * 60 * 1000))
                      ? colors.success
                      : tc.textMuted,
                  }}
                />
                <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>
                  {userData?.last_activity_at && (Date.now() - new Date(userData.last_activity_at).getTime() < 5 * 60 * 1000)
                    ? "Online now"
                    : userData?.last_activity_at
                      ? `Last active ${new Date(userData.last_activity_at).toLocaleString()}`
                      : "Never active"}
                </Text>
                {userData?.last_login_country ? (
                  <View style={{ marginLeft: "auto" as any, flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons name="location-outline" size={12} color={tc.textMuted} />
                    <Text style={{ color: tc.textSecondary, fontSize: 12, fontFamily: "DMSans_500Medium" }}>
                      {userData.last_login_country}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Current device (only while online) */}
              {currentDevice ? (
                <View style={{ padding: 18, borderBottomWidth: 1, borderBottomColor: tc.glass.border, flexDirection: "row", gap: 14, alignItems: "center" }}>
                  <Ionicons
                    name={currentDevice.platform?.toLowerCase().includes("ios") ? "phone-portrait" : "phone-portrait-outline"}
                    size={22}
                    color={colors.primary[400]}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: tc.textPrimary, fontSize: 13, fontFamily: "DMSans_600SemiBold" }}>
                      {currentDevice.device_name || currentDevice.platform || "Unknown device"}
                    </Text>
                    <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular", marginTop: 2 }}>
                      {currentDevice.ip_address || "IP unknown"} · seen {new Date(currentDevice.last_seen).toLocaleTimeString()}
                    </Text>
                  </View>
                  {currentDevice.is_trusted ? (
                    <View style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: colors.primary[500] + "18" }}>
                      <Text style={{ color: colors.primary[400], fontSize: 10, fontFamily: "DMSans_600SemiBold", letterSpacing: 0.6 }}>TRUSTED</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Login history — last 5 */}
              <View style={{ padding: 18 }}>
                <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_700Bold", letterSpacing: 0.8, marginBottom: 10 }}>
                  RECENT LOGINS
                </Text>
                {loginHistory.length === 0 ? (
                  <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular" }}>No login events recorded.</Text>
                ) : (
                  loginHistory.slice(0, 5).map((ev, i) => (
                    <View
                      key={`${ev.created_at}-${i}`}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingVertical: 6,
                        borderBottomWidth: i < Math.min(loginHistory.length, 5) - 1 ? 1 : 0,
                        borderBottomColor: tc.glass.border,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: tc.textPrimary, fontSize: 12, fontFamily: "DMSans_500Medium" }}>
                          {ev.action.replace(/_/g, " ")}
                        </Text>
                        <Text style={{ color: tc.textMuted, fontSize: 10, fontFamily: "DMSans_400Regular", marginTop: 2 }}>
                          {ev.ip || "—"} · {new Date(ev.created_at).toLocaleString()}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </View>

            {/* Wallets */}
            {sectionTitle("Wallets", "wallet-outline", colors.primary[400])}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {wallets.length === 0 ? (
                <Text style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_400Regular", padding: 20 }}>No wallets</Text>
              ) : (
                wallets.map((w) => {
                  const cryptoColor = colors.crypto[w.currency] || tc.textSecondary;
                  return (
                    <View
                      key={w.currency}
                      style={{
                        flex: 1,
                        minWidth: isDesktop ? 200 : 150,
                        ...cardStyle,
                        padding: 18,
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                        <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: cryptoColor + "18", alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ color: cryptoColor, fontSize: 11, fontFamily: "DMSans_700Bold" }}>{w.currency.slice(0, 3)}</Text>
                        </View>
                        <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>{w.currency}</Text>
                      </View>
                      <Text style={{ color: tc.textPrimary, fontSize: 20, fontFamily: "DMSans_700Bold" }}>{w.available_balance}</Text>
                      {parseFloat(w.locked_balance) > 0 && (
                        <Text style={{ color: colors.warning, fontSize: 11, fontFamily: "DMSans_500Medium", marginTop: 4 }}>
                          Locked: {w.locked_balance}
                        </Text>
                      )}
                    </View>
                  );
                })
              )}
            </View>

            {/* KYC Documents */}
            {sectionTitle("KYC Documents", "document-text-outline", colors.info)}
            <View style={cardStyle}>
              {kycDocs.length === 0 ? (
                <View style={{ padding: 24, alignItems: "center" }}>
                  <Text style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_400Regular" }}>No documents submitted</Text>
                </View>
              ) : (
                kycDocs.map((doc, i) => {
                  const statusColor = DOC_STATUS_COLORS[doc.status] || tc.textMuted;
                  const isReviewing = kycReviewingId === doc.id;
                  const isShowingReject = kycRejectingId === doc.id;
                  return (
                    <View
                      key={doc.id}
                      style={{
                        paddingVertical: 14,
                        paddingHorizontal: 18,
                        borderBottomWidth: i < kycDocs.length - 1 ? 1 : 0,
                        borderBottomColor: tc.glass.border,
                      }}
                    >
                      {/* Top row: doc info + status */}
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_500Medium", textTransform: "capitalize" }}>
                            {doc.document_type.replace(/_/g, " ")}
                          </Text>
                          <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular", marginTop: 2 }}>
                            {formatDate(doc.created_at)}
                          </Text>
                        </View>
                        <View style={{ backgroundColor: statusColor + "15", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                          <Text style={{ color: statusColor, fontSize: 11, fontFamily: "DMSans_600SemiBold", textTransform: "capitalize" }}>
                            {doc.status}
                          </Text>
                        </View>
                      </View>

                      {/* Rejection reason display */}
                      {doc.rejection_reason ? (
                        <Text style={{ color: colors.error, fontSize: 11, fontFamily: "DMSans_400Regular", marginTop: 6 }}>
                          Reason: {doc.rejection_reason}
                        </Text>
                      ) : null}

                      {/* Action row: View Document + Approve/Reject buttons */}
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                        {/* View Document link */}
                        {doc.file_url ? (
                          <Pressable
                            onPress={() => {
                              if (Platform.OS === "web") {
                                window.open(doc.file_url, "_blank");
                              } else {
                                Linking.openURL(doc.file_url);
                              }
                            }}
                            style={({ pressed, hovered }: any) => ({
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 5,
                              paddingHorizontal: 10,
                              paddingVertical: 6,
                              borderRadius: 8,
                              backgroundColor: hovered ? colors.info + "20" : "transparent",
                              opacity: pressed ? 0.7 : 1,
                              ...(isWeb ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any) : {}),
                            })}
                          >
                            <Ionicons name="document-outline" size={14} color={colors.info} />
                            <Text style={{ color: colors.info, fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>View Document</Text>
                          </Pressable>
                        ) : null}

                        {/* Approve / Reject buttons for pending docs */}
                        {doc.status === "pending" && !isReviewing && (
                          <>
                            <Pressable
                              onPress={() => handleKycReview(doc.id, "approve")}
                              style={({ pressed, hovered }: any) => ({
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 5,
                                paddingHorizontal: 12,
                                paddingVertical: 6,
                                borderRadius: 8,
                                backgroundColor: hovered ? colors.success + "25" : colors.success + "15",
                                borderWidth: 1,
                                borderColor: colors.success + "30",
                                transform: [{ scale: pressed ? 0.97 : 1 }],
                                ...(isWeb ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any) : {}),
                              })}
                            >
                              <Ionicons name="checkmark-outline" size={14} color={colors.success} />
                              <Text style={{ color: colors.success, fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>Approve</Text>
                            </Pressable>

                            <Pressable
                              onPress={() => {
                                setKycRejectingId(isShowingReject ? null : doc.id);
                              }}
                              style={({ pressed, hovered }: any) => ({
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 5,
                                paddingHorizontal: 12,
                                paddingVertical: 6,
                                borderRadius: 8,
                                backgroundColor: hovered ? colors.error + "25" : isShowingReject ? colors.error + "25" : colors.error + "15",
                                borderWidth: 1,
                                borderColor: colors.error + "30",
                                transform: [{ scale: pressed ? 0.97 : 1 }],
                                ...(isWeb ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any) : {}),
                              })}
                            >
                              <Ionicons name="close-outline" size={14} color={colors.error} />
                              <Text style={{ color: colors.error, fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>Reject</Text>
                            </Pressable>
                          </>
                        )}

                        {/* Loading spinner while reviewing */}
                        {isReviewing && (
                          <ActivityIndicator size="small" color={colors.primary[400]} style={{ marginLeft: 8 }} />
                        )}
                      </View>

                      {/* Rejection reason input */}
                      {isShowingReject && !isReviewing && (
                        <View style={{ marginTop: 10 }}>
                          <TextInput
                            value={kycRejectReasons[doc.id] || ""}
                            onChangeText={(text) => setKycRejectReasons((prev) => ({ ...prev, [doc.id]: text }))}
                            placeholder="Reason for rejection (required)..."
                            placeholderTextColor={tc.textMuted}
                            multiline
                            numberOfLines={2}
                            style={{
                              backgroundColor: tc.dark.bg,
                              borderRadius: 10,
                              padding: 12,
                              color: tc.textPrimary,
                              fontSize: 13,
                              fontFamily: "DMSans_400Regular",
                              borderWidth: 1,
                              borderColor: tc.glass.border,
                              minHeight: 56,
                              textAlignVertical: "top",
                              ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
                            }}
                          />
                          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                            <Pressable
                              onPress={() => setKycRejectingId(null)}
                              style={({ pressed }: any) => ({
                                paddingHorizontal: 14,
                                paddingVertical: 8,
                                borderRadius: 8,
                                backgroundColor: tc.dark.elevated,
                                borderWidth: 1,
                                borderColor: tc.glass.border,
                                opacity: pressed ? 0.8 : 1,
                                ...(isWeb ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any) : {}),
                              })}
                            >
                              <Text style={{ color: tc.textSecondary, fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>Cancel</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => handleKycReview(doc.id, "reject")}
                              disabled={!kycRejectReasons[doc.id]?.trim()}
                              style={({ pressed }: any) => ({
                                paddingHorizontal: 14,
                                paddingVertical: 8,
                                borderRadius: 8,
                                backgroundColor: colors.error,
                                opacity: !kycRejectReasons[doc.id]?.trim() ? 0.5 : pressed ? 0.85 : 1,
                                ...(isWeb ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any) : {}),
                              })}
                            >
                              <Text style={{ color: "#fff", fontSize: 12, fontFamily: "DMSans_700Bold" }}>Confirm Reject</Text>
                            </Pressable>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </View>
          </>
        )}

        {activeTab === "transactions" && (
          <>
            {sectionTitle("Recent Transactions", "swap-horizontal-outline", colors.primary[400])}
            <View style={cardStyle}>
              {transactions.length === 0 ? (
                <View style={{ padding: 24, alignItems: "center" }}>
                  <Ionicons name="receipt-outline" size={32} color={tc.textMuted} />
                  <Text style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_400Regular", marginTop: 10 }}>No transactions</Text>
                </View>
              ) : (
                <>
                  {/* Header */}
                  <View style={{ flexDirection: "row", paddingVertical: 10, paddingHorizontal: 16, backgroundColor: tc.glass.highlight, borderBottomWidth: 1, borderBottomColor: tc.glass.border }}>
                    <Text style={{ flex: 1, color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_600SemiBold", textTransform: "uppercase" }}>ID</Text>
                    <Text style={{ flex: 1, color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_600SemiBold", textTransform: "uppercase" }}>Type</Text>
                    <Text style={{ flex: 1, color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_600SemiBold", textTransform: "uppercase" }}>Amount</Text>
                    <Text style={{ flex: 1, color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_600SemiBold", textTransform: "uppercase" }}>Status</Text>
                    <Text style={{ flex: 1, color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_600SemiBold", textTransform: "uppercase" }}>Date</Text>
                  </View>
                  {transactions.map((tx, i) => {
                    const statusColor = STATUS_COLORS[tx.status] || tc.textMuted;
                    return (
                      <View
                        key={i}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          paddingVertical: 12,
                          paddingHorizontal: 16,
                          borderBottomWidth: i < transactions.length - 1 ? 1 : 0,
                          borderBottomColor: tc.glass.border,
                        }}
                      >
                        <Text style={{ flex: 1, color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_500Medium" }}>{tx.id}</Text>
                        <Text style={{ flex: 1, color: tc.textPrimary, fontSize: 12, fontFamily: "DMSans_500Medium", textTransform: "capitalize" }}>{tx.type.replace(/_/g, " ")}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: tc.textPrimary, fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>{tx.source_amount} {tx.source_currency}</Text>
                          {tx.dest_amount !== "0" && tx.dest_amount !== "0.00" && (
                            <Text style={{ color: tc.textMuted, fontSize: 10, fontFamily: "DMSans_400Regular" }}>{tx.dest_amount} {tx.dest_currency}</Text>
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={{ backgroundColor: statusColor + "15", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start" }}>
                            <Text style={{ color: statusColor, fontSize: 11, fontFamily: "DMSans_600SemiBold", textTransform: "capitalize" }}>{tx.status}</Text>
                          </View>
                        </View>
                        <Text style={{ flex: 1, color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular" }}>{formatDate(tx.created_at)}</Text>
                      </View>
                    );
                  })}
                </>
              )}
            </View>
          </>
        )}

        {activeTab === "devices" && (
          <>
            {sectionTitle("Registered Devices", "phone-portrait-outline", colors.accent)}
            <View style={cardStyle}>
              {devices.length === 0 ? (
                <View style={{ padding: 24, alignItems: "center" }}>
                  <Ionicons name="phone-portrait-outline" size={32} color={tc.textMuted} />
                  <Text style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_400Regular", marginTop: 10 }}>No devices</Text>
                </View>
              ) : (
                devices.map((d, i) => (
                  <View
                    key={i}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 14,
                      paddingVertical: 14,
                      paddingHorizontal: 18,
                      borderBottomWidth: i < devices.length - 1 ? 1 : 0,
                      borderBottomColor: tc.glass.border,
                    }}
                  >
                    <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: tc.dark.elevated, alignItems: "center", justifyContent: "center" }}>
                      <Ionicons
                        name={d.platform?.toLowerCase().includes("web") ? "desktop-outline" : d.platform?.toLowerCase().includes("ios") ? "phone-portrait-outline" : "phone-portrait-outline"}
                        size={18}
                        color={tc.textSecondary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_500Medium" }}>
                          {d.device_name || "Unknown device"}
                        </Text>
                        {d.is_trusted && (
                          <View style={{ backgroundColor: colors.success + "15", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                            <Text style={{ color: colors.success, fontSize: 10, fontFamily: "DMSans_600SemiBold" }}>Trusted</Text>
                          </View>
                        )}
                      </View>
                      <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular", marginTop: 2 }}>
                        {d.platform} {d.ip_address ? ` \u2022 ${d.ip_address}` : ""}
                      </Text>
                    </View>
                    <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular" }}>
                      {formatDate(d.last_seen)}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </>
        )}

        {activeTab === "audit" && (
          <>
            {sectionTitle("Audit Log", "time-outline", "#8B5CF6")}
            <View style={cardStyle}>
              {auditLog.length === 0 ? (
                <View style={{ padding: 24, alignItems: "center" }}>
                  <Ionicons name="time-outline" size={32} color={tc.textMuted} />
                  <Text style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_400Regular", marginTop: 10 }}>No audit entries</Text>
                </View>
              ) : (
                auditLog.map((entry, i) => {
                  const isSuspend = entry.action.includes("suspend");
                  const isVerify = entry.action.includes("verify");
                  const actionColor = isSuspend ? colors.error : isVerify ? colors.success : colors.info;
                  return (
                    <View
                      key={i}
                      style={{
                        paddingVertical: 14,
                        paddingHorizontal: 18,
                        borderBottomWidth: i < auditLog.length - 1 ? 1 : 0,
                        borderBottomColor: tc.glass.border,
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: actionColor }} />
                        <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_500Medium", flex: 1 }}>
                          {entry.action.replace(/_/g, " ")}
                        </Text>
                        <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular" }}>
                          {formatDate(entry.created_at)}
                        </Text>
                      </View>
                      {entry.admin ? (
                        <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular", marginTop: 4, marginLeft: 18 }}>
                          Admin: {entry.admin}
                        </Text>
                      ) : null}
                      {entry.details?.reason ? (
                        <Text style={{ color: tc.textSecondary, fontSize: 12, fontFamily: "DMSans_400Regular", marginTop: 2, marginLeft: 18 }}>
                          Reason: {entry.details.reason}
                        </Text>
                      ) : null}
                      {entry.details?.kyc_tier !== undefined && (
                        <Text style={{ color: tc.textSecondary, fontSize: 12, fontFamily: "DMSans_400Regular", marginTop: 2, marginLeft: 18 }}>
                          KYC Tier set to: {entry.details.kyc_tier}
                        </Text>
                      )}
                    </View>
                  );
                })
              )}
            </View>
          </>
        )}
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
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 20 }}>
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    backgroundColor: suspendModal === "suspend" ? colors.error + "15" : colors.success + "15",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons
                    name={suspendModal === "suspend" ? "ban-outline" : "checkmark-circle-outline"}
                    size={24}
                    color={suspendModal === "suspend" ? colors.error : colors.success}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: tc.textPrimary, fontSize: 18, fontFamily: "DMSans_700Bold" }}>
                    {suspendModal === "suspend" ? "Suspend Account" : "Unsuspend Account"}
                  </Text>
                  <Text style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_400Regular", marginTop: 2 }}>
                    {userData.phone}
                  </Text>
                </View>
              </View>

              {suspendModal === "suspend" ? (
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
                    The user will be blocked from all transactions and profile updates.
                  </Text>
                </>
              ) : (
                <Text style={{ color: tc.textSecondary, fontSize: 14, fontFamily: "DMSans_400Regular", lineHeight: 22 }}>
                  This will restore the user's access to all platform features.
                </Text>
              )}

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
                  disabled={suspending || (suspendModal === "suspend" && !suspendReason.trim())}
                  style={({ pressed }: any) => ({
                    flex: 1,
                    paddingVertical: 14,
                    borderRadius: 14,
                    backgroundColor: suspendModal === "suspend" ? colors.error : colors.success,
                    alignItems: "center",
                    opacity: (suspending || (suspendModal === "suspend" && !suspendReason.trim())) ? 0.5 : pressed ? 0.85 : 1,
                    ...(isWeb ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any) : {}),
                  })}
                >
                  {suspending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={{ color: "#fff", fontSize: 15, fontFamily: "DMSans_700Bold" }}>
                      {suspendModal === "suspend" ? "Suspend" : "Unsuspend"}
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
