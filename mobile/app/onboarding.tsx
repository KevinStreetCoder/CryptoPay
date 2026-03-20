import { useRef, useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  Animated,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  Modal,
  ViewToken,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { storage } from "../src/utils/storage";
import { colors, getThemeColors } from "../src/constants/theme";
import { useThemeMode } from "../src/stores/theme";
import { GlassCard } from "../src/components/GlassCard";
import { useLocale } from "../src/hooks/useLocale";

const isWeb = Platform.OS === "web";

// Static colors that don't change with theme
const S = {
  primary: colors.primary[500],
  primaryDark: colors.primary[600],
  white: "#FFFFFF",
  backdrop: "rgba(0,0,0,0.7)",
};

export const ONBOARDING_COMPLETED_KEY = "cryptopay_onboarding_completed";

// ── Slide data ───────────────────────────────────────────────────────────────
interface Slide {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  title: string;
  description: string;
}

// Slide visual config (icons/colors) — text comes from i18n
const SLIDE_CONFIG = [
  { id: "1", icon: "wallet" as const, iconColor: "#10B981", iconBg: "rgba(16, 185, 129, 0.15)", titleKey: "tour.slide1Title", descKey: "tour.slide1Desc" },
  { id: "2", icon: "arrow-down-circle" as const, iconColor: "#F59E0B", iconBg: "rgba(245, 158, 11, 0.15)", titleKey: "tour.slide2Title", descKey: "tour.slide2Desc" },
  { id: "3", icon: "send" as const, iconColor: "#3B82F6", iconBg: "rgba(59, 130, 246, 0.15)", titleKey: "tour.slide3Title", descKey: "tour.slide3Desc" },
  { id: "4", icon: "shield-checkmark" as const, iconColor: "#8B5CF6", iconBg: "rgba(139, 92, 246, 0.15)", titleKey: "tour.slide4Title", descKey: "tour.slide4Desc" },
  { id: "5", icon: "rocket" as const, iconColor: "#EC4899", iconBg: "rgba(236, 72, 153, 0.15)", titleKey: "tour.slide5Title", descKey: "tour.slide5Desc" },
];

function getSlides(t: (key: string) => string): Slide[] {
  return SLIDE_CONFIG.map((s) => ({
    id: s.id,
    icon: s.icon,
    iconColor: s.iconColor,
    iconBg: s.iconBg,
    title: t(s.titleKey),
    description: t(s.descKey),
  }));
}

// ── Pagination dot ───────────────────────────────────────────────────────────
function Dot({
  index,
  scrollX,
  itemWidth,
  tc,
}: {
  index: number;
  scrollX: Animated.Value;
  itemWidth: number;
  tc: ReturnType<typeof getThemeColors>;
}) {
  const inputRange = [
    (index - 1) * itemWidth,
    index * itemWidth,
    (index + 1) * itemWidth,
  ];
  const w = scrollX.interpolate({
    inputRange,
    outputRange: [8, 24, 8],
    extrapolate: "clamp",
  });
  const bg = scrollX.interpolate({
    inputRange,
    outputRange: [tc.textMuted, S.primary, tc.textMuted],
    extrapolate: "clamp",
  });
  const o = scrollX.interpolate({
    inputRange,
    outputRange: [0.35, 1, 0.35],
    extrapolate: "clamp",
  });
  return <Animated.View style={[s.dot, { width: w, backgroundColor: bg, opacity: o }]} />;
}

// ── Web popup card slide ─────────────────────────────────────────────────────
function WebSlide({ item, tc }: { item: Slide; tc: ReturnType<typeof getThemeColors> }) {
  return (
    <View style={s.webSlide}>
      <View
        style={[
          s.iconCircle,
          {
            backgroundColor: item.iconBg,
            borderColor: item.iconColor + "30",
          },
          isWeb ? { boxShadow: `0 0 24px ${item.iconColor}25` } as any : {},
        ]}
      >
        <Ionicons name={item.icon} size={48} color={item.iconColor} />
      </View>
      <Text style={[s.webTitle, { color: tc.textPrimary }]}>{item.title}</Text>
      <Text style={[s.webDesc, { color: tc.textSecondary }]}>{item.description}</Text>
    </View>
  );
}

// ── Mobile slide ─────────────────────────────────────────────────────────────
function MobileSlide({ item, width, tc }: { item: Slide; width: number; tc: ReturnType<typeof getThemeColors> }) {
  return (
    <View style={[s.mobileSlide, { width }]}>
      <GlassCard
        glowColor={item.iconColor}
        glowOpacity={0.2}
        style={{ paddingVertical: 28, paddingHorizontal: 24, alignItems: "center" } as any}
      >
        <View
          style={[
            s.iconCircleLarge,
            {
              backgroundColor: item.iconBg,
              borderColor: item.iconColor + "30",
            },
          ]}
        >
          <Ionicons name={item.icon} size={48} color={item.iconColor} />
        </View>
        <Text style={[s.mobileTitle, { color: tc.textPrimary }]}>{item.title}</Text>
        <Text style={[s.mobileDesc, { color: tc.textSecondary }]}>{item.description}</Text>
      </GlassCard>
    </View>
  );
}

// ── Main Onboarding Modal ────────────────────────────────────────────────────
export function OnboardingModal({
  visible,
  onComplete,
}: {
  visible: boolean;
  onComplete: () => void;
}) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const isDesktop = isWeb && screenW >= 768;
  const scrollX = useRef(new Animated.Value(0)).current;
  const flatListRef = useRef<FlatList>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const { locale, setLocale, t } = useLocale();
  const slides = getSlides(t);
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const cardAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(cardAnim, {
          toValue: 1,
          friction: 8,
          tension: 50,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setCurrentIndex(viewableItems[0].index);
      }
    }
  ).current;

  const viewabilityConfig = useRef({
    viewAreaCoveragePercentThreshold: 50,
  }).current;

  const handleFinish = useCallback(async () => {
    await storage.setItemAsync(ONBOARDING_COMPLETED_KEY, "true");
    onComplete();
  }, [onComplete]);

  const handleNext = useCallback(() => {
    if (currentIndex < slides.length - 1) {
      flatListRef.current?.scrollToIndex({
        index: currentIndex + 1,
        animated: true,
      });
    } else {
      handleFinish();
    }
  }, [currentIndex, handleFinish]);

  const isLast = currentIndex === slides.length - 1;

  if (!visible) return null;

  // ── Web: centered popup card ───────────────────────────────────────────────
  if (isDesktop) {
    const CARD_W = 480;
    return (
      <View style={s.webOverlay}>
        <Animated.View style={[s.webBackdrop, { opacity: backdropAnim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleFinish} />
        </Animated.View>

        <Animated.View
          style={[
            s.webCard,
            {
              backgroundColor: tc.dark.card,
              borderColor: colors.primary[500] + "40",
              width: CARD_W,
              transform: [
                {
                  scale: cardAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.85, 1],
                  }),
                },
              ],
              opacity: cardAnim,
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              boxShadow: `0 25px 80px rgba(0,0,0,0.6), 0 0 30px ${colors.primary[500]}20`,
            } as any,
          ]}
        >
          {/* Step indicator + language toggle */}
          <View style={s.webStepRow}>
            <Text style={[s.webStepLabel, { color: tc.textMuted }]}>
              {currentIndex + 1} of {slides.length}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              {/* Language toggle */}
              <Pressable
                onPress={() => setLocale(locale === "en" ? "sw" : "en")}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  backgroundColor: tc.dark.elevated,
                  borderRadius: 8,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderWidth: 1,
                  borderColor: tc.glass.border,
                }}
              >
                <Ionicons name="language-outline" size={14} color={tc.textSecondary} />
                <Text style={{ color: tc.textSecondary, fontSize: 11, fontFamily: "DMSans_500Medium" }}>
                  {locale === "en" ? "SW" : "EN"}
                </Text>
              </Pressable>
              {!isLast && (
                <Pressable onPress={handleFinish} hitSlop={12}>
                  <Text style={[s.webSkipText, { color: tc.textSecondary }]}>{t("tour.skip")}</Text>
                </Pressable>
              )}
            </View>
          </View>

          {/* Slide content */}
          <WebSlide item={slides[currentIndex]} tc={tc} />

          {/* Dots */}
          <View style={s.webDots}>
            {slides.map((_, i) => (
              <View
                key={i}
                style={[
                  s.webDot,
                  { backgroundColor: tc.textMuted },
                  i === currentIndex && [s.webDotActive, { backgroundColor: S.primary }],
                ]}
              />
            ))}
          </View>

          {/* Button */}
          <Pressable
            onPress={() => {
              if (isLast) handleFinish();
              else setCurrentIndex((prev) => Math.min(prev + 1, slides.length - 1));
            }}
            style={({ pressed }) => [
              s.webButton,
              pressed && { backgroundColor: S.primaryDark },
            ]}
          >
            <Text style={s.webButtonText}>
              {isLast ? t("tour.letsGo") : t("tour.next")}
            </Text>
            <Ionicons
              name={isLast ? "checkmark-circle" : "arrow-forward"}
              size={18}
              color={S.white}
            />
          </Pressable>
        </Animated.View>
      </View>
    );
  }

  // ── Mobile: full-screen swipeable modal ────────────────────────────────────
  const slideWidth = screenW;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
    >
      <View style={[s.mobileOverlay, { backgroundColor: tc.dark.bg }]}>
        {/* Header */}
        <View style={s.mobileHeader}>
          <View style={s.mobileLogoRow}>
            <Ionicons name="diamond" size={20} color={S.primary} />
            <Text style={[s.mobileLogo, { color: tc.textPrimary }]}>CryptoPay</Text>
          </View>
          {!isLast && (
            <Pressable
              onPress={handleFinish}
              hitSlop={12}
              style={({ pressed }) => [
                s.mobileSkipBtn,
                pressed && { opacity: 0.6 },
              ]}
            >
              <Text style={[s.mobileSkipText, { color: tc.textSecondary }]}>{t("tour.skip")}</Text>
              <Ionicons name="chevron-forward" size={14} color={tc.textSecondary} />
            </Pressable>
          )}
        </View>

        {/* Slides */}
        <FlatList
          ref={flatListRef}
          data={slides}
          keyExtractor={(item) => item.id}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: false }
          )}
          scrollEventThrottle={16}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          renderItem={({ item }) => (
            <MobileSlide item={item} width={slideWidth} tc={tc} />
          )}
          getItemLayout={(_, index) => ({
            length: slideWidth,
            offset: slideWidth * index,
            index,
          })}
        />

        {/* Footer */}
        <View style={s.mobileFooter}>
          <View style={s.mobileDots}>
            {slides.map((_, i) => (
              <Dot key={i} index={i} scrollX={scrollX} itemWidth={slideWidth} tc={tc} />
            ))}
          </View>

          <Pressable
            onPress={handleNext}
            style={({ pressed }) => [
              s.mobileNextBtn,
              isLast && s.mobileFinishBtn,
              pressed && { backgroundColor: S.primaryDark, transform: [{ scale: 0.97 }] },
            ]}
          >
            <Text style={s.mobileNextText}>
              {isLast ? t("tour.letsGo") : t("tour.next")}
            </Text>
            <Ionicons
              name={isLast ? "checkmark-circle" : "arrow-forward"}
              size={18}
              color={S.white}
            />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ── Keep default export for the route (redirects away) ───────────────────────
