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
  // `useSafeAreaInsets` intentionally NOT called here — React Navigation
  // reads it itself when rendering the bottom tab bar, and stacking our
  // own padding on top of that produced the "phantom dark strip" bug.
  const { width } = useWindowDimensions();

  // Vertical budget (critical · the previous value clipped labels):
  //
  //   icon (24)  +  gap (4)  +  label line-box (16)  =  44 px content
  //   + paddingTop (8)                                =  8 px top
  //   + paddingBottom (8)                             =  8 px bottom
  //   + safeBottom (system nav inset)                 =  variable
  //   --------------------------------------------------
  //   total                                           ≈ 60 px + safeBottom
  //
  // We size at 70 px content (vs. 44 px strict minimum) so the 11-pt label
  // renders with comfortable ascender/descender clearance even when the
  // browser's font metric rounding pushes the line box up to ~16 px.
  const isSmallPhone = width < 380;
  // Root cause of the "phantom strip under the tabs" regression:
  // React Navigation's BottomTabBar automatically adds
  // `paddingBottom: useSafeAreaInsets().bottom` to its default style
  // AND we were also adding our own `paddingBottom: safeBottom` on top
  // of the style we supply — giving us *double* the inset on every
  // Android phone where `insets.bottom > 0`. The user saw that as a
  // dead dark band between the last label baseline and the system nav.
  //
  // Fix: we supply `paddingBottom: 0` on native and let React Navigation
  // own the safe-area handling. On web there is no system nav, so we
  // pad manually so the label isn't flush with the viewport edge.
  //
  // We also shrink the height to `contentHeight` only — no `+ safeBottom`.
  // RN's auto-inset pushes the icons up by `insets.bottom` visually.
  const webGutter = isWeb ? 12 : 0;
  const contentHeight = isSmallPhone ? 64 : 70;
  const tabBarHeight = contentHeight + webGutter;
  const tabBarPaddingBottom = webGutter;

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
          fontSize: 11,
          lineHeight: 14,
          fontFamily: "DMSans_600SemiBold",
          letterSpacing: 0.2,
          // Explicit gap between icon and label. Matches the 4 px designers
          // expect below the 24 px icon.
          marginTop: 4,
          marginBottom: 0,
          paddingBottom: 2,
          // `includeFontPadding: false` removes Android's default baseline
          // padding so descenders (g, y, p) don't clip.
          includeFontPadding: false,
        },
        // Icon sits at the top of the cell; the label flows naturally
        // below it with the 4 px gap set above. This removes the vertical
        // centering that was pushing the label past the tab-bar bottom
        // edge on web viewports.
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
