import { View, Text, Pressable, Platform, useWindowDimensions, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import * as Haptics from "expo-haptics";
import { Button } from "../../src/components/Button";
import { useToast } from "../../src/components/Toast";
import { colors, shadows, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";

function AnimatedCheckmark() {
  const scale = useRef(new Animated.Value(0)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const glowScale = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    // Checkmark spring bounce in
    Animated.spring(scale, {
      toValue: 1,
      friction: 4,
      tension: 80,
      useNativeDriver: Platform.OS !== "web",
    }).start();

    // Glow pulse loop
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(glowOpacity, {
            toValue: 0.6,
            duration: 1500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: Platform.OS !== "web",
          }),
          Animated.timing(glowScale, {
            toValue: 1.3,
            duration: 1500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: Platform.OS !== "web",
          }),
        ]),
        Animated.parallel([
          Animated.timing(glowOpacity, {
            toValue: 0.15,
            duration: 1500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: Platform.OS !== "web",
          }),
          Animated.timing(glowScale, {
            toValue: 0.9,
            duration: 1500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: Platform.OS !== "web",
          }),
        ]),
      ])
    ).start();
  }, []);

  return (
    <View style={{ alignItems: "center", justifyContent: "center", marginBottom: 36 }}>
      {/* Outer glow ring - 140px, success/12% */}
      <Animated.View
        style={{
          position: "absolute",
          width: 140,
          height: 140,
          borderRadius: 70,
          backgroundColor: colors.success + "1F",
          opacity: glowOpacity,
          transform: [{ scale: glowScale }],
        }}
      />
      {/* Middle glow ring - 110px, success/10% */}
      <Animated.View
        style={{
          position: "absolute",
          width: 110,
          height: 110,
          borderRadius: 55,
          backgroundColor: colors.success + "1A",
          opacity: glowOpacity,
          transform: [{ scale: glowScale }],
        }}
      />
      {/* Inner checkmark circle - 92px, success/15% bg, success/30% border */}
      <Animated.View
        style={{
          width: 92,
          height: 92,
          borderRadius: 46,
          backgroundColor: colors.success + "26",
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 2,
          borderColor: colors.success + "4D",
          transform: [{ scale }],
        }}
      >
        <Ionicons name="checkmark" size={50} color={colors.success} />
      </Animated.View>
    </View>
  );
}

