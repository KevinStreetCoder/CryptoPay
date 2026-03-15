/**
 * Crypto Withdrawal Screen
 *
 * Allows users to withdraw crypto from their CryptoPay wallet to an external
 * blockchain address. Supports network selection, fee estimation, PIN
 * confirmation, and real-time status polling.
 */

import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { CryptoLogo } from "../../src/components/CryptoLogo";
import { Button } from "../../src/components/Button";
import { PinInput } from "../../src/components/PinInput";
import { GlassCard } from "../../src/components/GlassCard";
import { SectionHeader } from "../../src/components/SectionHeader";
import { PaymentStepper } from "../../src/components/PaymentStepper";
import { useToast } from "../../src/components/Toast";
import { useWallets } from "../../src/hooks/useWallets";
import { useScreenSecurity } from "../../src/hooks/useScreenSecurity";
import { useTransactionPoller } from "../../src/hooks/useTransactionPoller";
import { paymentsApi, WithdrawFeeInfo } from "../../src/api/payments";
import { normalizeError } from "../../src/utils/apiErrors";
import { colors, getThemeColors, getThemeShadows, CURRENCIES, CurrencyCode } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { useLocale } from "../../src/hooks/useLocale";
import { useQueryClient } from "@tanstack/react-query";

const isWeb = Platform.OS === "web";

type WithdrawCurrency = "USDT" | "USDC" | "ETH" | "BTC" | "SOL";

interface NetworkOption {
  id: string;
  label: string;
  currency: WithdrawCurrency;
}

const CURRENCY_NETWORKS: Record<WithdrawCurrency, NetworkOption[]> = {
  USDT: [
    { id: "tron", label: "Tron (TRC-20)", currency: "USDT" },
    { id: "ethereum", label: "Ethereum (ERC-20)", currency: "USDT" },
    { id: "polygon", label: "Polygon", currency: "USDT" },
  ],
  USDC: [
    { id: "ethereum", label: "Ethereum (ERC-20)", currency: "USDC" },
    { id: "polygon", label: "Polygon", currency: "USDC" },
  ],
  ETH: [{ id: "ethereum", label: "Ethereum", currency: "ETH" }],
  BTC: [{ id: "bitcoin", label: "Bitcoin", currency: "BTC" }],
  SOL: [{ id: "solana", label: "Solana", currency: "SOL" }],
};

const CRYPTO_OPTIONS: WithdrawCurrency[] = ["USDT", "USDC", "BTC", "ETH", "SOL"];

