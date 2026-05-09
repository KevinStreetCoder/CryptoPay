/**
 * Linked exchange accounts · settings screen.
 *
 * Lists Binance / Coinbase / Noones providers · for each shows the
 * link state (not linked / linked + balance / unavailable). Tapping
 * a card navigates to the link flow:
 *   - Binance · API-key paste form (settings/binance-link.tsx)
 *   - Coinbase · OAuth deep-link via expo-web-browser
 *   - Noones · OAuth deep-link via expo-web-browser
 *
 * Design follows the 2-cards-per-row pattern established for the Pay
 * tab grids · responsive 2/3/4 cols by viewport.
 */
import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
  Alert,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";

import {
  exchangesApi,
  ExchangeProvider,
  ExchangeLink,
  ProviderInfo,
  Balances,
  BinanceBalance,
} from "../../src/api/exchanges";
import { useToast } from "../../src/components/Toast";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { Spinner } from "../../src/components/brand/Spinner";
import { normalizeError } from "../../src/utils/apiErrors";
import { useLocale } from "../../src/hooks/useLocale";


const isWeb = Platform.OS === "web";


// Per-provider visual treatment · matches the on-the-wire id so we
// can look up by `link.provider` directly.
const PROVIDER_META: Record<
  ExchangeProvider,
  {
    name: string;
    accent: string;
    accentBg: string;
    icon: keyof typeof Ionicons.glyphMap;
    logoUrl: string;
    /** One-line tagline shown under the provider name. */
    tagline: string;
  }
> = {
  binance: {
    name: "Binance",
    accent: "#F0B90B",
    accentBg: "rgba(240, 185, 11, 0.12)",
    icon: "trending-up-outline",
    logoUrl: "https://cryptologos.cc/logos/binance-coin-bnb-logo.svg",
    tagline: "Withdraw-only API key",
  },
  coinbase: {
    name: "Coinbase",
    accent: "#0052FF",
    accentBg: "rgba(0, 82, 255, 0.12)",
    icon: "wallet-outline",
    logoUrl: "https://cryptologos.cc/logos/coinbase-logo.svg",
    tagline: "Sign in with Coinbase",
  },
  noones: {
    name: "Noones",
    accent: "#10B981",
    accentBg: "rgba(16, 185, 129, 0.12)",
    icon: "people-outline",
    logoUrl: "https://noones.com/favicon.ico",
    tagline: "Sign in with Noones",
  },
};


/** Format any-shape balance map into a human-readable line. */
function formatBalances(b: Balances): string {
  if (!b || Object.keys(b).length === 0) return "No balances";
  if ((b as any)._error) return (b as any)._error as string;
  const parts: string[] = [];
  for (const [cur, val] of Object.entries(b)) {
    if (cur.startsWith("_")) continue;
    if (typeof val === "string") {
      parts.push(`${val} ${cur}`);
    } else {
      const free = (val as BinanceBalance).free || "0";
      parts.push(`${free} ${cur}`);
    }
    if (parts.length >= 3) break;
  }
  const more = Object.keys(b).length - parts.length;
  return more > 0 ? `${parts.join(" · ")} +${more}` : parts.join(" · ");
}