export default function PaymentSuccessScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    amount_kes: string;
    crypto_amount: string;
    crypto_currency: string;
    recipient: string;
  }>();

  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);

  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 768;

  useEffect(() => {
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, []);

  const toast = useToast();
  const amountKES = parseFloat(params.amount_kes || "0");

  const handleShare = async () => {
    const receiptText = `CryptoPay Payment Receipt\n\nAmount: KSh ${amountKES.toLocaleString()}\nCrypto: ${params.crypto_amount} ${params.crypto_currency}\nSent To: ${params.recipient}\nStatus: Processing\n\nPowered by CryptoPay`;

    if (Platform.OS === "web") {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(receiptText);
        toast.success("Copied", "Receipt copied to clipboard");
      }
    } else {
      try {
        await Share.share({ message: receiptText, title: "CryptoPay Receipt" });
      } catch {
        // User cancelled
      }
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: isDesktop ? 48 : 24,
          maxWidth: isDesktop ? 600 : undefined,
          alignSelf: isDesktop ? "center" : undefined,
          width: isDesktop ? "100%" : undefined,
        }}
      >
        {/* Animated checkmark with 3-layer glow */}
        <AnimatedCheckmark />

        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 28,
            fontFamily: "Inter_700Bold",
            marginBottom: 8,
            letterSpacing: -0.5,
          }}
        >
          Payment Sent!
        </Text>
        <Text
          style={{
            color: tc.textSecondary,
            fontSize: 15,
            fontFamily: "Inter_400Regular",
            textAlign: "center",
            marginBottom: 32,
            lineHeight: 22,
          }}
        >
          Your payment is being processed via M-Pesa
        </Text>

        {/* Receipt Card - glass, rounded-3xl */}
        <View
          style={{
            backgroundColor: tc.dark.card,
            borderRadius: 24,
            width: "100%",
            overflow: "hidden",
            borderWidth: 1,
            borderColor: tc.glass.border,
          }}
        >
          {/* Amount header - primary/8% bg */}
          <View
            style={{
              backgroundColor: tc.primary[500] + "14",
              paddingVertical: 22,
              paddingHorizontal: 24,
              alignItems: "center",
              borderBottomWidth: 1,
              borderBottomColor: tc.dark.border + "20",
            }}
          >
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 12,
                fontFamily: "Inter_500Medium",
                textTransform: "uppercase",
                letterSpacing: 1.2,
                marginBottom: 8,
              }}
            >
              Amount Paid
            </Text>
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 34,
                fontFamily: "Inter_700Bold",
                letterSpacing: -0.5,
              }}
            >
              KSh {amountKES.toLocaleString()}
            </Text>
          </View>

          {/* Details */}
          <View style={{ padding: 24 }}>
            {/* Crypto used */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 14,
                  fontFamily: "Inter_400Regular",
                }}
              >
                Crypto Used
              </Text>
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 14,
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                {params.crypto_amount} {params.crypto_currency}
              </Text>
            </View>

            {/* Dashed separator */}
            <View
              style={{
                borderBottomWidth: 1,
                borderBottomColor: tc.dark.border + "40",
                borderStyle: "dashed",
                marginBottom: 16,
              }}
            />

            {/* Sent to */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 14,
                  fontFamily: "Inter_400Regular",
                }}
              >
                Sent To
              </Text>
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 14,
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                {params.recipient}
              </Text>
            </View>

            {/* Dashed separator */}
            <View
              style={{
                borderBottomWidth: 1,
                borderBottomColor: tc.dark.border + "40",
                borderStyle: "dashed",
                marginBottom: 16,
              }}
            />

            {/* Status - success pill with dot */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 14,
                  fontFamily: "Inter_400Regular",
                }}
              >
                Status
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  backgroundColor: tc.success + "1A",
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                }}
              >
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: tc.success,
                  }}
                />
                <Text
                  style={{
                    color: tc.success,
                    fontSize: 13,
                    fontFamily: "Inter_600SemiBold",
                  }}
                >
                  Processing
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Share Receipt - ghost button */}
        <Pressable
          onPress={handleShare}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            marginTop: 20,
            paddingVertical: 12,
            paddingHorizontal: 20,
            borderRadius: 14,
            backgroundColor: pressed ? tc.dark.elevated + "60" : "transparent",
          })}
        >
          <Ionicons name="share-outline" size={18} color={tc.primary[400]} />
          <Text
            style={{
              color: tc.primary[400],
              fontSize: 14,
              fontFamily: "Inter_600SemiBold",
            }}
          >
            Share Receipt
          </Text>
        </Pressable>

        {/* Info text */}
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 12,
            fontFamily: "Inter_400Regular",
            textAlign: "center",
            marginTop: 12,
            lineHeight: 18,
            opacity: 0.8,
          }}
        >
          You'll receive an M-Pesa confirmation SMS shortly.{"\n"}
          Transaction details are in your history.
        </Text>
      </View>

      {/* Bottom Buttons */}
      <View
        style={{
          paddingHorizontal: isDesktop ? 48 : 24,
          paddingBottom: 32,
          gap: 12,
          maxWidth: isDesktop ? 600 : undefined,
          alignSelf: isDesktop ? "center" : undefined,
          width: isDesktop ? "100%" : undefined,
        }}
      >
        <Button
          title="Done"
          onPress={() => router.replace("/(tabs)")}
          size="lg"
          style={{
            ...ts.glow(tc.primary[500], 0.35),
          }}
        />
        <Button
          title="Make Another Payment"
          onPress={() => router.replace("/(tabs)/pay")}
          variant="secondary"
          size="lg"
        />
      </View>
    </SafeAreaView>
  );
}
