import { useEffect, useRef } from "react";
import { View, Text, Animated, Easing, Platform, Image, useWindowDimensions } from "react-native";
import { getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";

const useNative = Platform.OS !== "web";
const APP_LOGO = require("../../assets/icon.png");

export function LoadingScreen({ status }: { status?: string }) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const pulseAnim = useRef(new Animated.Value(0.7)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(20)).current;
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Entrance animation
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: useNative }),
      Animated.timing(slideUp, { toValue: 0, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: useNative }),
    ]).start();

    // Logo pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: useNative }),
        Animated.timing(pulseAnim, { toValue: 0.7, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: useNative }),
      ])
    ).start();

    // Spinner rotation
    Animated.loop(
      Animated.timing(rotateAnim, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: useNative })
    ).start();

    // Expanding ring 1
    Animated.loop(
      Animated.sequence([
        Animated.timing(ring1, { toValue: 1, duration: 2000, easing: Easing.out(Easing.cubic), useNativeDriver: useNative }),
        Animated.timing(ring1, { toValue: 0, duration: 0, useNativeDriver: useNative }),
      ])
    ).start();

    // Expanding ring 2 (staggered)
    setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(ring2, { toValue: 1, duration: 2000, easing: Easing.out(Easing.cubic), useNativeDriver: useNative }),
          Animated.timing(ring2, { toValue: 0, duration: 0, useNativeDriver: useNative }),
        ])
      ).start();
    }, 1000);
  }, []);

  const spin = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <Animated.View
      style={{
        flex: 1,
        backgroundColor: tc.dark.bg,
        alignItems: "center",
        justifyContent: "center",
        opacity: fadeIn,
      }}
    >
      {/* Background ambient glow */}
      <View style={{
        position: "absolute", width: 300, height: 300, borderRadius: 150,
        backgroundColor: tc.primary[500], opacity: 0.04,
        ...(Platform.OS === "web" ? { filter: "blur(80px)" } as any : {}),
      }} />

      {/* Expanding pulse rings */}
      <Animated.View style={{
        position: "absolute", width: 120, height: 120, borderRadius: 60,
        borderWidth: 1.5, borderColor: tc.primary[500],
        opacity: ring1.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] }),
        transform: [{ scale: ring1.interpolate({ inputRange: [0, 1], outputRange: [1, 2.5] }) }],
      }} />
      <Animated.View style={{
        position: "absolute", width: 120, height: 120, borderRadius: 60,
        borderWidth: 1, borderColor: tc.primary[500],
        opacity: ring2.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0] }),
        transform: [{ scale: ring2.interpolate({ inputRange: [0, 1], outputRange: [1, 2] }) }],
      }} />

      {/* Spinning ring */}
      <Animated.View style={{
        position: "absolute", width: 110, height: 110, borderRadius: 55,
        borderWidth: 2.5, borderColor: "rgba(16, 185, 129, 0.08)",
        borderTopColor: tc.primary[500] + "80",
        borderRightColor: tc.primary[500] + "30",
        transform: [{ rotate: spin }],
      }} />

      {/* App Logo — using actual icon */}
      <Animated.View style={{
        transform: [
          { translateY: slideUp },
          { scale: pulseAnim.interpolate({ inputRange: [0.7, 1], outputRange: [0.95, 1.05] }) },
        ],
      }}>
        <Image
          source={APP_LOGO}
          style={{
            width: 72, height: 72, borderRadius: 20,
            ...(Platform.OS === "web"
              ? { boxShadow: "0 12px 32px rgba(16, 185, 129, 0.4)" }
              : {
                  shadowColor: "#10B981",
                  shadowOffset: { width: 0, height: 8 },
                  shadowOpacity: 0.4,
                  shadowRadius: 20,
                  elevation: 12,
                }) as any,
          }}
          resizeMode="cover"
        />
      </Animated.View>

      {/* Brand name */}
      <Animated.View style={{ transform: [{ translateY: slideUp }], marginTop: 24, alignItems: "center" }}>
        <Text style={{ color: tc.textPrimary, fontSize: 26, fontWeight: "700", letterSpacing: -0.5 }}>
          CryptoPay
        </Text>
        <Text style={{ color: tc.textMuted, fontSize: 14, fontWeight: "400", marginTop: 6, textAlign: "center" }}>
          Pay bills with crypto, instantly.
        </Text>
      </Animated.View>

      {/* Loading indicator */}
      <Animated.View style={{ marginTop: 40, alignItems: "center", opacity: fadeIn, transform: [{ translateY: slideUp }] }}>
        {/* Progress bar */}
        <View style={{
          width: isMobile ? 200 : 240, height: 3, borderRadius: 2,
          backgroundColor: "rgba(16, 185, 129, 0.12)", overflow: "hidden",
        }}>
          <Animated.View style={{
            width: "35%", height: "100%", borderRadius: 2,
            backgroundColor: tc.primary[500],
            transform: [{
              translateX: rotateAnim.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [-80, isMobile ? 120 : 160, -80],
              }),
            }],
          }} />
        </View>

        {/* Status text */}
        <Text style={{
          color: tc.textMuted, fontSize: 13, fontWeight: "400",
          marginTop: 16, opacity: 0.7, textAlign: "center",
        }}>
          {status || "Opening CryptoPay..."}
        </Text>

        {/* Version */}
        <Text style={{
          color: tc.textMuted, fontSize: 11, fontWeight: "400",
          marginTop: 8, opacity: 0.3,
        }}>
          v1.0.0
        </Text>
      </Animated.View>
    </Animated.View>
  );
}
