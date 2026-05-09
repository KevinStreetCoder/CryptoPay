/**
 * Pull funds from a linked exchange into the Cpay wallet.
 *
 * Routes to here when the user taps a LINKED card on
 * /settings/linked-accounts and picks "Pull to Cpay".
 *
 * Flow:
 *   1. Show balances per supported currency · pick one
 *   2. Enter amount (max = available)
 *   3. POST /exchanges/<provider>/withdraw/ → get ExchangeWithdrawal id
 *   4. Poll /exchanges/withdrawals/<id>/ until terminal status
 *   5. On done, credit the user's Cpay wallet (handled server-side
 *      by the existing blockchain confirmer · this UI just shows the
 *      pull status + on-chain hash + a "View in wallet" button)
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  TextInput,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import {
  exchangesApi,
  ExchangeProvider,
  ExchangeLink,
  ExchangeWithdrawal,
  BinanceBalance,
} from "../../src/api/exchanges";
import { useToast } from "../../src/components/Toast";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { Button } from "../../src/components/Button";
import { CryptoLogo } from "../../src/components/CryptoLogo";
import { Spinner } from "../../src/components/brand/Spinner";
import { normalizeError } from "../../src/utils/apiErrors";


const isWeb = Platform.OS === "web";


type Step = "pick" | "amount" | "submitting" | "tracking" | "done" | "failed";


/** Decimal string available-balance · handles Binance free/locked +
 *  Coinbase / Noones simple-Decimal shapes. */
function availableForCurrency(link: ExchangeLink, currency: string): string {
  const v = link.balances[currency];
  if (!v) return "0";
  if (typeof v === "string") return v;
  return (v as BinanceBalance).free || "0";
}


