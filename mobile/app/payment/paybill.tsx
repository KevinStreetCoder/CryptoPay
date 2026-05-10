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
import { getFrequent, type RecipientEntry } from "../../src/utils/recipientPrefs";
import { usePersistedState } from "../../src/hooks/usePersistedState";

const CRYPTO_OPTIONS: CurrencyCode[] = ["USDT", "USDC", "BTC", "ETH", "SOL"];

// 2026-05-09 · keys for usePersistedState. Survives network blip /
// reload. Cleared after successful payment in confirm.tsx.
const PERSIST_KEYS = {
  paybill: "paybill_number",
  account: "paybill_account",
  amount: "paybill_amount",
  label: "paybill_label",
  crypto: "paybill_crypto",
};

export default function PayBillScreen() {
  const router = useRouter();
  const { prefill, name: prefillName, account: prefillAccount } = useLocalSearchParams<{ prefill?: string; name?: string; account?: string }>();
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 900;
  const { data: wallets } = useWallets();
  // 2026-05-09 · persisted form state. The prefill from URL params
  // takes precedence over the persisted value (user tapped a saved
  // bill so they expect that one to load).
  const [paybillNumber, setPaybillNumber] = usePersistedState(
    PERSIST_KEYS.paybill, prefill || "",
  );
  const [accountNumber, setAccountNumber] = usePersistedState(
    PERSIST_KEYS.account, prefillAccount || "",
  );
  const [saveLabel, setSaveLabel] = usePersistedState(
    PERSIST_KEYS.label, prefillName || "",
  );
  const [amount, setAmount] = usePersistedState(PERSIST_KEYS.amount, "");
  const [persistedCrypto, setPersistedCrypto] = usePersistedState(
    PERSIST_KEYS.crypto, "USDT",
  );
  const selectedCrypto = (persistedCrypto || "USDT") as CurrencyCode;
  const setSelectedCrypto = (c: CurrencyCode) => setPersistedCrypto(c);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [savedBills, setSavedBills] = useState<SavedPaybill[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  // 2026-05-09 · top-3 paybills the user has paid most recently /
  // frequently. Read from recipientPrefs (90-day half-life decay) so
  // a one-off burst doesn't pin a bill forever. Fresh devices start
  // empty · the section is hidden when the list is empty.
  const [frequentBills, setFrequentBills] = useState<RecipientEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await getFrequent("paybill");
      if (!cancelled) setFrequentBills(list);
    })();
    return () => { cancelled = true; };
  }, []);

  // 2026-05-10 · Bill-query for utility paybills · when user types a
  // utility paybill+account, debounce-call /utilities/bill-query/
  // and show the customer name + due amount BEFORE confirming.
  // Eliminates wrong-smartcard typos. Only fires for documented
  // utility codes (DSTV/GOTV/water · KPLC tokens use a separate
  // dedicated endpoint).
  const PAYBILL_TO_SERVICE_CODE: Record<string, string> = {
    "444900": "SP-DSTV",
    "423655": "SP-GOTV",
    "525252": "SP-NRB-WATER",
  };
  const [billPreview, setBillPreview] = useState<{
    customer_name: string;
    due_amount: string;
    due_date: string;
  } | null>(null);
  const [billPreviewState, setBillPreviewState] = useState<"idle" | "loading" | "found" | "notfound" | "error">("idle");
  useEffect(() => {
    setBillPreview(null);
    setBillPreviewState("idle");
    const serviceCode = PAYBILL_TO_SERVICE_CODE[paybillNumber];
    if (!serviceCode || !accountNumber || accountNumber.length < 4) return;
    let cancelled = false;
    setBillPreviewState("loading");
    const timer = setTimeout(async () => {
      try {
        const { data } = await paymentsApi.billQuery({
          service_code: serviceCode,
          account_number: accountNumber,
        });
        if (cancelled) return;
        if (data?.customer_name) {
          setBillPreview({
            customer_name: data.customer_name,
            due_amount: data.due_amount || "",
            due_date: data.due_date || "",
          });
          setBillPreviewState("found");
          // If user hasn't entered an amount yet, pre-fill with the
          // due amount so a quick "pay full" tap is one click away.
          if (!amount && data.due_amount) {
            setAmount(data.due_amount);
          }
        } else {
          setBillPreviewState("notfound");
        }
      } catch {
        if (!cancelled) setBillPreviewState("error");
      }
    }, 700);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paybillNumber, accountNumber]);

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
              {/* 2026-05-10 · UNIFIED "Recent" section · merges
                  server-side Saved Bills (explicit pins) + on-device
                  Frequent (auto-tracked usage). User feedback: two
                  separate sections doing the same thing was confusing.
                  Saved entries take priority (deduped by paybill+account)
                  and show a bookmark icon · frequent-only entries show
                  a clock icon. Both tap to prefill the form. Saved
                  entries get a delete X. Limited to 6 visible to keep
                  the section scannable on phone screens. */}
              {(() => {
                type Entry = {
                  paybill: string;
                  account: string;
                  label: string;
                  saved: boolean;
                  savedId?: string;
                };
                const merged: Entry[] = [];
                const seen = new Set<string>();
                // Saved first (priority)
                for (const b of savedBills) {
                  const key = `${b.paybill_number}|${b.account_number}`;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  merged.push({
                    paybill: b.paybill_number,
                    account: b.account_number,
                    label: b.label || "",
                    saved: true,
                    savedId: b.id,
                  });
                }
                // Frequent fills the gap
                for (const f of frequentBills) {
                  const key = `${f.id}|${f.account || ""}`;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  merged.push({
                    paybill: f.id,
                    account: f.account || "",
                    label: f.label || "",
                    saved: false,
                  });
                }
                const visible = merged.slice(0, 6);
                if (visible.length === 0) return null;
                return (
                  <View style={{ marginBottom: 20 }}>
                    <SectionHeader title="Recent" icon="time-outline" iconColor={colors.primary[400]} />
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, paddingBottom: 4 }}>
                      {visible.map((entry, idx) => {
                        const cols = width >= 900 ? 4 : width >= 600 ? 3 : 2;
                        const isOrphan = visible.length % cols === 1 && idx === visible.length - 1;
                        const wPct = isOrphan ? "100%" : `${100 / cols - 2}%`;
                        const isSelected = paybillNumber === entry.paybill && accountNumber === entry.account;
                        return (
                          <Pressable
                            key={`recent-${entry.paybill}-${entry.account || "_"}`}
                            onPress={() => {
                              setPaybillNumber(entry.paybill);
                              if (entry.account) setAccountNumber(entry.account);
                              if (entry.label) setSaveLabel(entry.label);
                            }}
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
                            accessibilityLabel={`${entry.saved ? "Saved" : "Frequent"} bill ${entry.label || entry.paybill}`}
                          >
                            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                                <Ionicons
                                  name={entry.saved ? "bookmark" : "time-outline"}
                                  size={12}
                                  color={entry.saved ? colors.primary[400] : tc.textMuted}
                                  style={{ flexShrink: 0 }}
                                />
                                <Text
                                  style={{
                                    color: tc.textPrimary,
                                    fontSize: 13,
                                    fontFamily: "DMSans_600SemiBold",
                                    flex: 1,
                                  }}
                                  numberOfLines={1}
                                >
                                  {entry.label || `Paybill ${entry.paybill}`}
                                </Text>
                              </View>
                              {entry.saved && entry.savedId ? (
                                <Pressable
                                  onPress={(e) => {
                                    e.stopPropagation?.();
                                    handleDeleteSavedBill(entry.savedId!);
                                  }}
                                  hitSlop={8}
                                  accessibilityRole="button"
                                  accessibilityLabel="Delete saved bill"
                                  style={{ flexShrink: 0 }}
                                >
                                  <Ionicons name="close-circle-outline" size={16} color={tc.textMuted} />
                                </Pressable>
                              ) : null}
                            </View>
                            <Text
                              style={{
                                color: tc.textMuted,
                                fontSize: 12,
                                fontFamily: "DMSans_400Regular",
                                marginTop: 4,
                              }}
                              numberOfLines={1}
                            >
                              {entry.paybill}{entry.account ? ` · ${entry.account}` : ""}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                );
              })()}

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

              {/* 2026-05-10 · Bill-query preview · only renders when
                  this paybill is a known utility (DSTV/GOTV/water).
                  Shows "Customer · Due amount · Due date" so the user
                  confirms BEFORE paying. Reduces wrong-smartcard
                  losses. */}
              {PAYBILL_TO_SERVICE_CODE[paybillNumber] && accountNumber.length >= 4 && (
                <View style={{ marginTop: -12, marginBottom: 16, paddingHorizontal: 4 }}>
                  {billPreviewState === "loading" && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_500Medium" }}>
                        Looking up bill…
                      </Text>
                    </View>
                  )}
                  {billPreviewState === "found" && billPreview && (
                    <GlassCard glowOpacity={0.10} style={{ marginTop: 4 }}>
                      <View style={{ padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: tc.textPrimary, fontSize: 13, fontFamily: "DMSans_700Bold" }} numberOfLines={1}>
                            {billPreview.customer_name}
                          </Text>
                          {!!billPreview.due_amount && (
                            <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular", marginTop: 2 }} numberOfLines={1}>
                              Due: KSh {billPreview.due_amount}
                              {billPreview.due_date ? ` · ${billPreview.due_date}` : ""}
                            </Text>
                          )}
                        </View>
                      </View>
                    </GlassCard>
                  )}
                  {billPreviewState === "notfound" && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name="alert-circle-outline" size={14} color="#F59E0B" />
                      <Text style={{ color: "#F59E0B", fontSize: 12, fontFamily: "DMSans_500Medium" }}>
                        Bill not found · check the account number
                      </Text>
                    </View>
                  )}
                </View>
              )}

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
