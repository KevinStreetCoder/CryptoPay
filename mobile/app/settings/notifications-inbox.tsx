import { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
  Animated,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { paymentsApi, Transaction, getTxKesAmount, getTxRecipient } from "../../src/api/payments";
import { notificationsApi, ServerNotification } from "../../src/api/notifications";
import * as NotifStore from "../../src/stores/notifications";
import { useToast } from "../../src/components/Toast";
import { NotificationDetailModal } from "../../src/components/NotificationDetailModal";
import { normalizeError } from "../../src/utils/apiErrors";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { Spinner } from "../../src/components/brand/Spinner";
import { EmptyNoNotifications } from "../../src/components/brand/PolishAssets";

/* --- Types --- */
type NotificationType = "transaction" | "deposit" | "security" | "system" | "update" | "promotion" | "maintenance";
type FilterTab = "all" | "transaction" | "security" | "system";

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  timestamp: Date;
  read: boolean;
  amount?: string;
  isServer?: boolean; // true for server-side admin notifications
  serverCategory?: string;
}

/* --- Convert transactions to notification items --- */
function txToNotificationType(type: string): NotificationType {
  if (type === "DEPOSIT") return "deposit";
  return "transaction";
}

function txToNotificationTitle(tx: Transaction): string {
  switch (tx.type) {
    case "PAYBILL_PAYMENT": return tx.status === "completed" ? "Payment Sent" : tx.status === "failed" ? "Payment Failed" : "Payment Processing";
    case "TILL_PAYMENT": return tx.status === "completed" ? "Till Payment Successful" : tx.status === "failed" ? "Till Payment Failed" : "Till Payment Processing";
    case "SEND_MPESA": return tx.status === "completed" ? "M-Pesa Send Completed" : tx.status === "failed" ? "M-Pesa Send Failed" : "M-Pesa Send Processing";
    case "DEPOSIT": return "Deposit Confirmed";
    case "BUY": return "Crypto Purchased";
    case "SELL": return "Crypto Sold";
    default: return tx.type;
  }
}

function txToNotificationBody(tx: Transaction): string {
  const kes = getTxKesAmount(tx);
  const recipient = getTxRecipient(tx);
  const kesStr = `KSh ${kes.toLocaleString("en-KE")}`;
  switch (tx.type) {
    case "PAYBILL_PAYMENT": return `${kesStr} sent to Paybill ${recipient || ""}.`;
    case "TILL_PAYMENT": return `${kesStr} paid to Till ${recipient || ""}.`;
    case "SEND_MPESA": return `${kesStr} sent to ${recipient || "M-Pesa"}.`;
    case "DEPOSIT": return `${tx.source_currency} deposit credited to your wallet.`;
    case "BUY": return `Purchased crypto via M-Pesa STK Push for ${kesStr}.`;
    default: return `Transaction ${tx.status}.`;
  }
}

function txToNotificationAmount(tx: Transaction): string | undefined {
  if (!tx.source_currency || tx.source_currency === "KES") return undefined;
  const amount = parseFloat(tx.source_amount || "0");
  if (amount === 0) return undefined;
  const isIncoming = tx.type === "DEPOSIT";
  return `${isIncoming ? "+" : "-"}${amount.toFixed(amount < 1 ? 4 : 2)} ${tx.source_currency}`;
}

function transactionsToNotifications(transactions: Transaction[]): Notification[] {
  return transactions.map((tx) => ({
    id: tx.id,
    type: txToNotificationType(tx.type),
    title: txToNotificationTitle(tx),
    body: txToNotificationBody(tx),
    timestamp: new Date(tx.created_at),
    read: NotifStore.isRead(tx.id),
    amount: txToNotificationAmount(tx),
    isServer: false,
  }));
}

/* --- Convert server notifications to unified format --- */
function serverCategoryToType(category: string): NotificationType {
  switch (category) {
    case "security": return "security";
    case "update": return "update";
    case "promotion": return "promotion";
    case "maintenance": return "maintenance";
    default: return "system";
  }
}

function serverToNotifications(items: ServerNotification[]): Notification[] {
  return items.map((n) => ({
    id: n.id,
    type: serverCategoryToType(n.category),
    title: n.title,
    body: n.body,
    timestamp: new Date(n.created_at),
    read: n.read,
    isServer: true,
    serverCategory: n.category,
  }));
}