export default function LinkedAccountsScreen() {
  const router = useRouter();
  const toast = useToast();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const { t } = useLocale();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;

  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [links, setLinks] = useState<ExchangeLink[]>([]);
  const [oauthBusy, setOauthBusy] = useState<ExchangeProvider | null>(null);

  const linkByProvider = (p: ExchangeProvider): ExchangeLink | undefined =>
    links.find((l) => l.provider === p);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, lRes] = await Promise.all([
        exchangesApi.providers(),
        exchangesApi.list(),
      ]);
      setProviders(pRes.data.providers);
      setLinks(lRes.data.links);
    } catch (e) {
      const err = normalizeError(e);
      toast.error(err.title, err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleProviderPress = useCallback(
    async (info: ProviderInfo) => {
      const linked = linkByProvider(info.id);
      if (linked) {
        // Already linked · show actions
        Alert.alert(
          PROVIDER_META[info.id].name,
          "Choose an action",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Pull to Cpay",
              onPress: () =>
                router.push({
                  pathname: "/settings/exchange-pull" as any,
                  params: { provider: info.id },
                }),
            },
            {
              text: "Refresh balance",
              onPress: () => load(),
            },
            {
              text: "Unlink",
              style: "destructive",
              onPress: async () => {
                try {
                  await exchangesApi.unlink(info.id);
                  toast.success("Unlinked", `${PROVIDER_META[info.id].name} disconnected.`);
                  load();
                } catch (e) {
                  const err = normalizeError(e);
                  toast.error(err.title, err.message);
                }
              },
            },
          ],
          { cancelable: true },
        );
        return;
      }

      if (!info.configured) {
        toast.warning(
          "Not available yet",
          `${info.name} integration is being configured. Check back soon.`,
        );
        return;
      }

      if (info.method === "api_key") {
        // Binance · go to the paste-key form
        router.push({
          pathname: "/settings/binance-link" as any,
          params: { egressIp: info.egress_ip || "" },
        });
        return;
      }

      // OAuth · open authorize URL in an in-app browser
      setOauthBusy(info.id);
      try {
        const start =
          info.id === "coinbase"
            ? await exchangesApi.coinbaseOAuthStart("app")
            : await exchangesApi.noonesOAuthStart("app");

        const result = await WebBrowser.openAuthSessionAsync(
          start.data.authorize_url,
          `cryptopay://oauth/${info.id}`,
          { showInRecents: false },
        );

        if (result.type !== "success" || !result.url) {
          toast.info("Cancelled", "Sign-in was not completed.");
          return;
        }

        // Parse code + state from the deep-link URL
        // e.g. cryptopay://oauth/coinbase?code=AUTH_CODE&state=xxx
        const url = new URL(result.url);
        const code = url.searchParams.get("code") || "";
        const state = url.searchParams.get("state") || "";
        if (!code || !state) {
          toast.error("Sign-in failed", "Missing code/state in callback.");
          return;
        }

        const completer =
          info.id === "coinbase"
            ? exchangesApi.coinbaseOAuthComplete
            : exchangesApi.noonesOAuthComplete;
        await completer({ code, state, scheme: "app" });
        toast.success("Linked", `${info.name} connected. Pulling balance…`);
        load();
      } catch (e) {
        const err = normalizeError(e);
        toast.error(err.title, err.message);
      } finally {
        setOauthBusy(null);
      }
    },
    [linkByProvider, router, toast, load],
  );

  // Responsive 2-per-row grid · pixel-width math (calc() is web-only,
  // RN-Android falls back to content width which produces 1-col).
  const hPad = isDesktop ? 32 : 16;
  const cols = width >= 1100 ? 3 : width >= 700 ? 2 : 2;
  const gap = 12;
  const cardW = (width - 2 * hPad - gap * (cols - 1)) / cols;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      {/* Header */}
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
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={20} color={tc.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 22,
              fontFamily: "DMSans_700Bold",
              letterSpacing: -0.3,
            }}
          >
            Linked Exchanges
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 13,
              fontFamily: "DMSans_400Regular",
              marginTop: 2,
            }}
          >
            Pay bills with crypto from Binance, Coinbase or Noones
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: hPad,
          paddingBottom: 40,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Explainer card */}
        <View
          style={{
            backgroundColor: colors.primary[500] + "0F",
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: colors.primary[500] + "30",
            flexDirection: "row",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <Ionicons
            name="information-circle"
            size={22}
            color={colors.primary[400]}
            style={{ marginTop: 2 }}
          />
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 14,
                fontFamily: "DMSans_700Bold",
                marginBottom: 4,
              }}
            >
              How linking works
            </Text>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 13,
                fontFamily: "DMSans_400Regular",
                lineHeight: 19,
              }}
            >
              Connect your exchange so you can pay any Kenyan bill or
              merchant with crypto held there. Cpay never sees your
              login · Coinbase / Noones use OAuth, Binance uses a
              withdraw-only API key. Unlink any time.
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={{ alignItems: "center", padding: 40 }}>
            <Spinner size={32} color={colors.primary[400]} />
          </View>
        ) : (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap,
            }}
          >
            {providers.map((info) => {
              const meta = PROVIDER_META[info.id];
              const linked = linkByProvider(info.id);
              const balanceText = linked ? formatBalances(linked.balances) : "";
              const isOauthLoading = oauthBusy === info.id;
              return (
                <Pressable
                  key={info.id}
                  onPress={() => handleProviderPress(info)}
                  disabled={isOauthLoading}
                  style={({ pressed, hovered }: any) => ({
                    width: cardW,
                    backgroundColor: hovered ? tc.dark.elevated : tc.dark.card,
                    borderRadius: 18,
                    padding: 16,
                    borderWidth: 1.5,
                    borderColor: linked
                      ? meta.accent + "55"
                      : pressed
                        ? meta.accent + "40"
                        : tc.glass.border,
                    opacity: pressed ? 0.9 : isOauthLoading ? 0.6 : 1,
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                    minHeight: 150,
                    ...(isWeb
                      ? ({ cursor: "pointer", transition: "all 0.2s ease" } as any)
                      : {}),
                    ...ts.sm,
                  })}
                  accessibilityRole="button"
                  accessibilityLabel={`${meta.name} · ${linked ? "linked" : "not linked"}`}
                >
                  {/* Top row · icon + status pill */}
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 12,
                    }}
                  >
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 14,
                        backgroundColor: meta.accentBg,
                        alignItems: "center",
                        justifyContent: "center",
                        borderWidth: 1,
                        borderColor: meta.accent + "30",
                      }}
                    >
                      <Ionicons
                        name={meta.icon}
                        size={22}
                        color={meta.accent}
                      />
                    </View>
                    {linked ? (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                          paddingVertical: 4,
                          paddingHorizontal: 10,
                          borderRadius: 999,
                          backgroundColor: "rgba(16, 185, 129, 0.18)",
                          borderWidth: 1,
                          borderColor: "rgba(16, 185, 129, 0.4)",
                        }}
                      >
                        <Ionicons
                          name="checkmark-circle"
                          size={12}
                          color="#10B981"
                        />
                        <Text
                          style={{
                            color: "#10B981",
                            fontSize: 10,
                            fontFamily: "DMSans_700Bold",
                            letterSpacing: 0.4,
                          }}
                        >
                          LINKED
                        </Text>
                      </View>
                    ) : !info.configured ? (
                      <View
                        style={{
                          paddingVertical: 4,
                          paddingHorizontal: 10,
                          borderRadius: 999,
                          backgroundColor: tc.glass.bg,
                          borderWidth: 1,
                          borderColor: tc.glass.border,
                        }}
                      >
                        <Text
                          style={{
                            color: tc.textMuted,
                            fontSize: 10,
                            fontFamily: "DMSans_700Bold",
                            letterSpacing: 0.4,
                          }}
                        >
                          SOON
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Provider name + tagline */}
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 16,
                      fontFamily: "DMSans_700Bold",
                      marginBottom: 4,
                    }}
                  >
                    {meta.name}
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 12,
                      fontFamily: "DMSans_400Regular",
                      marginBottom: 10,
                    }}
                    numberOfLines={1}
                  >
                    {meta.tagline}
                  </Text>

                  {/* Bottom row · balance or CTA */}
                  {linked ? (
                    <Text
                      style={{
                        color: tc.textSecondary,
                        fontSize: 13,
                        fontFamily: "DMSans_500Medium",
                      }}
                      numberOfLines={2}
                    >
                      {balanceText}
                    </Text>
                  ) : (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      {isOauthLoading ? (
                        <ActivityIndicator size="small" color={meta.accent} />
                      ) : (
                        <>
                          <Text
                            style={{
                              color: info.configured ? meta.accent : tc.textMuted,
                              fontSize: 13,
                              fontFamily: "DMSans_700Bold",
                            }}
                          >
                            {info.configured ? "Tap to link" : "Coming soon"}
                          </Text>
                          {info.configured && (
                            <Ionicons
                              name="arrow-forward"
                              size={14}
                              color={meta.accent}
                            />
                          )}
                        </>
                      )}
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Footer · trust + privacy note */}
        <View
          style={{
            marginTop: 28,
            padding: 14,
            borderRadius: 14,
            backgroundColor: tc.dark.card,
            borderWidth: 1,
            borderColor: tc.glass.border,
            flexDirection: "row",
            gap: 10,
          }}
        >
          <Ionicons
            name="shield-checkmark"
            size={18}
            color={colors.primary[400]}
            style={{ marginTop: 1 }}
          />
          <Text
            style={{
              flex: 1,
              color: tc.textMuted,
              fontSize: 12,
              fontFamily: "DMSans_400Regular",
              lineHeight: 17,
            }}
          >
            Cpay never asks for your exchange password. Tokens / API
            keys are encrypted at rest. You can revoke access from
            this screen or directly on the exchange's site.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