export default function ExchangePullScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ provider?: string }>();
  const provider = (params.provider || "") as ExchangeProvider;

  const toast = useToast();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;
  const hPad = isDesktop ? 32 : 16;

  const [step, setStep] = useState<Step>("pick");
  const [link, setLink] = useState<ExchangeLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [withdrawal, setWithdrawal] = useState<ExchangeWithdrawal | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load the link
  useEffect(() => {
    (async () => {
      try {
        const r = await exchangesApi.list();
        const found = r.data.links.find((l) => l.provider === provider);
        if (!found) {
          toast.error("Not linked", `${provider} is not connected.`);
          router.back();
          return;
        }
        setLink(found);
      } catch (e) {
        const err = normalizeError(e);
        toast.error(err.title, err.message);
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [provider, router, toast]);

  // Cancel poll on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handlePickCurrency = useCallback((c: string) => {
    setCurrency(c);
    setStep("amount");
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!link) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast.warning("Invalid amount", "Enter an amount greater than zero.");
      return;
    }
    const max = parseFloat(availableForCurrency(link, currency));
    if (amt > max) {
      toast.warning("Too much", `Max available: ${max} ${currency}`);
      return;
    }
    setStep("submitting");
    try {
      const r = await exchangesApi.withdraw(provider, {
        currency,
        amount: String(amt),
      });
      setWithdrawal(r.data);
      setStep("tracking");
      // Start poll · every 8 seconds, stop on terminal
      pollRef.current = setInterval(async () => {
        try {
          const s = await exchangesApi.withdrawalStatus(r.data.id);
          setWithdrawal(s.data);
          if (s.data.status === "done" || s.data.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
            setStep(s.data.status === "done" ? "done" : "failed");
          }
        } catch {
          /* ignore individual poll errors · keep retrying */
        }
      }, 8000);
    } catch (e) {
      const err = normalizeError(e);
      toast.error(err.title, err.message);
      setStep("amount");
    }
  }, [link, amount, currency, provider, toast]);

  // ─── Render helpers ───────────────────────────────────────────
  const renderPick = () => {
    if (!link) return null;
    const currencies = Object.keys(link.balances).filter((k) => !k.startsWith("_"));
    if (currencies.length === 0) {
      return (
        <View style={{ alignItems: "center", padding: 40, gap: 12 }}>
          <Ionicons name="wallet-outline" size={36} color={tc.textMuted} />
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 15,
              fontFamily: "DMSans_700Bold",
              textAlign: "center",
            }}
          >
            No balance to pull
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 13,
              fontFamily: "DMSans_400Regular",
              textAlign: "center",
              maxWidth: 320,
            }}
          >
            Top up your {provider} account first, then come back.
          </Text>
        </View>
      );
    }

    // 2-per-row grid
    const cols = width >= 700 ? 3 : 2;
    const gap = 10;
    const cardW = (width - 2 * hPad - gap * (cols - 1)) / cols;

    return (
      <View style={{ gap: 14 }}>
        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 18,
            fontFamily: "DMSans_700Bold",
          }}
        >
          Pick a coin
        </Text>
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 13,
            fontFamily: "DMSans_400Regular",
            lineHeight: 19,
          }}
        >
          We'll pull this from {provider} to your Cpay deposit
          address. Once on-chain, your Cpay balance updates and you
          can pay any bill.
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap }}>
          {currencies.map((c) => {
            const avail = availableForCurrency(link, c);
            return (
              <Pressable
                key={c}
                onPress={() => handlePickCurrency(c)}
                style={({ pressed, hovered }: any) => ({
                  width: cardW,
                  backgroundColor: hovered ? tc.dark.elevated : tc.dark.card,
                  borderRadius: 16,
                  padding: 14,
                  borderWidth: 1.5,
                  borderColor: pressed ? colors.primary[500] : tc.glass.border,
                  opacity: pressed ? 0.9 : 1,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                  ...(isWeb ? ({ cursor: "pointer" } as any) : {}),
                  ...ts.sm,
                })}
                accessibilityRole="button"
                accessibilityLabel={`Pull ${c}`}
              >
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                  <CryptoLogo currency={c as any} size={26} />
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 15,
                      fontFamily: "DMSans_700Bold",
                      marginLeft: 8,
                    }}
                  >
                    {c}
                  </Text>
                </View>
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 11,
                    fontFamily: "DMSans_500Medium",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    marginBottom: 2,
                  }}
                >
                  Available
                </Text>
                <Text
                  style={{
                    color: tc.textSecondary,
                    fontSize: 14,
                    fontFamily: "DMSans_700Bold",
                  }}
                  numberOfLines={1}
                >
                  {avail}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  };

  const renderAmount = () => {
    if (!link) return null;
    const max = availableForCurrency(link, currency);
    return (
      <View style={{ gap: 16 }}>
        <Pressable
          onPress={() => setStep("pick")}
          style={({ pressed }) => ({
            alignSelf: "flex-start",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="arrow-back" size={14} color={tc.textMuted} />
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 13,
              fontFamily: "DMSans_500Medium",
            }}
          >
            Change coin
          </Text>
        </Pressable>

        <View
          style={{
            backgroundColor: tc.dark.card,
            borderRadius: 16,
            padding: 18,
            borderWidth: 1,
            borderColor: tc.glass.border,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <CryptoLogo currency={currency as any} size={28} />
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: 16,
                  fontFamily: "DMSans_700Bold",
                }}
              >
                Pull {currency}
              </Text>
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 12,
                  fontFamily: "DMSans_400Regular",
                }}
              >
                Available · {max} {currency}
              </Text>
            </View>
          </View>

          <Text
            style={{
              color: tc.textMuted,
              fontSize: 11,
              fontFamily: "DMSans_700Bold",
              textTransform: "uppercase",
              letterSpacing: 0.6,
              marginTop: 6,
              marginBottom: 6,
            }}
          >
            Amount
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: tc.glass.bg,
              borderRadius: 12,
              paddingHorizontal: 14,
              borderWidth: 1,
              borderColor: tc.glass.border,
            }}
          >
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={tc.textMuted}
              style={{
                flex: 1,
                color: tc.textPrimary,
                fontSize: 18,
                fontFamily: "DMSans_700Bold",
                paddingVertical: 14,
                ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
              }}
            />
            <Pressable
              onPress={() => setAmount(max)}
              hitSlop={8}
              style={({ pressed }) => ({
                paddingVertical: 6,
                paddingHorizontal: 10,
                borderRadius: 8,
                backgroundColor: colors.primary[500] + "20",
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text
                style={{
                  color: colors.primary[400],
                  fontSize: 12,
                  fontFamily: "DMSans_700Bold",
                  letterSpacing: 0.5,
                }}
              >
                MAX
              </Text>
            </Pressable>
          </View>
        </View>

        <View
          style={{
            backgroundColor: colors.warning + "10",
            borderRadius: 14,
            padding: 14,
            borderWidth: 1,
            borderColor: colors.warning + "40",
            flexDirection: "row",
            gap: 10,
          }}
        >
          <Ionicons
            name="information-circle"
            size={18}
            color={colors.warning}
            style={{ marginTop: 1 }}
          />
          <Text
            style={{
              flex: 1,
              color: tc.textSecondary,
              fontSize: 12,
              fontFamily: "DMSans_400Regular",
              lineHeight: 17,
            }}
          >
            Network fees apply on the {provider} side · charged to
            your {provider} balance, not Cpay. Funds arrive in your
            Cpay wallet within 3–10 minutes once on-chain.
          </Text>
        </View>

        <Button
          onPress={handleSubmit}
          title={`Pull ${amount || "0"} ${currency} to Cpay`}
          disabled={!amount || parseFloat(amount) <= 0}
        />
      </View>
    );
  };

  const renderTracking = () => {
    if (!withdrawal) return null;
    const statusText = {
      pending: "Submitted to " + provider,
      confirming: "Sending on-chain · waiting confirmations",
      done: "Complete · funds in your Cpay wallet",
      failed: "Failed",
    }[withdrawal.status];
    const statusIcon =
      withdrawal.status === "done"
        ? "checkmark-circle"
        : withdrawal.status === "failed"
          ? "close-circle"
          : "time-outline";
    const statusColor =
      withdrawal.status === "done"
        ? "#10B981"
        : withdrawal.status === "failed"
          ? colors.error
          : colors.warning;

    return (
      <View style={{ alignItems: "center", padding: 28, gap: 16 }}>
        {withdrawal.status === "pending" || withdrawal.status === "confirming" ? (
          <ActivityIndicator size="large" color={colors.primary[400]} />
        ) : (
          <Ionicons name={statusIcon as any} size={56} color={statusColor} />
        )}
        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 18,
            fontFamily: "DMSans_700Bold",
            textAlign: "center",
          }}
        >
          {statusText}
        </Text>

        {/* Detail card */}
        <View
          style={{
            width: "100%",
            backgroundColor: tc.dark.card,
            borderRadius: 14,
            padding: 14,
            borderWidth: 1,
            borderColor: tc.glass.border,
            gap: 8,
          }}
        >
          <DetailRow label="Amount" value={`${withdrawal.amount} ${withdrawal.currency}`} tc={tc} />
          <DetailRow label="Network" value={withdrawal.network} tc={tc} />
          <DetailRow label="Source" value={provider} tc={tc} />
          {withdrawal.exchange_tx_id ? (
            <DetailRow
              label={`${provider} ID`}
              value={withdrawal.exchange_tx_id.slice(0, 24) + (withdrawal.exchange_tx_id.length > 24 ? "…" : "")}
              tc={tc}
            />
          ) : null}
          {withdrawal.on_chain_tx ? (
            <DetailRow
              label="On-chain hash"
              value={withdrawal.on_chain_tx.slice(0, 16) + "…" + withdrawal.on_chain_tx.slice(-6)}
              tc={tc}
            />
          ) : null}
        </View>

        {withdrawal.status === "failed" && withdrawal.error_message ? (
          <View
            style={{
              width: "100%",
              backgroundColor: colors.error + "10",
              borderRadius: 12,
              padding: 12,
              borderWidth: 1,
              borderColor: colors.error + "40",
            }}
          >
            <Text
              style={{
                color: colors.error,
                fontSize: 12,
                fontFamily: "DMSans_700Bold",
                marginBottom: 4,
              }}
            >
              {withdrawal.error_code}
            </Text>
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: 12,
                fontFamily: "DMSans_400Regular",
                lineHeight: 17,
              }}
            >
              {withdrawal.error_message}
            </Text>
          </View>
        ) : null}

        {withdrawal.status === "done" ? (
          <Button
            onPress={() => router.replace("/(tabs)/wallet" as any)}
            title="View in Wallet"
            style={{ alignSelf: "stretch" }}
          />
        ) : withdrawal.status === "failed" ? (
          <Button
            onPress={() => setStep("amount")}
            title="Try again"
            style={{ alignSelf: "stretch" }}
          />
        ) : (
          <Button
            onPress={() => router.replace("/settings/linked-accounts" as any)}
            title="Done · keep tracking in background"
            variant="secondary"
            style={{ alignSelf: "stretch" }}
          />
        )}
      </View>
    );
  };

  const renderSubmitting = () => (
    <View style={{ alignItems: "center", padding: 40, gap: 14 }}>
      <ActivityIndicator size="large" color={colors.primary[400]} />
      <Text
        style={{
          color: tc.textPrimary,
          fontSize: 16,
          fontFamily: "DMSans_700Bold",
        }}
      >
        Submitting to {provider}…
      </Text>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView
        style={{
          flex: 1, backgroundColor: tc.dark.bg,
          alignItems: "center", justifyContent: "center",
        }}
      >
        <Spinner size={32} color={colors.primary[400]} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: hPad,
          paddingVertical: 14,
          gap: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={{
            width: 40, height: 40, borderRadius: 12,
            backgroundColor: tc.dark.card,
            alignItems: "center", justifyContent: "center",
            borderWidth: 1, borderColor: tc.glass.border,
          }}
        >
          <Ionicons name="arrow-back" size={20} color={tc.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 18,
              fontFamily: "DMSans_700Bold",
              letterSpacing: -0.3,
              textTransform: "capitalize",
            }}
          >
            Pull from {provider}
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 12,
              fontFamily: "DMSans_400Regular",
              marginTop: 2,
            }}
          >
            Move crypto to your Cpay wallet
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: hPad, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step === "pick" && renderPick()}
        {step === "amount" && renderAmount()}
        {step === "submitting" && renderSubmitting()}
        {(step === "tracking" || step === "done" || step === "failed") &&
          renderTracking()}
      </ScrollView>
    </SafeAreaView>
  );
}


function DetailRow({
  label, value, tc,
}: {
  label: string;
  value: string;
  tc: ReturnType<typeof getThemeColors>;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <Text
        style={{
          color: tc.textMuted,
          fontSize: 12,
          fontFamily: "DMSans_500Medium",
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: tc.textSecondary,
          fontSize: 13,
          fontFamily: "DMSans_700Bold",
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
    </View>
  );
}