/* --- Filter tab mapping --- */
function matchesFilter(n: Notification, filter: FilterTab): boolean {
  if (filter === "all") return true;
  if (filter === "transaction") return n.type === "transaction" || n.type === "deposit";
  if (filter === "security") return n.type === "security";
  if (filter === "system") return n.type === "system" || n.type === "update" || n.type === "promotion" || n.type === "maintenance";
  return true;
}

/* --- Filter tabs config --- */
const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "transaction", label: "Transactions" },
  { key: "security", label: "Security" },
  { key: "system", label: "System" },
];

/* --- Icon map by notification type --- */
function getTypeIcon(type: NotificationType): {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
} {
  switch (type) {
    case "transaction":
      return { name: "send-outline", color: colors.primary[400], bg: "rgba(16, 185, 129, 0.12)" };
    case "deposit":
      return { name: "download-outline", color: colors.info, bg: "rgba(59, 130, 246, 0.12)" };
    case "security":
      return { name: "shield-checkmark-outline", color: colors.warning, bg: "rgba(245, 158, 11, 0.12)" };
    case "update":
      return { name: "megaphone-outline", color: colors.info, bg: "rgba(59, 130, 246, 0.12)" };
    case "promotion":
      return { name: "gift-outline", color: colors.primary[400], bg: "rgba(16, 185, 129, 0.12)" };
    case "maintenance":
      return { name: "construct-outline", color: colors.warning, bg: "rgba(245, 158, 11, 0.12)" };
    case "system":
    default:
      return { name: "megaphone-outline", color: colors.textSecondary, bg: "rgba(136, 153, 170, 0.12)" };
  }
}

/* --- Date grouping helpers --- */
function isSameDay(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

function getDateLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(date, today)) return "Today";
  if (isSameDay(date, yesterday)) return "Yesterday";
  return "Earlier";
}

function formatTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (isSameDay(date, now) && diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString("en-KE", { month: "short", day: "numeric" });
}

type GroupedNotifications = { label: string; items: Notification[] }[];

function groupByDate(notifications: Notification[]): GroupedNotifications {
  const groups: Record<string, Notification[]> = {};
  const order: string[] = [];
  for (const n of notifications) {
    const label = getDateLabel(n.timestamp);
    if (!groups[label]) {
      groups[label] = [];
      order.push(label);
    }
    groups[label].push(n);
  }
  return order.map((label) => ({ label, items: groups[label] }));
}

const isWeb = Platform.OS === "web";

/* ================================================================
   Main Screen
   ================================================================ */
