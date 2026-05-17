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
import { useToast } from "../../src/components/Toast";
import { useWallets } from "../../src/hooks/useWallets";
import { pickHighestBalanceCurrency } from "../../src/utils/portfolioTotal";
import { ratesApi, Quote } from "../../src/api/rates";
import { normalizeError } from "../../src/utils/apiErrors";
import { cacheQuote } from "../../src/utils/rateCache";
import { colors, getThemeColors, getThemeShadows, CURRENCIES, CurrencyCode } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { SectionHeader } from "../../src/components/SectionHeader";
import { CryptoLogo } from "../../src/components/CryptoLogo";
import { CryptoSelector } from "../../src/components/CryptoSelector";
import { PaymentStepper } from "../../src/components/PaymentStepper";
import { GlassCard } from "../../src/components/GlassCard";
import { useLocale } from "../../src/hooks/useLocale";
import { getFrequent, type RecipientEntry } from "../../src/utils/recipientPrefs";
import { usePersistedState } from "../../src/hooks/usePersistedState";

const CRYPTO_OPTIONS: CurrencyCode[] = ["USDT", "USDC", "BTC", "ETH", "SOL"];

const PERSIST_KEYS = {
  till: "till_number",
  amount: "till_amount",
  crypto: "till_crypto",
};

