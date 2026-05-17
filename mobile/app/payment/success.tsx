import { View, Text, Pressable, Platform, useWindowDimensions, Share, ScrollView, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing } from "react-native";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../src/components/Button";
import { useToast } from "../../src/components/Toast";
import { GlassCard } from "../../src/components/GlassCard";
import { PaymentStepper } from "../../src/components/PaymentStepper";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { useLocale } from "../../src/hooks/useLocale";

const isWeb = Platform.OS === "web";
const useNative = Platform.OS !== "web";

/* ═══════════════════════════════════════════════════════════════════════════════
   Animated Success Checkmark · ring expand + check draw + particle burst
   ═══════════════════════════════════════════════════════════════════════════════ */
function AnimatedCheckmark() {
  const ringScale = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0)).current;
  const checkRotate = useRef(new Animated.Value(-0.15)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // 1. Ring expands
    Animated.spring(ringScale, {
      toValue: 1,
      friction: 6,
      tension: 60,
      useNativeDriver: useNative,
    }).start();

    // 2. Checkmark bounces in (delayed)
    Animated.sequence([
      Animated.delay(250),
      Animated.parallel([
        Animated.spring(checkScale, {
          toValue: 1,
          friction: 4,
          tension: 100,
          useNativeDriver: useNative,
        }),
        Animated.timing(checkRotate, {
          toValue: 0,
          duration: 300,
          easing: Easing.out(Easing.back(1.5)),
          useNativeDriver: useNative,
        }),
      ]),
    ]).start();

    // 3. Glow pulse
    Animated.sequence([
      Animated.delay(400),
      Animated.timing(glowOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: useNative,
      }),
      Animated.timing(glowOpacity, {
        toValue: 0.4,
        duration: 800,
        useNativeDriver: useNative,
      }),
    ]).start();
  }, []);

  const checkRotateInterpolated = checkRotate.interpolate({
    inputRange: [-0.15, 0],
    outputRange: ["-15deg", "0deg"],
  });

  return (
    <View style={{ alignItems: "center", justifyContent: "center", marginBottom: 32, height: 120 }}>
      {/* Glow ring */}
      <Animated.View
        style={{
          position: "absolute",
          width: 110,
          height: 110,
          borderRadius: 55,
          backgroundColor: colors.success + "0C",
          borderWidth: 1,
          borderColor: colors.success + "15",
          opacity: glowOpacity,
          transform: [{ scale: ringScale }],
        }}
      />

      {/* Main circle */}
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
          transform: [{ scale: ringScale }],
        }}
      >
        <Animated.View
          style={{
            transform: [
              { scale: checkScale },
              { rotate: checkRotateInterpolated },
            ],
          }}
        >
          <Ionicons name="checkmark" size={44} color={colors.success} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Detail Row
   ═══════════════════════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════════════════════
   Main Screen
   ═══════════════════════════════════════════════════════════════════════════════ */
// 2026-05-17 · Expo Router param values are typed `string | string[]`
// because URL queries can be multi-value (`?recipient=A&recipient=B`).
// Programmatic router.replace shouldn't produce arrays, but defensive
// coercion eliminates the entire class of "X.startsWith is not a
// function" crashes when an array sneaks in. Returns "" for arrays so
// downstream string methods just no-op rather than crash.
const asString = (v: string | string[] | undefined): string => {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
  return "";
};