export default function NotificationsInboxScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const toast = useToast();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [, forceUpdate] = useState(0);
  // The detail modal shows the full notification content (long bodies,
  // sender, timestamps, delivery channel, read status). `openId` holds
  // the UserNotification id of the row that was tapped — null when the
  // modal is closed.
  const [openId, setOpenId] = useState<string | null>(null);

  const loadNotifications = useCallback(async () => {
    try {
      await NotifStore.loadReadIds();

      // Fetch both transaction-based and server-side notifications in parallel
      const [txResult, serverResult] = await Promise.allSettled([
        paymentsApi.history(),
        notificationsApi.list(1),
      ]);

      let txNotifs: Notification[] = [];
      if (txResult.status === "fulfilled") {
        const txData = txResult.value.data;
        const txs = Array.isArray(txData) ? txData : txData.results || [];
        txNotifs = transactionsToNotifications(txs);
      }

      let serverNotifs: Notification[] = [];
      if (serverResult.status === "fulfilled") {
        const sData = serverResult.value.data;
        const items = Array.isArray(sData) ? sData : sData.results || [];
        serverNotifs = serverToNotifications(items);
      }

      // Merge and sort by timestamp descending
      const merged = [...txNotifs, ...serverNotifs].sort(
        (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
      );
      setNotifications(merged);
    } catch (err) {
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Subscribe to local store changes
  useEffect(() => {
    return NotifStore.subscribe(() => {
      setNotifications((prev) =>
        prev.map((n) =>
          n.isServer ? n : { ...n, read: NotifStore.isRead(n.id) }
        )
      );
      forceUpdate((c) => c + 1);
    });
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const isDesktop = isWeb && width >= 900;
  const hPad = isDesktop ? 48 : 20;

  // Filter
  const filteredNotifications = notifications.filter((n) => {
    if (deletedIds.has(n.id)) return false;
    return matchesFilter(n, activeFilter);
  });

  const grouped = groupByDate(filteredNotifications);

  const markAllRead = useCallback(async () => {
    // Mark local (transaction) notifications
    const localIds = notifications.filter((n) => !n.isServer).map((n) => n.id);
    NotifStore.markAllRead(localIds);

    // Mark server notifications
    try {
      await notificationsApi.markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      // best-effort
    }
  }, [notifications]);

  const markRead = useCallback(async (id: string, isServer: boolean) => {
    if (isServer) {
      try {
        await notificationsApi.markRead(id);
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read: true } : n))
        );
      } catch {
        // best-effort
      }
    } else {
      NotifStore.markRead(id);
    }
  }, []);

  const deleteNotification = useCallback((id: string, isServer: boolean) => {
    if (!isServer) NotifStore.markRead(id);
    setDeletedIds((prev) => new Set(prev).add(id));
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadNotifications();
    setRefreshing(false);
  }, [loadNotifications]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: hPad,
          paddingTop: isWeb ? 16 : 8,
          paddingBottom: 0,
          ...(isDesktop ? { width: "100%" } : {}),
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingBottom: 16,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Pressable
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace("/settings" as any);
              }}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              style={({ pressed, hovered }: any) => ({
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: isWeb && hovered ? tc.dark.elevated : tc.dark.card,
                alignItems: "center" as const,
                justifyContent: "center" as const,
                borderWidth: 1,
                borderColor: isWeb && hovered ? tc.glass.borderStrong : tc.glass.border,
                opacity: pressed ? 0.85 : 1,
                ...(isWeb ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any) : {}),
              })}
            >
              <Ionicons name="arrow-back" size={20} color={tc.textPrimary} />
            </Pressable>

            <Text
              style={{
                color: tc.textPrimary,
                fontSize: isDesktop ? 24 : 20,
                fontFamily: "DMSans_700Bold",
                letterSpacing: -0.3,
              }}
            >
              Notifications
            </Text>

            {unreadCount > 0 && (
              <View
                style={{
                  backgroundColor: colors.primary[500],
                  borderRadius: 10,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  minWidth: 22,
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    color: "#FFFFFF",
                    fontSize: 12,
                    fontFamily: "DMSans_600SemiBold",
                  }}
                >
                  {unreadCount}
                </Text>
              </View>
            )}
          </View>

          {unreadCount > 0 && (
            <Pressable
              onPress={markAllRead}
              accessibilityRole="button"
              accessibilityLabel="Mark all as read"
              style={({ pressed, hovered }: any) => ({
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 10,
                backgroundColor: isWeb && hovered ? colors.primary[800] : "transparent",
                borderWidth: 1,
                borderColor: colors.primary[700],
                opacity: pressed ? 0.85 : 1,
                ...(isWeb ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any) : {}),
              })}
            >
              <Text
                style={{
                  color: colors.primary[400],
                  fontSize: 13,
                  fontFamily: "DMSans_600SemiBold",
                }}
              >
                Mark all read
              </Text>
            </Pressable>
          )}
        </View>

        <FilterTabs active={activeFilter} onChange={setActiveFilter} isDesktop={isDesktop} tc={tc} />
      </View>

      {/* Notification list */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          Platform.OS !== "web" ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary[400]}
              colors={[colors.primary[400]]}
            />
          ) : undefined
        }
        contentContainerStyle={{
          paddingTop: 8,
          paddingBottom: 40,
          ...(isDesktop ? { width: "100%" } : {}),
        }}
      >
        {loading ? (
          <View style={{ alignItems: "center", paddingTop: 60 }}>
            <Spinner size={32} color={colors.primary[400]} />
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 14,
                fontFamily: "DMSans_400Regular",
                marginTop: 12,
              }}
            >
              Loading notifications...
            </Text>
          </View>
        ) : filteredNotifications.length === 0 ? (
          <EmptyState filter={activeFilter} tc={tc} />
        ) : (
          grouped.map((group) => (
            <View key={group.label}>
              <View style={{ paddingHorizontal: hPad, paddingTop: 20, paddingBottom: 8 }}>
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 12,
                    fontFamily: "DMSans_600SemiBold",
                    letterSpacing: 0.8,
                    textTransform: "uppercase",
                  }}
                >
                  {group.label}
                </Text>
              </View>

              {group.items.map((notification, index) => (
                <AnimatedNotificationRow
                  key={notification.id}
                  notification={notification}
                  index={index}
                  onPress={() => {
                    markRead(notification.id, !!notification.isServer);
                    if (notification.isServer) {
                      // Server-backed admin broadcasts → show the full
                      // detail modal. This handles both short and long
                      // bodies; the user can scroll long content, see
                      // who sent it and when, and the open is tracked
                      // for admin stats.
                      setOpenId(notification.id);
                    } else {
                      // Transaction-style client notifications still
                      // deep-link into the payment detail page.
                      router.push({ pathname: "/payment/detail", params: { id: notification.id } });
                    }
                  }}
                  onDelete={() => deleteNotification(notification.id, !!notification.isServer)}
                  isDesktop={isDesktop}
                  hPad={hPad}
                  tc={tc}
                  ts={ts}
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>

      {/* Full-content detail modal for server-backed notifications. */}
      <NotificationDetailModal
        notificationId={openId}
        onClose={() => setOpenId(null)}
      />
    </SafeAreaView>
  );
}

/* ================================================================
   Filter Tabs with animated underline
   ================================================================ */
function FilterTabs({
  active,
  onChange,
  isDesktop,
  tc,
}: {
  active: FilterTab;
  onChange: (f: FilterTab) => void;
  isDesktop: boolean;
  tc: ReturnType<typeof getThemeColors>;
}) {
  const underlineAnim = useRef(new Animated.Value(0)).current;
  const tabWidths = useRef<number[]>([]).current;
  const tabPositions = useRef<number[]>([]).current;
  const activeIndex = FILTER_TABS.findIndex((t) => t.key === active);

  useEffect(() => {
    if (tabPositions.length > 0 && tabWidths.length > 0 && tabPositions[activeIndex] != null) {
      Animated.spring(underlineAnim, {
        toValue: tabPositions[activeIndex],
        useNativeDriver: Platform.OS !== "web",
        tension: 300,
        friction: 30,
      }).start();
    }
  }, [activeIndex, tabPositions, tabWidths]);

  return (
    <View
      style={{
        flexDirection: "row",
        borderBottomWidth: 1,
        borderBottomColor: tc.dark.border,
        position: "relative",
      }}
    >
      {FILTER_TABS.map((tab, i) => {
        const isActive = active === tab.key;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            onLayout={(e) => {
              tabWidths[i] = e.nativeEvent.layout.width;
              tabPositions[i] = e.nativeEvent.layout.x;
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            style={({ pressed, hovered }: any) => ({
              paddingVertical: 12,
              paddingHorizontal: isDesktop ? 20 : 14,
              marginRight: isDesktop ? 8 : 2,
              opacity: pressed ? 0.7 : 1,
              ...(isWeb ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any) : {}),
            })}
          >
            <Text
              style={{
                color: isActive ? colors.primary[400] : tc.textMuted,
                fontSize: isDesktop ? 14 : 13,
                fontFamily: isActive ? "DMSans_600SemiBold" : "DMSans_500Medium",
                letterSpacing: -0.1,
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}

      {tabWidths[activeIndex] != null && (
        <Animated.View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            height: 2,
            width: tabWidths[activeIndex] || 60,
            backgroundColor: colors.primary[400],
            borderRadius: 1,
            transform: [{ translateX: underlineAnim }],
          }}
        />
      )}
    </View>
  );
}

/* ================================================================
   Animated Notification Row
   ================================================================ */
function AnimatedNotificationRow({
  notification,
  index,
  onPress,
  onDelete,
  isDesktop,
  hPad,
  tc,
  ts,
}: {
  notification: Notification;
  index: number;
  onPress: () => void;
  onDelete: () => void;
  isDesktop: boolean;
  hPad: number;
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const swipeAnim = useRef(new Animated.Value(0)).current;
  const [swiped, setSwiped] = useState(false);

  useEffect(() => {
    const delay = index * 60;
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 350,
        delay,
        useNativeDriver: Platform.OS !== "web",
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 350,
        delay,
        useNativeDriver: Platform.OS !== "web",
      }),
    ]).start();
  }, []);

  const handleSwipeStart = useCallback(() => {
    if (isWeb) return;
    if (!swiped) {
      setSwiped(true);
      Animated.spring(swipeAnim, {
        toValue: -80,
        useNativeDriver: Platform.OS !== "web",
        tension: 200,
        friction: 25,
      }).start();
    } else {
      setSwiped(false);
      Animated.spring(swipeAnim, {
        toValue: 0,
        useNativeDriver: Platform.OS !== "web",
        tension: 200,
        friction: 25,
      }).start();
    }
  }, [swiped]);

  // Priority indicator color
  const priorityColor =
    notification.isServer && notification.serverCategory === "security"
      ? colors.warning
      : notification.isServer && notification.serverCategory === "maintenance"
        ? colors.warning
        : null;

  return (
    <Animated.View
      style={{
        opacity: fadeAnim,
        transform: [{ translateY: slideAnim }],
        position: "relative",
        overflow: "hidden",
      }}
    >
      {!isWeb && (
        <View
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: 80,
            backgroundColor: colors.error,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Pressable onPress={onDelete} accessibilityRole="button" accessibilityLabel="Delete notification">
            <Ionicons name="trash-outline" size={22} color="#FFFFFF" />
          </Pressable>
        </View>
      )}

      <Animated.View
        style={{
          transform: !isWeb ? [{ translateX: swipeAnim }] : [],
          backgroundColor: tc.dark.bg,
        }}
      >
        <Pressable
          onPress={onPress}
          onLongPress={!isWeb ? handleSwipeStart : undefined}
          accessibilityRole="button"
          accessibilityLabel={`${notification.title}: ${notification.body}`}
          style={({ pressed, hovered }: any) => ({
            flexDirection: "row",
            alignItems: "flex-start",
            gap: isDesktop ? 18 : 14,
            paddingHorizontal: hPad,
            paddingVertical: isDesktop ? 18 : 14,
            backgroundColor: isWeb && hovered
              ? tc.dark.card
              : !notification.read
                ? "rgba(16, 185, 129, 0.08)"
                : "transparent",
            borderBottomWidth: 1,
            borderBottomColor: tc.dark.border,
            borderLeftWidth: 3,
            borderLeftColor: !notification.read ? colors.primary[400] : "transparent",
            opacity: pressed ? 0.85 : 1,
            ...(isWeb ? ({ cursor: "pointer", transition: "background-color 0.2s ease" } as any) : {}),
          })}
        >
          {/* Type icon */}
          <View style={{ opacity: notification.read ? 0.5 : 1 }}>
            <NotificationIcon type={notification.type} isDesktop={isDesktop} />
          </View>

          {/* Content */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 4,
                gap: 8,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                <Text
                  style={{
                    color: notification.read ? tc.textSecondary : tc.textPrimary,
                    fontSize: isDesktop ? 15 : 14,
                    fontFamily: notification.read ? "DMSans_500Medium" : "DMSans_600SemiBold",
                    letterSpacing: -0.2,
                    flexShrink: 1,
                  }}
                  numberOfLines={1}
                >
                  {notification.title}
                </Text>
                {!notification.read && (
                  <View
                    style={{
                      backgroundColor: colors.primary[500],
                      borderRadius: 4,
                      paddingHorizontal: 5,
                      paddingVertical: 1,
                    }}
                  >
                    <Text
                      style={{
                        color: "#FFFFFF",
                        fontSize: 9,
                        fontFamily: "DMSans_700Bold",
                        letterSpacing: 0.5,
                      }}
                    >
                      NEW
                    </Text>
                  </View>
                )}
                {/* Server notification category badge */}
                {notification.isServer && notification.serverCategory && (
                  <View
                    style={{
                      backgroundColor:
                        notification.serverCategory === "security"
                          ? "rgba(245, 158, 11, 0.15)"
                          : notification.serverCategory === "maintenance"
                            ? "rgba(245, 158, 11, 0.15)"
                            : notification.serverCategory === "promotion"
                              ? "rgba(16, 185, 129, 0.15)"
                              : "rgba(59, 130, 246, 0.15)",
                      borderRadius: 4,
                      paddingHorizontal: 6,
                      paddingVertical: 1,
                    }}
                  >
                    <Text
                      style={{
                        color:
                          notification.serverCategory === "security" || notification.serverCategory === "maintenance"
                            ? colors.warning
                            : notification.serverCategory === "promotion"
                              ? colors.primary[400]
                              : colors.info,
                        fontSize: 9,
                        fontFamily: "DMSans_600SemiBold",
                        letterSpacing: 0.3,
                        textTransform: "uppercase",
                      }}
                    >
                      {notification.serverCategory}
                    </Text>
                  </View>
                )}
              </View>

              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 12,
                    fontFamily: "DMSans_400Regular",
                  }}
                >
                  {formatTime(notification.timestamp)}
                </Text>

                {isWeb && (
                  <View
                    // @ts-ignore web-only onClick
                    onClick={(e: any) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                    accessibilityLabel="Delete notification"
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      alignItems: "center" as const,
                      justifyContent: "center" as const,
                      cursor: "pointer",
                    } as any}
                  >
                    <Ionicons name="trash-outline" size={15} color={colors.error} />
                  </View>
                )}
              </View>
            </View>

            <Text
              style={{
                color: notification.read ? tc.textMuted : tc.textSecondary,
                fontSize: 13,
                fontFamily: "DMSans_400Regular",
                lineHeight: 19,
              }}
              numberOfLines={2}
            >
              {notification.body}
            </Text>

            {notification.amount ? (
              <View
                style={{
                  marginTop: 8,
                  alignSelf: "flex-start",
                  backgroundColor: notification.amount.startsWith("+")
                    ? "rgba(16, 185, 129, 0.1)"
                    : "rgba(239, 68, 68, 0.08)",
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 8,
                }}
              >
                <Text
                  style={{
                    color: notification.amount.startsWith("+") ? colors.success : colors.error,
                    fontSize: 12,
                    fontFamily: "DMSans_600SemiBold",
                    letterSpacing: -0.2,
                  }}
                >
                  {notification.amount}
                </Text>
              </View>
            ) : null}
          </View>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

/* ================================================================
   Notification Icon
   ================================================================ */
function NotificationIcon({ type, isDesktop }: { type: NotificationType; isDesktop: boolean }) {
  const { name, color, bg } = getTypeIcon(type);
  const size = isDesktop ? 46 : 42;
  const iconSize = isDesktop ? 22 : 20;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 14,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
        marginTop: 2,
        borderWidth: 1,
        borderColor: "rgba(255, 255, 255, 0.04)",
      }}
    >
      <Ionicons name={name as any} size={iconSize} color={color} />
    </View>
  );
}