export default function OnboardingScreen() {
  return null;
}

// ── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // ── Web overlay ──
  webOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    justifyContent: "center",
    alignItems: "center",
  },
  webBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: S.backdrop,
  },
  webCard: {
    borderRadius: 24,
    padding: 40,
    borderWidth: 1,
    alignItems: "center",
    ...(isWeb
      ? ({ boxShadow: "0 25px 80px rgba(0,0,0,0.6)" } as any)
      : {}),
  },
  webStepRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    marginBottom: 28,
  },
  webStepLabel: {
    fontSize: 13,
    fontFamily: "DMSans_600SemiBold",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  webSkipText: {
    fontSize: 14,
    fontFamily: "DMSans_600SemiBold",
  },
  webSlide: {
    alignItems: "center",
    paddingHorizontal: 8,
  },
  webTitle: {
    fontSize: 22,
    fontFamily: "DMSans_700Bold",
    textAlign: "center",
    marginBottom: 12,
    letterSpacing: -0.3,
  },
  webDesc: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 360,
  },
  webDots: {
    flexDirection: "row",
    gap: 8,
    marginTop: 28,
    marginBottom: 24,
  },
  webDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    opacity: 0.4,
  },
  webDotActive: {
    width: 24,
    opacity: 1,
  },
  webButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: S.primary,
    paddingVertical: 14,
    paddingHorizontal: 36,
    borderRadius: 14,
    width: "100%",
    ...(isWeb ? ({ cursor: "pointer" } as any) : {}),
  },
  webButtonText: {
    fontSize: 16,
    fontFamily: "DMSans_700Bold",
    color: S.white,
  },

  // ── Shared ──
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  iconCircleLarge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  dot: {
    height: 7,
    borderRadius: 3.5,
  },

  // ── Mobile ──
  mobileOverlay: {
    flex: 1,
  },
  mobileHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: Platform.OS === "android" ? 48 : 56,
    paddingBottom: 8,
  },
  mobileLogoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  mobileLogo: {
    fontSize: 18,
    fontFamily: "DMSans_700Bold",
    letterSpacing: 0.3,
  },
  mobileSkipBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  mobileSkipText: {
    fontSize: 14,
    fontFamily: "DMSans_600SemiBold",
  },
  mobileSlide: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 28,
    maxHeight: "70%",
  },
  mobileTitle: {
    fontSize: 26,
    fontFamily: "DMSans_700Bold",
    textAlign: "center",
    marginBottom: 14,
    letterSpacing: -0.3,
  },
  mobileDesc: {
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center",
    maxWidth: 340,
  },
  mobileFooter: {
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === "android" ? 24 : 32,
    paddingTop: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  mobileDots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  mobileNextBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: S.primary,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
  },
  mobileFinishBtn: {
    paddingHorizontal: 32,
  },
  mobileNextText: {
    fontSize: 16,
    fontFamily: "DMSans_700Bold",
    color: S.white,
  },
});