export default function PaymentSuccessScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const rawParams = useLocalSearchParams<{
    amount_kes: string;
    crypto_amount: string;
    crypto_currency: string;
    recipient: string;
    transaction_id: string;
    status?: string; // "failed" for failure state
    error_message?: string;
    tx_status?: string; // backend status: "completed", "processing", "confirming"
    // 2026-05-09 · resolved business / phone-holder name forwarded from
    // confirm.tsx · used for the headline on the "Sent To" row.
    merchant_name?: string;
    // 2026-05-09 · "paybill" | "till" | "send" | "bank" · drives label
    // copy on the "Sent To" / "Paid To" row.
    payment_type?: string;
  }>();
  // 2026-05-17 · normalised params · always strings, never arrays /
  // undefined. The PRE-FIX render did `params.recipient?.startsWith(...)`
  // which crashed when an array sneaked in (because Array has no
  // .startsWith · `.startsWith` → undefined → call → TypeError). User
  // report 2026-05-17: send-to-cpay transfer committed (backend 201)
  // but app crashed before /payment/success could mount · no status
  // polls observed in nginx logs between success POST and the email
  // deep-link click 42s later.
  const params = {
    amount_kes: asString(rawParams.amount_kes),
    crypto_amount: asString(rawParams.crypto_amount),
    crypto_currency: asString(rawParams.crypto_currency),
    recipient: asString(rawParams.recipient),
    transaction_id: asString(rawParams.transaction_id),
    status: asString(rawParams.status),
    error_message: asString(rawParams.error_message),
    tx_status: asString(rawParams.tx_status),
    merchant_name: asString(rawParams.merchant_name),
    payment_type: asString(rawParams.payment_type),
  };

  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const { t } = useLocale();
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const [liveStatus, setLiveStatus] = useState(params.tx_status || "processing");
  // 2026-05-09 · live merchant_name · seeded from confirm.tsx route
  // params (set by the backend's pre-flight name lookup) and refreshed
  // when the result callback's RecipientName lands during polling.
  const [liveMerchantName, setLiveMerchantName] = useState(
    (params.merchant_name || "").trim()
  );
  // 2026-05-16 · live failure_reason · seeded from the route param
  // (set by confirm.tsx when the saga's sync API call returns an error)
  // and refreshed when polling picks up the cron / webhook-set value.
  // Surface this next to the FAILED badge so the user sees WHY the
  // payment didn't settle (not just a generic red banner) and can
  // decide whether to retry or contact support.
  const [liveFailureReason, setLiveFailureReason] = useState(
    (params.error_message || "").trim()
  );

  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;

  // Refresh wallet balances immediately
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["wallets"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
  }, []);

  // Auto-poll when status is processing · update live when backend confirms
  useEffect(() => {
    if (liveStatus === "completed" || liveStatus === "failed" || !params.transaction_id) return;

    const interval = setInterval(async () => {
      try {
        const { paymentsApi } = require("../../src/api/payments");
        const { data } = await paymentsApi.transactionStatus(params.transaction_id);
        const newStatus = data.status || "processing";
        // 2026-05-09 · pick up `merchant_name` once the result callback
        // populates it (RecipientName captured from SasaPay) so the row
        // flips from "M-Pesa transfer · 254712••••••" to
        // "Kevin Kareithi · 254712••••••" without needing a refresh.
        const cbName = (data.merchant_name || "").trim();
        if (cbName && cbName !== liveMerchantName) {
          setLiveMerchantName(cbName);
        }
        // 2026-05-16 · pick up failure_reason as soon as the saga writes
        // it (sync rejection, webhook-FAILED state, or cron timeout).
        // Earlier we polled status only · the user saw a generic red
        // banner with no explanation when payment failed.
        const cbReason = ((data as any).failure_reason || "").trim();
        if (cbReason && cbReason !== liveFailureReason) {
          setLiveFailureReason(cbReason);
        }
        if (newStatus !== liveStatus) {
          setLiveStatus(newStatus);
          queryClient.invalidateQueries({ queryKey: ["wallets"] });
          queryClient.invalidateQueries({ queryKey: ["transactions"] });
          if (newStatus === "completed" && !isWeb) {
            try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)?.catch?.(() => {}); } catch {}
          }
          if (newStatus === "failed" && !isWeb) {
            try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)?.catch?.(() => {}); } catch {}
          }
        }
      } catch {}
    }, 3000);

    return () => clearInterval(interval);
  }, [liveStatus, params.transaction_id]);

  // Staggered fade-in for content sections
  const cardFade = useRef(new Animated.Value(0)).current;
  const cardSlide = useRef(new Animated.Value(30)).current;
  const buttonsFade = useRef(new Animated.Value(0)).current;

  const isFailed = params.status === "failed" || liveStatus === "failed";
  const isCompleted = liveStatus === "completed";
  const isProcessing = !isFailed && !isCompleted;
  const statusLabel = isFailed ? t("payment.failed") : isCompleted ? t("payment.completed") : t("payment.processing");
  const statusColor = isFailed ? colors.error : isCompleted ? colors.success : "#F59E0B";

  useEffect(() => {
    // 2026-05-17 · defensive Haptics · this fires on initial mount
    // of the success page. If the device lacks haptic support and
    // the promise rejects, the prior fire-and-forget call leaked an
    // unhandled rejection that crashed the page mid-mount on
    // Hermes-built APKs (user report 2026-05-17 · send-to-cpay
    // transfer committed but app crashed before success could
    // render · ZERO status polls in nginx logs proves the mount
    // never completed).
    if (!isWeb) {
      try {
        Haptics.notificationAsync(
          isFailed
            ? Haptics.NotificationFeedbackType.Error
            : isCompleted
              ? Haptics.NotificationFeedbackType.Success
              : Haptics.NotificationFeedbackType.Warning
        )?.catch?.(() => {});
      } catch {}
    }

    // Stagger animations
    Animated.sequence([
      Animated.delay(400),
      Animated.parallel([
        Animated.timing(cardFade, { toValue: 1, duration: 500, useNativeDriver: useNative }),
        Animated.spring(cardSlide, { toValue: 0, tension: 80, friction: 12, useNativeDriver: useNative }),
      ]),
    ]).start();

    Animated.sequence([
      Animated.delay(700),
      Animated.timing(buttonsFade, { toValue: 1, duration: 400, useNativeDriver: useNative }),
    ]).start();
  }, []);

  const toast = useToast();
  const amountKES = parseFloat(params.amount_kes || "0");
  // 2026-05-17 · cpay = ledger-only internal transfer · explicit
  // payment_type so the screen renders the "Sent to Cpay user" copy
  // instead of mis-classifying as a BUY (crypto received) because the
  // recipient field starts with +254.
  const isCpay = params.payment_type === "cpay";
  // Detect transaction type from params
  const isSwap = !isCpay && params.recipient.includes("→");
  // Detect if this is a deposit/buy flow (crypto received) vs payment flow (crypto spent)
  const isBuyFlow = !isCpay && !isSwap && (
    !params.recipient
    || params.recipient.startsWith("+254")
    || params.recipient.startsWith("0")
  );

  const handleDownloadReceipt = async () => {
    const txId = params.transaction_id;
    if (!txId) {
      toast.warning("Unavailable", "Receipt will be available shortly");
      return;
    }
    setDownloadingReceipt(true);
    try {
      if (isWeb) {
        // C2: signed one-shot URL · the access token never rides in the query string.
        const { authApi } = require("../../src/api/auth");
        const { config } = require("../../src/constants/config");
        const { data } = await authApi.signReceipt(txId);
        const base = String(config.apiUrl || "").replace(/\/api\/v1\/?$/, "");
        const fullUrl = data.url.startsWith("http") ? data.url : `${base}${data.url}`;
        window.open(fullUrl, "_blank");
        toast.success("Downloading", "Receipt opened in new tab");
      } else {
        const { authApi } = require("../../src/api/auth");
        await authApi.emailReceipt(txId);
        toast.success("Sent", "Receipt sent to your email");
      }
    } catch {
      toast.error("Error", "Could not download receipt. Try again later.");
    } finally {
      setDownloadingReceipt(false);
    }
  };

  const handleShare = async () => {
    const receiptText = isSwap
      ? `Cpay Swap Receipt\n\nReceived: ${params.crypto_amount} ${params.crypto_currency}\nConversion: ${params.recipient}\nStatus: ${statusLabel}\n${params.transaction_id ? `Ref: ${params.transaction_id.slice(0, 8)}` : ""}\n\nPowered by Cpay`
      : `Cpay Receipt\n\nTotal: KSh ${amountKES.toLocaleString()}\n${isBuyFlow ? "Received" : "Used"}: ${params.crypto_amount} ${params.crypto_currency}\n${isBuyFlow ? "Phone" : "Sent To"}: ${params.recipient}\nStatus: ${statusLabel}\n${params.transaction_id ? `Ref: ${params.transaction_id.slice(0, 8)}` : ""}\n\nPowered by Cpay`;

    if (isWeb) {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(receiptText);
        toast.success("Copied", "Receipt copied to clipboard");
      }
    } else {
      try {
        await Share.share({ message: receiptText, title: "Cpay Receipt" });
      } catch {}
    }
  };

  const handleShareWhatsApp = () => {
    const message = isSwap
      ? `I just swapped crypto on Cpay! ${params.crypto_amount} ${params.crypto_currency} received instantly. Try it: https://cpay.co.ke`
      : `I just paid my bill with crypto using Cpay! KSh ${amountKES.toLocaleString()} sent via M-Pesa in seconds. Try it: https://cpay.co.ke`;
    const encoded = encodeURIComponent(message);
    Linking.openURL(`https://wa.me/?text=${encoded}`);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: isDesktop ? 48 : 24,
          paddingTop: isDesktop ? 40 : 24,
          paddingBottom: isDesktop ? 48 : 36,
          maxWidth: isDesktop ? 520 : undefined,
          alignSelf: isDesktop ? "center" : undefined,
          width: isDesktop ? "100%" : undefined,
        }}
        showsVerticalScrollIndicator={false}
      >
        <PaymentStepper currentStep={isFailed ? 1 : 2} />
        <View style={{ height: 12 }} />
        {isFailed ? <AnimatedFailure /> : <AnimatedCheckmark />}

        <Text
          style={{
            color: tc.textPrimary,
            fontSize: isDesktop ? 28 : 26,
            fontFamily: "DMSans_700Bold",
            marginBottom: 8,
            letterSpacing: -0.5,
          }}
        >
          {isFailed ? t("payment.paymentFailed") : isCompleted ? (isSwap ? t("payment.swapComplete") : t("payment.paymentComplete")) : t("payment.paymentProcessing")}
        </Text>
        <Text
          style={{
            color: tc.textSecondary,
            fontSize: 15,
            fontFamily: "DMSans_400Regular",
            textAlign: "center",
            marginBottom: 28,
            lineHeight: 22,
          }}
        >
          {isFailed
            ? liveFailureReason || params.error_message || t("payment.paymentFailedDesc")
            : isCompleted
              ? (isSwap ? t("payment.swapConfirmedDesc") : t("payment.paymentConfirmedDesc"))
              : t("payment.paymentProcessingDesc")}
        </Text>

        {/*
          2026-05-16 · explicit "Funds refunded · please retry" banner
          when the saga's failure_reason carries one. Prevents the user
          from thinking they need to chase the merchant for a refund;
          the crypto is already back in their wallet.
        */}
        {isFailed && liveFailureReason && liveFailureReason.toLowerCase().includes("refund") && (
          <View
            style={{
              width: "100%",
              backgroundColor: colors.warning + "12",
              borderColor: colors.warning + "40",
              borderWidth: 1,
              borderRadius: 12,
              paddingVertical: 12,
              paddingHorizontal: 14,
              marginBottom: 20,
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 10,
            }}
          >
            <Ionicons name="information-circle" size={18} color={colors.warning} />
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 13,
                lineHeight: 20,
                fontFamily: "DMSans_500Medium",
                flex: 1,
              }}
            >
              {t("payment.refundedRetryHint") || "Your crypto has been credited back to your wallet. You can safely retry this payment."}
            </Text>
          </View>
        )}

        {/* Receipt Card · animated */}
        <Animated.View
          style={{
            width: "100%",
            opacity: cardFade,
            transform: [{ translateY: cardSlide }],
          }}
        >
          <GlassCard
            glowColor={isFailed ? colors.error : colors.success}
            glowOpacity={0.15}
            style={{ width: "100%" }}
          >
            <View
              style={{
                backgroundColor: isFailed ? colors.error + "0C" : colors.primary[500] + "0C",
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
                {isFailed ? "Amount" : isSwap ? "Amount Swapped" : "Total Charged"}
              </Text>
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 34,
                  fontFamily: "DMSans_700Bold",
                  letterSpacing: -0.5,
                }}
              >
                {isSwap ? `${params.crypto_amount} ${params.crypto_currency}` : `KSh ${amountKES.toLocaleString()}`}
              </Text>
            </View>

            <View style={{ paddingHorizontal: 24 }}>
              <DetailRow
                label={isSwap ? "Received" : isBuyFlow ? "Crypto Received" : "Crypto Used"}
                value={`${params.crypto_amount} ${params.crypto_currency}`}
                icon={isSwap ? "swap-horizontal-outline" : isBuyFlow ? "arrow-down-circle-outline" : "wallet-outline"}
                tc={tc}
              />
              <View style={{ height: 1, backgroundColor: tc.glass.border }} />
              {/* 2026-05-09 \u00b7 prefer the resolved merchant_name as the
                  primary value with the rail-specific identifier (paybill
                  number / till number / phone) shown beneath in muted text.
                  Falls back to just the raw identifier when name lookup
                  hasn't returned (Daraja path, transient SasaPay miss). */}
              {(() => {
                const railLabel = isSwap
                  ? "Conversion"
                  : isBuyFlow
                    ? "M-Pesa Phone"
                    : params.payment_type === "paybill"
                      ? "Paid to"
                      : params.payment_type === "till"
                        ? "Bought from"
                        : params.payment_type === "bank"
                          ? "Sent to bank"
                          : "Sent to";
                const railIcon = isSwap
                  ? "repeat-outline"
                  : isBuyFlow
                    ? "phone-portrait-outline"
                    : params.payment_type === "paybill"
                      ? "receipt-outline"
                      : params.payment_type === "till"
                        ? "cart-outline"
                        : params.payment_type === "bank"
                          ? "business-outline"
                          : "person-outline";
                const headline = liveMerchantName || params.recipient || "\u2014";
                const sub =
                  liveMerchantName && params.recipient && !isSwap && !isBuyFlow
                    ? params.recipient
                    : "";
                return (
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      paddingVertical: 14,
                      gap: 12,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <Ionicons name={railIcon as any} size={16} color={tc.textMuted} />
                      <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_400Regular" }}>
                        {railLabel}
                      </Text>
                    </View>
                    <View style={{ flex: 1, alignItems: "flex-end" }}>
                      <Text
                        style={{
                          color: tc.textPrimary,
                          fontSize: 14,
                          fontFamily: "DMSans_600SemiBold",
                          textAlign: "right",
                        }}
                        numberOfLines={2}
                      >
                        {headline}
                      </Text>
                      {sub ? (
                        <Text
                          style={{
                            color: tc.textMuted,
                            fontSize: 12,
                            fontFamily: "DMSans_400Regular",
                            marginTop: 2,
                            textAlign: "right",
                          }}
                          numberOfLines={1}
                        >
                          {sub}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })()}
              <View style={{ height: 1, backgroundColor: tc.glass.border }} />
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name={isFailed ? "close-circle-outline" : isCompleted ? "checkmark-circle" : "time-outline"} size={16} color={statusColor} />
                  <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_400Regular" }}>Status</Text>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    backgroundColor: statusColor + "15",
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 5,
                  }}
                >
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
                  <Text
                    style={{
                      color: statusColor,
                      fontSize: 13,
                      fontFamily: "DMSans_600SemiBold",
                    }}
                  >
                    {statusLabel}
                  </Text>
                </View>
              </View>
            </View>
          </GlassCard>
        </Animated.View>

        {/* Action Buttons · PDF Receipt & Share */}
        {!isFailed && (
          <Animated.View style={{ flexDirection: "row", gap: 12, marginTop: 20, width: "100%", opacity: buttonsFade }}>
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
          </Animated.View>
        )}

        {/* Share to WhatsApp */}
        {!isFailed && (
          <Animated.View style={{ width: "100%", marginTop: 8, opacity: buttonsFade }}>
            <Pressable
              onPress={handleShareWhatsApp}
              style={({ pressed, hovered }: any) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                paddingVertical: 14,
                borderRadius: 14,
                backgroundColor: isWeb && hovered ? "#128C7E" : "#25D366",
                opacity: pressed ? 0.85 : 1,
                ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
              })}
              accessibilityRole="button"
              accessibilityLabel="Share to WhatsApp"
            >
              <Ionicons name="logo-whatsapp" size={20} color="#FFFFFF" />
              <Text style={{ color: "#FFFFFF", fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>
                Share to WhatsApp
              </Text>
            </Pressable>
          </Animated.View>
        )}

        {/* Info text */}
        <Animated.View style={{ opacity: buttonsFade, width: "100%", marginTop: isFailed ? 20 : 8 }}>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 12,
              fontFamily: "DMSans_400Regular",
              textAlign: "center",
              marginTop: isFailed ? 0 : 6,
              lineHeight: 18,
              opacity: 0.8,
              marginBottom: 16,
            }}
          >
            {isFailed
              ? "No funds have been deducted from your wallet.\nPlease try again or contact support."
              : isSwap
                ? t("payment.swapInfoText")
                : "You'll receive an M-Pesa confirmation SMS and email receipt shortly.\nTransaction details are in your history."}
          </Text>
        </Animated.View>

        {/* Primary action buttons · inline with content */}
        <Animated.View
          style={{
            width: "100%",
            gap: 12,
            opacity: buttonsFade,
            maxWidth: isDesktop ? 400 : undefined,
          }}
        >
          {isFailed ? (
            <>
              <Button
                title="Try Again"
                onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)/pay" as any); }}
                size="lg"
                icon={<Ionicons name="refresh-outline" size={20} color="#FFFFFF" />}
              />
              <Button
                title="Go Home"
                onPress={() => router.replace("/(tabs)")}
                variant="secondary"
                size="lg"
                icon={<Ionicons name="home-outline" size={20} color={isDark ? "#FFFFFF" : "#0F172A"} />}
              />
            </>
          ) : (
            <>
              <Button
                title="Done"
                onPress={() => router.replace("/(tabs)")}
                size="lg"
                icon={<Ionicons name="checkmark-done-outline" size={20} color="#FFFFFF" />}
              />
              <Button
                title={isSwap ? "Make Another Swap" : "Make Another Payment"}
                onPress={() => router.replace(isSwap ? "/(tabs)/swap" as any : "/(tabs)/pay")}
                variant="secondary"
                size="lg"
                icon={<Ionicons name="repeat-outline" size={20} color={isDark ? "#FFFFFF" : "#0F172A"} />}
              />
            </>
          )}
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Animated Failure · shake + X mark
   ═══════════════════════════════════════════════════════════════════════════════ */
