/**
 * Send to Cpay user · 2026-05-10.
 *
 * Pure ledger-only intra-Cpay transfer. Free, instant, no SasaPay/
 * M-Pesa hop. Recipient looked up by phone, username, or referral
 * code (any one of the three works).
 *
 * Backend: POST /api/v1/payments/send-to-cpay/
 *
 * UX:
 *   1. User picks crypto + amount + recipient identifier
 *   2. Tap Continue → goes to PIN screen (in-place, no separate
 *      confirm screen because we already validated the recipient)
 *   3. PIN entered → POST send-to-cpay → success or error
 *   4. On success → navigate to /payment/success with synthesised
 *      params so the existing screen renders cleanly
 */
import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Button } from "../../src/components/Button";
import { CryptoSelector } from "../../src/components/CryptoSelector";
import { PinInput } from "../../src/components/PinInput";
import { useToast } from "../../src/components/Toast";
import { useWallets } from "../../src/hooks/useWallets";
import { useScreenSecurity } from "../../src/hooks/useScreenSecurity";
import { paymentsApi } from "../../src/api/payments";
import { normalizeError } from "../../src/utils/apiErrors";
import { colors, getThemeColors, getThemeShadows, CURRENCIES, CurrencyCode } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { SectionHeader } from "../../src/components/SectionHeader";
import { PaymentStepper } from "../../src/components/PaymentStepper";
import { GlassCard } from "../../src/components/GlassCard";
import { useLocale } from "../../src/hooks/useLocale";
import { usePersistedState } from "../../src/hooks/usePersistedState";
import { Spinner } from "../../src/components/brand/Spinner";

const CRYPTO_OPTIONS: CurrencyCode[] = ["USDT", "USDC", "BTC", "ETH", "SOL"];

const PERSIST_KEYS = {
  recipient: "cpay_recipient",
  amount: "cpay_amount",
  memo: "cpay_memo",
  crypto: "cpay_crypto",
};