export default function PayTillScreen() {
  const router = useRouter();
  const { prefill, name: prefillName } = useLocalSearchParams<{ prefill?: string; name?: string }>();
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 900;
  const { data: wallets } = useWallets();
  // 2026-05-09 · persisted form state.
  const [tillNumber, setTillNumber] = usePersistedState(PERSIST_KEYS.till, prefill || "");
  const [amount, setAmount] = usePersistedState(PERSIST_KEYS.amount, "");
  // 2026-05-16 · default "" so the auto-pick effect (below) fires
  // on first visit and selects the highest-balance crypto rather than
  // hardcoding USDT.
  const [persistedCrypto, setPersistedCrypto] = usePersistedState(
    PERSIST_KEYS.crypto, "",
  );
  const selectedCrypto = (persistedCrypto || "USDT") as CurrencyCode;
  const setSelectedCrypto = (c: CurrencyCode) => setPersistedCrypto(c);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  // 2026-05-09 · top-3 frequent tills via recipientPrefs.
  const [frequentTills, setFrequentTills] = useState<RecipientEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await getFrequent("till");
      if (!cancelled) setFrequentTills(list);
    })();
    return () => { cancelled = true; };
  }, []);

  // 2026-05-16 · auto-pick highest-balance crypto on first visit.
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

  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);

  const selectedWallet = wallets?.find((w) => w.currency === selectedCrypto);
  const balance = selectedWallet ? parseFloat(selectedWallet.balance) : 0;

  const toast = useToast();
  const { t } = useLocale();

  const handleGetQuote = async () => {
    if (!tillNumber || !amount) {
      toast.warning(t("payment.missingFields"), t("payment.fillAllFields"));
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
    if (tillNumber.length < 5 || tillNumber.length > 7) {
      toast.warning(t("payment.invalidTill"), t("payment.invalidTillFormat"));
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
    try {
      router.push({
        pathname: "/payment/confirm",
        params: {
          type: "till",
          till_number: String(tillNumber || ""),
          amount_kes: String(amount || ""),
          crypto_currency: String(selectedCrypto || ""),
          quote_id: String(quote.quote_id || ""),
          crypto_amount: String(quote.crypto_amount || ""),
          rate: String(quote.exchange_rate || ""),
          fee: String(quote.fee_kes || ""),
          excise_duty: String(quote.excise_duty_kes || "0"),
        },
      });
    } catch (navErr) {
      console.warn("[till] confirm-nav failed", navErr);
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
          style={{ flex: 1 }}
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
                {t("payment.payTill")}
              </Text>

              {/* Step indicator */}
              <PaymentStepper currentStep={0} />
            </View>

            <View
              style={{
                paddingHorizontal: isDesktop ? 0 : 20,
                marginTop: isDesktop ? 0 : 8,
              }}
            >
              {/* 2026-05-09 · "Frequent" tills · top-3 by use count
                  with 90-day half-life decay. Hidden on fresh devices. */}
              {frequentTills.length > 0 && (
                <View style={{ marginBottom: 20 }}>
                  <SectionHeader title="Frequent" icon="time-outline" iconColor={colors.primary[400]} />
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, paddingBottom: 4 }}>
                    {frequentTills.map((entry, idx) => {
                      const cols = width >= 900 ? 4 : width >= 600 ? 3 : 2;
                      const isOrphan = frequentTills.length % cols === 1 && idx === frequentTills.length - 1;
                      const wPct = isOrphan ? "100%" : `${100 / cols - 2}%`;
                      const isSelected = tillNumber === entry.id;
                      return (
                        <Pressable
                          key={`freq-till-${entry.id}`}
                          onPress={() => setTillNumber(entry.id)}
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
                          accessibilityLabel={`Frequent till ${entry.label || entry.id}`}
                        >
                          <Text
                            style={{ color: tc.textPrimary, fontSize: 13, fontFamily: "DMSans_600SemiBold" }}
                            numberOfLines={1}
                          >
                            {entry.label || `Till ${entry.id}`}
                          </Text>
                          <Text
                            style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular", marginTop: 4 }}
                            numberOfLines={1}
                          >
                            {entry.id}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Till Number */}
              <SectionHeader title={t("payment.tillNumber")} icon="storefront-outline" iconColor={colors.primary[400]} />
              <TextInput
                value={tillNumber}
                onChangeText={setTillNumber}
                placeholder="e.g. 5678901"
                placeholderTextColor={tc.dark.muted}
                keyboardType="number-pad"
                maxLength={7}
                onFocus={() => setFocusedField("till")}
                onBlur={() => setFocusedField(null)}
                style={{
                  backgroundColor: tc.dark.card,
                  color: tc.textPrimary,
                  fontSize: 16,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: inputBorderColor("till"),
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  marginBottom: 20,
                  ...(isWeb ? { outlineStyle: "none", transition: "border-color 0.15s ease, box-shadow 0.15s ease" } as any : {}),
                  ...inputFocusGlow("till"),
                }}
                accessibilityLabel="Till Number"
                testID="till-number-input"
                maxFontSizeMultiplier={1.3}
              />

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
                  onChangeText={setAmount}
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
                    <Text style={{ color: tc.dark.muted, fontSize: 14 }}>{t("payment.rate")}</Text>
                    <Text
                      style={{
                        color: tc.textPrimary,
                        fontSize: 14,
                        fontFamily: "DMSans_500Medium",
                      }}
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
                    <Text style={{ color: tc.dark.muted, fontSize: 14 }}>{t("payment.fee")}</Text>
                    <Text
                      style={{
                        color: tc.textPrimary,
                        fontSize: 14,
                        fontFamily: "DMSans_500Medium",
                      }}
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
                      <Text style={{ color: tc.dark.muted, fontSize: 14 }}>
                        {t("payment.exciseDuty")}
                      </Text>
                      <Text
                        style={{
                          color: tc.textPrimary,
                          fontSize: 14,
                          fontFamily: "DMSans_500Medium",
                        }}
                      >
                        KSh {quote.excise_duty_kes}
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
                    >
                      {t("payment.total")}
                    </Text>
                    <Text
                      style={{
                        color: colors.primary[400],
                        fontSize: 16,
                        fontFamily: "DMSans_700Bold",
                      }}
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
                    disabled={!tillNumber || !amount}
                    size="lg"
                    icon={<Ionicons name="flash-outline" size={20} color="#FFFFFF" />}
                  />
                ) : (
                  <Button
                    title={t("payment.confirmPayment")}
                    onPress={handleConfirm}
                    disabled={parseFloat(quote.crypto_amount) > balance}
                    size="lg"
                    icon={<Ionicons name="arrow-forward-circle-outline" size={20} color="#FFFFFF" />}
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
