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
 * clipping the label). Labels come from the separate `tabBarLabel` prop.
 * Icon is rendered at its exact size · no bounding container · so the
 * React Navigation tab-item layout can compute the label position correctly
 * (previously a 28 px container for a 24 px icon nudged the label past the
 * tab-bar bottom edge, clipping it). */
function TabIconOnly({
  name,
  color,
  focused,
  showBadge,
  size = 22,
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
        // No explicit width/height · let the icon define its own box.
        // Including the badge requires `overflow: visible` which is the
        // default on View.
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

  // Vertical budget (tightened 2026-04-25 · user feedback that the
  // previous 70 px content height read as bulky / non-modern):
  //
  //   icon (22)  +  gap (3)  +  label line-box (14)  =  39 px content
  //   + paddingTop (6)                                =  6 px top
  //   + paddingBottom (6)                             =  6 px bottom
  //   + safeBottom (system nav inset)                 =  variable
  //   --------------------------------------------------
  //   total                                           ≈ 51 px + safeBottom
  //
  // 56 px content (52 on small phones) gives a 5-7 px safety margin above
  // the strict minimum, which keeps the 11-pt label readable on Android's
  // metric rounding without the previous "fat" feel. iOS is forgiving at
  // any value >= 49.
  const isSmallPhone = width < 380;
  // Safe-area handling on bottom tabs · 2026-04-24 iteration.
  //
  // React Navigation v7 applies the `tabBarStyle` we pass it verbatim —
  // it does NOT auto-add `paddingBottom: insets.bottom` for us (that's
  // the v6-and-earlier behaviour a lot of Stack Overflow threads still
  // describe). So we must explicitly account for the inset:
  //
  //   • Grow the tab bar's height by `insets.bottom` so the bar
  //     physically sits above the system nav / gesture area.
  //   • Pad the bottom by the same `insets.bottom` so the label row
  //     lands at the top of that extra space (icon row above, label
  //     row below, safe-area gutter at the very bottom).
  //
  // Earlier fix attempts:
  //   (a) `Math.max(insets.bottom, 8)` floor  → created a phantom 8px
  //       empty strip under labels on 3-button Android (`insets.bottom=0`).
  //   (b) `paddingBottom: 0` + shrunk height  → pushed tabs UNDER the
  //       system nav on devices with non-zero `insets.bottom`.
  //
  // The correct fix is: honour the real inset exactly (no floor, no
  // override) — with a tiny 6 px *minimum* on native so the last label
  // keeps a visible gutter above the Android system nav / iOS home
  // indicator even when the OS reports `insets.bottom = 0` (standard
  // 3-button Android). Min-only, not additive: if the device reports
  // a real 20-34 px gesture inset, that's what we use (not 26-40 px).
  // Web has no system nav so we add 12 px for viewport breathing room.
  const safeBottom = isWeb ? 8 : Math.max(insets.bottom, 4);
  const contentHeight = isSmallPhone ? 52 : 56;
  const tabBarHeight = contentHeight + safeBottom;
  const tabBarPaddingBottom = safeBottom;

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
              // `borderTopWidth: 0` removes the 1 px hairline above the
              // tabs that read as a dead "divider strip" on the APK.
              // The existing drop-shadow (Android elevation + iOS
              // shadow*) already separates the bar from the content.
              borderTopWidth: 0,
              height: tabBarHeight,
              paddingBottom: tabBarPaddingBottom,
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
          fontSize: 10.5,
          lineHeight: 13,
          fontFamily: "DMSans_600SemiBold",
          letterSpacing: 0.15,
          // Tightened gap to match the 56 px content height (was 70 px,
          // user reported the bar felt bulky). 3 px below a 22 px icon
          // is the iOS Human Interface default.
          marginTop: 3,
          marginBottom: 0,
          paddingBottom: 1,
          includeFontPadding: false,
        },
        tabBarIconStyle: {
          marginTop: 0,
          marginBottom: 0,
        },
        tabBarItemStyle: {
          flex: 1,
          paddingVertical: 0,
          justifyContent: "flex-start" as const,
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
