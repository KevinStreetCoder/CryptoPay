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
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "../../src/components/Button";
import { CryptoSelector } from "../../src/components/CryptoSelector";
import { useToast } from "../../src/components/Toast";
import { useWallets } from "../../src/hooks/useWallets";
import { pickHighestBalanceCurrency } from "../../src/utils/portfolioTotal";
import { ratesApi, Quote } from "../../src/api/rates";
import { normalizeError } from "../../src/utils/apiErrors";
import { cacheQuote } from "../../src/utils/rateCache";
import { colors, getThemeColors, getThemeShadows, CURRENCIES, CurrencyCode } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { SectionHeader } from "../../src/components/SectionHeader";
import { PaymentStepper } from "../../src/components/PaymentStepper";
import { GlassCard } from "../../src/components/GlassCard";
import { useLocale } from "../../src/hooks/useLocale";
import { NetworkBadge, currencyToChain } from "../../src/components/brand/NetworkBadge";
import { getFrequent, type RecipientEntry } from "../../src/utils/recipientPrefs";
import { usePersistedState, clearPersistedFields } from "../../src/hooks/usePersistedState";
import { Spinner } from "../../src/components/brand/Spinner";

const CRYPTO_OPTIONS: CurrencyCode[] = ["USDT", "USDC", "BTC", "ETH", "SOL"];

// 2026-05-09 · keys for usePersistedState · stable across mounts.
// Wiped after a successful payment so the next visit doesn't auto-
// fill the previous recipient's number.
const PERSIST_KEYS = {
  phone: "send_phone",
  amount: "send_amount",
  crypto: "send_crypto",
};

