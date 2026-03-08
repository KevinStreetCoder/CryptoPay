import { useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Animated,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ViewToken,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { storage } from "../src/utils/storage";

// ── Theme ──────────────────────────────────────────────────────────────────────
const COLORS = {
  bg: "#060E1F",
  card: "#0C1A2E",
  elevated: "#162742",
  border: "#1E3350",
  primary: "#10B981",
  primaryLight: "#34D399",
  primaryDark: "#059669",
  accent: "#F59E0B",
  textPrimary: "#F0F4F8",
  textSecondary: "#8899AA",
  textMuted: "#556B82",
  white: "#FFFFFF",
};

export const ONBOARDING_COMPLETED_KEY = "cryptopay_onboarding_completed";

// ── Slide data ─────────────────────────────────────────────────────────────────
interface Slide {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  title: string;
  description: string;
  isLast?: boolean;
}

const slides: Slide[] = [
  {
    id: "1",
    icon: "wallet",
    iconColor: "#10B981",
    iconBg: "rgba(16, 185, 129, 0.15)",
    title: "Pay Bills with Crypto",
    description:
      "Convert USDT, BTC, or ETH and pay any M-Pesa bill instantly. No bank account needed — just your crypto wallet and a phone number.",
  },
  {
    id: "2",
    icon: "flash",
    iconColor: "#F59E0B",
    iconBg: "rgba(245, 158, 11, 0.15)",
    title: "Instant M-Pesa Integration",
    description:
      "Pay Safaricom M-Pesa Paybill and Till numbers directly from your crypto balance. Settlements arrive in seconds, not days.",
  },
  {
    id: "3",
    icon: "shield-checkmark",
    iconColor: "#3B82F6",
    iconBg: "rgba(59, 130, 246, 0.15)",
    title: "Bank-Grade Security",
    description:
      "Your funds are protected with PIN authentication, biometric verification, and end-to-end encryption. Your keys, your crypto.",
  },
  {
    id: "4",
    icon: "rocket",
    iconColor: "#A78BFA",
    iconBg: "rgba(167, 139, 250, 0.15)",
    title: "Get Started",
    description:
      "Create your free account in under a minute. Start paying bills, sending money, and managing crypto — all from one app.",
    isLast: true,
  },
];

// ── Pagination dot ─────────────────────────────────────────────────────────────
function PaginationDot({
  index,
  scrollX,
  width,
}: {
  index: number;
  scrollX: Animated.Value;
  width: number;
}) {
  const inputRange = [(index - 1) * width, index * width, (index + 1) * width];

  const dotWidth = scrollX.interpolate({
    inputRange,
    outputRange: [8, 28, 8],
    extrapolate: "clamp",
  });

  const opacity = scrollX.interpolate({
    inputRange,
    outputRange: [0.3, 1, 0.3],
    extrapolate: "clamp",
  });

  const backgroundColor = scrollX.interpolate({
    inputRange,
    outputRange: [COLORS.textMuted, COLORS.primary, COLORS.textMuted],
    extrapolate: "clamp",
  });

  return (
    <Animated.View
      style={[
        styles.dot,
        {
          width: dotWidth,
          opacity,
          backgroundColor,
        },
      ]}
    />
  );
}

// ── Slide renderer ─────────────────────────────────────────────────────────────
function SlideItem({
  item,
  width,
  onGetStarted,
}: {
  item: Slide;
  width: number;
  onGetStarted: () => void;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  // Animate in when the component mounts
  useState(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
  });

  return (
    <View
      style={[styles.slideContainer, { width }]}
      accessibilityRole="summary"
      accessibilityLabel={`Onboarding slide: ${item.title}. ${item.description}`}
    >
      <Animated.View
        style={[
          styles.slideContent,
          { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
        ]}
      >
        {/* Icon circle */}
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: item.iconBg },
          ]}
        >
          <Ionicons name={item.icon} size={80} color={item.iconColor} />
        </View>

        {/* Title */}
        <Text style={styles.slideTitle}>{item.title}</Text>

        {/* Description */}
        <Text style={styles.slideDescription}>{item.description}</Text>

        {/* CTA on last slide */}
        {item.isLast && (
          <Pressable
            onPress={onGetStarted}
            style={({ pressed }) => [
              styles.ctaButton,
              pressed && styles.ctaButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Get started — create your account"
          >
            <Ionicons
              name="rocket"
              size={20}
              color={COLORS.white}
              style={{ marginRight: 8 }}
            />
            <Text style={styles.ctaButtonText}>Get Started</Text>
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────
export default function OnboardingScreen() {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [currentIndex, setCurrentIndex] = useState(0);

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

  const completeOnboarding = useCallback(async () => {
    await storage.setItemAsync(ONBOARDING_COMPLETED_KEY, "true");
    router.replace("/auth/login");
  }, [router]);

  const handleNext = useCallback(() => {
    if (currentIndex < slides.length - 1) {
      flatListRef.current?.scrollToIndex({
        index: currentIndex + 1,
        animated: true,
      });
    } else {
      completeOnboarding();
    }
  }, [currentIndex, completeOnboarding]);

  const handleSkip = useCallback(() => {
    completeOnboarding();
  }, [completeOnboarding]);

  const isLastSlide = currentIndex === slides.length - 1;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header with Skip button */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="diamond" size={22} color={COLORS.primary} />
          <Text style={styles.logoText}>CryptoPay</Text>
        </View>
        {!isLastSlide && (
          <Pressable
            onPress={handleSkip}
            hitSlop={12}
            style={({ pressed }) => [
              styles.skipButton,
              pressed && { opacity: 0.6 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Skip onboarding"
          >
            <Text style={styles.skipText}>Skip</Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={COLORS.textSecondary}
            />
          </Pressable>
        )}
      </View>

      {/* Slide list */}
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
          <SlideItem
            item={item}
            width={width}
            onGetStarted={completeOnboarding}
          />
        )}
        getItemLayout={(_, index) => ({
          length: width,
          offset: width * index,
          index,
        })}
        accessibilityRole="adjustable"
        accessibilityLabel="Onboarding slides"
      />

      {/* Bottom: pagination + next button */}
      <View style={styles.footer}>
        {/* Dots */}
        <View style={styles.pagination}>
          {slides.map((_, index) => (
            <PaginationDot
              key={index}
              index={index}
              scrollX={scrollX}
              width={width}
            />
          ))}
        </View>

        {/* Next / Get Started button */}
        {!isLastSlide ? (
          <Pressable
            onPress={handleNext}
            style={({ pressed }) => [
              styles.nextButton,
              pressed && styles.nextButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Go to slide ${currentIndex + 2}`}
          >
            <Text style={styles.nextButtonText}>Next</Text>
            <Ionicons name="arrow-forward" size={18} color={COLORS.white} />
          </Pressable>
        ) : (
          <Pressable
            onPress={completeOnboarding}
            style={({ pressed }) => [
              styles.nextButton,
              styles.getStartedButton,
              pressed && styles.nextButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Get started — create your account"
          >
            <Text style={styles.nextButtonText}>Get Started</Text>
            <Ionicons name="arrow-forward" size={18} color={COLORS.white} />
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: Platform.OS === "android" ? 12 : 8,
    paddingBottom: 8,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  logoText: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
    letterSpacing: 0.3,
  },
  skipButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  skipText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },

  // Slide
  slideContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  slideContent: {
    alignItems: "center",
    maxWidth: 360,
  },
  iconCircle: {
    width: 160,
    height: 160,
    borderRadius: 80,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 40,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  slideTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.textPrimary,
    textAlign: "center",
    marginBottom: 16,
    letterSpacing: -0.3,
  },
  slideDescription: {
    fontSize: 16,
    lineHeight: 24,
    color: COLORS.textSecondary,
    textAlign: "center",
    paddingHorizontal: 8,
  },

  // CTA on last slide
  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    paddingHorizontal: 36,
    borderRadius: 16,
    marginTop: 36,
    minWidth: 200,
  },
  ctaButtonPressed: {
    backgroundColor: COLORS.primaryDark,
    transform: [{ scale: 0.97 }],
  },
  ctaButtonText: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.white,
  },

  // Footer
  footer: {
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === "android" ? 24 : 16,
    paddingTop: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pagination: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  nextButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
  },
  nextButtonPressed: {
    backgroundColor: COLORS.primaryDark,
    transform: [{ scale: 0.97 }],
  },
  getStartedButton: {
    paddingHorizontal: 32,
  },
  nextButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.white,
  },
});
