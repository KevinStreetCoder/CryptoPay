import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
  useWindowDimensions,
  Linking,
  Animated,
  LayoutAnimation,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { SectionHeader } from "../../src/components/SectionHeader";
import { useLocale } from "../../src/hooks/useLocale";

const isWeb = Platform.OS === "web";

// ── FAQ Data ──────────────────────────────────────────────────────────────────

interface FAQItem {
  question: string;
  answer: string;
  category: string;
}

type CategoryKey = "all" | "deposits" | "payments" | "security" | "general";

const CATEGORIES: { key: CategoryKey; labelKey: string; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
  { key: "all", labelKey: "help.all", icon: "grid-outline", color: colors.primary[400] },
  { key: "deposits", labelKey: "help.deposits", icon: "download-outline", color: "#60A5FA" },
  { key: "payments", labelKey: "help.payments", icon: "card-outline", color: colors.success },
  { key: "security", labelKey: "help.security", icon: "shield-outline", color: colors.warning },
  { key: "general", labelKey: "help.general", icon: "information-circle-outline", color: "#A78BFA" },
];

// FAQ keys map to i18n translations — no hardcoded content
const FAQ_KEYS: { questionKey: string; answerKey: string; category: string }[] = [
  { questionKey: "help.faqDepositHow", answerKey: "help.faqDepositHowAnswer", category: "deposits" },
  { questionKey: "help.faqDepositTime", answerKey: "help.faqDepositTimeAnswer", category: "deposits" },
  { questionKey: "help.faqPayBill", answerKey: "help.faqPayBillAnswer", category: "payments" },
  { questionKey: "help.faqFees", answerKey: "help.faqFeesAnswer", category: "payments" },
  { questionKey: "help.faqVerifyIdentity", answerKey: "help.faqVerifyIdentityAnswer", category: "security" },
  { questionKey: "help.faqCryptoSafe", answerKey: "help.faqCryptoSafeAnswer", category: "security" },
  { questionKey: "help.faqCurrencies", answerKey: "help.faqCurrenciesAnswer", category: "general" },
  { questionKey: "help.faqContactSupport", answerKey: "help.faqContactSupportAnswer", category: "general" },
];

// ── Accordion Item ────────────────────────────────────────────────────────────

function AccordionItem({
  item,
  isExpanded,
  onToggle,
  isDesktop,
  tc,
  ts,
}: {
  item: FAQItem;
  isExpanded: boolean;
  onToggle: () => void;
  isDesktop: boolean;
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
}) {
  const rotateAnim = useRef(new Animated.Value(isExpanded ? 1 : 0)).current;
  const heightAnim = useRef(new Animated.Value(isExpanded ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(rotateAnim, {
        toValue: isExpanded ? 1 : 0,
        duration: 250,
        useNativeDriver: Platform.OS !== "web",
      }),
      Animated.timing(heightAnim, {
        toValue: isExpanded ? 1 : 0,
        duration: 250,
        useNativeDriver: Platform.OS !== "web",
      }),
    ]).start();
  }, [isExpanded]);

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  const categoryInfo = CATEGORIES.find((c) => c.key === item.category);

  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed, hovered }: any) => ({
        paddingHorizontal: isDesktop ? 22 : 18,
        paddingVertical: isDesktop ? 18 : 16,
        backgroundColor: isExpanded
          ? (categoryInfo?.color || colors.primary[400]) + "06"
          : hovered
            ? tc.glass.highlight
            : "transparent",
        opacity: pressed ? 0.85 : 1,
        ...(isWeb
          ? ({
              cursor: "pointer",
              transition: "all 0.2s ease",
            } as any)
          : {}),
      })}
      accessibilityRole="button"
      accessibilityLabel={item.question}
      accessibilityState={{ expanded: isExpanded }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", flex: 1, gap: 12 }}>
          {/* Category dot */}
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: categoryInfo?.color || colors.primary[400],
              opacity: 0.7,
            }}
          />
          <Text
            style={{
              color: isExpanded ? tc.textPrimary : tc.textPrimary,
              fontSize: 15,
              fontFamily: isExpanded ? "DMSans_700Bold" : "DMSans_600SemiBold",
              flex: 1,
              paddingRight: 12,
            }}
          >
            {item.question}
          </Text>
        </View>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons
            name="chevron-down"
            size={18}
            color={isExpanded ? categoryInfo?.color || colors.primary[400] : tc.textMuted}
          />
        </Animated.View>
      </View>
      {isExpanded && (
        <Animated.View
          style={{
            opacity: heightAnim,
            marginTop: 12,
            marginLeft: 20,
            paddingLeft: 12,
            borderLeftWidth: 2,
            borderLeftColor: (categoryInfo?.color || colors.primary[400]) + "30",
          }}
        >
          <Text
            style={{
              color: tc.textSecondary,
              fontSize: 14,
              lineHeight: 22,
            }}
          >
            {item.answer}
          </Text>
        </Animated.View>
      )}
    </Pressable>
  );
}

