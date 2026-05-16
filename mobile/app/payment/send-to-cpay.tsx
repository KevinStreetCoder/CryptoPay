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
import { ratesApi, normalizeRate, Rate } from "../../src/api/rates";
import { useQuery } from "@tanstack/react-query";

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

  // 2026-05-16 · live KES preview · user enters the amount in crypto
  // units (what the backend wants) and we show "≈ KSh 123.45" beneath
  // so they have an instant feel for the actual KES value the
  // recipient will see in their wallet. Uses the same /rates/ feed
  // wallet.tsx uses · shared React Query cache key keeps the rate
  // consistent across screens.
  const { data: rates } = useQuery<Rate[]>({
    queryKey: ["rates"],
    queryFn: async () => {
      const currencies = ["USDC", "USDT", "BTC", "SOL", "ETH"];
      const results = await Promise.all(
        currencies.map(async (c) => {
          try {
            const { data } = await ratesApi.getRate(c);
            return normalizeRate(data);
          } catch {
            return null;
          }
        }),
      );
      return results.filter(Boolean) as Rate[];
    },
    refetchInterval: 30000,
    staleTime: 0,
  });
  const cryptoRate = rates?.find((r) => r.currency === selectedCrypto);
  const kesPerCrypto = cryptoRate ? parseFloat(cryptoRate.kes_rate) || 0 : 0;
  const kesEquivalent = parsedAmount * kesPerCrypto;

  // 2026-05-16 · KES-first amount entry. Users find it MUCH easier to
  // think in KES ("send my friend 200 bob") than in crypto units
  // ("send 0.001823 SOL"). The mode toggle lives on the amount card:
  //   - "kes" mode  → user types KES, we compute crypto = KES / rate
  //   - "crypto" mode → user types crypto, we show KES equivalent
  //                     (original behaviour · kept for power users)
  // The CRYPTO amount is what we send to the backend regardless.
  const [amountMode, setAmountMode] = useState<"kes" | "crypto">("kes");
  const [kesInput, setKesInput] = useState<string>("");
  const parsedKes = parseFloat(kesInput) || 0;

  // When the user types in KES, derive the crypto amount + sync the
  // `amount` field (which is the crypto value the backend expects).
  useEffect(() => {
    if (amountMode !== "kes") return;
    if (!parsedKes || !kesPerCrypto) {
      // Don't wipe a crypto-mode amount when user toggles modes.
      return;
    }
    const cryptoFromKes = parsedKes / kesPerCrypto;
    // Round to the currency's decimals so we don't send 17 decimal places.
    const rounded = cryptoFromKes.toFixed(Math.min(decimals, 8));
    if (rounded !== amount) setAmount(rounded);
  }, [kesInput, kesPerCrypto, amountMode, decimals]);

  // When the user toggles modes, seed the inactive field with the
  // computed equivalent so they see a sensible starting value.
  const switchToKesMode = () => {
    setAmountMode("kes");
    if (parsedAmount > 0 && kesPerCrypto > 0 && !kesInput) {
      setKesInput((parsedAmount * kesPerCrypto).toFixed(2));
    }
  };
  const switchToCryptoMode = () => {
    setAmountMode("crypto");
  };

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

  // 2026-05-16 · recipient lookup runs in TWO modes:
  //   - typeahead suggestions list as the user types (3+ chars)
  //   - confirmed single-result match once the user PICKS one
  //
  // The pre-2026-05-16 single-result auto-match was too fragile
  // when multiple "John"s exist · the sender had no way to pick
  // between them. Now we surface a click-to-confirm list and only
  // gate Continue when one entry has been explicitly chosen.
  type Suggestion = {
    id: string;
    display_name: string;
    phone_masked: string;
    matched_by: string;
  };
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestState, setSuggestState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [pickedRecipient, setPickedRecipient] = useState<Suggestion | null>(null);

  useEffect(() => {
    const v = recipient.trim();
    if (v.length < 3) {
      setSuggestions([]);
      setSuggestState("idle");
      // Clear the picked recipient if the user re-types from scratch.
      setPickedRecipient(null);
      return;
    }
    // If the user already picked someone and the text still matches
    // that pick's display, don't re-query · they're confirmed.
    if (pickedRecipient && (
      v === pickedRecipient.display_name
      || v === pickedRecipient.phone_masked
    )) {
      return;
    }
    setSuggestState("loading");
    const timer = setTimeout(async () => {
      try {
        const { data } = await paymentsApi.cpayUserSuggest(v);
        setSuggestions(data.results || []);
        setSuggestState("loaded");
      } catch (err: any) {
        setSuggestions([]);
        setSuggestState("error");
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [recipient, pickedRecipient]);

  const recipientFound = pickedRecipient !== null;

  const canContinue =
    parsedAmount > 0 &&
    parsedAmount <= balance &&
    recipientFound;

  const handleContinue = () => {
    if (!canContinue) {
      if (parsedAmount <= 0) {
        toast.warning("Amount required", "Enter the amount you want to send.");
      } else if (parsedAmount > balance) {
        toast.warning("Insufficient balance", `You have ${balance.toFixed(decimals)} ${selectedCrypto}.`);
      } else if (!pickedRecipient && suggestState === "loaded" && suggestions.length === 0) {
        toast.warning(
          "Recipient not on Cpay",
          "We couldn't find anyone matching · ask them to sign up first.",
        );
      } else if (!pickedRecipient && suggestState === "loading") {
        toast.info("Checking recipient", "Hang on a moment…");
      } else if (!pickedRecipient && suggestions.length > 0) {
        toast.warning("Pick recipient", "Tap one of the matches below to confirm who you're sending to.");
      } else {
        toast.warning("Recipient required", "Enter a phone, name, or Cpay referral code.");
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
      // 2026-05-16 · backend's POST /send-to-cpay/ reads PREFIXED keys
      // (`recipient_phone` / `recipient_username` / `recipient_referral_code`).
      // Earlier we were spreading the detect-kind dict unprefixed
      // ({phone, username, referral_code}) and every POST 404'd
      // "Recipient not found" even when the pre-flight lookup
      // succeeded. Map explicitly so a future refactor of
      // detectRecipientKind() can't silently re-introduce the bug.
      // (Backend now also accepts unprefixed keys for safety, but
      //  this is the canonical shape.)
      const recipientBody: {
        recipient_phone?: string;
        recipient_username?: string;
        recipient_referral_code?: string;
      } = {};
      if (recipientKind.phone) recipientBody.recipient_phone = recipientKind.phone;
      if (recipientKind.username) recipientBody.recipient_username = recipientKind.username;
      if (recipientKind.referral_code) recipientBody.recipient_referral_code = recipientKind.referral_code;

      const { data } = await paymentsApi.sendToCpay({
        ...recipientBody,
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

            {/* 2026-05-16 · richer PIN-confirm card · mirrors the paybill
                confirm screen so the sender sees a full transaction
                breakdown (amount, recipient, KES equivalent, memo)
                BEFORE typing their PIN. Earlier this screen showed
                just "0.0100 SOL → John Njongoro" which obscured the
                actual KES value at stake. */}
            <View style={{ alignItems: "center", marginTop: 16, marginBottom: 20 }}>
              <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: colors.primary[500] + "1A", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: colors.primary[500] + "25", marginBottom: 12 }}>
                <Ionicons name="lock-closed" size={28} color={colors.primary[400]} />
              </View>
              <Text style={{ color: tc.textPrimary, fontSize: 22, fontFamily: "DMSans_700Bold", textAlign: "center", marginBottom: 4 }}>
                Confirm send to Cpay
              </Text>
              <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular", textAlign: "center", marginBottom: 16 }}>
                Your PIN is never stored or shared
              </Text>

              <View
                style={{
                  width: "100%",
                  backgroundColor: tc.dark.card,
                  borderRadius: 16,
                  paddingHorizontal: 20,
                  paddingVertical: 18,
                  borderWidth: 1,
                  borderColor: tc.glass.border,
                  gap: 14,
                }}
              >
                {/* Recipient · avatar circle + name + masked phone */}
                {pickedRecipient ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: tc.glass.border }}>
                    <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary[500] + "20", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ color: colors.primary[400], fontSize: 18, fontFamily: "DMSans_700Bold" }}>
                        {(pickedRecipient.display_name?.[0] || "?").toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: tc.textMuted, fontSize: 10, letterSpacing: 1, fontFamily: "DMSans_600SemiBold" }}>
                        SENDING TO
                      </Text>
                      <Text style={{ color: tc.textPrimary, fontSize: 16, fontFamily: "DMSans_700Bold", marginTop: 2 }}>
                        {pickedRecipient.display_name}
                      </Text>
                      <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular", marginTop: 1 }}>
                        {pickedRecipient.phone_masked} · matched by {pickedRecipient.matched_by.replace("_", " ")}
                      </Text>
                    </View>
                  </View>
                ) : null}

                {/* Amount row · big crypto + KES equivalent beneath */}
                <View>
                  <Text style={{ color: tc.textMuted, fontSize: 10, letterSpacing: 1, fontFamily: "DMSans_600SemiBold" }}>
                    AMOUNT
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                    <Text style={{ color: tc.textPrimary, fontSize: 24, fontFamily: "DMSans_700Bold" }}>
                      {parsedAmount.toFixed(Math.min(decimals, 8))}
                    </Text>
                    <Text style={{ color: tc.textSecondary, fontSize: 16, fontFamily: "DMSans_600SemiBold" }}>
                      {selectedCrypto}
                    </Text>
                  </View>
                  {kesPerCrypto > 0 ? (
                    <Text style={{ color: colors.primary[400], fontSize: 13, fontFamily: "DMSans_500Medium", marginTop: 2 }}>
                      ≈ KSh {(parsedAmount * kesPerCrypto).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Text>
                  ) : null}
                </View>

                {memo ? (
                  <View>
                    <Text style={{ color: tc.textMuted, fontSize: 10, letterSpacing: 1, fontFamily: "DMSans_600SemiBold" }}>
                      MEMO
                    </Text>
                    <Text style={{ color: tc.textPrimary, fontSize: 13, fontFamily: "DMSans_500Medium", marginTop: 4, fontStyle: "italic" }} numberOfLines={2}>
                      "{memo}"
                    </Text>
                  </View>
                ) : null}

                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: tc.glass.border }}>
                  <Ionicons name="flash" size={12} color={colors.success} />
                  <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_500Medium" }}>
                    Instant · free · ledger-only · no M-Pesa hop
                  </Text>
                </View>
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
              {/* 2026-05-16 · live recipient confirmation card · proves
                  the recipient is a real Cpay user before the sender
                  hits Continue → PIN. Four visual states:
                    idle      · no input, no card
                    loading   · spinner
                    found     · green card with the name + masked phone
                    not_found · red card · sender knows they can't send
                  Removes the "type PIN, see 'Recipient not found'" trap. */}
              {/*
                2026-05-16 · two-stage recipient picker.

                State 1 · USER STILL TYPING · suggestState is "loading"
                or "loaded" and pickedRecipient is null. We show the
                suggestion list (up to 5 results) as clickable cards.
                Empty result list → "no match" hint. Each card has the
                same shape as the single-result confirmed card so
                tap-to-pick feels continuous.

                State 2 · USER PICKED ONE · pickedRecipient is set.
                We show one big "Sending to: Jane D. (+254712••••89)"
                confirmation card with a "Change" button that clears
                the pick + lets them re-type.
              */}
              {recipient ? (
                <View style={{ marginBottom: 14 }}>
                  {pickedRecipient ? (
                    /* Confirmed pick */
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        paddingVertical: 12,
                        paddingHorizontal: 14,
                        backgroundColor: colors.success + "12",
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: colors.success + "40",
                      }}
                      accessibilityLabel={`Sending to ${pickedRecipient.display_name}`}
                    >
                      <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_700Bold" }}>
                          {pickedRecipient.display_name}
                        </Text>
                        <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular", marginTop: 2 }}>
                          {pickedRecipient.phone_masked} · matched by {pickedRecipient.matched_by.replace("_", " ")}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => {
                          setPickedRecipient(null);
                          setRecipient("");
                          setSuggestions([]);
                          setSuggestState("idle");
                        }}
                        accessibilityLabel="Change recipient"
                        hitSlop={8}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 8,
                          backgroundColor: tc.dark.card,
                          borderWidth: 1,
                          borderColor: tc.glass.border,
                        }}
                      >
                        <Text style={{ color: tc.textPrimary, fontSize: 11, fontFamily: "DMSans_600SemiBold" }}>
                          Change
                        </Text>
                      </Pressable>
                    </View>
                  ) : suggestState === "loading" ? (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        paddingVertical: 10,
                        paddingHorizontal: 14,
                        backgroundColor: tc.dark.card,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: tc.glass.border,
                      }}
                    >
                      <Spinner size={14} color={tc.textMuted} />
                      <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_500Medium" }}>
                        Searching Cpay users…
                      </Text>
                    </View>
                  ) : suggestState === "loaded" && suggestions.length > 0 ? (
                    /* Suggestion list · clickable cards */
                    <View>
                      <Text style={{ color: tc.textMuted, fontSize: 10, fontFamily: "DMSans_600SemiBold", letterSpacing: 1, marginBottom: 8, paddingHorizontal: 4, textTransform: "uppercase" }}>
                        Tap to pick recipient
                      </Text>
                      {suggestions.map((s) => (
                        <Pressable
                          key={s.id}
                          onPress={() => {
                            setPickedRecipient(s);
                            // Replace the input with the picked display name so
                            // the user sees a coherent state.
                            setRecipient(s.display_name);
                          }}
                          style={({ pressed, hovered }: any) => ({
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 10,
                            paddingVertical: 12,
                            paddingHorizontal: 14,
                            backgroundColor: pressed || hovered ? colors.primary[500] + "10" : tc.dark.card,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: tc.glass.border,
                            marginBottom: 8,
                            ...(isWeb ? { cursor: "pointer", transition: "all 0.12s ease" } : {}),
                          })}
                          accessibilityLabel={`Pick ${s.display_name}`}
                          accessibilityRole="button"
                        >
                          <View
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 18,
                              backgroundColor: colors.primary[500] + "20",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Text style={{ color: colors.primary[400], fontSize: 14, fontFamily: "DMSans_700Bold" }}>
                              {(s.display_name?.[0] || "?").toUpperCase()}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: tc.textPrimary, fontSize: 14, fontFamily: "DMSans_600SemiBold" }}>
                              {s.display_name}
                            </Text>
                            <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular", marginTop: 2 }}>
                              {s.phone_masked} · by {s.matched_by.replace("_", " ")}
                            </Text>
                          </View>
                          <Ionicons name="chevron-forward" size={16} color={tc.textMuted} />
                        </Pressable>
                      ))}
                    </View>
                  ) : suggestState === "loaded" && suggestions.length === 0 ? (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        paddingVertical: 10,
                        paddingHorizontal: 14,
                        backgroundColor: colors.error + "12",
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: colors.error + "40",
                      }}
                    >
                      <Ionicons name="close-circle" size={16} color={colors.error} />
                      <Text style={{ color: tc.textPrimary, fontSize: 12, fontFamily: "DMSans_500Medium", flex: 1 }}>
                        Nobody matches "{recipient}" on Cpay · ask them to sign up first.
                      </Text>
                    </View>
                  ) : (
                    <Text style={{ color: tc.textMuted, fontSize: 11, fontFamily: "DMSans_400Regular", paddingHorizontal: 4 }}>
                      {recipient.length < 3
                        ? "Keep typing · we'll show matches after 3+ characters."
                        : "Detected as: " + (recipientKind.phone ? "phone" : recipientKind.referral_code ? "referral code" : "name")}
                    </Text>
                  )}
                </View>
              ) : (
                <View style={{ height: 14 }} />
              )}

              {/* Amount · 2026-05-16 KES-first by default · the toggle
                  swaps which side the user is typing on. Crypto value
                  is always what goes to the backend; KES is just a
                  user-facing mental-math aid. */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <SectionHeader title="Amount" icon="cash-outline" iconColor={colors.primary[400]} />
                <View
                  style={{
                    flexDirection: "row",
                    backgroundColor: tc.dark.card,
                    borderRadius: 10,
                    padding: 2,
                    borderWidth: 1,
                    borderColor: tc.glass.border,
                  }}
                >
                  <Pressable
                    onPress={switchToKesMode}
                    style={({ pressed }) => ({
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 8,
                      backgroundColor: amountMode === "kes" ? colors.primary[500] + "25" : "transparent",
                      opacity: pressed ? 0.7 : 1,
                    })}
                    accessibilityLabel="Enter amount in KES"
                  >
                    <Text style={{ color: amountMode === "kes" ? colors.primary[400] : tc.textMuted, fontSize: 11, fontFamily: "DMSans_700Bold", letterSpacing: 0.6 }}>
                      KES
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={switchToCryptoMode}
                    style={({ pressed }) => ({
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 8,
                      backgroundColor: amountMode === "crypto" ? colors.primary[500] + "25" : "transparent",
                      opacity: pressed ? 0.7 : 1,
                    })}
                    accessibilityLabel={`Enter amount in ${selectedCrypto}`}
                  >
                    <Text style={{ color: amountMode === "crypto" ? colors.primary[400] : tc.textMuted, fontSize: 11, fontFamily: "DMSans_700Bold", letterSpacing: 0.6 }}>
                      {selectedCrypto}
                    </Text>
                  </Pressable>
                </View>
              </View>

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
                  {amountMode === "kes" ? "KSh" : selectedCrypto}
                </Text>
                {amountMode === "kes" ? (
                  <TextInput
                    value={kesInput}
                    onChangeText={setKesInput}
                    placeholder="0"
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
                    accessibilityLabel="Amount in KES"
                  />
                ) : (
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
                    accessibilityLabel={`Amount in ${selectedCrypto}`}
                  />
                )}
                <Pressable
                  onPress={() => {
                    if (amountMode === "kes" && kesPerCrypto > 0) {
                      setKesInput((balance * kesPerCrypto).toFixed(0));
                    } else {
                      setAmount(balance.toFixed(decimals));
                    }
                  }}
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
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 16,
                  paddingHorizontal: 4,
                }}
              >
                <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular" }}>
                  Available: {balance.toFixed(decimals)} {selectedCrypto}
                  {kesPerCrypto > 0 ? `  ·  ≈ KSh ${(balance * kesPerCrypto).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : ""}
                </Text>
                {/* 2026-05-16 · always show the OTHER side of the conversion
                    so the user has both numbers visible. In KES mode this is
                    "= 0.001823 SOL"; in crypto mode it's "≈ KSh 132.50". */}
                {amountMode === "kes" && parsedAmount > 0 ? (
                  <Text style={{ color: colors.primary[400], fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>
                    = {parsedAmount.toFixed(Math.min(decimals, 8))} {selectedCrypto}
                  </Text>
                ) : amountMode === "crypto" && parsedAmount > 0 && kesPerCrypto > 0 ? (
                  <Text style={{ color: colors.primary[400], fontSize: 12, fontFamily: "DMSans_600SemiBold" }}>
                    ≈ KSh {kesEquivalent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Text>
                ) : null}
              </View>

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
