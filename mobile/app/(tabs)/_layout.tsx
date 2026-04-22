import { Tabs } from "expo-router";
import { View, Platform, useWindowDimensions, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRef, useEffect } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, getThemeColors } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { usePendingDeposits } from "../../src/components/DepositTracker";

const isWeb = Platform.OS === "web";
const useNative = Platform.OS !== "web";

/** Pulsing indicator dot for pending deposits · rendered over the wallet icon. */
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
        top: -2,
        right: -2,
        width: 9,
        height: 9,
        borderRadius: 4.5,
        backgroundColor: "#F59E0B",
        opacity: pulseAnim,
        zIndex: 10,
      }}
    />
  );
}

/** Standalone icon wrapper · React Navigation calls this once per item and
 * handles the focused / unfocused cross-fade at the tab-item level, so we
 * do NOT stack an icon + label inside it (doing so used to cause the whole
 * stack to render twice on web, doubling the effective tab-bar height and
 * clipping the label). Labels are rendered via the separate `tabBarLabel`
 * prop below, which is the idiomatic RN-Navigation pattern. */
function TabIconOnly({
  name,
  color,
  focused,
  showBadge,
  size = 24,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  focused: boolean;
  showBadge?: boolean;
  size?: number;
}) {
  const scaleAnim = useRef(new Animated.Value(focused ? 1.05 : 1)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: focused ? 1.05 : 1,
      tension: 300,
      friction: 15,
      useNativeDriver: useNative,
    }).start();
  }, [focused]);

  return (
    <Animated.View
      style={{
        transform: [{ scale: scaleAnim }],
        position: "relative",
        alignItems: "center",
        justifyContent: "center",
        width: size + 8,
        height: size + 4,
      }}
    >
      {showBadge && <PendingBadge />}
      <Ionicons name={name} size={size} color={color} />
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
  const { width } = useWindowDimensions();

  // Responsive sizing · phones (< 600), small tablets (< 900), and web phone
  // viewports all need enough vertical room for icon + label without clipping.
  const isSmallPhone = width < 380;
  // iOS renders its own ~34 px home-indicator bar; Android gesture-nav has a
  // similar inset via useSafeAreaInsets. 3-button Android has insets.bottom = 0.
  const safeBottom = isWeb
    ? 14
    : Platform.OS === "ios"
      ? Math.max(insets.bottom, 10)
      : Math.max(insets.bottom, 8);
  // Content area above the safe bottom · icon (24) + gap (4) + label (~14)
  // + top/bottom breathing (10). 62 px content fits 24 + 4 + 14 = 42 of text
  // + 20 padding comfortably on every device.
  const contentHeight = isSmallPhone ? 58 : 64;
  const tabBarHeight = contentHeight + safeBottom;

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
              paddingBottom: safeBottom,
              paddingTop: 8,
              // Give web phone viewports a comfortable side gutter; native
              // phones hug the edges so touch targets stay large.
              paddingHorizontal: isWeb ? 24 : 0,
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
                    shadowOpacity: 0.2,
                    shadowRadius: 10,
                    elevation: 12,
                  }) as any,
            },
        tabBarActiveTintColor: colors.primary[400],
        tabBarInactiveTintColor: isDark ? "#7A8FA5" : "#94A3B8",
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: "DMSans_600SemiBold",
          letterSpacing: 0.2,
          marginTop: 2,
          marginBottom: 0,
          // Crucial: `includeFontPadding: false` removes the baseline padding
          // Android adds around text, so descender letters (g, y, p) aren't
          // clipped by the tab-bar bottom edge.
          includeFontPadding: false,
        },
        tabBarItemStyle: {
          flex: 1,
          paddingVertical: 0,
          paddingTop: 2,
          paddingBottom: 2,
          justifyContent: "center" as const,
          alignItems: "center" as const,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <TabIconOnly
              name={focused ? "home" : "home-outline"}
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
            <TabIconOnly
              name={focused ? "send" : "send-outline"}
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
            <TabIconOnly
              name={focused ? "wallet" : "wallet-outline"}
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
          title: "Me",
          tabBarIcon: ({ color, focused }) => (
            <TabIconOnly
              name={focused ? "person" : "person-outline"}
              color={color}
              focused={focused}
            />
          ),
        }}
      />
    </Tabs>
  );
}
