import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
  Image,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "../../src/components/Button";
import { CryptoSelector } from "../../src/components/CryptoSelector";
import { useToast } from "../../src/components/Toast";
import { useWallets } from "../../src/hooks/useWallets";
import { ratesApi, Quote } from "../../src/api/rates";
import { paymentsApi, Bank } from "../../src/api/payments";
import { normalizeError } from "../../src/utils/apiErrors";
import { cacheQuote } from "../../src/utils/rateCache";
import { colors, getThemeColors, getThemeShadows, CurrencyCode } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { SectionHeader } from "../../src/components/SectionHeader";
import { PaymentStepper } from "../../src/components/PaymentStepper";
import { GlassCard } from "../../src/components/GlassCard";
import { useLocale } from "../../src/hooks/useLocale";
import { NetworkBadge, currencyToChain } from "../../src/components/brand/NetworkBadge";

const CRYPTO_OPTIONS: CurrencyCode[] = ["USDT", "USDC", "BTC", "ETH", "SOL"];

/**
 * Bank tile logo with letter-initial fallback. The logo URLs in the
 * backend registry point at static assets that may not be deployed yet
 * (placeholder paths under cpay.co.ke/static/banks/). When the image
 * load fails, render the bank's first letter on the tile background ·
 * cleaner than a broken-image glyph and matches our "no emoji as
 * fallback" convention.
 */
function BankTileLogo({
  url,
  name,
  bg,
  textColor,
}: {
  url: string;
  name: string;
  bg: string;
  textColor: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 8,
        overflow: "hidden",
      }}
    >
      {failed ? (
        <Text
          style={{
            color: textColor,
            fontSize: 18,
            fontFamily: "DMSans_700Bold",
          }}
        >
          {name.charAt(0).toUpperCase()}
        </Text>
      ) : (
        <Image
          source={{ uri: url }}
          style={{ width: 32, height: 32, borderRadius: 6 }}
          resizeMode="contain"
          onError={() => setFailed(true)}
        />
      )}
    </View>
  );
}

// Email-verification threshold mirrors the backend gate (50 000 KES).
// Surfaced in the UI so users see the warning before tapping submit.
const EMAIL_VERIFY_THRESHOLD_KES = 50000;

