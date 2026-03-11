import { Tabs } from "expo-router";
import { View, Text, Platform, useWindowDimensions, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRef, useEffect } from "react";
import { colors, getThemeColors } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";

const isWeb = Platform.OS === "web";
const useNative = Platform.OS !== "web";

function TabIcon({
  name,
  color,
  focused,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  focused: boolean;
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
        paddingTop: 4,
        transform: [{ scale: scaleAnim }],
      }}
    >
      <View style={{ position: "relative" }}>
        {/* Glow behind focused icon */}
        {focused && (
          <Animated.View
            style={{
              position: "absolute",
              top: -2,
              left: -2,
              right: -2,
              bottom: -2,
              borderRadius: 18,
              backgroundColor: color + "15",
              opacity: bgOpacity,
            }}
          />
        )}
        <View
          style={{
            width: 48,
            height: 34,
            borderRadius: 17,
            backgroundColor: focused
              ? color + "18"
              : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={name} size={23} color={color} />
        </View>
      </View>
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
              height: isWeb ? 72 : 88,
              paddingBottom: isWeb ? 12 : 28,
              paddingTop: 8,
              paddingHorizontal: isWeb ? 40 : 0,
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
        tabBarLabelStyle: {
          fontFamily: "DMSans_600SemiBold",
          fontSize: 11,
          marginTop: -2,
          letterSpacing: 0.3,
        },
        tabBarItemStyle: {
          paddingVertical: 2,
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
              color={color}
              focused={focused}
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
              color={color}
              focused={focused}
            />
          ),
        }}
      />
    </Tabs>
  );
}
