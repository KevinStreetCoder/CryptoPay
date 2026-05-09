/**
 * Binance API-key paste flow.
 *
 * Walks the user through creating a withdraw-only API key on
 * Binance with the right scopes + IP restriction + address
 * whitelist, then accepts the key + secret. Backend verifies
 * before persisting.
 *
 * 3-step UX:
 *   1. Setup walkthrough (read-only · scoped instructions)
 *   2. Paste credentials (TextInput x2)
 *   3. Verifying spinner → success or detailed error
 */
import { useState, useCallback } from "react";
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
import * as Clipboard from "expo-clipboard";

import { exchangesApi } from "../../src/api/exchanges";
import { useToast } from "../../src/components/Toast";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { Button } from "../../src/components/Button";
import { normalizeError } from "../../src/utils/apiErrors";


const isWeb = Platform.OS === "web";


type Step = "walkthrough" | "paste" | "verifying" | "done";


export default function BinanceLinkScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ egressIp?: string }>();
  const toast = useToast();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;

  const egressIp = (params.egressIp as string) || "173.249.4.109";

  const [step, setStep] = useState<Step>("walkthrough");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [supportedCoins, setSupportedCoins] = useState<string[]>([]);

  const copyEgress = useCallback(async () => {
    await Clipboard.setStringAsync(egressIp);
    toast.success("Copied", `Cpay IP ${egressIp} copied`);
  }, [egressIp, toast]);

  const handleSubmit = useCallback(async () => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      toast.warning("Missing fields", "Paste both API key and secret.");
      return;
    }
    setStep("verifying");
    setError(null);
    try {
      const r = await exchangesApi.linkBinance({
        api_key: apiKey.trim(),
        api_secret: apiSecret.trim(),
      });
      setSupportedCoins(r.data.supported_coins || []);
      setStep("done");
    } catch (e: any) {
      const norm = normalizeError(e);
      const code = e?.response?.data?.error || norm.title;
      const message = e?.response?.data?.message || norm.message;
      setError({ code, message });
      setStep("paste");
    }
  }, [apiKey, apiSecret, toast]);

  // Layout
  const hPad = isDesktop ? 32 : 16;

  // ─── Step renderers ────────────────────────────────────────────
  const renderWalkthrough = () => (
    <View style={{ gap: 16 }}>
      <Text
        style={{
          color: tc.textPrimary,
          fontSize: 18,
          fontFamily: "DMSans_700Bold",
        }}
      >
        Create your Binance API key
      </Text>
      <Text
        style={{
          color: tc.textMuted,
          fontSize: 13,
          fontFamily: "DMSans_400Regular",
          lineHeight: 20,
        }}
      >
        Cpay never sees your Binance password. Instead you create a
        withdraw-only API key on Binance and paste it here. Cpay can
        only move funds from your Binance to your Cpay deposit
        address — nothing else.
      </Text>

      {/* Step list */}
      {[
        {
          n: 1,
          title: "Open Binance API Management",
          body: 'On binance.com → Profile → API Management → "Create API"',
        },
        {
          n: 2,
          title: "Pick System-generated, name it Cpay",
          body: 'Pass any 2FA prompts. You only need ONE key.',
        },
        {
          n: 3,
          title: "Permissions · withdraw ONLY",
          body: 'ENABLE: "Enable Withdrawals". DISABLE: Spot Trading, Reading, Margin, Futures. Cpay refuses keys with trading enabled.',
        },
        {
          n: 4,
          title: "Restrict IP · paste this address",
          body: `Click "Restrict access to trusted IPs" → paste ${egressIp}`,
          hasCopy: true,
        },
        {
          n: 5,
          title: "Whitelist Cpay deposit addresses",
          body: 'Optional but recommended · pick "Withdraw to Whitelisted Addresses Only" and add your Cpay deposit addresses (Wallet → Receive → Copy address per coin).',
        },
        {
          n: 6,
          title: "Copy the API key + secret",
          body: 'Binance shows the secret ONCE. Copy both into the fields below.',
        },
      ].map((step) => (
        <View
          key={step.n}
          style={{
            flexDirection: "row",
            gap: 12,
            backgroundColor: tc.dark.card,
            borderRadius: 14,
            padding: 14,
            borderWidth: 1,
            borderColor: tc.glass.border,
          }}
        >
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: "#F0B90B" + "20",
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: "#F0B90B" + "60",
              flexShrink: 0,
            }}
          >
            <Text
              style={{
                color: "#F0B90B",
                fontSize: 13,
                fontFamily: "DMSans_700Bold",
              }}
            >
              {step.n}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 14,
                fontFamily: "DMSans_700Bold",
                marginBottom: 4,
              }}
            >
              {step.title}
            </Text>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 12,
                fontFamily: "DMSans_400Regular",
                lineHeight: 18,
              }}
            >
              {step.body}
            </Text>
            {step.hasCopy && (
              <Pressable
                onPress={copyEgress}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 8,
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  backgroundColor: "#F0B90B" + "18",
                  borderWidth: 1,
                  borderColor: "#F0B90B" + "40",
                  alignSelf: "flex-start",
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Ionicons name="copy-outline" size={12} color="#F0B90B" />
                <Text
                  style={{
                    color: "#F0B90B",
                    fontSize: 12,
                    fontFamily: "DMSans_700Bold",
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {egressIp}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      ))}

      <Button
        onPress={() => setStep("paste")}
        title="I've created the API key"
        style={{ marginTop: 8 }}
      />
    </View>
  );

  const renderPaste = () => (
    <View style={{ gap: 14 }}>
      <Text
        style={{
          color: tc.textPrimary,
          fontSize: 18,
          fontFamily: "DMSans_700Bold",
        }}
      >
        Paste your Binance credentials
      </Text>
      <Text
        style={{
          color: tc.textMuted,
          fontSize: 13,
          fontFamily: "DMSans_400Regular",
          lineHeight: 19,
        }}
      >
        We verify the key before saving. If the key has trading
        enabled or wrong IP restrictions, you'll see the exact error.
      </Text>

      {error && (
        <View
          style={{
            backgroundColor: colors.danger + "10",
            borderRadius: 12,
            padding: 12,
            borderWidth: 1,
            borderColor: colors.danger + "40",
            flexDirection: "row",
            gap: 10,
          }}
        >
          <Ionicons
            name="alert-circle"
            size={18}
            color={colors.danger}
            style={{ marginTop: 1 }}
          />
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: colors.danger,
                fontSize: 13,
                fontFamily: "DMSans_700Bold",
                marginBottom: 4,
              }}
            >
              Verification failed · {error.code}
            </Text>
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: 12,
                fontFamily: "DMSans_400Regular",
                lineHeight: 17,
              }}
            >
              {error.message}
            </Text>
          </View>
        </View>
      )}

      <View>
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 11,
            fontFamily: "DMSans_700Bold",
            textTransform: "uppercase",
            letterSpacing: 0.6,
            marginBottom: 6,
          }}
        >
          API Key
        </Text>
        <TextInput
          value={apiKey}
          onChangeText={setApiKey}
          placeholder="64-character hex string from Binance"
          placeholderTextColor={tc.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            color: tc.textPrimary,
            fontSize: 14,
            fontFamily: "DMSans_500Medium",
            backgroundColor: tc.dark.card,
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 14,
            borderWidth: 1,
            borderColor: tc.glass.border,
            ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
          }}
        />
      </View>

      <View>
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 11,
            fontFamily: "DMSans_700Bold",
            textTransform: "uppercase",
            letterSpacing: 0.6,
            marginBottom: 6,
          }}
        >
          API Secret
        </Text>
        <View
          style={{
            flexDirection: "row",
            backgroundColor: tc.dark.card,
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 4,
            borderWidth: 1,
            borderColor: tc.glass.border,
            alignItems: "center",
          }}
        >
          <TextInput
            value={apiSecret}
            onChangeText={setApiSecret}
            placeholder="Shown only once on Binance · paste here"
            placeholderTextColor={tc.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!showSecret}
            style={{
              flex: 1,
              color: tc.textPrimary,
              fontSize: 14,
              fontFamily: "DMSans_500Medium",
              paddingVertical: 12,
              ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
            }}
          />
          <Pressable
            onPress={() => setShowSecret(!showSecret)}
            hitSlop={8}
            style={{ padding: 6 }}
          >
            <Ionicons
              name={showSecret ? "eye-off-outline" : "eye-outline"}
              size={20}
              color={tc.textMuted}
            />
          </Pressable>
        </View>
      </View>

      <Button
        onPress={handleSubmit}
        title="Verify and link"
        disabled={!apiKey.trim() || !apiSecret.trim()}
        style={{ marginTop: 6 }}
      />

      <Pressable
        onPress={() => setStep("walkthrough")}
        style={({ pressed }) => ({
          alignSelf: "center",
          paddingVertical: 8,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 13,
            fontFamily: "DMSans_500Medium",
          }}
        >
          ← Back to setup steps
        </Text>
      </Pressable>
    </View>
  );

  const renderVerifying = () => (
    <View style={{ alignItems: "center", padding: 40, gap: 16 }}>
      <ActivityIndicator size="large" color={"#F0B90B"} />
      <Text
        style={{
          color: tc.textPrimary,
          fontSize: 16,
          fontFamily: "DMSans_700Bold",
        }}
      >
        Verifying with Binance…
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
        Confirming the key has withdraw-only scope and your IP
        restriction matches.
      </Text>
    </View>
  );

  const renderDone = () => (
    <View style={{ gap: 16, paddingTop: 8 }}>
      <View
        style={{
          alignSelf: "center",
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: "rgba(16, 185, 129, 0.16)",
          borderWidth: 2,
          borderColor: "#10B981",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 8,
        }}
      >
        <Ionicons name="checkmark" size={36} color="#10B981" />
      </View>
      <Text
        style={{
          color: tc.textPrimary,
          fontSize: 20,
          fontFamily: "DMSans_700Bold",
          textAlign: "center",
        }}
      >
        Binance linked
      </Text>
      <Text
        style={{
          color: tc.textMuted,
          fontSize: 13,
          fontFamily: "DMSans_400Regular",
          textAlign: "center",
          lineHeight: 19,
        }}
      >
        You can now pay any Kenyan bill or merchant from your Binance
        balance. Tap a coin on the Pay screen and pick "Binance" as
        the source.
      </Text>

      {supportedCoins.length > 0 && (
        <View
          style={{
            backgroundColor: tc.dark.card,
            borderRadius: 14,
            padding: 14,
            borderWidth: 1,
            borderColor: tc.glass.border,
          }}
        >
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 11,
              fontFamily: "DMSans_700Bold",
              textTransform: "uppercase",
              letterSpacing: 0.6,
              marginBottom: 8,
            }}
          >
            Supported coins on your account
          </Text>
          <Text
            style={{
              color: tc.textSecondary,
              fontSize: 13,
              fontFamily: "DMSans_500Medium",
            }}
          >
            {supportedCoins.slice(0, 12).join(" · ")}
            {supportedCoins.length > 12 ? ` +${supportedCoins.length - 12}` : ""}
          </Text>
        </View>
      )}

      <Button
        onPress={() => router.replace("/settings/linked-accounts" as any)}
        title="Done"
        style={{ marginTop: 6 }}
      />
    </View>
  );

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
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: tc.dark.card,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: tc.glass.border,
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
            }}
          >
            Link Binance
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 12,
              fontFamily: "DMSans_400Regular",
              marginTop: 2,
            }}
          >
            Withdraw-only API key flow
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: hPad,
          paddingBottom: 40,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step === "walkthrough" && renderWalkthrough()}
        {step === "paste" && renderPaste()}
        {step === "verifying" && renderVerifying()}
        {step === "done" && renderDone()}
      </ScrollView>
    </SafeAreaView>
  );
}
