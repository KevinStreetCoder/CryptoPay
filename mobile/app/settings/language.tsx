import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  Platform,
  useWindowDimensions,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { useLocale } from "../../src/hooks/useLocale";
import { useRef } from "react";

const isWeb = Platform.OS === "web";
const useNative = Platform.OS !== "web";

interface LanguageInfo {
  code: string;
  labelKey: string;
  nativeLabel: string;
  flagUrl: string;
  region: string;
  speakers: string;
}

const LANGUAGES: LanguageInfo[] = [
  {
    code: "en",
    labelKey: "profile.english",
    nativeLabel: "English",
    flagUrl: "https://flagcdn.com/w80/gb.png",
    region: "International",
    speakers: "1.5B+ speakers",
  },
  {
    code: "sw",
    labelKey: "profile.swahili",
    nativeLabel: "Kiswahili",
    flagUrl: "https://flagcdn.com/w80/ke.png",
    region: "East Africa",
    speakers: "200M+ speakers",
  },
];

function LanguageCard({
  lang,
  isActive,
  onSelect,
  tc,
  ts,
  t,
}: {
  lang: LanguageInfo;
  isActive: boolean;
  onSelect: () => void;
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
  t: (key: string) => string;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    Animated.spring(scale, {
      toValue: 0.97,
      friction: 8,
      useNativeDriver: useNative,
    }).start();
  }, []);

  const handlePressOut = useCallback(() => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 8,
      useNativeDriver: useNative,
    }).start();
  }, []);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onSelect}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={({ hovered }: any) => ({
          backgroundColor: isActive
            ? colors.primary[500] + "10"
            : hovered
              ? tc.glass.highlight
              : tc.dark.card,
          borderRadius: 20,
          padding: 20,
          borderWidth: 1.5,
          borderColor: isActive
            ? colors.primary[500] + "40"
            : hovered
              ? tc.glass.borderStrong
              : tc.glass.border,
          flexDirection: "row",
          alignItems: "center",
          gap: 16,
          ...ts.sm,
          ...(isWeb
            ? ({
                cursor: "pointer",
                transition: "all 0.2s ease",
              } as any)
            : {}),
        })}
        accessibilityRole="radio"
        accessibilityState={{ selected: isActive }}
        accessibilityLabel={`${t(lang.labelKey)} - ${lang.nativeLabel}`}
      >
        {/* Flag Image */}
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            overflow: "hidden",
            backgroundColor: tc.dark.elevated,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: tc.glass.border,
          }}
        >
          <Image
            source={{ uri: lang.flagUrl }}
            style={{ width: 52, height: 52 }}
            resizeMode="cover"
          />
        </View>

        {/* Language Info */}
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 17,
              fontFamily: "DMSans_700Bold",
              marginBottom: 2,
            }}
          >
            {t(lang.labelKey)}
          </Text>
          <Text
            style={{
              color: isActive ? colors.primary[400] : tc.textSecondary,
              fontSize: 14,
              fontFamily: "DMSans_500Medium",
              marginBottom: 4,
            }}
          >
            {lang.nativeLabel}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Ionicons name="globe-outline" size={12} color={tc.textMuted} />
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 12,
                  fontFamily: "DMSans_400Regular",
                }}
              >
                {lang.region}
              </Text>
            </View>
            <View
              style={{
                width: 3,
                height: 3,
                borderRadius: 1.5,
                backgroundColor: tc.textMuted,
                opacity: 0.5,
              }}
            />
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 12,
                fontFamily: "DMSans_400Regular",
              }}
            >
              {lang.speakers}
            </Text>
          </View>
        </View>

        {/* Selection Indicator */}
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            borderWidth: 2,
            borderColor: isActive ? colors.primary[500] : tc.dark.border,
            backgroundColor: isActive ? colors.primary[500] : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isActive && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function LanguageScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const { t, locale, setLocale } = useLocale();
  const [selected, setSelected] = useState(locale || "en");

  const handleSelect = async (code: string) => {
    setSelected(code);
    await setLocale(code);
  };

  const content = (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: isDesktop ? 48 : 16,
        paddingBottom: 40,
      }}
    >
      {/* Page Title */}
      {!isDesktop && (
        <View style={{ marginBottom: 8, marginTop: 4 }}>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 24,
              fontFamily: "DMSans_700Bold",
              letterSpacing: -0.3,
            }}
          >
            {t("settings.language")}
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 14,
              fontFamily: "DMSans_400Regular",
              marginTop: 4,
              lineHeight: 20,
            }}
          >
            {t("profile.selectLanguage")}
          </Text>
        </View>
      )}

      {/* Language Cards */}
      <View
        style={{
          gap: 12,
          marginTop: 20,
          ...(isDesktop
            ? { flexDirection: "row", flexWrap: "wrap" }
            : {}),
        }}
      >
        {LANGUAGES.map((lang) => (
          <View
            key={lang.code}
            style={isDesktop ? { flex: 1, minWidth: 320 } : {}}
          >
            <LanguageCard
              lang={lang}
              isActive={selected === lang.code}
              onSelect={() => handleSelect(lang.code)}
              tc={tc}
              ts={ts}
              t={t}
            />
          </View>
        ))}
      </View>

      {/* Info Section */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          marginTop: 24,
          paddingHorizontal: 4,
          gap: 10,
        }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            backgroundColor: colors.info + "15",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="information-circle" size={18} color={colors.info} />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: tc.textSecondary,
              fontSize: 13,
              fontFamily: "DMSans_500Medium",
              marginBottom: 4,
            }}
          >
            About Language Support
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 12,
              fontFamily: "DMSans_400Regular",
              lineHeight: 18,
            }}
          >
            Changing the language will update all text throughout the app
            instantly. Some third-party content and M-Pesa receipts may remain
            in their original language.
          </Text>
        </View>
      </View>

      {/* Current Selection Summary */}
      <View
        style={{
          backgroundColor: colors.primary[500] + "08",
          borderRadius: 16,
          padding: 16,
          borderWidth: 1,
          borderColor: colors.primary[500] + "15",
          marginTop: 20,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Ionicons name="checkmark-circle" size={20} color={colors.primary[400]} />
        <Text
          style={{
            color: tc.textSecondary,
            fontSize: 13,
            fontFamily: "DMSans_500Medium",
            flex: 1,
          }}
        >
          {t("settings.language")}:{" "}
          <Text style={{ color: colors.primary[400], fontFamily: "DMSans_700Bold" }}>
            {LANGUAGES.find((l) => l.code === selected)?.nativeLabel || "English"}
          </Text>
        </Text>
      </View>
    </ScrollView>
  );

  if (isDesktop) {
    return (
      <View style={{ flex: 1, backgroundColor: tc.dark.bg }}>
        {/* Back button header */}
        <View style={{ paddingHorizontal: 24, paddingTop: 24 }}>
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
              opacity: pressed ? 0.9 : 1,
              ...(isWeb ? ({ cursor: "pointer", transition: "all 0.2s ease" } as any) : {}),
            })}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: 15,
                fontFamily: "DMSans_500Medium",
              }}
            >
              {t("common.back")}
            </Text>
          </Pressable>
        </View>

        {/* Title */}
        <View
          style={{
            paddingHorizontal: 48,
            paddingTop: 16,
            paddingBottom: 8,
          }}
        >
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 28,
              fontFamily: "DMSans_700Bold",
              letterSpacing: -0.5,
            }}
          >
            {t("settings.language")}
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 15,
              fontFamily: "DMSans_400Regular",
              marginTop: 6,
            }}
          >
            {t("profile.selectLanguage")}
          </Text>
        </View>

        {content}
      </View>
    );
  }

  // Mobile layout
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      {/* Back button header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/settings" as any);
          }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 6,
            paddingHorizontal: 8,
            borderRadius: 10,
            backgroundColor: pressed ? tc.dark.elevated : "transparent",
            opacity: pressed ? 0.9 : 1,
          })}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
          <Text
            style={{
              color: tc.textSecondary,
              fontSize: 15,
              fontFamily: "DMSans_500Medium",
            }}
          >
            {t("common.back")}
          </Text>
        </Pressable>
      </View>

      {content}
    </SafeAreaView>
  );
}