export default function SendMpesaScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  // `context=pochi` switches the screen copy to "Pay a small business"
  // and tags the resulting transaction so history can render "Business"
  // next to the recipient. The underlying rail is identical to a normal
  // M-Pesa send · see docs/research/MPESA-RAILS.md.
  const params = useLocalSearchParams<{ context?: string }>();
  const isPochi = (params.context || "") === "pochi";
  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 900;
  const { data: wallets } = useWallets();
  // 2026-05-09 · persisted form state · survives network blip /
  // bundle reload. Cleared in the success path of confirm.tsx via
  // `clearPersistedFields(["send_phone", "send_amount"])`.
  const [phone, setPhone] = usePersistedState(PERSIST_KEYS.phone, "");
  const [amount, setAmount] = usePersistedState(PERSIST_KEYS.amount, "");
  // 2026-05-16 · default "" so auto-pick effect (below) selects the
  // highest-balance crypto on first visit instead of always USDT.
  const [persistedCrypto, setPersistedCrypto] = usePersistedState(
    PERSIST_KEYS.crypto, "",
  );
  const selectedCrypto = (persistedCrypto || "USDT") as CurrencyCode;
  const setSelectedCrypto = (c: CurrencyCode) => setPersistedCrypto(c);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  // 2026-05-09 · top-3 frequent phone recipients · recipientPrefs.
  const [frequentPhones, setFrequentPhones] = useState<RecipientEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await getFrequent("phone");
      if (!cancelled) setFrequentPhones(list);
    })();
    return () => { cancelled = true; };
  }, []);

  // 2026-05-16 · auto-pick highest-balance crypto on first visit
  // so a user holding only SOL doesn't always see USDT (empty) as
  // the default.
  const CRYPTO_DEFAULTS: CurrencyCode[] = ["USDT", "USDC", "BTC", "ETH", "SOL"];
  useEffect(() => {
    if (persistedCrypto) return;
    if (!wallets) return;
    const best = pickHighestBalanceCurrency(
      CRYPTO_DEFAULTS, wallets, undefined, "USDT",
    );
    if (best && best !== persistedCrypto) setPersistedCrypto(best);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets, persistedCrypto]);

  // 2026-05-10 · pre-flight holder-name validation. Debounced 600ms
  // after typing pauses · calls /payments/account/validate/ via the
  // SasaPay account-validation endpoint (backend caches 1h server-
  // side, so a re-typed number is free). Shows "Sending to: John
  // Doe" before the user confirms · eliminates wrong-number losses.
  const [recipientName, setRecipientName] = useState<string>("");
  const [recipientLookupState, setRecipientLookupState] =
    useState<"idle" | "loading" | "found" | "notfound" | "error">("idle");
  useEffect(() => {
    setRecipientName("");
    setRecipientLookupState("idle");
    if (!phone || phone.length < 9) return;
    const fullPhone = phone.startsWith("0") ? "254" + phone.slice(1) : phone.startsWith("254") ? phone : "254" + phone;
    if (fullPhone.length < 12) return;
    let cancelled = false;
    setRecipientLookupState("loading");
    const timer = setTimeout(async () => {
      try {
        const { paymentsApi } = require("../../src/api/payments");
        const { data } = await paymentsApi.validateAccount({
          account_number: fullPhone,
          channel_code: "63902",
        });
        if (cancelled) return;
        if (data?.account_name) {
          setRecipientName(data.account_name);
          setRecipientLookupState("found");
        } else {
          setRecipientLookupState("notfound");
        }
      } catch {
        if (!cancelled) setRecipientLookupState("error");
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [phone]);

  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);

  const selectedWallet = wallets?.find((w) => w.currency === selectedCrypto);
  const balance = selectedWallet ? parseFloat(selectedWallet.balance) : 0;

  const toast = useToast();
  const { t } = useLocale();

  const handleGetQuote = async () => {
    if (!phone || !amount) {
      toast.warning(t("payment.missingFields"), t("payment.fillAllFields"));
      return;
    }
    // Strip leading 0 or +254 prefix for validation
    const rawDigits = phone.replace(/^(\+?254|0)/, "");
    if (rawDigits.length !== 9 || !/^[17]/.test(rawDigits)) {
      toast.warning(t("payment.invalidPhone"), t("payment.invalidPhoneFormat"));
      return;
    }
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 10) {
      toast.warning(t("payment.invalidAmount"), t("payment.minimumAmount"));
      return;
    }
    if (numAmount > 999999) {
      toast.warning(t("payment.invalidAmount"), t("payment.maximumAmount"));
      return;
    }
    setLoading(true);
    try {
      const { data } = await ratesApi.lockRate({
        currency: selectedCrypto,
        kes_amount: amount,
      });
      setQuote(data);
      cacheQuote({
        quote_id: data.quote_id,
        currency: data.currency,
        exchange_rate: data.exchange_rate,
        crypto_amount: data.crypto_amount,
        kes_amount: data.kes_amount,
        fee_kes: data.fee_kes,
        excise_duty_kes: data.excise_duty_kes,
      });
    } catch (err: unknown) {
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    if (!quote) return;
    const fullPhone = phone.startsWith("0")
      ? "+254" + phone.slice(1)
      : phone.startsWith("254")
        ? "+" + phone
        : phone.startsWith("+254")
          ? phone
          : "+254" + phone;
    try {
      router.push({
        pathname: "/payment/confirm",
        params: {
          type: "send",
          phone: String(fullPhone || ""),
          amount_kes: String(amount || ""),
          crypto_currency: String(selectedCrypto || ""),
          quote_id: String(quote.quote_id || ""),
          crypto_amount: String(quote.crypto_amount || ""),
          rate: String(quote.exchange_rate || ""),
          fee: String(quote.fee_kes || ""),
          excise_duty: String(quote.excise_duty_kes || "0"),
          // Forward the Pochi flag so the confirm screen can pass it
          // through to /payments/send-mpesa/ as `context=pochi`.
          ...(isPochi ? { context: "pochi" } : {}),
        },
      });
    } catch (navErr) {
      console.warn("[send] confirm-nav failed", navErr);
      toast.error("Couldn't open confirm screen", "Please try again.");
    }
  };

  const inputBorderColor = (field: string) =>
    focusedField === field ? colors.primary[400] + "60" : tc.dark.border;

  const inputFocusGlow = (field: string) =>
    focusedField === field && isWeb
      ? ({ boxShadow: `0 0 0 3px ${colors.primary[500]}15` } as any)
      : {};

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1 }}
      >
        <ScrollView
          // 2026-05-09 · backgroundColor on the ScrollView itself so
          // the over-scroll bounce area paints in our dark color
          // instead of leaking the browser body's white background
          // (visible as a white stripe at the bottom of the page on
          // Chrome mobile when the user scrolls past the last card).
          style={{ flex: 1, backgroundColor: tc.dark.bg }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={
            isDesktop
              ? { alignItems: "stretch", paddingTop: 20, paddingBottom: 32 }
              : undefined
          }
        >
          {/* Top-level back button · desktop only */}
          {isDesktop && (
            <View style={{ paddingHorizontal: width >= 1200 ? 48 : 32, marginBottom: 16 }}>
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
            </View>
          )}

          {/* Desktop wrapper card */}
          <View
            style={
              isDesktop
                ? {
                    width: "100%",
                    maxWidth: 600,
                    alignSelf: "center",
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
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: isDesktop ? 24 : 20,
                  fontFamily: "DMSans_700Bold",
                  marginLeft: 0,
                  flex: 1,
                  letterSpacing: -0.3,
                }}
                maxFontSizeMultiplier={1.3}
              >
                {isPochi ? "Pay a small business" : t("payment.sendToMpesa")}
              </Text>

              {/* Step indicator */}
              <PaymentStepper currentStep={0} />
            </View>

            {/* Pochi context subtitle · explains the rail to first-time users. */}
            {isPochi && (
              <View
                style={{
                  paddingHorizontal: isDesktop ? 0 : 20,
                  marginTop: -4,
                  marginBottom: 16,
                }}
              >
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 13,
                    fontFamily: "DMSans_400Regular",
                    lineHeight: 18,
                  }}
                  maxFontSizeMultiplier={1.3}
                >
                  Pay a Pochi la Biashara number directly. Same as M-Pesa Send Money.
                </Text>
              </View>
            )}

            <View
              style={{
                paddingHorizontal: isDesktop ? 0 : 20,
                marginTop: isDesktop ? 0 : 8,
              }}
            >
              {/* 2026-05-09 · "Frequent" recipients · top-3 phones the
                  user has paid most often (90-day half-life decay).
                  Hidden on fresh devices. Tap to prefill the phone
                  field with the masked number + resolved holder name. */}
              {frequentPhones.length > 0 && (
                <View style={{ marginBottom: 20 }}>
                  <SectionHeader title="Frequent" icon="time-outline" iconColor={colors.primary[400]} />
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, paddingBottom: 4 }}>
                    {frequentPhones.map((entry, idx) => {
                      const cols = width >= 900 ? 4 : width >= 600 ? 3 : 2;
                      const isOrphan = frequentPhones.length % cols === 1 && idx === frequentPhones.length - 1;
                      const wPct = isOrphan ? "100%" : `${100 / cols - 2}%`;
                      const isSelected = phone === entry.id;
                      const masked = entry.id.length > 6
                        ? `${entry.id.slice(0, 6)}${"•".repeat(Math.max(0, entry.id.length - 6))}`
                        : entry.id;
                      return (
                        <Pressable
                          key={`freq-phone-${entry.id}`}
                          onPress={() => setPhone(entry.id)}
                          style={({ pressed, hovered }: any) => ({
                            backgroundColor: isWeb && hovered ? tc.dark.elevated : tc.glass.bg,
                            borderRadius: 14,
                            borderWidth: 1,
                            borderColor: isSelected ? colors.primary[400] + "60" : tc.glass.border,
                            paddingVertical: 12,
                            paddingHorizontal: 14,
                            flexBasis: wPct as any,
                            flexGrow: 0,
                            opacity: pressed ? 0.85 : 1,
                            ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
                          })}
                          accessibilityRole="button"
                          accessibilityLabel={`Frequent recipient ${entry.label || masked}`}
                        >
                          <Text
                            style={{ color: tc.textPrimary, fontSize: 13, fontFamily: "DMSans_600SemiBold" }}
                            numberOfLines={1}
                          >
                            {entry.label || "M-Pesa"}
                          </Text>
                          <Text
                            style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular", marginTop: 4 }}
                            numberOfLines={1}
                          >
                            {masked}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Phone Number */}
              <SectionHeader
                title={isPochi ? "Trader's phone number (Pochi)" : t("payment.phoneNumber")}
                icon="call-outline"
                iconColor={colors.primary[400]}
              />
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: tc.dark.card,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: inputBorderColor("phone"),
                  paddingHorizontal: 16,
                  marginBottom: 20,
                  ...(isWeb ? { transition: "border-color 0.15s ease, box-shadow 0.15s ease" } as any : {}),
                  ...inputFocusGlow("phone"),
                }}
              >
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 16,
                    fontFamily: "DMSans_600SemiBold",
                    marginRight: 4,
                  }}
                >
                  +254
                </Text>
                <TextInput
                  value={phone}
                  onChangeText={(text) => {
                    setPhone(text.replace(/[^0-9]/g, ""));
                    setQuote(null);
                  }}
                  placeholder="7XXXXXXXX"
                  placeholderTextColor={tc.dark.muted}
                  keyboardType="phone-pad"
                  maxLength={10}
                  onFocus={() => setFocusedField("phone")}
                  onBlur={() => setFocusedField(null)}
                  style={{
                    flex: 1,
                    color: tc.textPrimary,
                    fontSize: 16,
                    paddingVertical: 14,
                    ...(isWeb ? { outlineStyle: "none" } as any : {}),
                  }}
                  accessibilityLabel="Phone Number"
                  testID="phone-number-input"
                  maxFontSizeMultiplier={1.3}
                />
              </View>

              {/* 2026-05-10 · holder-name pill · shows after a debounced
                  validate-account lookup so the user sees who they're
                  about to pay BEFORE confirming. Eliminates wrong-
                  number losses (typoed last digit, etc.). */}
              {phone.length >= 9 && (
                <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 4, marginTop: 6, marginBottom: 14, gap: 6 }}>
                  {recipientLookupState === "loading" && (
                    <>
                      <Spinner variant="arc" size={12} color={tc.textMuted} />
                      <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_500Medium" }}>
                        Verifying recipient…
                      </Text>
                    </>
                  )}
                  {recipientLookupState === "found" && recipientName && (
                    <>
                      <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                      <Text style={{ color: tc.textPrimary, fontSize: 13, fontFamily: "DMSans_600SemiBold", flex: 1 }} numberOfLines={1}>
                        Sending to {recipientName}
                      </Text>
                    </>
                  )}
                  {recipientLookupState === "notfound" && (
                    <>
                      <Ionicons name="alert-circle-outline" size={14} color="#F59E0B" />
                      <Text style={{ color: "#F59E0B", fontSize: 12, fontFamily: "DMSans_500Medium" }}>
                        We couldn't verify this number · double-check it
                      </Text>
                    </>
                  )}
                </View>
              )}

              {/* Amount */}
              <SectionHeader title={t("payment.amountKes")} icon="cash-outline" iconColor={colors.primary[400]} />
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: tc.dark.card,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: inputBorderColor("amount"),
                  paddingHorizontal: 16,
                  ...(isWeb ? { transition: "border-color 0.15s ease, box-shadow 0.15s ease" } as any : {}),
                  ...inputFocusGlow("amount"),
                }}
              >
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 18,
                    fontFamily: "DMSans_700Bold",
                    marginRight: 4,
                  }}
                >
                  KSh
                </Text>
                <TextInput
                  value={amount}
                  onChangeText={(text) => {
                    setAmount(text);
                    setQuote(null);
                  }}
                  placeholder="0"
                  placeholderTextColor={tc.dark.muted}
                  keyboardType="numeric"
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
                  accessibilityLabel="Amount in KES"
                  testID="amount-input"
                  maxFontSizeMultiplier={1.3}
                />
              </View>

              {/* Crypto Selector */}
              <View style={{ marginTop: 24 }}>
                <SectionHeader title={t("payment.payWith")} icon="wallet-outline" iconColor={colors.primary[400]} />
              </View>
              <CryptoSelector
                options={CRYPTO_OPTIONS}
                selected={selectedCrypto}
                wallets={wallets}
                onSelect={(c) => { setSelectedCrypto(c); setQuote(null); }}
              />
              {/* NetworkBadge · confirms which chain the payment settles on */}
              <View style={{ flexDirection: "row", marginTop: 10 }}>
                <NetworkBadge chain={currencyToChain(selectedCrypto)} dark />
              </View>

              {/* Quote Display */}
              {quote && (
                <GlassCard glowOpacity={0.15} style={{ marginTop: 24 }}>
                <View style={{ padding: 16 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      marginBottom: 10,
                    }}
                  >
                    <Text
                      style={{ color: tc.dark.muted, fontSize: 14 }}
                      maxFontSizeMultiplier={1.3}
                    >
                      {t("payment.rate")}
                    </Text>
                    <Text
                      style={{
                        color: tc.textPrimary,
                        fontSize: 14,
                        fontFamily: "DMSans_500Medium",
                      }}
                      maxFontSizeMultiplier={1.3}
                    >
                      1 {selectedCrypto} = KSh{" "}
                      {parseFloat(quote.exchange_rate).toLocaleString()}
                    </Text>
                  </View>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      marginBottom: 10,
                    }}
                  >
                    <Text
                      style={{ color: tc.dark.muted, fontSize: 14 }}
                      maxFontSizeMultiplier={1.3}
                    >
                      {t("payment.fee")}
                    </Text>
                    <Text
                      style={{
                        color: tc.textPrimary,
                        fontSize: 14,
                        fontFamily: "DMSans_500Medium",
                      }}
                      maxFontSizeMultiplier={1.3}
                    >
                      KSh {quote.fee_kes}
                    </Text>
                  </View>
                  {quote.excise_duty_kes && parseFloat(quote.excise_duty_kes) > 0 && (
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        marginBottom: 10,
                      }}
                    >
                      <Text
                        style={{ color: tc.dark.muted, fontSize: 14 }}
                        maxFontSizeMultiplier={1.3}
                      >
                        {t("payment.exciseDuty")}
                      </Text>
                      <Text
                        style={{
                          color: tc.textPrimary,
                          fontSize: 14,
                          fontFamily: "DMSans_500Medium",
                        }}
                        maxFontSizeMultiplier={1.3}
                      >
                        KSh {parseFloat(quote.excise_duty_kes).toLocaleString()}
                      </Text>
                    </View>
                  )}
                  <View
                    style={{
                      height: 1,
                      backgroundColor: tc.dark.border,
                      marginVertical: 10,
                    }}
                  />
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text
                      style={{
                        color: tc.textSecondary,
                        fontSize: 14,
                        fontFamily: "DMSans_600SemiBold",
                      }}
                      maxFontSizeMultiplier={1.3}
                    >
                      {t("payment.total")}
                    </Text>
                    <Text
                      style={{
                        color: colors.primary[400],
                        fontSize: 16,
                        fontFamily: "DMSans_700Bold",
                      }}
                      maxFontSizeMultiplier={1.3}
                    >
                      {quote.crypto_amount} {selectedCrypto}
                    </Text>
                  </View>
                  {parseFloat(quote.crypto_amount) > balance && (
                    <Text
                      style={{
                        color: tc.error,
                        fontSize: 12,
                        marginTop: 8,
                      }}
                      maxFontSizeMultiplier={1.3}
                    >
                      {t("payment.insufficientBalance", { currency: selectedCrypto })}
                    </Text>
                  )}
                  <Text
                    style={{
                      color: tc.dark.muted,
                      fontSize: 12,
                      marginTop: 8,
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    {t("payment.rateLocked30")}
                  </Text>
                </View>
                </GlassCard>
              )}

              {/* Action Button */}
              <View style={{ marginTop: 28, marginBottom: 32, maxWidth: isDesktop ? 420 : undefined, alignSelf: isDesktop ? "center" : undefined, width: isDesktop ? "100%" : undefined }}>
                {!quote ? (
                  <Button
                    title={t("payment.getQuote")}
                    onPress={handleGetQuote}
                    loading={loading}
                    disabled={!phone || !amount}
                    size="lg"
                    icon={<Ionicons name="flash-outline" size={20} color="#FFFFFF" />}
                    testID="get-quote-button"
                  />
                ) : (
                  <Button
                    title={isPochi ? "Pay" : t("payment.confirmPayment")}
                    onPress={handleConfirm}
                    disabled={parseFloat(quote.crypto_amount) > balance}
                    size="lg"
                    icon={<Ionicons name="arrow-forward-circle-outline" size={20} color="#FFFFFF" />}
                    testID="confirm-payment-button"
                  />
                )}
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
