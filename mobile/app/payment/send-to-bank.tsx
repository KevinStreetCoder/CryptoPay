import { useState, useEffect, useMemo } from "react";
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
import { paymentsApi, Bank, BankCategory } from "../../src/api/payments";
import { normalizeError } from "../../src/utils/apiErrors";
import { cacheQuote } from "../../src/utils/rateCache";
import { colors, getThemeColors, getThemeShadows, CurrencyCode } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { SectionHeader } from "../../src/components/SectionHeader";
import { PaymentStepper } from "../../src/components/PaymentStepper";
import { GlassCard } from "../../src/components/GlassCard";
import { useLocale } from "../../src/hooks/useLocale";
import { NetworkBadge, currencyToChain } from "../../src/components/brand/NetworkBadge";
import {
  getFavouriteBanks,
  getFrequentBanks,
  toggleFavourite,
} from "../../src/utils/bankPrefs";

const CRYPTO_OPTIONS: CurrencyCode[] = ["USDT", "USDC", "BTC", "ETH", "SOL"];

/**
 * Display order for the section labels. Anything backend sends that
 * isn't in this tuple still renders, in the order the API returned.
 */
const CATEGORY_ORDER: readonly BankCategory[] = [
  "tier1",
  "midtier",
  "regional",
  "sharia",
] as const;

/**
 * Bank tile logo · 2026-04-25 redesign. NO letter-initial fallback ·
 * the user explicitly asked us to drop banks whose logo doesn't load
 * rather than rendering a placeholder character. The component reports
 * load success/failure to its parent via `onResolve`, and the parent
 * filters the bank list so failed tiles never paint.
 */
function BankTileLogo({
  url,
  name,
  bg,
  size = 36,
  onResolve,
}: {
  url: string;
  name: string;
  bg: string;
  size?: number;
  onResolve?: (slug: string, ok: boolean) => void;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <Image
        source={{ uri: url }}
        style={{ width: size - 8, height: size - 8, borderRadius: 6 }}
        resizeMode="contain"
        accessibilityLabel={`${name} logo`}
        onLoad={() => onResolve?.(name, true)}
        onError={() => onResolve?.(name, false)}
      />
    </View>
  );
}

/**
 * Single bank row · logo, name, and a star pin in the corner.
 * Shared by Favourites, Frequent, and category sections so the
 * styling stays in lockstep. The `showStarPin` flag hides the pin on
 * the Frequent row (those tiles are already implicit favourites-in-
 * waiting · users can pin from any other section).
 */