// ── Category Filter Chip ─────────────────────────────────────────────────────

function CategoryChip({
  category,
  isActive,
  onPress,
  tc,
  t,
}: {
  category: (typeof CATEGORIES)[number];
  isActive: boolean;
  onPress: () => void;
  tc: ReturnType<typeof getThemeColors>;
  t: (key: string) => string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 12,
        backgroundColor: isActive
          ? category.color + "20"
          : hovered
            ? tc.glass.highlight
            : tc.dark.card,
        borderWidth: 1,
        borderColor: isActive ? category.color + "40" : tc.glass.border,
        opacity: pressed ? 0.8 : 1,
        ...(isWeb
          ? ({
              cursor: "pointer",
              transition: "all 0.2s ease",
              transform: hovered && !isActive ? "translateY(-1px)" : "translateY(0px)",
            } as any)
          : {}),
      })}
      accessibilityRole="button"
      accessibilityLabel={`Filter by ${t(category.labelKey)}`}
      accessibilityState={{ selected: isActive }}
    >
      <Ionicons
        name={category.icon}
        size={14}
        color={isActive ? category.color : tc.textMuted}
      />
      <Text
        style={{
          color: isActive ? category.color : tc.textSecondary,
          fontSize: 13,
          fontFamily: isActive ? "DMSans_700Bold" : "DMSans_500Medium",
        }}
      >
        {t(category.labelKey)}
      </Text>
    </Pressable>
  );
}

// ── Contact Card ──────────────────────────────────────────────────────────────

