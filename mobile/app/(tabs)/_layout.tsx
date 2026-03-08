import { Tabs } from "expo-router";
import { View, Platform, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/theme";

const isWeb = Platform.OS === "web";

function TabIcon({
  name,
  color,
  focused,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  focused: boolean;
}) {
  return (
    <View
      style={{
        alignItems: "center",
        justifyContent: "center",
        paddingTop: 4,
      }}
    >
      <View
        style={{
          width: 44,
          height: 32,
          borderRadius: 16,
          backgroundColor: focused
            ? "rgba(16, 185, 129, 0.12)"
            : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={name} size={24} color={color} />
      </View>
    </View>
  );
}

function useIsDesktop() {
  if (!isWeb) return false;
  const { width } = useWindowDimensions();
  return width >= 900;
}

export default function TabLayout() {
  const isDesktop = useIsDesktop();

  return (
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: isDesktop
            ? { display: "none" }
            : {
                backgroundColor: "rgba(12, 26, 46, 0.95)",
                borderTopColor: "rgba(255, 255, 255, 0.06)",
                borderTopWidth: 1,
                height: isWeb ? 72 : 88,
                paddingBottom: isWeb ? 12 : 28,
                paddingTop: 8,
                paddingHorizontal: isWeb ? 40 : 0,
                ...(isWeb
                  ? { boxShadow: "0 -3px 10px rgba(0,0,0,0.25)", width: "100%" }
                  : {
                      shadowColor: "#000",
                      shadowOffset: { width: 0, height: -3 },
                      shadowOpacity: 0.25,
                      shadowRadius: 10,
                      elevation: 16,
                    }) as any,
              },
          tabBarActiveTintColor: colors.primary[400],
          tabBarInactiveTintColor: "#556B82",
          tabBarLabelStyle: {
            fontFamily: "Inter_600SemiBold",
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