function AnimatedFailure() {
  const ringScale = useRef(new Animated.Value(0)).current;
  const xScale = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Ring expands
    Animated.spring(ringScale, {
      toValue: 1,
      friction: 6,
      tension: 60,
      useNativeDriver: useNative,
    }).start();

    // X mark appears + shake
    Animated.sequence([
      Animated.delay(250),
      Animated.spring(xScale, {
        toValue: 1,
        friction: 4,
        tension: 100,
        useNativeDriver: useNative,
      }),
      // Shake sequence
      Animated.sequence([
        Animated.timing(shake, { toValue: 10, duration: 50, useNativeDriver: useNative }),
        Animated.timing(shake, { toValue: -10, duration: 50, useNativeDriver: useNative }),
        Animated.timing(shake, { toValue: 8, duration: 50, useNativeDriver: useNative }),
        Animated.timing(shake, { toValue: -8, duration: 50, useNativeDriver: useNative }),
        Animated.timing(shake, { toValue: 4, duration: 50, useNativeDriver: useNative }),
        Animated.timing(shake, { toValue: 0, duration: 50, useNativeDriver: useNative }),
      ]),
    ]).start();
  }, []);

  return (
    <View style={{ alignItems: "center", justifyContent: "center", marginBottom: 32, height: 120 }}>
      <Animated.View
        style={{
          width: 88,
          height: 88,
          borderRadius: 44,
          backgroundColor: colors.error + "18",
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 2,
          borderColor: colors.error + "35",
          transform: [
            { scale: ringScale },
            { translateX: shake },
          ],
        }}
      >
        <Animated.View style={{ transform: [{ scale: xScale }] }}>
          <Ionicons name="close" size={44} color={colors.error} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}