function ContactCard({
  icon,
  iconColor,
  iconBg,
  label,
  value,
  onPress,
  isDesktop,
  tc,
  ts,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  label: string;
  value: string;
  onPress: () => void;
  isDesktop: boolean;
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => ({
        backgroundColor: hovered
          ? tc.dark.elevated
          : tc.dark.card,
        borderRadius: 16,
        padding: isDesktop ? 18 : 16,
        borderWidth: 1,
        borderColor: hovered ? tc.glass.borderStrong : tc.glass.border,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        opacity: pressed ? 0.85 : 1,
        ...ts.sm,
        ...(isWeb
          ? ({
              cursor: "pointer",
              transition: "all 0.2s ease",
              transform: hovered ? "translateY(-2px) scale(1.01)" : "translateY(0px) scale(1)",
            } as any)
          : {}),
      })}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 13,
          backgroundColor: iconBg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={20} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
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
            color: tc.textPrimary,
            fontSize: 15,
            fontFamily: "DMSans_600SemiBold",
            marginTop: 2,
          }}
        >
          {value}
        </Text>
      </View>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          backgroundColor: tc.glass.highlight,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="open-outline" size={14} color={tc.textMuted} />
      </View>
    </Pressable>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function HelpScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;
  const isLargeDesktop = isWeb && width >= 1100;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const { t } = useLocale();

  const [searchQuery, setSearchQuery] = useState("");
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [activeCategory, setActiveCategory] = useState<CategoryKey>("all");
  const [searchFocused, setSearchFocused] = useState(false);

  // Resolve FAQ items from i18n translations
  const faqData: FAQItem[] = useMemo(() =>
    FAQ_KEYS.map((k) => ({
      question: t(k.questionKey),
      answer: t(k.answerKey),
      category: k.category,
    })),
  [t]);

  const filteredFAQ = useMemo(() => {
    let items = faqData;

    // Category filter
    if (activeCategory !== "all") {
      items = items.filter((item) => item.category === activeCategory);
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        (item) =>
          item.question.toLowerCase().includes(q) ||
          item.answer.toLowerCase().includes(q)
      );
    }

    return items;
  }, [searchQuery, activeCategory, faqData]);

  const handleToggle = useCallback((index: number) => {
    if (Platform.OS !== "web") {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    setExpandedIndex((prev) => (prev === index ? null : index));
  }, []);

  const handleCategoryChange = useCallback((key: CategoryKey) => {
    setActiveCategory(key);
    setExpandedIndex(null);
  }, []);

  const handleEmail = () => {
    Linking.openURL("mailto:support@cpay.co.ke");
  };

  // Support WhatsApp — routes to Kevin's line until we provision a
  // dedicated support number. Swap this constant when that happens.
  // Previous value "+254700000000" was a placeholder that 404'd.
  const SUPPORT_WHATSAPP_NUMBER = "254701961618";
  const handleWhatsApp = () => {
    if (!SUPPORT_WHATSAPP_NUMBER) return;
    Linking.openURL(`https://wa.me/${SUPPORT_WHATSAPP_NUMBER}`);
  };

  const handleTwitter = () => {
    Linking.openURL("https://x.com/CryptoPayKE");
  };

  const contentMaxWidth = undefined;
  const horizontalPadding = isDesktop ? 48 : 20;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: horizontalPadding,
          paddingTop: isDesktop ? 12 : 8,
          paddingBottom: 40,
        }}
      >
        {/* Back button */}
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/settings" as any);
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
            marginBottom: 8,
            opacity: pressed ? 0.9 : 1,
            ...(isWeb
              ? ({
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  transform: hovered ? "translateX(-2px)" : "translateX(0px)",
                } as any)
              : {}),
          })}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
          <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_500Medium" }}>
            {t("common.back")}
          </Text>
        </Pressable>

        {/* Page Title */}
        <View
          style={{
            marginBottom: isDesktop ? 28 : 20,
            paddingHorizontal: 4,
          }}
        >
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: isDesktop ? 32 : 26,
              fontFamily: "DMSans_700Bold",
              letterSpacing: -0.5,
            }}
          >
            {t("help.helpSupport")}
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: isDesktop ? 16 : 14,
              marginTop: 4,
              lineHeight: 22,
            }}
          >
            {t("help.findAnswers")}
          </Text>
        </View>

        {/* Search Bar */}
        <View
          style={{
            backgroundColor: tc.dark.card,
            borderRadius: 16,
            borderWidth: 1.5,
            borderColor: searchFocused
              ? colors.primary[500] + "50"
              : tc.glass.border,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            marginBottom: 20,
            ...ts.sm,
            ...(isWeb && searchFocused
              ? ({
                  boxShadow: `0 0 0 3px ${colors.primary[500]}15, 0 2px 8px rgba(0,0,0,0.15)`,
                  transition: "all 0.25s ease",
                } as any)
              : isWeb
                ? ({ transition: "all 0.25s ease" } as any)
                : {}),
          }}
        >
          <Ionicons
            name="search-outline"
            size={20}
            color={searchFocused ? colors.primary[400] : tc.textMuted}
          />
          <TextInput
            value={searchQuery}
            onChangeText={(text) => {
              setSearchQuery(text);
              setExpandedIndex(null);
            }}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder={t("help.searchFAQs")}
            placeholderTextColor={tc.textMuted}
            style={{
              flex: 1,
              color: tc.textPrimary,
              fontSize: 15,
              paddingVertical: 14,
              paddingHorizontal: 12,
              ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
            }}
            accessibilityLabel="Search frequently asked questions"
          />
          {searchQuery.length > 0 && (
            <Pressable
              onPress={() => {
                setSearchQuery("");
                setExpandedIndex(null);
              }}
              style={({ pressed, hovered }: any) => ({
                opacity: pressed ? 0.6 : 1,
                padding: 6,
                borderRadius: 8,
                backgroundColor: hovered ? tc.glass.highlight : "transparent",
                ...(isWeb ? ({ cursor: "pointer", transition: "all 0.15s ease" } as any) : {}),
              })}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={20} color={tc.textMuted} />
            </Pressable>
          )}
        </View>

        {/* Category Filters */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: 8,
            paddingBottom: 4,
            marginBottom: 20,
          }}
        >
          {CATEGORIES.map((cat) => (
            <CategoryChip
              key={cat.key}
              category={cat}
              isActive={activeCategory === cat.key}
              onPress={() => handleCategoryChange(cat.key)}
              tc={tc}
              t={t}
            />
          ))}
        </ScrollView>

        {/* FAQ + Contact Sections */}
        <View
          style={{
            ...(isLargeDesktop
              ? { flexDirection: "row" as const, gap: 24, alignItems: "flex-start" as const }
              : {}),
          }}
        >
          {/* FAQ Section */}
          <View style={{ marginBottom: 28, ...(isLargeDesktop ? { flex: 6 } : {}) }}>
            <SectionHeader
              title={t("help.faq")}
              icon="chatbubbles-outline"
              iconColor="#60A5FA"
              count={filteredFAQ.length}
            />
            <View
              style={{
                backgroundColor: tc.dark.card,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: tc.glass.border,
                overflow: "hidden",
                ...ts.sm,
              }}
            >
              {filteredFAQ.length === 0 ? (
                <View
                  style={{
                    paddingVertical: 40,
                    alignItems: "center",
                  }}
                >
                  <View
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 16,
                      backgroundColor: tc.glass.highlight,
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 14,
                    }}
                  >
                    <Ionicons
                      name="search-outline"
                      size={28}
                      color={tc.textMuted}
                    />
                  </View>
                  <Text
                    style={{
                      color: tc.textSecondary,
                      fontSize: 15,
                      fontFamily: "DMSans_600SemiBold",
                    }}
                  >
                    {t("help.noResultsFound")}
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 13,
                      marginTop: 6,
                    }}
                  >
                    {t("help.tryDifferentSearch")}
                  </Text>
                </View>
              ) : (
                filteredFAQ.map((item, index) => {
                  const originalIndex = faqData.indexOf(item);
                  return (
                    <View key={item.question}>
                      {index > 0 && (
                        <View
                          style={{
                            height: 1,
                            backgroundColor: tc.glass.border,
                            marginLeft: isDesktop ? 22 : 18,
                          }}
                        />
                      )}
                      <AccordionItem
                        item={item}
                        isExpanded={expandedIndex === originalIndex}
                        onToggle={() => handleToggle(originalIndex)}
                        isDesktop={isDesktop}
                        tc={tc}
                        ts={ts}
                      />
                    </View>
                  );
                })
              )}
            </View>
          </View>

          {/* Contact Section */}
          <View style={{ marginBottom: 28, ...(isLargeDesktop ? { flex: 4 } : {}) }}>
            <SectionHeader
              title={t("help.contactUs")}
              icon="chatbubble-ellipses-outline"
              iconColor={colors.primary[400]}
            />
            <View style={{ gap: 10 }}>
              <ContactCard
                icon="mail-outline"
                iconColor={colors.primary[400]}
                iconBg={colors.primary[500] + "18"}
                label={t("help.email")}
                value="support@cpay.co.ke"
                onPress={handleEmail}
                isDesktop={isDesktop}
                tc={tc}
                ts={ts}
              />
              {SUPPORT_WHATSAPP_NUMBER ? (
              <ContactCard
                icon="logo-whatsapp"
                iconColor="#25D366"
                iconBg="rgba(37,211,102,0.15)"
                label={t("help.whatsApp")}
                value={`+${SUPPORT_WHATSAPP_NUMBER}`}
                onPress={handleWhatsApp}
                isDesktop={isDesktop}
                tc={tc}
                ts={ts}
              />
              ) : null}
              <ContactCard
                icon="logo-twitter"
                iconColor="#1DA1F2"
                iconBg="rgba(29,161,242,0.15)"
                label={t("help.twitterX")}
                value="@CryptoPayKE"
                onPress={handleTwitter}
                isDesktop={isDesktop}
                tc={tc}
                ts={ts}
              />
            </View>

            {/* Quick Help Card */}
            <View
              style={{
                backgroundColor: colors.primary[500] + "10",
                borderRadius: 18,
                padding: isDesktop ? 22 : 18,
                borderWidth: 1,
                borderColor: colors.primary[500] + "20",
                marginTop: 16,
                ...ts.sm,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    backgroundColor: colors.primary[500] + "20",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="bulb-outline" size={18} color={colors.primary[400]} />
                </View>
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: 15,
                    fontFamily: "DMSans_700Bold",
                  }}
                >
                  {t("help.needMoreHelp")}
                </Text>
              </View>
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 13,
                  lineHeight: 20,
                }}
              >
                {t("help.supportResponseTime")}
              </Text>
            </View>
          </View>
        </View>

        {/* App Version */}
        <View style={{ alignItems: "center", marginTop: 8 }}>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 12,
              fontFamily: "DMSans_500Medium",
            }}
          >
            Cpay v1.0.0
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
