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
  label,
  color,
  focused,
}: {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
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
        transform: [{ scale: scaleAnim }],
        position: "relative",
        paddingHorizontal: 14,
        paddingVertical: 6,
      }}
    >
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
        style={{
          color,
          fontSize: 11,
          fontFamily: focused ? "DMSans_600SemiBold" : "DMSans_500Medium",
          marginTop: 2,
          letterSpacing: 0.3,
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
        tabBarShowLabel: false,
        tabBarItemStyle: {
          paddingVertical: 4,
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
              label="Profile"
              color={color}
              focused={focused}
            />
          ),
        }}
      />
    </Tabs>
  );
}