/* ================================================================
   Empty State
   ================================================================ */
function EmptyState({
  filter,
  tc,
}: {
  filter: FilterTab;
  tc: ReturnType<typeof getThemeColors>;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: Platform.OS !== "web",
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 100,
        friction: 12,
        useNativeDriver: Platform.OS !== "web",
      }),
    ]).start();
  }, [filter]);

  const filterLabel =
    filter === "all"
      ? "notifications"
      : filter === "transaction"
        ? "transaction notifications"
        : filter === "security"
          ? "security alerts"
          : "system updates";

  return (
    <Animated.View
      style={{
        alignItems: "center",
        justifyContent: "center",
        paddingTop: 100,
        paddingHorizontal: 40,
        opacity: fadeAnim,
        transform: [{ scale: scaleAnim }],
      }}
    >
      {/* Brand EmptyNoNotifications illustration — bell outline with
          emerald "zzz". Replaces the prior ring + bell Ionicon composite. */}
      <View style={{ marginBottom: 24, opacity: 0.9 }}>
        <EmptyNoNotifications size={140} />
      </View>

      <Text
        style={{
          color: tc.textPrimary,
          fontSize: 18,
          fontFamily: "DMSans_600SemiBold",
          marginBottom: 8,
          textAlign: "center",
          letterSpacing: -0.3,
        }}
      >
        All caught up!
      </Text>
      <Text
        style={{
          color: tc.textSecondary,
          fontSize: 14,
          fontFamily: "DMSans_400Regular",
          textAlign: "center",
          lineHeight: 22,
          maxWidth: 280,
        }}
      >
        You have no {filterLabel} right now.{"\n"}New ones will appear here automatically.
      </Text>
    </Animated.View>
  );
}