export default function SendToBankScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 900;
  const { data: wallets } = useWallets();

  const [banks, setBanks] = useState<Bank[]>([]);
  const [selectedBank, setSelectedBank] = useState<Bank | null>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedCrypto, setSelectedCrypto] = useState<CurrencyCode>("USDT");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);

  const selectedWallet = wallets?.find((w) => w.currency === selectedCrypto);
  const balance = selectedWallet ? parseFloat(selectedWallet.balance) : 0;

  const toast = useToast();
  const { t } = useLocale();

  // Pull the bank registry on mount. The list is small and changes rarely
  // so a single fetch per screen entry is enough.
  useEffect(() => {
    let alive = true;
    paymentsApi
      .banks()
      .then(({ data }) => {
        if (alive) setBanks(data.banks || []);
      })
      .catch(() => {
        if (alive) toast.error("Error", "Could not load bank list. Try again.");
      });
    return () => {
      alive = false;
    };
  }, [toast]);

  const handleGetQuote = async () => {
    if (!selectedBank) {
      toast.warning("Pick a bank", "Choose the destination bank first.");
      return;
    }
    if (!accountNumber || !amount) {
      toast.warning(t("payment.missingFields"), t("payment.fillAllFields"));
      return;
    }
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 10) {
      toast.warning(t("payment.invalidAmount"), t("payment.minimumAmount"));
      return;
    }
    if (numAmount > 250000) {
      toast.warning(
        t("payment.invalidAmount"),
        "Single bank transfers are capped at KES 250,000 per M-Pesa.",
      );
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
    if (!quote || !selectedBank) return;
    router.push({
      pathname: "/payment/confirm",
      params: {
        type: "bank",
        bank_slug: selectedBank.slug,
        bank_name: selectedBank.name,
        account_number: accountNumber.trim(),
        amount_kes: amount,
        crypto_currency: selectedCrypto,
        quote_id: quote.quote_id,
        crypto_amount: quote.crypto_amount,
        rate: quote.exchange_rate,
        fee: quote.fee_kes,
        excise_duty: quote.excise_duty_kes || "0",
      },
    });
  };

  const inputBorderColor = (field: string) =>
    focusedField === field ? colors.primary[400] + "60" : tc.dark.border;

  const inputFocusGlow = (field: string) =>
    focusedField === field && isWeb
      ? ({ boxShadow: `0 0 0 3px ${colors.primary[500]}15` } as any)
      : {};

  // Bank tile · responsive grid columns. 3 on phones, 4 on tablets,
  // 5 on desktops.
  const gridCols = isDesktop ? (width >= 1200 ? 5 : 4) : 3;
  const tileGap = 10;

  const showEmailWarning =
    parseFloat(amount || "0") > EMAIL_VERIFY_THRESHOLD_KES;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
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

          <View
            style={
              isDesktop
                ? {
                    width: "100%",
                    maxWidth: 720,
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
                  flex: 1,
                  letterSpacing: -0.3,
                }}
                maxFontSizeMultiplier={1.3}
              >
                Send to Bank
              </Text>
              <PaymentStepper currentStep={0} />
            </View>

            <View
              style={{
                paddingHorizontal: isDesktop ? 0 : 20,
                marginTop: isDesktop ? 0 : 8,
              }}
            >
              {/* Subtitle · explains the rail */}
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 13,
                  fontFamily: "DMSans_400Regular",
                  lineHeight: 18,
                  marginBottom: 20,
                }}
                maxFontSizeMultiplier={1.3}
              >
                Crypto · KES · bank account, in one tap. Funds arrive in your
                bank within a minute, sometimes up to 10 minutes during peak
                hours.
              </Text>

              {/* Bank picker grid */}
              <SectionHeader
                title="Pick a bank"
                icon="business-outline"
                iconColor={colors.primary[400]}
              />
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: tileGap,
                  marginBottom: 20,
                }}
              >
                {banks.map((bank) => {
                  const isSelected = selectedBank?.slug === bank.slug;
                  return (
                    <Pressable
                      key={bank.slug}
                      onPress={() => {
                        setSelectedBank(bank);
                        setQuote(null);
                      }}
                      style={({ pressed, hovered }: any) => ({
                        width: `calc(${100 / gridCols}% - ${(tileGap * (gridCols - 1)) / gridCols}px)` as any,
                        backgroundColor: isSelected ? colors.primary[400] + "20" : tc.dark.card,
                        borderRadius: 14,
                        padding: 12,
                        alignItems: "center",
                        borderWidth: 1.5,
                        borderColor: isSelected
                          ? colors.primary[400]
                          : hovered
                            ? colors.primary[400] + "60"
                            : tc.glass.border,
                        opacity: pressed ? 0.85 : 1,
                        ...(isWeb
                          ? ({
                              cursor: "pointer",
                              transition: "all 0.15s ease",
                            } as any)
                          : {}),
                      })}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${bank.name}`}
                    >
                      <BankTileLogo
                        url={bank.logo_url}
                        name={bank.name}
                        bg={tc.dark.elevated}
                        textColor={tc.textPrimary}
                      />
                      <Text
                        numberOfLines={2}
                        style={{
                          color: tc.textPrimary,
                          fontSize: 11,
                          fontFamily: "DMSans_600SemiBold",
                          textAlign: "center",
                          lineHeight: 14,
                        }}
                        maxFontSizeMultiplier={1.2}
                      >
                        {bank.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Account number */}
              {selectedBank && (
                <>
                  <SectionHeader
                    title={`Account at ${selectedBank.name}`}
                    icon="card-outline"
                    iconColor={colors.primary[400]}
                  />
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 12,
                      fontFamily: "DMSans_400Regular",
                      marginBottom: 8,
                    }}
                    maxFontSizeMultiplier={1.3}
                  >
                    {selectedBank.account_format_hint}
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: tc.dark.card,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: inputBorderColor("account"),
                      paddingHorizontal: 16,
                      marginBottom: 20,
                      ...(isWeb
                        ? ({ transition: "border-color 0.15s ease, box-shadow 0.15s ease" } as any)
                        : {}),
                      ...inputFocusGlow("account"),
                    }}
                  >
                    <TextInput
                      value={accountNumber}
                      onChangeText={(text) => {
                        setAccountNumber(text.replace(/[^0-9\s\-]/g, ""));
                        setQuote(null);
                      }}
                      placeholder="Account number"
                      placeholderTextColor={tc.dark.muted}
                      keyboardType="number-pad"
                      maxLength={30}
                      onFocus={() => setFocusedField("account")}
                      onBlur={() => setFocusedField(null)}
                      style={{
                        flex: 1,
                        color: tc.textPrimary,
                        fontSize: 16,
                        paddingVertical: 14,
                        ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
                      }}
                      accessibilityLabel="Account number"
                      testID="account-number-input"
                      maxFontSizeMultiplier={1.3}
                    />
                  </View>

                  {/* Amount */}
                  <SectionHeader
                    title={t("payment.amountKes")}
                    icon="cash-outline"
                    iconColor={colors.primary[400]}
                  />
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: tc.dark.card,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: inputBorderColor("amount"),
                      paddingHorizontal: 16,
                      ...(isWeb
                        ? ({ transition: "border-color 0.15s ease, box-shadow 0.15s ease" } as any)
                        : {}),
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
                        ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
                      }}
                      accessibilityLabel="Amount in KES"
                      testID="amount-input"
                      maxFontSizeMultiplier={1.3}
                    />
                  </View>

                  {/* Crypto Selector */}
                  <View style={{ marginTop: 24 }}>
                    <SectionHeader
                      title={t("payment.payWith")}
                      icon="wallet-outline"
                      iconColor={colors.primary[400]}
                    />
                  </View>
                  <CryptoSelector
                    options={CRYPTO_OPTIONS}
                    selected={selectedCrypto}
                    wallets={wallets}
                    onSelect={(c) => {
                      setSelectedCrypto(c);
                      setQuote(null);
                    }}
                  />
                  <View style={{ flexDirection: "row", marginTop: 10 }}>
                    <NetworkBadge chain={currencyToChain(selectedCrypto)} dark />
                  </View>

                  {/* Email-verify warning when amount is over the threshold */}
                  {showEmailWarning && (
                    <View
                      style={{
                        marginTop: 20,
                        backgroundColor: "#F59E0B22",
                        borderRadius: 12,
                        padding: 14,
                        borderWidth: 1,
                        borderColor: "#F59E0B40",
                        flexDirection: "row",
                        gap: 10,
                      }}
                    >
                      <Ionicons name="warning-outline" size={20} color="#F59E0B" />
                      <Text
                        style={{
                          color: tc.textPrimary,
                          fontSize: 13,
                          fontFamily: "DMSans_500Medium",
                          flex: 1,
                          lineHeight: 18,
                        }}
                        maxFontSizeMultiplier={1.3}
                      >
                        Bank transfers above KES 50,000 require a verified email.
                        Verify in Settings · Security before continuing.
                      </Text>
                    </View>
                  )}

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
                            style={{ color: tc.error, fontSize: 12, marginTop: 8 }}
                            maxFontSizeMultiplier={1.3}
                          >
                            {t("payment.insufficientBalance", { currency: selectedCrypto })}
                          </Text>
                        )}
                        <Text
                          style={{ color: tc.dark.muted, fontSize: 12, marginTop: 8 }}
                          maxFontSizeMultiplier={1.3}
                        >
                          Sending to {selectedBank.name} · {accountNumber}
                        </Text>
                      </View>
                    </GlassCard>
                  )}

                  {/* Action Button */}
                  <View
                    style={{
                      marginTop: 28,
                      marginBottom: 32,
                      maxWidth: isDesktop ? 420 : undefined,
                      alignSelf: isDesktop ? "center" : undefined,
                      width: isDesktop ? "100%" : undefined,
                    }}
                  >
                    {!quote ? (
                      <Button
                        title={t("payment.getQuote")}
                        onPress={handleGetQuote}
                        loading={loading}
                        disabled={!accountNumber || !amount || !selectedBank}
                        size="lg"
                        icon={<Ionicons name="flash-outline" size={20} color="#FFFFFF" />}
                        testID="get-quote-button"
                      />
                    ) : (
                      <Button
                        title="Send to Bank"
                        onPress={handleConfirm}
                        disabled={parseFloat(quote.crypto_amount) > balance}
                        size="lg"
                        icon={<Ionicons name="arrow-forward-circle-outline" size={20} color="#FFFFFF" />}
                        testID="confirm-payment-button"
                      />
                    )}
                  </View>
                </>
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
