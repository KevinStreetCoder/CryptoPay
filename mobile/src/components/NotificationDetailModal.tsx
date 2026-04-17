/**
 * NotificationDetailModal — full-content popup for a single inbox entry.
 *
 * Used by BOTH the user inbox and the admin inbox (admin gets the extra
 * stats block + edit controls via the `adminMode` prop). Rather than two
 * near-identical screens we branch behaviour inside one cohesive modal.
 *
 * Design notes:
 *   - Centered card on tablet/desktop, bottom-sheet on mobile.
 *   - ScrollView so long bodies never clip.
 *   - Category + priority pills at the top for at-a-glance context.
 *   - Sender + timestamps + delivery channel in a compact meta grid.
 *   - Read / unread badge only appears when relevant (read state is
 *     flipped the moment this modal opens, so we show "Read now" rather
 *     than the stale "unread" state).
 *   - Admin mode: shows recipients / read / opened / total opens and
 *     reveals an "Edit" flyout that PATCHes the broadcast. The edit form
 *     lives inline — no nested modal — so the admin flow is one surface.
 *
 * Aesthetic: financial-instrument minimalism. No gradients except a
 * single hairline divider. Emerald accents only for positive actions.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import {
  AdminNotificationStatsDetail,
  NotificationDetail,
  ServerNotification,
  notificationsApi,
} from "../api/notifications";
import { getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";
import { useToast } from "./Toast";

type Props = {
  /** The id of the UserNotification (not the AdminNotification). */
  notificationId: string | null;
  /** If true, the caller is a staff user viewing any broadcast — shows
   *  stats panel + edit UI. For staff-viewing-their-own-inbox the caller
   *  should pass false; the normal user view renders. */
  adminMode?: boolean;
  /** Called when the user taps the backdrop, close button, or Done. */
  onClose: () => void;
  /** Fires after an admin edit succeeds so parent lists can refresh. */
  onEdited?: () => void;
};

const CATEGORY_META: Record<
  ServerNotification["category"],
  { label: string; tone: string }
> = {
  security: { label: "Security", tone: "#EF4444" },
  update: { label: "Update", tone: "#3B82F6" },
  promotion: { label: "Promotion", tone: "#10B981" },
  maintenance: { label: "Maintenance", tone: "#F59E0B" },
};

const PRIORITY_META: Record<
  ServerNotification["priority"],
  { label: string; tone: string }
> = {
  low: { label: "Low", tone: "#64748B" },
  normal: { label: "Normal", tone: "#64748B" },
  high: { label: "High", tone: "#F59E0B" },
  critical: { label: "Critical", tone: "#EF4444" },
};

