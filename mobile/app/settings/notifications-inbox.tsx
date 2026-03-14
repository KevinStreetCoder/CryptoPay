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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { paymentsApi, Transaction, getTxKesAmount, getTxRecipient } from "../../src/api/payments";
import * as NotifStore from "../../src/stores/notifications";
import { useToast } from "../../src/components/Toast";
import { normalizeError } from "../../src/utils/apiErrors";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";

/* ─── Types ─── */
type NotificationType = "transaction" | "deposit" | "security" | "system";
type FilterTab = "all" | "transaction" | "security" | "system";

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  timestamp: Date;
  read: boolean;
  amount?: string;
}

/* ─── Convert real transactions to notification items ─── */
function txToNotificationType(type: string): NotificationType {
  if (type === "DEPOSIT") return "deposit";
  if (type === "PAYBILL_PAYMENT" || type === "TILL_PAYMENT" || type === "SEND_MPESA" || type === "BUY" || type === "SELL")
    return "transaction";
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
  }));
}

/* ─── Filter tabs config ─── */
const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "transaction", label: "Transactions" },
  { key: "security", label: "Security" },
  { key: "system", label: "System" },
];

/* ─── Icon map by notification type ─── */
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
    case "system":
      return { name: "megaphone-outline", color: colors.textSecondary, bg: "rgba(136, 153, 170, 0.12)" };
    default:
      return { name: "notifications-outline", color: colors.textSecondary, bg: "rgba(136, 153, 170, 0.12)" };
  }
}

/* ─── Date grouping helpers ─── */
function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
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

/* ═══════════════════════════════════════════════════════════════════════════════
   Main Screen
   ═══════════════════════════════════════════════════════════════════════════════ */
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

  const loadNotifications = useCallback(async () => {
    try {
      await NotifStore.loadReadIds();
      const { data } = await paymentsApi.history();
      const txs = Array.isArray(data) ? data : data.results || [];
      setNotifications(transactionsToNotifications(txs));
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

  // Subscribe to store changes so we re-render when read state changes
  useEffect(() => {
    return NotifStore.subscribe(() => {
      // Rebuild notifications with fresh read state
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, read: NotifStore.isRead(n.id) }))
      );
      forceUpdate((c) => c + 1);
    });
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const isDesktop = isWeb && width >= 900;
  const hPad = isDesktop ? 48 : 20;

  // Filter notifications
  const filteredNotifications = notifications.filter((n) => {
    if (deletedIds.has(n.id)) return false;
    if (activeFilter === "all") return true;
    if (activeFilter === "transaction") return n.type === "transaction" || n.type === "deposit";
    return n.type === activeFilter;
  });

  const grouped = groupByDate(filteredNotifications);

  const markAllRead = useCallback(() => {
    const allIds = notifications.map((n) => n.id);
    NotifStore.markAllRead(allIds);
  }, [notifications]);

  const markRead = useCallback((id: string) => {
    NotifStore.markRead(id);
  }, []);

  const deleteNotification = useCallback((id: string) => {
    // Also mark as read when deleting
    NotifStore.markRead(id);
    setDeletedIds((prev) => new Set(prev).add(id));
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadNotifications();
    setRefreshing(false);
  }, [loadNotifications]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      {/* ── Header ── */}
      <View
        style={{
          paddingHorizontal: hPad,
          paddingTop: isWeb ? 16 : 8,
          paddingBottom: 0,
          ...(isDesktop
            ? { width: "100%" }
            : {}),
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
            {/* Back button */}
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
                ...(isWeb
                  ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any)
                  : {}),
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

          {/* Mark all as read */}
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
                ...(isWeb
                  ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any)
                  : {}),
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

        {/* ── Filter Tabs ── */}
        <FilterTabs
          active={activeFilter}
          onChange={setActiveFilter}
          isDesktop={isDesktop}
          tc={tc}
        />
      </View>

      {/* ── Notification list ── */}
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
          ...(isDesktop
            ? { width: "100%" }
            : {}),
        }}
      >
        {filteredNotifications.length === 0 ? (
          <EmptyState filter={activeFilter} tc={tc} />
        ) : (
          grouped.map((group) => (
            <View key={group.label}>
              {/* Date group header */}
              <View
                style={{
                  paddingHorizontal: hPad,
                  paddingTop: 20,
                  paddingBottom: 8,
                }}
              >
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

              {/* Notification rows */}
              {group.items.map((notification, index) => (
                <AnimatedNotificationRow
                  key={notification.id}
                  notification={notification}
                  index={index}
                  onPress={() => {
                    markRead(notification.id);
                    router.push({ pathname: "/payment/detail", params: { id: notification.id } });
                  }}
                  onDelete={() => deleteNotification(notification.id)}
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
    </SafeAreaView>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Filter Tabs with animated underline
   ═══════════════════════════════════════════════════════════════════════════════ */
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
              ...(isWeb
                ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any)
                : {}),
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

      {/* Animated underline */}
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

/* ═══════════════════════════════════════════════════════════════════════════════
   Animated Notification Row – staggered entrance + swipe/hover delete
   ═══════════════════════════════════════════════════════════════════════════════ */
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

  // Mobile swipe to delete
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

  return (
    <Animated.View
      style={{
        opacity: fadeAnim,
        transform: [{ translateY: slideAnim }],
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Delete background (mobile swipe) */}
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
            ...(isWeb
              ? ({
                  cursor: "pointer",
                  transition: "background-color 0.2s ease",
                } as any)
              : {}),
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

                {/* Desktop hover delete button — uses View+onClick to avoid nested <button> */}
                {isWeb && (
                  <View
                    // @ts-ignore — web-only onClick
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

            {/* Amount badge */}
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
                    color: notification.amount.startsWith("+")
                      ? colors.success
                      : colors.error,
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

/* ═══════════════════════════════════════════════════════════════════════════════
   Notification Icon
   ═══════════════════════════════════════════════════════════════════════════════ */
function NotificationIcon({
  type,
  isDesktop,
}: {
  type: NotificationType;
  isDesktop: boolean;
}) {
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

/* ═══════════════════════════════════════════════════════════════════════════════
   Empty State
   ═══════════════════════════════════════════════════════════════════════════════ */
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
      {/* Decorative icon container */}
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: 28,
          backgroundColor: tc.dark.card,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 24,
          borderWidth: 1,
          borderColor: tc.glass.border,
          position: "relative",
        }}
      >
        {/* Outer glow ring */}
        <View
          style={{
            position: "absolute",
            width: 120,
            height: 120,
            borderRadius: 36,
            borderWidth: 1,
            borderColor: "rgba(52, 211, 153, 0.06)",
          }}
        />
        <Ionicons name="notifications-off-outline" size={38} color={tc.textMuted} />
        {/* Small checkmark badge */}
        <View
          style={{
            position: "absolute",
            bottom: -4,
            right: -4,
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: colors.primary[500],
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 3,
            borderColor: tc.dark.bg,
          }}
        >
          <Ionicons name="checkmark" size={14} color="#FFFFFF" />
        </View>
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
