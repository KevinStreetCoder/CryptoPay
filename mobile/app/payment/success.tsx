import { View, Text, Pressable, Platform, useWindowDimensions, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Animated } from "react-native";
import * as Haptics from "expo-haptics";
import { Button } from "../../src/components/Button";
import { useToast } from "../../src/components/Toast";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";

const isWeb = Platform.OS === "web";
const useNative = Platform.OS !== "web";

function AnimatedCheckmark() {
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 5,
      tension: 80,
      useNativeDriver: useNative,
    }).start();
  }, []);

  return (
    <View style={{ alignItems: "center", justifyContent: "center", marginBottom: 32 }}>
      <Animated.View
        style={{
          width: 88,
          height: 88,
          borderRadius: 44,
          backgroundColor: colors.success + "18",
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 2,
          borderColor: colors.success + "35",
          transform: [{ scale }],
        }}
      >
        <Ionicons name="checkmark" size={44} color={colors.success} />
      </Animated.View>
    </View>
  );
}

function DetailRow({
  label,
  value,
  icon,
  tc,
}: {
  label: string;
  value: string;
  icon?: string;
  tc: ReturnType<typeof getThemeColors>;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: 14,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {icon && <Ionicons name={icon as any} size={16} color={tc.textMuted} />}
        <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_400Regular" }}>
          {label}
        </Text>
      </View>
      <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>
        {value}
      </Text>
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
    transaction_id: string;
  }>();

  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);

  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 768;

  useEffect(() => {
    if (!isWeb) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, []);

  const toast = useToast();
  const amountKES = parseFloat(params.amount_kes || "0");

  const handleDownloadReceipt = async () => {
    const txId = params.transaction_id;
    if (!txId) {
      toast.warning("Unavailable", "Receipt will be available shortly");
      return;
    }
    setDownloadingReceipt(true);
    try {
      const { authApi } = require("../../src/api/auth");
      const response = await authApi.downloadReceipt(txId);
      if (isWeb) {
        const blob = new Blob([response.data], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `CryptoPay_Receipt_${txId.slice(0, 8)}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("Downloaded", "Receipt saved to downloads");
      } else {
        toast.success("Generated", "Receipt is being prepared");
      }
    } catch {
      toast.error("Error", "Could not download receipt. Try again later.");
    } finally {
      setDownloadingReceipt(false);
    }
  };

  const handleShare = async () => {
    const receiptText = `CryptoPay Payment Receipt\n\nAmount: KSh ${amountKES.toLocaleString()}\nCrypto: ${params.crypto_amount} ${params.crypto_currency}\nSent To: ${params.recipient}\nStatus: Processing\n\nPowered by CryptoPay`;

    if (isWeb) {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(receiptText);
        toast.success("Copied", "Receipt copied to clipboard");
      }
    } else {
      try {
        await Share.share({ message: receiptText, title: "CryptoPay Receipt" });
      } catch {}
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
          maxWidth: isDesktop ? 560 : undefined,
          alignSelf: isDesktop ? "center" : undefined,
          width: isDesktop ? "100%" : undefined,
        }}
      >
        <AnimatedCheckmark />

        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 26,
            fontFamily: "DMSans_700Bold",
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
            fontFamily: "DMSans_400Regular",
            textAlign: "center",
            marginBottom: 32,
            lineHeight: 22,
          }}
        >
          Your payment is being processed via M-Pesa
        </Text>

        {/* Receipt Card */}
        <View
          style={{
            backgroundColor: tc.dark.card,
            borderRadius: 24,
            width: "100%",
            overflow: "hidden",
            borderWidth: 1,
            borderColor: tc.glass.border,
            ...ts.sm,
          }}
        >
          <View
            style={{
              backgroundColor: colors.primary[500] + "0C",
              paddingVertical: 22,
              paddingHorizontal: 24,
              alignItems: "center",
              borderBottomWidth: 1,
              borderBottomColor: tc.glass.border,
            }}
          >
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 11,
                fontFamily: "DMSans_500Medium",
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
                fontFamily: "DMSans_700Bold",
                letterSpacing: -0.5,
              }}
            >
              KSh {amountKES.toLocaleString()}
            </Text>
          </View>

          <View style={{ paddingHorizontal: 24 }}>
            <DetailRow label="Crypto Used" value={`${params.crypto_amount} ${params.crypto_currency}`} icon="wallet-outline" tc={tc} />
            <View style={{ height: 1, backgroundColor: tc.glass.border }} />
            <DetailRow label="Sent To" value={params.recipient || "—"} icon="person-outline" tc={tc} />
            <View style={{ height: 1, backgroundColor: tc.glass.border }} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="checkmark-circle-outline" size={16} color={tc.textMuted} />
                <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_400Regular" }}>Status</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.success + "15", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 5 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success }} />
                <Text style={{ color: colors.success, fontSize: 13, fontFamily: "DMSans_600SemiBold" }}>Processing</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={{ flexDirection: "row", gap: 12, marginTop: 20, width: "100%" }}>
          <Pressable
            onPress={handleDownloadReceipt}
            disabled={downloadingReceipt}
            style={({ pressed, hovered }: any) => ({
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              paddingVertical: 14,
              borderRadius: 14,
              backgroundColor: isWeb && hovered ? tc.dark.elevated : tc.dark.card,
              borderWidth: 1,
              borderColor: isWeb && hovered ? tc.glass.borderStrong : tc.glass.border,
              opacity: downloadingReceipt ? 0.6 : pressed ? 0.85 : 1,
              ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
            })}
          >
            <Ionicons name="download-outline" size={18} color={colors.primary[400]} />
            <Text style={{ color: colors.primary[400], fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>
              {downloadingReceipt ? "Downloading..." : "PDF Receipt"}
            </Text>
          </Pressable>

          <Pressable
            onPress={handleShare}
            style={({ pressed, hovered }: any) => ({
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              paddingVertical: 14,
              borderRadius: 14,
              backgroundColor: isWeb && hovered ? tc.dark.elevated : tc.dark.card,
              borderWidth: 1,
              borderColor: isWeb && hovered ? tc.glass.borderStrong : tc.glass.border,
              opacity: pressed ? 0.85 : 1,
              ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
            })}
          >
            <Ionicons name="share-outline" size={18} color={colors.primary[400]} />
            <Text style={{ color: colors.primary[400], fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>Share</Text>
          </Pressable>
        </View>

        <Text
          style={{
            color: tc.textMuted,
            fontSize: 12,
            fontFamily: "DMSans_400Regular",
            textAlign: "center",
            marginTop: 14,
            lineHeight: 18,
            opacity: 0.8,
          }}
        >
          You'll receive an M-Pesa confirmation SMS and email receipt shortly.{"\n"}
          Transaction details are in your history.
        </Text>
      </View>

      <View
        style={{
          paddingHorizontal: isDesktop ? 48 : 24,
          paddingBottom: 32,
          gap: 12,
          maxWidth: isDesktop ? 560 : undefined,
          alignSelf: isDesktop ? "center" : undefined,
          width: isDesktop ? "100%" : undefined,
        }}
      >
        <Button title="Done" onPress={() => router.replace("/(tabs)")} size="lg" />
        <Button title="Make Another Payment" onPress={() => router.replace("/(tabs)/pay")} variant="secondary" size="lg" />
      </View>
    </SafeAreaView>
  );
}