function formatStamp(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function NotificationDetailModal({
  notificationId,
  adminMode,
  onClose,
  onEdited,
}: Props) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const toast = useToast();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  const [detail, setDetail] = useState<NotificationDetail | null>(null);
  const [adminStats, setAdminStats] = useState<AdminNotificationStatsDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit mode (admin only). Local copy of editable fields; commit on save.
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const open = !!notificationId;

  useEffect(() => {
    if (!open || !notificationId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEditing(false);
    setAdminStats(null);

    (async () => {
      try {
        if (adminMode) {
          // Admin path: `notificationId` is the AdminNotification id.
          // Fetch the aggregate stats and synthesise a "detail" shape
          // from it so the same modal UI works for both roles without
          // a separate view.
          const { data } = await notificationsApi.adminStatsDetail(notificationId);
          if (cancelled) return;
          setAdminStats(data);
          setDetail({
            id: data.id,
            title: data.title,
            body: data.body,
            category: data.category,
            priority: data.priority,
            read: true,
            read_at: null,
            opened_at: null,
            open_count: data.totals.total_opens,
            delivered_via: data.channels[0]?.channel || "in_app",
            created_at: data.created_at,
            sent_at: data.created_at,
            sender_name: data.created_by || "CryptoPay Team",
            is_edited: data.edit_count > 0,
            last_edited_at: data.edit_count > 0 ? data.updated_at : null,
          });
          setEditTitle(data.title);
          setEditBody(data.body);
        } else {
          // User path: `notificationId` is the UserNotification id.
          const { data } = await notificationsApi.detail(notificationId);
          if (cancelled) return;
          setDetail(data);
          setEditTitle(data.title);
          setEditBody(data.body);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.response?.data?.error || "Could not load notification.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, notificationId, adminMode]);

  const onSaveEdit = useCallback(async () => {
    if (!detail) return;
    const changes: Record<string, string> = {};
    if (editTitle.trim() && editTitle !== detail.title) changes.title = editTitle.trim();
    if (editBody.trim() && editBody !== detail.body) changes.body = editBody.trim();
    if (Object.keys(changes).length === 0) {
      toast.info("No changes", "Nothing to save.");
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      // NOTE: this endpoint expects the AdminNotification id. In the
      // admin inbox this modal is opened with that id already passed in.
      await notificationsApi.adminEdit(notificationId!, changes);
      toast.success("Saved", "Notification updated across all recipients.");
      setEditing(false);
      onEdited?.();
      onClose();
    } catch (e: any) {
      toast.error("Save failed", e?.response?.data?.error || "Try again.");
    } finally {
      setSaving(false);
    }
  }, [detail, editTitle, editBody, notificationId, onEdited, onClose, toast]);

  const catMeta = detail ? CATEGORY_META[detail.category] : null;
  const priMeta = detail ? PRIORITY_META[detail.priority] : null;

  // Responsive container: centered card on ≥ 768px, bottom sheet below.
  const containerStyle = isDesktop
    ? {
        maxWidth: 560,
        width: "100%" as const,
        alignSelf: "center" as const,
        marginTop: "auto" as const,
        marginBottom: "auto" as const,
        borderRadius: 20,
        maxHeight: "88%" as const,
      }
    : {
        width: "100%" as const,
        marginTop: "auto" as const,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: "90%" as const,
      };

  return (
    <Modal
      visible={open}
      onRequestClose={onClose}
      animationType={Platform.OS === "web" ? "fade" : "slide"}
      transparent
      statusBarTranslucent
    >
      {/* Backdrop — dismisses on tap outside. */}
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "rgba(6, 14, 31, 0.72)",
          justifyContent: "flex-end",
          paddingHorizontal: isDesktop ? 24 : 0,
        }}
      >
        {/* stopPropagation — inner tap shouldn't close the modal. */}
        <Pressable
          onPress={() => {}}
          style={[
            {
              backgroundColor: tc.dark.bg,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.06)",
              ...(Platform.OS === "web"
                ? ({ boxShadow: "0 20px 48px rgba(0,0,0,0.5)" } as any)
                : {}),
            },
            containerStyle,
          ]}
        >
          {/* Grab handle on mobile for the bottom-sheet feel. */}
          {!isDesktop ? (
            <View style={{ alignItems: "center", paddingTop: 10 }}>
              <View
                style={{
                  width: 44,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: tc.textMuted,
                  opacity: 0.4,
                }}
              />
            </View>
          ) : null}

          {/* Header row: category pill + close */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 20,
              paddingTop: isDesktop ? 20 : 14,
              paddingBottom: 10,
            }}
          >
            <View style={{ flexDirection: "row", gap: 8, flex: 1 }}>
              {catMeta ? <Pill label={catMeta.label} tone={catMeta.tone} /> : null}
              {priMeta && detail && detail.priority !== "normal" && detail.priority !== "low" ? (
                <Pill label={priMeta.label + " priority"} tone={priMeta.tone} />
              ) : null}
              {detail?.is_edited ? (
                <Pill label="Edited" tone={tc.textMuted} subtle />
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityLabel="Close"
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 4 })}
            >
              <Ionicons name="close" size={22} color={tc.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            style={{ paddingHorizontal: 20 }}
            contentContainerStyle={{ paddingBottom: 28 }}
          >
            {loading ? (
              <View style={{ paddingVertical: 48, alignItems: "center" }}>
                <ActivityIndicator color={tc.primary[500]} />
              </View>
            ) : error ? (
              <View style={{ paddingVertical: 32 }}>
                <Text style={{ color: tc.textSecondary, fontFamily: "DMSans_500Medium" }}>{error}</Text>
              </View>
            ) : detail ? (
              <>
                {/* Title + body. Editable inline in admin mode. */}
                {editing && adminMode ? (
                  <>
                    <TextInput
                      value={editTitle}
                      onChangeText={setEditTitle}
                      placeholder="Title"
                      placeholderTextColor={tc.textMuted}
                      style={{
                        color: tc.textPrimary,
                        fontSize: 20,
                        fontFamily: "DMSans_700Bold",
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.1)",
                        borderRadius: 10,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
                      }}
                    />
                    <TextInput
                      value={editBody}
                      onChangeText={setEditBody}
                      placeholder="Body"
                      placeholderTextColor={tc.textMuted}
                      multiline
                      style={{
                        color: tc.textPrimary,
                        fontSize: 15,
                        fontFamily: "DMSans_400Regular",
                        lineHeight: 22,
                        marginTop: 12,
                        minHeight: 120,
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.1)",
                        borderRadius: 10,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        textAlignVertical: "top",
                        ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
                      }}
                    />
                    <View
                      style={{
                        flexDirection: "row",
                        gap: 10,
                        marginTop: 14,
                      }}
                    >
                      <Pressable
                        onPress={() => setEditing(false)}
                        disabled={saving}
                        style={({ pressed }) => ({
                          flex: 1,
                          paddingVertical: 12,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: "rgba(255,255,255,0.12)",
                          alignItems: "center",
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Text style={{ color: tc.textSecondary, fontFamily: "DMSans_500Medium" }}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        onPress={onSaveEdit}
                        disabled={saving}
                        style={({ pressed }) => ({
                          flex: 1,
                          paddingVertical: 12,
                          borderRadius: 10,
                          backgroundColor: tc.primary[500],
                          alignItems: "center",
                          opacity: saving ? 0.7 : pressed ? 0.85 : 1,
                        })}
                      >
                        {saving ? (
                          <ActivityIndicator color="#FFF" />
                        ) : (
                          <Text style={{ color: "#FFF", fontFamily: "DMSans_600SemiBold" }}>Save changes</Text>
                        )}
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <>
                    <Text
                      style={{
                        color: tc.textPrimary,
                        fontSize: 22,
                        lineHeight: 28,
                        fontFamily: "DMSans_700Bold",
                        letterSpacing: -0.3,
                        marginBottom: 10,
                      }}
                      accessibilityRole="header"
                    >
                      {detail.title}
                    </Text>
                    <Text
                      style={{
                        color: tc.textSecondary,
                        fontSize: 15,
                        lineHeight: 23,
                        fontFamily: "DMSans_400Regular",
                        marginBottom: 22,
                      }}
                      selectable
                    >
                      {detail.body}
                    </Text>
                  </>
                )}

                {/* Meta grid */}
                <View
                  style={{
                    borderTopWidth: 1,
                    borderTopColor: "rgba(255,255,255,0.06)",
                    paddingTop: 14,
                    gap: 10,
                  }}
                >
                  <MetaRow label="From" value={detail.sender_name} tc={tc} />
                  <MetaRow label="Sent" value={formatStamp(detail.sent_at)} tc={tc} />
                  <MetaRow
                    label="Delivered via"
                    value={detail.delivered_via.replace("_", "-").toUpperCase()}
                    tc={tc}
                  />
                  <MetaRow
                    label="Status"
                    value={detail.read ? `Read · ${formatStamp(detail.read_at)}` : "Unread"}
                    tc={tc}
                    emphasize
                  />
                  {detail.open_count > 1 ? (
                    <MetaRow label="Times opened" value={String(detail.open_count)} tc={tc} />
                  ) : null}
                  {detail.is_edited && detail.last_edited_at ? (
                    <MetaRow
                      label="Last edited"
                      value={formatStamp(detail.last_edited_at)}
                      tc={tc}
                    />
                  ) : null}
                </View>

                {/* Admin-only stats block */}
                {adminMode && adminStats ? (
                  <AdminStatsBlock stats={adminStats} tc={tc} />
                ) : null}

                {/* Admin-only actions (edit). Non-admins see nothing here. */}
                {adminMode && !editing ? (
                  <Pressable
                    onPress={() => setEditing(true)}
                    style={({ pressed }) => ({
                      marginTop: 18,
                      paddingVertical: 12,
                      paddingHorizontal: 16,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: "rgba(16,185,129,0.35)",
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      opacity: pressed ? 0.75 : 1,
                    })}
                  >
                    <Ionicons name="create-outline" size={16} color={tc.primary[400]} />
                    <Text style={{ color: tc.primary[300], fontFamily: "DMSans_600SemiBold" }}>
                      Edit — propagates to {adminStats?.totals.recipients ?? "all"} recipients
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Pill({ label, tone, subtle }: { label: string; tone: string; subtle?: boolean }) {
  return (
    <View
      style={{
        paddingVertical: 3,
        paddingHorizontal: 9,
        borderRadius: 999,
        backgroundColor: subtle ? "transparent" : `${tone}22`,
        borderWidth: 1,
        borderColor: `${tone}55`,
      }}
    >
      <Text
        style={{
          color: tone,
          fontSize: 10,
          fontFamily: "DMSans_600SemiBold",
          letterSpacing: 0.5,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function MetaRow({
  label,
  value,
  tc,
  emphasize,
}: {
  label: string;
  value: string;
  tc: any;
  emphasize?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 16 }}>
      <Text
        style={{
          color: tc.textMuted,
          fontSize: 12,
          fontFamily: "DMSans_500Medium",
          letterSpacing: 0.2,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: emphasize ? tc.primary[300] : tc.textSecondary,
          fontSize: 13,
          fontFamily: emphasize ? "DMSans_600SemiBold" : "DMSans_500Medium",
          flexShrink: 1,
          textAlign: "right",
        }}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

function AdminStatsBlock({
  stats,
  tc,
}: {
  stats: AdminNotificationStatsDetail;
  tc: any;
}) {
  return (
    <View
      style={{
        marginTop: 20,
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "rgba(16,185,129,0.2)",
        backgroundColor: "rgba(16,185,129,0.06)",
        gap: 10,
      }}
    >
      <Text
        style={{
          color: tc.primary[300],
          fontSize: 11,
          fontFamily: "DMSans_700Bold",
          letterSpacing: 1,
          textTransform: "uppercase",
        }}
      >
        Broadcast stats
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 18 }}>
        <StatBlock label="Recipients" value={stats.totals.recipients} tc={tc} />
        <StatBlock
          label="Read"
          value={`${stats.totals.read} · ${stats.totals.read_rate_percent}%`}
          tc={tc}
        />
        <StatBlock
          label="Opened"
          value={`${stats.totals.opened} · ${stats.totals.open_rate_percent}%`}
          tc={tc}
          accent
        />
        {stats.totals.total_opens > stats.totals.opened ? (
          <StatBlock label="Total opens" value={stats.totals.total_opens} tc={tc} />
        ) : null}
      </View>
      {stats.edit_count > 0 ? (
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 11,
            fontFamily: "DMSans_400Regular",
            marginTop: 4,
          }}
        >
          Edited {stats.edit_count} time{stats.edit_count === 1 ? "" : "s"} · Last{" "}
          {formatStamp(stats.updated_at)}
        </Text>
      ) : null}
    </View>
  );
}

function StatBlock({
  label,
  value,
  tc,
  accent,
}: {
  label: string;
  value: string | number;
  tc: any;
  accent?: boolean;
}) {
  return (
    <View>
      <Text
        style={{
          color: tc.textMuted,
          fontSize: 10,
          fontFamily: "DMSans_500Medium",
          letterSpacing: 0.8,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: accent ? tc.primary[300] : tc.textPrimary,
          fontSize: 18,
          fontFamily: "DMSans_700Bold",
          marginTop: 2,
        }}
      >
        {value}
      </Text>
    </View>
  );
}