export default function WithdrawScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 768;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const toast = useToast();
  const { t } = useLocale();

  const { data: wallets } = useWallets();
  const { pollTransaction } = useTransactionPoller();

  const [currency, setCurrency] = useState<WithdrawCurrency>("USDT");
  const [network, setNetwork] = useState<string>("tron");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [feeInfo, setFeeInfo] = useState<WithdrawFeeInfo | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);
  const [step, setStep] = useState<"form" | "review" | "pin">("form");
  const [submitting, setSubmitting] = useState(false);
  const [pollingStatus, setPollingStatus] = useState<string | null>(null);
  const [pinError, setPinError] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  useScreenSecurity(step === "pin");

  const selectedWallet = wallets?.find((w) => w.currency === currency);
  const balance = selectedWallet ? parseFloat(selectedWallet.balance) : 0;
  const lockedBalance = selectedWallet ? parseFloat((selectedWallet as any).locked_balance || "0") : 0;
  const availableBalance = balance - lockedBalance;

  const numAmount = parseFloat(amount) || 0;
  const feeAmount = feeInfo ? parseFloat(feeInfo.fee) : 0;
  const totalDeduct = numAmount + feeAmount;
  const receiveAmount = numAmount;
  const minAmount = feeInfo ? parseFloat(feeInfo.minimum_amount) : 0;

  // Fetch fee when currency or network changes
  useEffect(() => {
    let cancelled = false;
    const fetchFee = async () => {
      setFeeLoading(true);
      try {
        const { data } = await paymentsApi.withdrawFee(currency, network);
        if (!cancelled) setFeeInfo(data);
      } catch {
        if (!cancelled) setFeeInfo(null);
      } finally {
        if (!cancelled) setFeeLoading(false);
      }
    };
    fetchFee();
    return () => { cancelled = true; };
  }, [currency, network]);

  // Update network when currency changes
  useEffect(() => {
    const networks = CURRENCY_NETWORKS[currency];
    if (networks && networks.length > 0) {
      setNetwork(networks[0].id);
    }
  }, [currency]);

  const handlePasteAddress = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text) {
        setDestinationAddress(text.trim());
        toast.success("Pasted", "Address pasted from clipboard");
      }
    } catch {
      toast.error("Paste Failed", "Could not read from clipboard");
    }
  }, [toast]);

  const handleMaxAmount = useCallback(() => {
    // Max = available balance - fee
    const maxAmount = Math.max(0, availableBalance - feeAmount);
    if (maxAmount > 0) {
      // Use appropriate decimal places
      const decimals = CURRENCIES[currency as CurrencyCode]?.decimals || 8;
      setAmount(maxAmount.toFixed(decimals));
    }
  }, [availableBalance, feeAmount, currency]);

  const handleReview = () => {
    if (!destinationAddress.trim()) {
      toast.warning(t("payment.invalidAddress"), t("payment.invalidAddressFormat"));
      return;
    }
    if (numAmount <= 0) {
      toast.warning(t("payment.invalidAmount"), "Enter a valid withdrawal amount");
      return;
    }
    if (minAmount > 0 && numAmount < minAmount) {
      toast.warning(t("payment.invalidAmount"), `${t("payment.minimumWithdrawal")}: ${minAmount} ${currency}`);
      return;
    }
    if (totalDeduct > availableBalance) {
      toast.warning("Insufficient Balance", `You need ${totalDeduct} ${currency} (including ${feeAmount} fee) but only have ${availableBalance.toFixed(8)} available`);
      return;
    }
    setStep("review");
  };

  const handleConfirmReview = () => {
    setStep("pin");
  };

  const handlePinComplete = async (pin: string) => {
    setSubmitting(true);
    setPinError(false);

    const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      const { data: txData } = await paymentsApi.withdraw({
        currency,
        amount: amount,
        destination_address: destinationAddress.trim(),
        network,
        pin,
        idempotency_key: idempotencyKey,
      });

      const transactionId = txData?.id || "";

      // Poll for status update
      setPollingStatus("processing");

      const { status: finalStatus } = await pollTransaction(
        transactionId,
        (s) => setPollingStatus(s)
      );

      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });

      if (finalStatus === "failed") {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
        toast.error(t("payment.withdrawalFailed"), t("payment.withdrawalFailedDesc"));
        setPollingStatus(null);
        setStep("form");
        return;
      }

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      router.replace({
        pathname: "/payment/success",
        params: {
          amount_kes: "0",
          crypto_amount: amount,
          crypto_currency: currency,
          recipient: destinationAddress.slice(0, 12) + "...",
          transaction_id: transactionId,
          tx_status: finalStatus,
        },
      });
    } catch (err: unknown) {
      setPinError(true);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);
    } finally {
      setSubmitting(false);
      setPollingStatus(null);
    }
  };

  const inputBorderColor = (field: string) =>
    focusedField === field ? colors.primary[400] + "60" : tc.dark.border;

  const inputFocusGlow = (field: string) =>
    focusedField === field && isWeb
      ? ({ boxShadow: `0 0 0 3px ${colors.primary[500]}15` } as any)
      : {};

  const availableNetworks = CURRENCY_NETWORKS[currency] || [];

  // ── PIN Entry Step ──
  if (step === "pin") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
        <ScrollView
          contentContainerStyle={
            isDesktop
              ? { alignItems: "center", paddingVertical: 32 }
              : { flex: 1 }
          }
        >
          <View
            style={
              isDesktop
                ? {
                    width: "100%",
                    maxWidth: 480,
                    backgroundColor: tc.dark.card,
                    borderRadius: 20,
                    padding: 36,
                    borderWidth: 1,
                    borderColor: tc.dark.border,
                    ...ts.md,
                  }
                : { flex: 1, paddingHorizontal: 20 }
            }
          >
            {/* Header */}
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 24 }}>
              <Pressable
                onPress={() => setStep("review")}
                hitSlop={12}
                style={({ pressed }) => ({
                  width: 42,
                  height: 42,
                  borderRadius: 14,
                  backgroundColor: tc.dark.card,
                  borderColor: tc.glass.border,
                  borderWidth: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.85 : 1,
                  ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
                })}
              >
                <Ionicons name="arrow-back" size={20} color={tc.textPrimary} />
              </Pressable>
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 20,
                  fontFamily: "DMSans_700Bold",
                  marginLeft: 14,
                  flex: 1,
                }}
              >
                {t("payment.enterYourPin")}
              </Text>
              <PaymentStepper currentStep={2} />
            </View>

            {pollingStatus ? (
              <View style={{ alignItems: "center", paddingVertical: 40, gap: 16 }}>
                <Ionicons name="hourglass-outline" size={48} color={colors.primary[400]} />
                <Text style={{ color: tc.textPrimary, fontSize: 18, fontFamily: "DMSans_700Bold" }}>
                  {t("payment.withdrawalProcessing")}
                </Text>
                <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_400Regular", textAlign: "center" }}>
                  {t("payment.withdrawalPendingDesc")}
                </Text>
              </View>
            ) : (
              <View style={{ alignItems: "center", paddingVertical: 20, gap: 16 }}>
                <GlassCard style={{ width: "100%", padding: 16 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
                    <Text style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_500Medium" }}>
                      {t("payment.withdrawAmount")}
                    </Text>
                    <Text style={{ color: colors.primary[400], fontSize: 15, fontFamily: "DMSans_700Bold" }}>
                      {amount} {currency}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: tc.textMuted, fontSize: 13, fontFamily: "DMSans_500Medium" }}>
                      {t("payment.sendTo")}
                    </Text>
                    <Text style={{ color: tc.textSecondary, fontSize: 12, fontFamily: "DMSans_500Medium" }}>
                      {destinationAddress.slice(0, 8)}...{destinationAddress.slice(-6)}
                    </Text>
                  </View>
                </GlassCard>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="lock-closed" size={14} color={tc.textMuted} />
                  <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular" }}>
                    {t("payment.securedBy")}
                  </Text>
                </View>

                <PinInput
                  length={6}
                  onComplete={handlePinComplete}
                  error={pinError}
                  loading={submitting}
                />
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Review Step ──
  if (step === "review") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
        <ScrollView
          contentContainerStyle={
            isDesktop
              ? { alignItems: "center", paddingVertical: 32 }
              : undefined
          }
        >
          <View
            style={
              isDesktop
                ? {
                    width: "100%",
                    maxWidth: 600,
                    backgroundColor: tc.dark.card,
                    borderRadius: 20,
                    padding: 36,
                    borderWidth: 1,
                    borderColor: tc.dark.border,
                    ...ts.md,
                  }
                : { flex: 1, paddingHorizontal: 20 }
            }
          >
            {/* Header */}
            <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, marginBottom: 16 }}>
              <Pressable
                onPress={() => setStep("form")}
                hitSlop={12}
                style={({ pressed }) => ({
                  width: 42,
                  height: 42,
                  borderRadius: 14,
                  backgroundColor: tc.dark.card,
                  borderColor: tc.glass.border,
                  borderWidth: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.85 : 1,
                  ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
                })}
              >
                <Ionicons name="arrow-back" size={20} color={tc.textPrimary} />
              </Pressable>
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: isDesktop ? 24 : 20,
                  fontFamily: "DMSans_700Bold",
                  marginLeft: 14,
                  flex: 1,
                }}
              >
                {t("payment.confirmWithdrawal")}
              </Text>
              <PaymentStepper currentStep={1} />
            </View>

            {/* Review Card */}
            <GlassCard glowOpacity={0.15} style={{ marginBottom: 20 }}>
              <View style={{ padding: 20, gap: 14 }}>
                {/* Currency & Amount */}
                <View style={{ alignItems: "center", paddingVertical: 12 }}>
                  <CryptoLogo currency={currency} size={48} />
                  <Text style={{ color: tc.textPrimary, fontSize: 32, fontFamily: "DMSans_700Bold", marginTop: 12 }}>
                    {amount} {currency}
                  </Text>
                  <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_400Regular", marginTop: 4 }}>
                    {t("payment.withdrawCrypto")}
                  </Text>
                </View>

                <View style={{ height: 1, backgroundColor: tc.dark.border }} />

                {/* Destination */}
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_500Medium" }}>
                    {t("payment.destinationAddress")}
                  </Text>
                  <Text style={{ color: tc.textPrimary, fontSize: 13, fontFamily: "DMSans_500Medium", maxWidth: "50%" }} numberOfLines={1} ellipsizeMode="middle">
                    {destinationAddress}
                  </Text>
                </View>

                {/* Network */}
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_500Medium" }}>
                    {t("payment.network")}
                  </Text>
                  <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_500Medium" }}>
                    {availableNetworks.find((n) => n.id === network)?.label || network}
                  </Text>
                </View>

                {/* Network Fee */}
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_500Medium" }}>
                    {t("payment.networkFee")}
                  </Text>
                  <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_500Medium" }}>
                    {feeInfo?.fee || "0"} {currency}
                  </Text>
                </View>

                <View style={{ height: 1, backgroundColor: tc.dark.border }} />

                {/* Total Deduction */}
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: tc.textSecondary, fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>
                    {t("payment.total")}
                  </Text>
                  <Text style={{ color: colors.primary[400], fontSize: 16, fontFamily: "DMSans_700Bold" }}>
                    {totalDeduct.toFixed(CURRENCIES[currency as CurrencyCode]?.decimals || 8)} {currency}
                  </Text>
                </View>

                {/* Receive Amount */}
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: tc.textSecondary, fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>
                    {t("payment.youWillReceive")}
                  </Text>
                  <Text style={{ color: colors.success, fontSize: 16, fontFamily: "DMSans_700Bold" }}>
                    {receiveAmount} {currency}
                  </Text>
                </View>
              </View>
            </GlassCard>

            {/* Warning */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: 10,
                marginBottom: 24,
                paddingHorizontal: 4,
              }}
            >
              <Ionicons name="warning-outline" size={18} color={colors.warning} />
              <Text
                style={{
                  flex: 1,
                  color: tc.textMuted,
                  fontSize: 12,
                  fontFamily: "DMSans_400Regular",
                  lineHeight: 18,
                }}
              >
                Double-check the destination address and network. Crypto sent to the wrong
                address or wrong network cannot be recovered.
              </Text>
            </View>

            <Button
              title={t("payment.confirmWithdrawal")}
              onPress={handleConfirmReview}
              size="lg"
              icon={<Ionicons name="shield-checkmark-outline" size={20} color="#FFFFFF" />}
              style={{ maxWidth: isDesktop ? 420 : undefined }}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Form Step (main) ──
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={
          isDesktop
            ? { alignItems: "center", paddingVertical: 32 }
            : undefined
        }
      >
        {/* Desktop back button */}
        {isDesktop && (
          <Pressable
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/(tabs)" as any);
            }}
            style={({ pressed, hovered }: any) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: hovered
                ? tc.glass.highlight
                : pressed
                  ? tc.dark.elevated
                  : "transparent",
              alignSelf: "flex-start",
              marginBottom: 12,
              opacity: pressed ? 0.85 : 1,
              cursor: "pointer",
              transition: "all 0.15s ease",
            } as any)}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
            <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_500Medium" }}>
              {t("common.back")}
            </Text>
          </Pressable>
        )}

        {/* Desktop wrapper card */}
        <View
          style={
            isDesktop
              ? {
                  width: "100%",
                  maxWidth: 600,
                  backgroundColor: tc.dark.card,
                  borderRadius: 20,
                  padding: 36,
                  borderWidth: 1,
                  borderColor: tc.dark.border,
                  ...ts.md,
                }
              : { flex: 1 }
          }
        >
          {/* Header */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: isDesktop ? 0 : 16,
              paddingVertical: 12,
              marginBottom: isDesktop ? 16 : 4,
            }}
          >
            <Pressable
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace("/(tabs)" as any);
              }}
              hitSlop={12}
              style={({ pressed, hovered }: any) => ({
                width: 42,
                height: 42,
                borderRadius: 14,
                backgroundColor: isWeb && hovered ? tc.dark.elevated : tc.dark.card,
                borderColor: isWeb && hovered ? tc.glass.borderStrong : tc.glass.border,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                opacity: pressed ? 0.85 : 1,
                ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
              })}
            >
              <Ionicons name="arrow-back" size={20} color={tc.textPrimary} />
            </Pressable>

            <Text
              style={{
                color: tc.textPrimary,
                fontSize: isDesktop ? 24 : 20,
                fontFamily: "DMSans_700Bold",
                marginLeft: 14,
                flex: 1,
                letterSpacing: -0.3,
              }}
            >
              {t("payment.withdrawCrypto")}
            </Text>

            <PaymentStepper currentStep={0} />
          </View>

          <View style={{ paddingHorizontal: isDesktop ? 0 : 20, marginTop: isDesktop ? 0 : 8 }}>
            {/* Currency Selector */}
            <SectionHeader title={t("wallet.withdraw")} icon="wallet-outline" iconColor={colors.primary[400]} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, marginBottom: 20 }}
            >
              {CRYPTO_OPTIONS.map((opt) => {
                const w = wallets?.find((wl) => wl.currency === opt);
                const bal = w ? parseFloat(w.balance) : 0;
                const isSelected = currency === opt;
                return (
                  <Pressable
                    key={opt}
                    onPress={() => setCurrency(opt)}
                    style={({ hovered }: any) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                      borderRadius: 14,
                      backgroundColor: isSelected
                        ? colors.crypto[opt] + "18"
                        : hovered
                          ? tc.dark.elevated
                          : tc.dark.card,
                      borderWidth: 1.5,
                      borderColor: isSelected ? colors.crypto[opt] + "40" : tc.glass.border,
                      ...(isWeb ? { cursor: "pointer", transition: "all 0.2s ease" } as any : {}),
                    })}
                  >
                    <CryptoLogo currency={opt} size={24} />
                    <View>
                      <Text
                        style={{
                          color: isSelected ? tc.textPrimary : tc.textSecondary,
                          fontSize: 14,
                          fontFamily: isSelected ? "DMSans_700Bold" : "DMSans_500Medium",
                        }}
                      >
                        {opt}
                      </Text>
                      <Text
                        style={{
                          color: tc.textMuted,
                          fontSize: 10,
                          fontFamily: "DMSans_400Regular",
                        }}
                      >
                        {bal > 0 ? bal.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "0"}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Available Balance */}
            <View
              style={{
                backgroundColor: tc.dark.card,
                borderRadius: 16,
                padding: 16,
                borderWidth: 1,
                borderColor: tc.glass.border,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                marginBottom: 20,
              }}
            >
              <CryptoLogo currency={currency} size={32} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_500Medium" }}>
                  {t("payment.availableBalance")}
                </Text>
                <Text style={{ color: tc.textPrimary, fontSize: 20, fontFamily: "DMSans_700Bold", marginTop: 2 }}>
                  {availableBalance.toLocaleString(undefined, { maximumFractionDigits: 8 })}{" "}
                  <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>{currency}</Text>
                </Text>
              </View>
            </View>

            {/* Network Selector */}
            {availableNetworks.length > 1 && (
              <>
                <SectionHeader title={t("payment.network")} icon="git-network-outline" iconColor={colors.info} />
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
                  {availableNetworks.map((net) => {
                    const isSelected = network === net.id;
                    return (
                      <Pressable
                        key={net.id}
                        onPress={() => setNetwork(net.id)}
                        style={({ hovered }: any) => ({
                          paddingVertical: 10,
                          paddingHorizontal: 16,
                          borderRadius: 12,
                          backgroundColor: isSelected ? colors.primary[500] + "18" : hovered ? tc.dark.elevated : tc.dark.card,
                          borderWidth: 1.5,
                          borderColor: isSelected ? colors.primary[500] + "40" : tc.glass.border,
                          ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
                        })}
                      >
                        <Text
                          style={{
                            color: isSelected ? colors.primary[400] : tc.textSecondary,
                            fontSize: 13,
                            fontFamily: isSelected ? "DMSans_700Bold" : "DMSans_500Medium",
                          }}
                        >
                          {net.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            {/* Destination Address */}
            <SectionHeader title={t("payment.destinationAddress")} icon="location-outline" iconColor={colors.primary[400]} />
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: tc.dark.card,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: inputBorderColor("address"),
                paddingHorizontal: 16,
                marginBottom: 20,
                ...(isWeb ? { transition: "border-color 0.15s ease, box-shadow 0.15s ease" } as any : {}),
                ...inputFocusGlow("address"),
              }}
            >
              <TextInput
                value={destinationAddress}
                onChangeText={setDestinationAddress}
                placeholder={t("payment.pasteAddress")}
                placeholderTextColor={tc.dark.muted}
                autoCapitalize="none"
                autoCorrect={false}
                onFocus={() => setFocusedField("address")}
                onBlur={() => setFocusedField(null)}
                style={{
                  flex: 1,
                  color: tc.textPrimary,
                  fontSize: 14,
                  fontFamily: "DMSans_500Medium",
                  paddingVertical: 14,
                  ...(isWeb ? { outlineStyle: "none" } as any : {}),
                }}
                accessibilityLabel="Destination Address"
                testID="address-input"
              />
              <Pressable
                onPress={handlePasteAddress}
                hitSlop={8}
                style={({ pressed, hovered }: any) => ({
                  paddingVertical: 6,
                  paddingHorizontal: 10,
                  borderRadius: 8,
                  backgroundColor: hovered ? colors.primary[500] + "20" : colors.primary[500] + "10",
                  opacity: pressed ? 0.7 : 1,
                  ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
                })}
              >
                <Text style={{ color: colors.primary[400], fontSize: 12, fontFamily: "DMSans_700Bold" }}>
                  PASTE
                </Text>
              </Pressable>
            </View>

            {/* Amount */}
            <SectionHeader title={t("payment.withdrawAmount")} icon="cash-outline" iconColor={colors.primary[400]} />
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: tc.dark.card,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: inputBorderColor("amount"),
                paddingHorizontal: 16,
                marginBottom: 8,
                ...(isWeb ? { transition: "border-color 0.15s ease, box-shadow 0.15s ease" } as any : {}),
                ...inputFocusGlow("amount"),
              }}
            >
              <TextInput
                value={amount}
                onChangeText={(text) => setAmount(text.replace(/[^0-9.]/g, ""))}
                placeholder="0.00"
                placeholderTextColor={tc.dark.muted}
                keyboardType="decimal-pad"
                onFocus={() => setFocusedField("amount")}
                onBlur={() => setFocusedField(null)}
                style={{
                  flex: 1,
                  color: tc.textPrimary,
                  fontSize: 24,
                  fontFamily: "DMSans_700Bold",
                  paddingVertical: 12,
                  ...(isWeb ? { outlineStyle: "none" } as any : {}),
                }}
                accessibilityLabel="Withdrawal Amount"
                testID="amount-input"
              />
              <Pressable
                onPress={handleMaxAmount}
                hitSlop={8}
                style={({ pressed, hovered }: any) => ({
                  paddingVertical: 6,
                  paddingHorizontal: 10,
                  borderRadius: 8,
                  backgroundColor: hovered ? colors.primary[500] + "20" : colors.primary[500] + "10",
                  opacity: pressed ? 0.7 : 1,
                  marginRight: 8,
                  ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
                })}
              >
                <Text style={{ color: colors.primary[400], fontSize: 12, fontFamily: "DMSans_700Bold" }}>MAX</Text>
              </Pressable>
              <Text style={{ color: tc.textMuted, fontSize: 16, fontFamily: "DMSans_700Bold" }}>
                {currency}
              </Text>
            </View>

            {/* Min amount hint */}
            {minAmount > 0 && (
              <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular", marginBottom: 16, paddingHorizontal: 4 }}>
                {t("payment.minimumWithdrawal")}: {minAmount} {currency}
              </Text>
            )}

            {/* Fee Summary */}
            {numAmount > 0 && feeInfo && (
              <GlassCard glowOpacity={0.15} style={{ marginTop: 8, marginBottom: 20 }}>
                <View style={{ padding: 16, gap: 10 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_500Medium" }}>
                      {t("payment.withdrawAmount")}
                    </Text>
                    <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_500Medium" }}>
                      {amount} {currency}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_500Medium" }}>
                      {t("payment.networkFee")}
                    </Text>
                    <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_500Medium" }}>
                      {feeInfo.fee} {currency}
                    </Text>
                  </View>
                  <View style={{ height: 1, backgroundColor: tc.dark.border }} />
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: tc.textSecondary, fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>
                      {t("payment.total")}
                    </Text>
                    <Text style={{ color: colors.primary[400], fontSize: 16, fontFamily: "DMSans_700Bold" }}>
                      {totalDeduct.toFixed(CURRENCIES[currency as CurrencyCode]?.decimals || 8)} {currency}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: tc.textSecondary, fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>
                      {t("payment.youWillReceive")}
                    </Text>
                    <Text style={{ color: colors.success, fontSize: 16, fontFamily: "DMSans_700Bold" }}>
                      {receiveAmount} {currency}
                    </Text>
                  </View>
                  {totalDeduct > availableBalance && (
                    <Text style={{ color: colors.error, fontSize: 12, marginTop: 4, fontFamily: "DMSans_500Medium" }}>
                      {t("payment.insufficientBalance", { currency })}
                    </Text>
                  )}
                </View>
              </GlassCard>
            )}

            {/* Warning */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: 10,
                paddingHorizontal: 4,
                marginBottom: 8,
              }}
            >
              <Ionicons name="warning-outline" size={18} color={colors.warning} />
              <Text
                style={{
                  flex: 1,
                  color: tc.textMuted,
                  fontSize: 12,
                  fontFamily: "DMSans_400Regular",
                  lineHeight: 18,
                }}
              >
                Double-check the destination address and selected network. Crypto sent to the
                wrong address or wrong network cannot be recovered.
              </Text>
            </View>

            {/* Submit Button */}
            <View style={{ marginTop: 20, marginBottom: 32 }}>
              <Button
                title={t("payment.confirmWithdrawal")}
                onPress={handleReview}
                disabled={!destinationAddress || !amount || totalDeduct > availableBalance}
                size="lg"
                icon={<Ionicons name="arrow-up-circle-outline" size={20} color="#FFFFFF" />}
                testID="review-withdrawal-button"
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
