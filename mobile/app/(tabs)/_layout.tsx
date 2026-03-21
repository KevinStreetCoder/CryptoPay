import { Tabs } from "expo-router";
import { View, Text, Platform, useWindowDimensions, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRef, useEffect } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, getThemeColors } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { usePendingDeposits } from "../../src/components/DepositTracker";

const isWeb = Platform.OS === "web";
const useNative = Platform.OS !== "web";

/** Pulsing indicator dot for pending deposits */
function PendingBadge() {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 900,
          useNativeDriver: useNative,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: useNative,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  return (
    <Animated.View
      style={{
        position: "absolute",
        top: 2,
        right: 8,
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: "#F59E0B",
        opacity: pulseAnim,
        zIndex: 10,
      }}
    />
  );
}

function TabIcon({
  name,
  label,
  color,
  focused,
  showBadge,
}: {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  focused: boolean;
  showBadge?: boolean;
}) {
  const scaleAnim = useRef(new Animated.Value(focused ? 1 : 0.95)).current;
  const bgOpacity = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: focused ? 1 : 0.95,
        tension: 300,
        friction: 15,
        useNativeDriver: useNative,
      }),
      Animated.timing(bgOpacity, {
        toValue: focused ? 1 : 0,
        duration: 200,
        useNativeDriver: useNative,
      }),
    ]).start();
  }, [focused]);

  return (
    <Animated.View
      style={{
        alignItems: "center",
        justifyContent: "center",
        transform: [{ scale: scaleAnim }],
        position: "relative",
        paddingHorizontal: 14,
        paddingVertical: 6,
        minWidth: 60,
        minHeight: 44,
        flex: 1,
      }}
    >
      {/* Pulsing badge for pending deposits */}
      {showBadge && <PendingBadge />}
      {/* Full pill background covering icon + label */}
      {focused && (
        <Animated.View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: 16,
            backgroundColor: color + "18",
            opacity: bgOpacity,
          }}
        />
      )}
      <Ionicons name={name} size={22} color={color} />
      <Text
        numberOfLines={1}
        ellipsizeMode="clip"
        style={{
          color,
          fontSize: 11,
          fontFamily: focused ? "DMSans_600SemiBold" : "DMSans_500Medium",
          marginTop: 2,
          letterSpacing: 0.3,
          textAlign: "center",
          minWidth: 40,
        }}
      >
        {label}
      </Text>
    </Animated.View>
  );
}

function useIsDesktop() {
  if (!isWeb) return false;
  const { width } = useWindowDimensions();
  return width >= 900;
}

export default function TabLayout() {
  const isDesktop = useIsDesktop();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const { hasPending: hasPendingDeposits } = usePendingDeposits();
  const insets = useSafeAreaInsets();

  // On Android, insets.bottom is 0 for 3-button nav and small for gesture nav.
  // We only need minimal padding — never add extra space above the system nav buttons.
  const bottomPadding = isWeb ? 12 : Platform.OS === "android" ? insets.bottom : insets.bottom;
  const tabBarHeight = (isWeb ? 72 : Platform.OS === "android" ? 56 : 88) + bottomPadding;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: isDesktop
          ? { display: "none" }
          : {
              backgroundColor: isDark
                ? "rgba(12, 26, 46, 0.97)"
                : "rgba(255, 255, 255, 0.97)",
              borderTopColor: isDark
                ? "rgba(255, 255, 255, 0.06)"
                : "rgba(0, 0, 0, 0.06)",
              borderTopWidth: 1,
              height: tabBarHeight,
              paddingBottom: bottomPadding,
              paddingTop: Platform.OS === "android" ? 4 : 6,
              paddingHorizontal: isWeb ? 40 : 0,
              position: Platform.OS === "android" ? "absolute" as const : "relative" as const,
              bottom: Platform.OS === "android" ? 0 : undefined,
              left: Platform.OS === "android" ? 0 : undefined,
              right: Platform.OS === "android" ? 0 : undefined,
              ...(isWeb
                ? {
                    boxShadow: isDark
                      ? "0 -4px 20px rgba(0,0,0,0.35)"
                      : "0 -2px 12px rgba(0,0,0,0.08)",
                    width: "100%",
                    backdropFilter: "blur(20px)",
                    WebkitBackdropFilter: "blur(20px)",
                  }
                : {
                    shadowColor: "#000",
                    shadowOffset: { width: 0, height: -3 },
                    shadowOpacity: 0.25,
                    shadowRadius: 10,
                    elevation: 16,
                  }) as any,
            },
        tabBarActiveTintColor: colors.primary[400],
        tabBarInactiveTintColor: isDark ? "#556B82" : "#94A3B8",
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontFamily: "DMSans_500Medium",
          fontSize: 11,
        },
        tabBarItemStyle: {
          flex: 1,
          paddingVertical: 0,
          justifyContent: "center" as const,
          alignItems: "center" as const,
          height: "100%" as any,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              name={focused ? "home" : "home-outline"}
              label="Home"
              color={color}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="pay"
        options={{
          title: "Pay",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              name={focused ? "send" : "send-outline"}
              label="Pay"
              color={color}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: "Wallet",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              name={focused ? "wallet" : "wallet-outline"}
              label="Wallet"
              color={color}
              focused={focused}
              showBadge={hasPendingDeposits}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              name={focused ? "person" : "person-outline"}
              label="Me"
              color={color}
              focused={focused}
            />
          ),
        }}
      />
    </Tabs>
  );
}
