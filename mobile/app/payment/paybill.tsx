import { useState, useEffect, useCallback } from "react";
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
import { ratesApi, Quote } from "../../src/api/rates";
import { paymentsApi, SavedPaybill } from "../../src/api/payments";
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

const CRYPTO_OPTIONS: CurrencyCode[] = ["USDT", "USDC", "BTC", "ETH", "SOL"];

export default function PayBillScreen() {
  const router = useRouter();
  const { prefill, name: prefillName, account: prefillAccount } = useLocalSearchParams<{ prefill?: string; name?: string; account?: string }>();
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 768;
  const { data: wallets } = useWallets();
  const [paybillNumber, setPaybillNumber] = useState(prefill || "");
  const [accountNumber, setAccountNumber] = useState(prefillAccount || "");
  const [saveLabel, setSaveLabel] = useState(prefillName || "");
  const [amount, setAmount] = useState("");
  const [selectedCrypto, setSelectedCrypto] = useState<CurrencyCode>("USDT");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [savedBills, setSavedBills] = useState<SavedPaybill[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);

  // Fetch saved paybills on mount
  const fetchSavedBills = useCallback(async () => {
    try {
      setLoadingSaved(true);
      const { data } = await paymentsApi.savedPaybills();
      setSavedBills(data);
    } catch {
      // Silently fail · not critical
    } finally {
      setLoadingSaved(false);
    }
  }, []);

  useEffect(() => {
    fetchSavedBills();
  }, [fetchSavedBills]);

  const handleDeleteSavedBill = async (id: string) => {
    try {
      await paymentsApi.deleteSavedPaybill(id);
      setSavedBills((prev) => prev.filter((b) => b.id !== id));
      toast.success("Removed", "Saved bill deleted");
    } catch {
      toast.error("Error", "Could not delete saved bill");
    }
  };

  const handleSelectSavedBill = (bill: SavedPaybill) => {
    setPaybillNumber(bill.paybill_number);
    setAccountNumber(bill.account_number);
    setSaveLabel(bill.label || "");
    setQuote(null);
  };

  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);

  const selectedWallet = wallets?.find((w) => w.currency === selectedCrypto);
  const balance = selectedWallet ? parseFloat(selectedWallet.balance) : 0;

  const toast = useToast();
  const { t } = useLocale();

  const handleGetQuote = async () => {
    if (!paybillNumber || !accountNumber || !amount) {
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
    if (paybillNumber.length < 4 || paybillNumber.length > 7) {
      toast.warning(t("payment.invalidPaybill"), t("payment.invalidPaybillFormat"));
      return;
    }
    setLoading(true);
    try {
      const { data } = await ratesApi.lockRate({
        currency: selectedCrypto,
        kes_amount: amount,
      });
      setQuote(data);
      // Cache quote for offline reference
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
    router.push({
      pathname: "/payment/confirm",
      params: {
        type: "paybill",
        paybill_number: paybillNumber,
        account_number: accountNumber,
        amount_kes: amount,
        crypto_currency: selectedCrypto,
        quote_id: quote.quote_id,
        crypto_amount: quote.crypto_amount,
        rate: quote.exchange_rate,
        fee: quote.fee_kes,
        excise_duty: quote.excise_duty_kes || "0",
        save_label: saveLabel,
      },
    });
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
          {/* Top-level back button · matches Payments index (pay.tsx) placement */}
          {isDesktop && (
            <View style={{ paddingHorizontal: 32, marginBottom: 16 }}>
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
              <Pressable
                onPress={() => router.replace("/(tabs)/pay" as any)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                testID="back-button"
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
                maxFontSizeMultiplier={1.3}
              >
                {t("payment.payBill")}
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
              {/* Saved Bills */}
              {savedBills.length > 0 && (
                <View style={{ marginBottom: 20 }}>
                  <SectionHeader title="Saved Bills" icon="bookmark-outline" iconColor={colors.primary[400]} />
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 10, paddingBottom: 4 }}
                  >
                    {savedBills.map((bill) => (
                      <Pressable
                        key={bill.id}
                        onPress={() => handleSelectSavedBill(bill)}
                        style={({ pressed, hovered }: any) => ({
                          backgroundColor: isWeb && hovered ? tc.dark.elevated : tc.glass.bg,
                          borderRadius: 14,
                          borderWidth: 1,
                          borderColor:
                            paybillNumber === bill.paybill_number && accountNumber === bill.account_number
                              ? colors.primary[400] + "60"
                              : tc.glass.border,
                          paddingVertical: 12,
                          paddingHorizontal: 16,
                          minWidth: 140,
                          opacity: pressed ? 0.85 : 1,
                          ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
                        })}
                        accessibilityRole="button"
                        accessibilityLabel={`Select saved bill ${bill.label || bill.paybill_number}`}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                          <Text
                            style={{
                              color: tc.textPrimary,
                              fontSize: 13,
                              fontFamily: "DMSans_600SemiBold",
                              flex: 1,
                            }}
                            numberOfLines={1}
                          >
                            {bill.label || "Bill"}
                          </Text>
                          <Pressable
                            onPress={(e) => {
                              e.stopPropagation?.();
                              handleDeleteSavedBill(bill.id);
                            }}
                            hitSlop={8}
                            style={{ marginLeft: 8 }}
                            accessibilityRole="button"
                            accessibilityLabel="Delete saved bill"
                          >
                            <Ionicons name="close-circle-outline" size={16} color={tc.textMuted} />
                          </Pressable>
                        </View>
                        <Text
                          style={{
                            color: tc.textMuted,
                            fontSize: 12,
                            fontFamily: "DMSans_400Regular",
                            marginTop: 4,
                          }}
                        >
                          {bill.paybill_number} / {bill.account_number}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Paybill Number */}
              <SectionHeader title={t("payment.paybillNumber")} icon="document-text-outline" iconColor={colors.primary[400]} />
              <TextInput
                value={paybillNumber}
                onChangeText={setPaybillNumber}
                placeholder="e.g. 888880"
                placeholderTextColor={tc.dark.muted}
                keyboardType="number-pad"
                maxLength={7}
                onFocus={() => setFocusedField("paybill")}
                onBlur={() => setFocusedField(null)}
                style={{
                  backgroundColor: tc.dark.card,
                  color: tc.textPrimary,
                  fontSize: 16,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: inputBorderColor("paybill"),
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  marginBottom: 20,
                  ...(isWeb ? { outlineStyle: "none", transition: "border-color 0.15s ease, box-shadow 0.15s ease" } as any : {}),
                  ...inputFocusGlow("paybill"),
                }}
                accessibilityLabel="Paybill Number"
                testID="paybill-number-input"
                maxFontSizeMultiplier={1.3}
              />

              {/* Account Number */}
              <SectionHeader title={t("payment.accountNumber")} icon="key-outline" iconColor={colors.primary[400]} />
              <TextInput
                value={accountNumber}
                onChangeText={setAccountNumber}
                placeholder="e.g. 12345678"
                placeholderTextColor={tc.dark.muted}
                onFocus={() => setFocusedField("account")}
                onBlur={() => setFocusedField(null)}
                style={{
                  backgroundColor: tc.dark.card,
                  color: tc.textPrimary,
                  fontSize: 16,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: inputBorderColor("account"),
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  marginBottom: 20,
                  ...(isWeb ? { outlineStyle: "none", transition: "border-color 0.15s ease, box-shadow 0.15s ease" } as any : {}),
                  ...inputFocusGlow("account"),
                }}
                accessibilityLabel="Account Number"
                testID="account-number-input"
                maxFontSizeMultiplier={1.3}
              />

              {/* Save Label */}
              <SectionHeader title="Save as (optional)" icon="bookmark-outline" iconColor={colors.primary[400]} />
              <TextInput
                value={saveLabel}
                onChangeText={setSaveLabel}
                placeholder="e.g. KPLC Home, DSTV"
                placeholderTextColor={tc.dark.muted}
                onFocus={() => setFocusedField("label")}
                onBlur={() => setFocusedField(null)}
                style={{
                  backgroundColor: tc.dark.card,
                  color: tc.textPrimary,
                  fontSize: 15,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: inputBorderColor("label"),
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  marginBottom: 20,
                  ...(isWeb ? { outlineStyle: "none", transition: "border-color 0.15s ease, box-shadow 0.15s ease" } as any : {}),
                  ...inputFocusGlow("label"),
                }}
                accessibilityLabel="Save label for this paybill"
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
                <GlassCard
                  glowOpacity={0.15}
                  style={{
                    marginTop: 24,
                  }}
                >
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
                    disabled={!paybillNumber || !accountNumber || !amount}
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
