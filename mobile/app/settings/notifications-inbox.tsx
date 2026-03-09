import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, shadows } from "../../src/constants/theme";

/* ─── Types ─── */
interface Notification {
  id: number;
  type: "transaction" | "deposit" | "security" | "system";
  title: string;
  body: string;
  time: string;
  read: boolean;
}

/* ─── Mock data ─── */
const INITIAL_NOTIFICATIONS: Notification[] = [
  {
    id: 1,
    type: "transaction",
    title: "Payment Sent",
    body: "KSh 5,000 sent to Safaricom Paybill 174379",
    time: "2 min ago",
    read: false,
  },
  {
    id: 2,
    type: "deposit",
    title: "Deposit Confirmed",
    body: "0.05 BTC deposit has been credited to your wallet",
    time: "1 hour ago",
    read: false,
  },
  {
    id: 3,
    type: "security",
    title: "New Login",
    body: "New login detected from Chrome on Windows",
    time: "3 hours ago",
    read: true,
  },
  {
    id: 4,
    type: "system",
    title: "Welcome to CryptoPay!",
    body: "Your account is ready. Start by depositing crypto to your wallet.",
    time: "1 day ago",
    read: true,
  },
];

/* ─── Icon map by notification type ─── */
function getTypeIcon(type: Notification["type"]): {
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

const isWeb = Platform.OS === "web";

export default function NotificationsInboxScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [notifications, setNotifications] = useState<Notification[]>(INITIAL_NOTIFICATIONS);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const markRead = useCallback((id: number) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }, []);

  const isDesktop = isWeb && width >= 900;
  const maxWidth = isDesktop ? 1100 : undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.dark.bg }}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 20,
          paddingTop: isWeb ? 16 : 8,
          paddingBottom: 16,
          borderBottomWidth: 1,
          borderBottomColor: colors.dark.border,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          {/* Back button */}
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={({ pressed, hovered }: any) => ({
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: isWeb && hovered ? colors.dark.elevated : colors.dark.card,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: isWeb && hovered ? colors.glass.borderStrong : colors.glass.border,
              opacity: pressed ? 0.85 : 1,
              ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
            })}
          >
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text
            style={{
              color: colors.textPrimary,
              fontSize: 20,
              fontFamily: "Inter_700Bold",
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
                  fontFamily: "Inter_600SemiBold",
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
              ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
            })}
          >
            <Text
              style={{
                color: colors.primary[400],
                fontSize: 13,
                fontFamily: "Inter_600SemiBold",
              }}
            >
              Mark all read
            </Text>
          </Pressable>
        )}
      </View>

      {/* Notification list */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingVertical: 8,
          alignItems: isDesktop ? "center" : undefined,
        }}
      >
        {notifications.length === 0 ? (
          <EmptyState />
        ) : (
          <View style={{ width: "100%", maxWidth, alignSelf: isDesktop ? "center" : undefined }}>
            {notifications.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onPress={() => markRead(notification.id)}
                isDesktop={isDesktop}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─── Notification Row ─── */
function NotificationRow({
  notification,
  onPress,
  isDesktop,
}: {
  notification: Notification;
  onPress: () => void;
  isDesktop: boolean;
}) {
  const { name, color, bg } = getTypeIcon(notification.type);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${notification.title}: ${notification.body}`}
      style={({ pressed, hovered }: any) => ({
        flexDirection: "row",
        alignItems: "flex-start",
        gap: isDesktop ? 18 : 14,
        paddingHorizontal: isDesktop ? 28 : 20,
        paddingVertical: isDesktop ? 20 : 16,
        backgroundColor: isWeb && hovered
          ? colors.dark.card
          : !notification.read
            ? "rgba(16, 185, 129, 0.03)"
            : "transparent",
        borderBottomWidth: 1,
        borderBottomColor: colors.dark.border,
        opacity: pressed ? 0.85 : 1,
        ...(isWeb
          ? { cursor: "pointer", transition: "background-color 0.15s ease" } as any
          : {}),
      })}
    >
      {/* Icon */}
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          backgroundColor: bg,
          alignItems: "center",
          justifyContent: "center",
          marginTop: 2,
        }}
      >
        <Ionicons name={name as any} size={20} color={color} />
      </View>

      {/* Content */}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
            <Text
              style={{
                color: notification.read ? colors.textSecondary : colors.textPrimary,
                fontSize: 15,
                fontFamily: notification.read ? "Inter_500Medium" : "Inter_600SemiBold",
                letterSpacing: -0.2,
              }}
              numberOfLines={1}
            >
              {notification.title}
            </Text>
            {!notification.read && (
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: colors.primary[400],
                }}
              />
            )}
          </View>
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 12,
              fontFamily: "Inter_400Regular",
              marginLeft: 8,
            }}
          >
            {notification.time}
          </Text>
        </View>
        <Text
          style={{
            color: notification.read ? colors.textMuted : colors.textSecondary,
            fontSize: 13,
            fontFamily: "Inter_400Regular",
            lineHeight: 19,
          }}
          numberOfLines={2}
        >
          {notification.body}
        </Text>
      </View>
    </Pressable>
  );
}

/* ─── Empty state ─── */
function EmptyState() {
  return (
    <View
      style={{
        alignItems: "center",
        justifyContent: "center",
        paddingTop: 80,
        paddingHorizontal: 40,
      }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          backgroundColor: colors.dark.card,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 20,
          borderWidth: 1,
          borderColor: colors.glass.border,
        }}
      >
        <Ionicons name="notifications-off-outline" size={32} color={colors.textMuted} />
      </View>
      <Text
        style={{
          color: colors.textPrimary,
          fontSize: 18,
          fontFamily: "Inter_600SemiBold",
          marginBottom: 8,
          textAlign: "center",
        }}
      >
        No notifications
      </Text>
      <Text
        style={{
          color: colors.textSecondary,
          fontSize: 14,
          fontFamily: "Inter_400Regular",
          textAlign: "center",
          lineHeight: 21,
        }}
      >
        You're all caught up. New notifications will appear here.
      </Text>
    </View>
  );
}