function BankTile({
  bank,
  gridCols,
  tileGap,
  isSelected,
  isFavourite,
  showStarPin,
  onSelect,
  onLogoResolve,
  onToggleFavourite,
  tc,
  isWeb,
  t,
}: {
  bank: Bank;
  gridCols: number;
  tileGap: number;
  isSelected: boolean;
  isFavourite: boolean;
  showStarPin: boolean;
  onSelect: () => void;
  onLogoResolve: (name: string, ok: boolean) => void;
  onToggleFavourite: () => void;
  tc: ReturnType<typeof getThemeColors>;
  isWeb: boolean;
  t: (k: string) => string;
}) {
  return (
    <Pressable
      onPress={onSelect}
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
        position: "relative",
        ...(isWeb
          ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any)
          : {}),
      })}
      accessibilityRole="button"
      accessibilityLabel={`${t("payment.pay")} ${bank.name}`}
      testID={`bank-tile-${bank.slug}`}
    >
      {showStarPin && (
        <Pressable
          onPress={onToggleFavourite}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={
            isFavourite ? t("payment.bankPinRemove") : t("payment.bankPinAdd")
          }
          style={({ pressed }: any) => ({
            position: "absolute",
            top: 6,
            right: 6,
            zIndex: 10,
            padding: 4,
            opacity: pressed ? 0.6 : 1,
            ...(isWeb ? ({ cursor: "pointer" } as any) : {}),
          })}
        >
          <Ionicons
            name={isFavourite ? "star" : "star-outline"}
            size={14}
            color={isFavourite ? "#F59E0B" : tc.textMuted}
          />
        </Pressable>
      )}
      <BankTileLogo
        url={bank.logo_url}
        name={bank.name}
        bg={tc.dark.elevated}
        onResolve={onLogoResolve}
      />
      <Text
        numberOfLines={2}
        style={{
          color: tc.textPrimary,
          fontSize: 11,
          fontFamily: "DMSans_600SemiBold",
          textAlign: "center",
          lineHeight: 14,
          marginTop: 8,
        }}
        maxFontSizeMultiplier={1.2}
      >
        {bank.name}
      </Text>
    </Pressable>
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
  const [grouped, setGrouped] = useState<Partial<Record<BankCategory, Bank[]>>>({});
  const [categories, setCategories] = useState<BankCategory[]>([]);
  // Slugs whose logo failed to load · those banks are dropped from the
  // picker (per user guidance "drop banks without real logos").
  const [failedLogos, setFailedLogos] = useState<Set<string>>(new Set());
  const [favourites, setFavourites] = useState<string[]>([]);
  const [frequent, setFrequent] = useState<string[]>([]);
  const [search, setSearch] = useState("");
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
  // so a single fetch per screen entry is enough. Server returns:
  //   { banks: [...], categories: [...], grouped: {tier1: [...], ...} }
  // Older builds without category data get a single "All banks" section
  // synthesised from `banks` so the new picker still works.
  useEffect(() => {
    let alive = true;
    paymentsApi
      .banks()
      .then(({ data }) => {
        if (!alive) return;
        const flat = data.banks || [];
        setBanks(flat);
        if (data.grouped && Object.keys(data.grouped).length > 0) {
          setGrouped(data.grouped);
          setCategories((data.categories as BankCategory[]) || []);
        } else {
          // Synthesise a fallback grouping from the flat list so the
          // picker doesn't render empty when talking to an older API.
          const fallback: Partial<Record<BankCategory, Bank[]>> = {
            tier1: flat,
          };
          setGrouped(fallback);
          setCategories(["tier1"]);
        }
      })
      .catch(() => {
        if (alive) toast.error("Error", t("payment.bankListError"));
      });
    return () => {
      alive = false;
    };
  }, [toast, t]);

  // Load favourites + frequent slugs in parallel. Done once on mount
  // and refreshed whenever the user toggles a pin.
  useEffect(() => {
    let alive = true;
    (async () => {
      const favs = await getFavouriteBanks();
      if (!alive) return;
      setFavourites(favs);
      const freq = await getFrequentBanks(favs); // exclude favourites
      if (!alive) return;
      setFrequent(freq);
    })();
    return () => { alive = false; };
  }, []);

  const handleToggleFavourite = async (slug: string) => {
    const next = await toggleFavourite(slug);
    setFavourites(next);
    const freq = await getFrequentBanks(next);
    setFrequent(freq);
  };

  const handleLogoResolve = (bankName: string, ok: boolean) => {
    if (ok) return;
    // Map the failing logo back to a slug so we can hide that bank
    // from every section on the next render.
    const bank = banks.find((b) => b.name === bankName);
    if (!bank) return;
    setFailedLogos((prev) => {
      if (prev.has(bank.slug)) return prev;
      const next = new Set(prev);
      next.add(bank.slug);
      return next;
    });
  };

  // ── Derived data · favourites / frequent / sections / search ──────
  const visibleBanks = useMemo(
    () => banks.filter((b) => !failedLogos.has(b.slug)),
    [banks, failedLogos],
  );

  const slugIndex = useMemo(() => {
    const m = new Map<string, Bank>();
    for (const b of visibleBanks) m.set(b.slug, b);
    return m;
  }, [visibleBanks]);

  const favouriteBanks = useMemo(
    () =>
      favourites
        .map((s) => slugIndex.get(s))
        .filter((b): b is Bank => Boolean(b)),
    [favourites, slugIndex],
  );

  const frequentBanks = useMemo(
    () =>
      frequent
        .map((s) => slugIndex.get(s))
        .filter((b): b is Bank => Boolean(b)),
    [frequent, slugIndex],
  );

  const sectionList = useMemo(() => {
    // Use server-provided category order, falling back to our local
    // CATEGORY_ORDER so a brand-new category from the server still
    // renders at the bottom rather than vanishing.
    const order: BankCategory[] = [
      ...categories,
      ...CATEGORY_ORDER.filter((c) => !categories.includes(c)),
    ];
    return order
      .map((cat) => ({
        category: cat,
        rows: (grouped[cat] || []).filter((b) => !failedLogos.has(b.slug)),
      }))
      .filter((s) => s.rows.length > 0);
  }, [categories, grouped, failedLogos]);

  const filterSection = (rows: Bank[]) => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.slug.toLowerCase().includes(q) ||
        b.paybill.includes(q),
    );
  };

  const categoryLabel = (cat: BankCategory): string => {
    switch (cat) {
      case "tier1":
        return t("payment.bankTier1");
      case "midtier":
        return t("payment.bankMidtier");
      case "regional":
        return t("payment.bankRegional");
      case "sharia":
        return t("payment.bankSharia");
      default:
        return cat;
    }
  };

  // True when search has results in any visible section · drives the
  // empty-state copy at the bottom of the picker.
  const anyMatch = useMemo(() => {
    if (!search.trim()) return true;
    if (filterSection(favouriteBanks).length) return true;
    if (filterSection(frequentBanks).length) return true;
    return sectionList.some((s) => filterSection(s.rows).length > 0);
  }, [search, favouriteBanks, frequentBanks, sectionList]);

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

              {/* Bank picker · 2026-04-25 redesign with search,
                  favourites, frequent, and category sections.
                  Banks whose Clearbit logo fails to load are auto-
                  filtered (see handleLogoResolve) so we never render
                  letter-initial placeholders. */}
              <SectionHeader
                title={t("payment.pickBank")}
                icon="business-outline"
                iconColor={colors.primary[400]}
              />

              {/* Search */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: tc.dark.card,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: focusedField === "search"
                    ? colors.primary[400] + "60"
                    : tc.dark.border,
                  paddingHorizontal: 14,
                  marginBottom: 14,
                  ...(isWeb
                    ? ({ transition: "border-color 0.15s ease" } as any)
                    : {}),
                  ...(focusedField === "search" && isWeb
                    ? ({ boxShadow: `0 0 0 3px ${colors.primary[500]}15` } as any)
                    : {}),
                }}
              >
                <Ionicons
                  name="search"
                  size={16}
                  color={tc.textMuted}
                  style={{ marginRight: 8 }}
                />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder={t("payment.bankSearchPlaceholder")}
                  placeholderTextColor={tc.dark.muted}
                  onFocus={() => setFocusedField("search")}
                  onBlur={() => setFocusedField(null)}
                  style={{
                    flex: 1,
                    color: tc.textPrimary,
                    fontSize: 14,
                    paddingVertical: 12,
                    fontFamily: "DMSans_400Regular",
                    ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
                  }}
                  accessibilityLabel={t("payment.bankSearchPlaceholder")}
                  testID="bank-search-input"
                />
                {search.length > 0 && (
                  <Pressable
                    onPress={() => setSearch("")}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                  >
                    <Ionicons name="close-circle" size={18} color={tc.textMuted} />
                  </Pressable>
                )}
              </View>

              {/* Favourites · pinned by the user. Renders as a single
                  tight row of 1-line tiles above the categories. */}
              {filterSection(favouriteBanks).length > 0 && (
                <View style={{ marginBottom: 18 }}>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 11,
                      fontFamily: "DMSans_600SemiBold",
                      letterSpacing: 0.6,
                      textTransform: "uppercase",
                      marginBottom: 10,
                    }}
                  >
                    {t("payment.bankFavourites")}
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: tileGap,
                    }}
                  >
                    {filterSection(favouriteBanks).map((bank) => (
                      <BankTile
                        key={`fav-${bank.slug}`}
                        bank={bank}
                        gridCols={gridCols}
                        tileGap={tileGap}
                        isSelected={selectedBank?.slug === bank.slug}
                        isFavourite
                        showStarPin
                        onSelect={() => {
                          setSelectedBank(bank);
                          setQuote(null);
                        }}
                        onLogoResolve={handleLogoResolve}
                        onToggleFavourite={() => handleToggleFavourite(bank.slug)}
                        tc={tc}
                        isWeb={isWeb}
                        t={t}
                      />
                    ))}
                  </View>
                </View>
              )}

              {/* Frequent · top-3 most-used (excluding favourites). */}
              {filterSection(frequentBanks).length > 0 && (
                <View style={{ marginBottom: 18 }}>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 11,
                      fontFamily: "DMSans_600SemiBold",
                      letterSpacing: 0.6,
                      textTransform: "uppercase",
                      marginBottom: 10,
                    }}
                  >
                    {t("payment.bankFrequent")}
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: tileGap,
                    }}
                  >
                    {filterSection(frequentBanks).map((bank) => (
                      <BankTile
                        key={`freq-${bank.slug}`}
                        bank={bank}
                        gridCols={gridCols}
                        tileGap={tileGap}
                        isSelected={selectedBank?.slug === bank.slug}
                        isFavourite={favourites.includes(bank.slug)}
                        showStarPin={false}
                        onSelect={() => {
                          setSelectedBank(bank);
                          setQuote(null);
                        }}
                        onLogoResolve={handleLogoResolve}
                        onToggleFavourite={() => handleToggleFavourite(bank.slug)}
                        tc={tc}
                        isWeb={isWeb}
                        t={t}
                      />
                    ))}
                  </View>
                </View>
              )}

              {/* Category sections · tier1 → midtier → regional → sharia */}
              {sectionList.map((section) => {
                const filtered = filterSection(section.rows);
                if (filtered.length === 0) return null;
                return (
                  <View key={`cat-${section.category}`} style={{ marginBottom: 18 }}>
                    <Text
                      style={{
                        color: tc.textMuted,
                        fontSize: 11,
                        fontFamily: "DMSans_600SemiBold",
                        letterSpacing: 0.6,
                        textTransform: "uppercase",
                        marginBottom: 10,
                      }}
                    >
                      {categoryLabel(section.category)}
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: tileGap,
                      }}
                    >
                      {filtered.map((bank) => (
                        <BankTile
                          key={`${section.category}-${bank.slug}`}
                          bank={bank}
                          gridCols={gridCols}
                          tileGap={tileGap}
                          isSelected={selectedBank?.slug === bank.slug}
                          isFavourite={favourites.includes(bank.slug)}
                          showStarPin
                          onSelect={() => {
                            setSelectedBank(bank);
                            setQuote(null);
                          }}
                          onLogoResolve={handleLogoResolve}
                          onToggleFavourite={() => handleToggleFavourite(bank.slug)}
                          tc={tc}
                          isWeb={isWeb}
                          t={t}
                        />
                      ))}
                    </View>
                  </View>
                );
              })}

              {/* Empty state when search filters everything out */}
              {!anyMatch && (
                <View
                  style={{
                    paddingVertical: 24,
                    alignItems: "center",
                    marginBottom: 20,
                  }}
                >
                  <Ionicons name="search-outline" size={28} color={tc.textMuted} />
                  <Text
                    style={{
                      color: tc.textSecondary,
                      fontSize: 13,
                      fontFamily: "DMSans_500Medium",
                      marginTop: 8,
                      textAlign: "center",
                    }}
                  >
                    {t("payment.bankNoneMatch").replace("{query}", search.trim())}
                  </Text>
                </View>
              )}

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
