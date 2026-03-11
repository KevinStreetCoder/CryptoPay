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
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";

/* ─── Types ─── */
type NotificationType = "transaction" | "deposit" | "security" | "system";
type FilterTab = "all" | "transaction" | "security" | "system";

interface Notification {
  id: number;
  type: NotificationType;
  title: string;
  body: string;
  timestamp: Date;
  read: boolean;
  amount?: string;
}

/* ─── Mock data ─── */
const now = new Date();
const today = (h: number, m: number) => {
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d;
};
const yesterday = (h: number, m: number) => {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  d.setHours(h, m, 0, 0);
  return d;
};
const daysAgo = (days: number, h: number, m: number) => {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  d.setHours(h, m, 0, 0);
  return d;
};

const INITIAL_NOTIFICATIONS: Notification[] = [
  {
    id: 1,
    type: "transaction",
    title: "Payment Sent",
    body: "KSh 5,000 sent to Safaricom Paybill 174379. Transaction confirmed on-chain.",
    timestamp: today(14, 32),
    read: false,
    amount: "-0.038 USDT",
  },
  {
    id: 2,
    type: "deposit",
    title: "Deposit Confirmed",
    body: "0.05 BTC deposit has been credited to your wallet. 3 network confirmations received.",
    timestamp: today(11, 15),
    read: false,
    amount: "+0.05 BTC",
  },
  {
    id: 3,
    type: "security",
    title: "New Login Detected",
    body: "New login from Chrome on Windows 11 in Nairobi, Kenya. If this wasn't you, secure your account immediately.",
    timestamp: today(9, 3),
    read: false,
  },
  {
    id: 4,
    type: "transaction",
    title: "Till Payment Successful",
    body: "KSh 1,250 paid to Java House Till 5274930. Enjoy your meal!",
    timestamp: yesterday(18, 45),
    read: true,
    amount: "-0.0096 USDT",
  },
  {
    id: 5,
    type: "deposit",
    title: "USDT Received",
    body: "150.00 USDT received from external wallet 0x7a3d...f2e1.",
    timestamp: yesterday(14, 20),
    read: true,
    amount: "+150.00 USDT",
  },
  {
    id: 6,
    type: "security",
    title: "Two-Factor Authentication Enabled",
    body: "2FA has been successfully enabled on your account. Your account is now more secure.",
    timestamp: yesterday(10, 0),
    read: true,
  },
  {
    id: 7,
    type: "system",
    title: "Scheduled Maintenance",
    body: "CryptoPay will undergo maintenance on March 15 from 2:00 AM - 4:00 AM EAT. Services may be briefly unavailable.",
    timestamp: daysAgo(2, 16, 30),
    read: true,
  },
  {
    id: 8,
    type: "transaction",
    title: "M-Pesa Send Completed",
    body: "KSh 10,000 sent to +254 712 *** 890 via M-Pesa. Recipient confirmed.",
    timestamp: daysAgo(3, 9, 12),
    read: true,
    amount: "-0.077 USDT",
  },
  {
    id: 9,
    type: "system",
    title: "New Feature: Crypto Charts",
    body: "You can now view interactive price charts for all supported cryptocurrencies. Check it out in the Wallet tab!",
    timestamp: daysAgo(4, 12, 0),
    read: true,
  },
  {
    id: 10,
    type: "system",
    title: "Welcome to CryptoPay!",
    body: "Your account is ready. Start by depositing crypto to your wallet and paying with crypto across Kenya.",
    timestamp: daysAgo(7, 8, 0),
    read: true,
  },
];

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

  const [notifications, setNotifications] = useState<Notification[]>(INITIAL_NOTIFICATIONS);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set());

  const unreadCount = notifications.filter((n) => !n.read).length;
  const isDesktop = isWeb && width >= 900;
  const maxW = isDesktop ? 1200 : undefined;
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
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const markRead = useCallback((id: number) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }, []);

  const deleteNotification = useCallback((id: number) => {
    setDeletedIds((prev) => new Set(prev).add(id));
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // Simulate network refresh
    setTimeout(() => {
      setRefreshing(false);
    }, 1200);
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      {/* ── Header ── */}
      <View
        style={{
          paddingHorizontal: hPad,
          paddingTop: isWeb ? 16 : 8,
          paddingBottom: 0,
          ...(isDesktop
            ? { maxWidth: maxW, width: "100%", alignSelf: "center" as const }
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
            ? { maxWidth: maxW, width: "100%", alignSelf: "center" as const }
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
                  onPress={() => markRead(notification.id)}
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
                ? "rgba(16, 185, 129, 0.03)"
                : "transparent",
            borderBottomWidth: 1,
            borderBottomColor: tc.dark.border,
            opacity: pressed ? 0.85 : 1,
            ...(isWeb
              ? ({
                  cursor: "pointer",
                  transition: "background-color 0.2s ease",
                } as any)
              : {}),
          })}
        >
          {/* Unread indicator dot */}
          {!notification.read && <UnreadDot />}

          {/* Type icon */}
          <NotificationIcon type={notification.type} isDesktop={isDesktop} />

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
              <Text
                style={{
                  color: notification.read ? tc.textSecondary : tc.textPrimary,
                  fontSize: isDesktop ? 15 : 14,
                  fontFamily: notification.read ? "DMSans_500Medium" : "DMSans_600SemiBold",
                  letterSpacing: -0.2,
                  flex: 1,
                }}
                numberOfLines={1}
              >
                {notification.title}
              </Text>

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

                {/* Desktop hover delete button */}
                {isWeb && (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Delete notification"
                    style={({ pressed, hovered }: any) => ({
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      alignItems: "center" as const,
                      justifyContent: "center" as const,
                      backgroundColor: hovered ? "rgba(239, 68, 68, 0.12)" : "transparent",
                      opacity: hovered ? 1 : 0,
                      ...(isWeb
                        ? ({
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          } as any)
                        : {}),
                    })}
                  >
                    <Ionicons name="trash-outline" size={15} color={colors.error} />
                  </Pressable>
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
            {notification.amount && (
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
            )}
          </View>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Unread Dot with pulse animation
   ═══════════════════════════════════════════════════════════════════════════════ */
function UnreadDot() {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.6,
          duration: 1200,
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: Platform.OS !== "web",
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, []);

  return (
    <View
      style={{
        position: "absolute",
        left: 8,
        top: "50%",
        marginTop: -4,
        width: 8,
        height: 8,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10,
      }}
    >
      <Animated.View
        style={{
          position: "absolute",
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: colors.primary[400],
          opacity: 0.3,
          transform: [{ scale: pulseAnim }],
        }}
      />
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: colors.primary[400],
        }}
      />
    </View>
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