export default function SendToCpayScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 900;
  const { data: wallets } = useWallets();

  // Single recipient field · we auto-detect phone vs username vs
  // referral code from the format. Saves the user from picking a
  // mode dropdown before they've even started typing.
  const [recipient, setRecipient] = usePersistedState(PERSIST_KEYS.recipient, "");
  const [amount, setAmount] = usePersistedState(PERSIST_KEYS.amount, "");
  const [memo, setMemo] = usePersistedState(PERSIST_KEYS.memo, "");
  const [persistedCrypto, setPersistedCrypto] = usePersistedState(PERSIST_KEYS.crypto, "USDT");
  const selectedCrypto = (persistedCrypto || "USDT") as CurrencyCode;
  const setSelectedCrypto = (c: CurrencyCode) => setPersistedCrypto(c);

  const [step, setStep] = useState<"form" | "pin">("form");
  const [loading, setLoading] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const toast = useToast();
  const { t } = useLocale();

  useScreenSecurity(step === "pin");

  const selectedWallet = wallets?.find((w) => w.currency === selectedCrypto);
  const balance = selectedWallet ? parseFloat(selectedWallet.balance) : 0;
  const parsedAmount = parseFloat(amount) || 0;
  const decimals = CURRENCIES[selectedCrypto]?.decimals ?? 4;

  // Detect recipient identifier kind so backend gets the right field.
  const detectRecipientKind = (raw: string): {
    phone?: string;
    username?: string;
    referral_code?: string;
  } => {
    const v = raw.trim();
    if (!v) return {};
    // Phone: starts with 0, +, or 254 and is mostly digits
    if (/^(\+?254|0)\d{6,12}$/.test(v.replace(/\s/g, ""))) {
      return { phone: v };
    }
    // Referral code: ALL UPPERCASE alphanumeric, 4-12 chars
    if (/^[A-Z0-9]{4,12}$/.test(v) && v === v.toUpperCase()) {
      return { referral_code: v };
    }
    // Default: treat as username
    return { username: v };
  };

  const recipientKind = detectRecipientKind(recipient);
  const canContinue =
    parsedAmount > 0 &&
    parsedAmount <= balance &&
    (recipientKind.phone || recipientKind.username || recipientKind.referral_code);

  const handleContinue = () => {
    if (!canContinue) {
      if (parsedAmount <= 0) {
        toast.warning("Amount required", "Enter the amount you want to send.");
      } else if (parsedAmount > balance) {
        toast.warning("Insufficient balance", `You have ${balance.toFixed(decimals)} ${selectedCrypto}.`);
      } else {
        toast.warning("Recipient required", "Enter a phone, username, or Cpay referral code.");
      }
      return;
    }
    setStep("pin");
  };

  const handlePinComplete = async (pin: string) => {
    setLoading(true);
    setPinError(false);
    const idem_key = `cpay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const { data } = await paymentsApi.sendToCpay({
        ...recipientKind,
        currency: selectedCrypto,
        amount,
        pin,
        idempotency_key: idem_key,
        memo: memo || undefined,
      });

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      // Clear persisted form so next visit starts fresh.
      try {
        const { clearPersistedFields } = require("../../src/hooks/usePersistedState");
        await clearPersistedFields(Object.values(PERSIST_KEYS));
      } catch {}

      // Reuse existing /payment/success screen.
      router.replace({
        pathname: "/payment/success",
        params: {
          amount_kes: amount,
          crypto_amount: amount,
          crypto_currency: selectedCrypto,
          recipient: data.recipient.phone_masked || data.recipient.username || "",
          merchant_name: data.merchant_name || "",
          transaction_id: data.id,
          tx_status: data.status,
          payment_type: "cpay",
        },
      });
    } catch (err: unknown) {
      setPinError(true);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);
      setStep("form");
    } finally {
      setLoading(false);
    }
  };

  const inputBorderColor = (field: string) =>
    focusedField === field ? colors.primary[400] + "60" : tc.dark.border;

  // ── PIN STEP ──────────────────────────────────────────────────────
  if (step === "pin") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
          <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 20 }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
              <Pressable
                onPress={() => setStep("form")}
                hitSlop={12}
                style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: tc.dark.card, alignItems: "center", justifyContent: "center" }}
              >
                <Ionicons name="chevron-back" size={20} color={tc.textPrimary} />
              </Pressable>
              <Text style={{ color: tc.textPrimary, fontSize: 18, fontFamily: "DMSans_600SemiBold", marginLeft: 14, flex: 1 }}>
                Enter PIN
              </Text>
              <PaymentStepper currentStep={1} />
            </View>

            <View style={{ alignItems: "center", marginTop: 24, marginBottom: 24 }}>
              <View style={{ width: 68, height: 68, borderRadius: 20, backgroundColor: colors.primary[500] + "1A", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: colors.primary[500] + "25", marginBottom: 16 }}>
                <Ionicons name="lock-closed" size={30} color={colors.primary[400]} />
              </View>
              <Text style={{ color: tc.textPrimary, fontSize: 22, fontFamily: "DMSans_700Bold", textAlign: "center", marginBottom: 8 }}>
                Confirm send to Cpay
              </Text>
              <View style={{ backgroundColor: tc.dark.card, borderRadius: 16, paddingHorizontal: 20, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, borderWidth: 1, borderColor: tc.glass.border }}>
                <Text style={{ color: tc.textPrimary, fontSize: 17, fontFamily: "DMSans_700Bold" }}>
                  {parsedAmount.toFixed(decimals)} {selectedCrypto}
                </Text>
                <Ionicons name="arrow-forward" size={14} color={tc.textMuted} />
                <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_500Medium" }} numberOfLines={1}>
                  {recipient}
                </Text>
              </View>
            </View>

            <PinInput onComplete={handlePinComplete} error={pinError} loading={loading} testID="cpay-pin" />

            {loading && (
              <View style={{ alignItems: "center", marginTop: 24, gap: 12 }}>
                <Spinner variant="arc" size={36} color={colors.primary[400]} />
                <Text style={{ color: tc.textPrimary, fontSize: 15, fontFamily: "DMSans_600SemiBold" }}>
                  Sending instantly…
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── FORM STEP ─────────────────────────────────────────────────────
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1, backgroundColor: tc.dark.bg }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={isDesktop ? { alignItems: "stretch", paddingTop: 20, paddingBottom: 32 } : undefined}
        >
          <View style={isDesktop ? { width: "100%", maxWidth: 600, alignSelf: "center", backgroundColor: tc.dark.card, borderRadius: 20, padding: 36, borderWidth: 1, borderColor: tc.dark.border, ...ts.md } : { flex: 1 }}>
            {/* Header */}
            <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: isDesktop ? 0 : 16, paddingVertical: 12, marginBottom: isDesktop ? 16 : 4 }}>
              <Pressable
                onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)" as any); }}
                hitSlop={12}
                style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 14, backgroundColor: tc.dark.card, borderWidth: 1, borderColor: tc.glass.border, alignItems: "center", justifyContent: "center", marginRight: 12, opacity: pressed ? 0.8 : 1 })}
                accessibilityLabel="Back"
              >
                <Ionicons name="chevron-back" size={20} color={tc.textPrimary} />
              </Pressable>
              <Text style={{ color: tc.textPrimary, fontSize: isDesktop ? 24 : 20, fontFamily: "DMSans_700Bold", flex: 1, letterSpacing: -0.3 }}>
                Send to Cpay user
              </Text>
              <PaymentStepper currentStep={0} />
            </View>

            <View style={{ paddingHorizontal: isDesktop ? 0 : 20, marginTop: isDesktop ? 0 : 8 }}>
              {/* Why-Cpay banner */}
              <GlassCard glowOpacity={0.08} style={{ marginBottom: 20 }}>
                <View style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Ionicons name="flash" size={20} color={colors.primary[400]} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_600SemiBold" }} numberOfLines={1}>
                      Instant · free · no M-Pesa needed
                    </Text>
                    <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular", marginTop: 2 }} numberOfLines={2}>
                      Send any crypto directly to another Cpay user. Settles instantly.
                    </Text>
                  </View>
                </View>
              </GlassCard>

              {/* Recipient */}
              <SectionHeader title="Recipient" icon="person-outline" iconColor={colors.primary[400]} />
              <View style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: tc.dark.card,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: inputBorderColor("recipient"),
                paddingHorizontal: 16,
                marginBottom: 6,
              }}>
                <Ionicons name="at-outline" size={18} color={tc.textMuted} style={{ marginRight: 8 }} />
                <TextInput
                  value={recipient}
                  onChangeText={setRecipient}
                  placeholder="Phone, username, or referral code"
                  placeholderTextColor={tc.dark.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onFocus={() => setFocusedField("recipient")}
                  onBlur={() => setFocusedField(null)}
                  style={{
                    flex: 1,
                    color: tc.textPrimary,
                    fontSize: 16,
                    fontFamily: "DMSans_500Medium",
                    paddingVertical: 14,
                    ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
                  }}
                  accessibilityLabel="Recipient identifier"
                />
              </View>
              {recipient ? (
                <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular", marginBottom: 14, paddingHorizontal: 4 }}>
                  Detected as: {recipientKind.phone ? "phone" : recipientKind.referral_code ? "referral code" : "username"}
                </Text>
              ) : (
                <View style={{ height: 14 }} />
              )}

              {/* Amount */}
              <SectionHeader title="Amount" icon="cash-outline" iconColor={colors.primary[400]} />
              <View style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: tc.dark.card,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: inputBorderColor("amount"),
                paddingHorizontal: 16,
                marginBottom: 6,
              }}>
                <Text style={{ color: tc.textSecondary, fontSize: 16, fontFamily: "DMSans_700Bold", marginRight: 6 }}>
                  {selectedCrypto}
                </Text>
                <TextInput
                  value={amount}
                  onChangeText={setAmount}
                  placeholder="0.00"
                  placeholderTextColor={tc.dark.muted}
                  keyboardType="decimal-pad"
                  onFocus={() => setFocusedField("amount")}
                  onBlur={() => setFocusedField(null)}
                  style={{
                    flex: 1,
                    color: tc.textPrimary,
                    fontSize: 22,
                    fontFamily: "DMSans_700Bold",
                    paddingVertical: 14,
                    ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
                  }}
                  accessibilityLabel="Amount"
                />
                <Pressable
                  onPress={() => setAmount(balance.toFixed(decimals))}
                  style={({ pressed }) => ({
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 8,
                    backgroundColor: colors.primary[500] + "15",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ color: colors.primary[400], fontSize: 12, fontFamily: "DMSans_700Bold" }}>
                    MAX
                  </Text>
                </Pressable>
              </View>
              <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular", marginBottom: 16, paddingHorizontal: 4 }}>
                Available: {balance.toFixed(decimals)} {selectedCrypto}
              </Text>

              {/* Crypto picker */}
              <SectionHeader title={t("payment.payWith")} icon="wallet-outline" iconColor={colors.primary[400]} />
              <View style={{ marginBottom: 20 }}>
                <CryptoSelector
                  options={CRYPTO_OPTIONS}
                  selected={selectedCrypto}
                  wallets={wallets}
                  onSelect={(c) => setSelectedCrypto(c as CurrencyCode)}
                />
              </View>

              {/* Optional memo */}
              <SectionHeader title="Memo (optional)" icon="chatbubble-outline" iconColor={colors.primary[400]} />
              <View style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: tc.dark.card,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: inputBorderColor("memo"),
                paddingHorizontal: 16,
                marginBottom: 24,
              }}>
                <TextInput
                  value={memo}
                  onChangeText={setMemo}
                  placeholder="e.g. for lunch"
                  placeholderTextColor={tc.dark.muted}
                  maxLength={100}
                  onFocus={() => setFocusedField("memo")}
                  onBlur={() => setFocusedField(null)}
                  style={{
                    flex: 1,
                    color: tc.textPrimary,
                    fontSize: 14,
                    fontFamily: "DMSans_500Medium",
                    paddingVertical: 14,
                    ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
                  }}
                  accessibilityLabel="Memo"
                />
              </View>

              {/* Continue */}
              <Button
                title="Continue"
                onPress={handleContinue}
                disabled={!canContinue}
                loading={loading}
              />

              <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular", marginTop: 16, textAlign: "center" }}>
                Both you and the recipient need a Cpay account · they receive instantly.
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
