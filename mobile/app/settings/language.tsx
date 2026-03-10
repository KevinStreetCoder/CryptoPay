import { useState, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  Platform,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, shadows, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { storage } from "../../src/utils/storage";

const isWeb = Platform.OS === "web";

const LANGUAGES = [
  { code: "en", label: "English", native: "English", flag: "🇬🇧" },
  { code: "sw", label: "Swahili", native: "Kiswahili", flag: "🇰🇪" },
];

const LANG_KEY = "app_language";

export default function LanguageScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const [selected, setSelected] = useState("en");

  useEffect(() => {
    storage.getItemAsync(LANG_KEY).then((val) => {
      if (val) setSelected(val);
    });
  }, []);

  const handleSelect = async (code: string) => {
    setSelected(code);
    await storage.setItemAsync(LANG_KEY, code);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <View
        style={{
          paddingHorizontal: isDesktop ? 32 : 16,
          paddingTop: isDesktop ? 8 : 8,
          ...(isDesktop
            ? { maxWidth: 580, alignSelf: "center" as const, width: "100%" as const }
            : {}),
        }}
      >
        {/* Header */}
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/settings" as any);
          }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 8,
            opacity: pressed ? 0.6 : 1,
            alignSelf: "flex-start",
            marginBottom: 20,
          })}
        >
          <Ionicons name="arrow-back" size={22} color={tc.textSecondary} />
          <Text style={{ color: tc.textSecondary, fontSize: 16, fontWeight: "500" }}>
            Language
          </Text>
        </Pressable>

        <View
          style={{
            backgroundColor: tc.dark.card,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: tc.glass.border,
            overflow: "hidden",
            ...shadows.sm,
          }}
        >
          {LANGUAGES.map((lang, idx) => {
            const isActive = selected === lang.code;
            return (
              <View key={lang.code}>
                <Pressable
                  onPress={() => handleSelect(lang.code)}
                  style={({ pressed, hovered }: any) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 16,
                    paddingHorizontal: 18,
                    backgroundColor: hovered
                      ? "rgba(255,255,255,0.03)"
                      : "transparent",
                    opacity: pressed ? 0.8 : 1,
                    gap: 14,
                    ...(isWeb
                      ? ({ cursor: "pointer", transition: "background-color 0.15s" } as any)
                      : {}),
                  })}
                >
                  <Text style={{ fontSize: 28 }}>{lang.flag}</Text>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: tc.textPrimary,
                        fontSize: 15,
                        fontWeight: "600",
                      }}
                    >
                      {lang.label}
                    </Text>
                    <Text
                      style={{
                        color: tc.textMuted,
                        fontSize: 13,
                        marginTop: 2,
                      }}
                    >
                      {lang.native}
                    </Text>
                  </View>
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      borderWidth: 2,
                      borderColor: isActive ? colors.primary[500] : tc.dark.border,
                      backgroundColor: isActive ? colors.primary[500] : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {isActive && (
                      <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                    )}
                  </View>
                </Pressable>
                {idx < LANGUAGES.length - 1 && (
                  <View
                    style={{
                      height: 1,
                      backgroundColor: tc.glass.border,
                      marginLeft: 60,
                    }}
                  />
                )}
              </View>
            );
          })}
        </View>

        <Text
          style={{
            color: tc.textMuted,
            fontSize: 13,
            marginTop: 16,
            paddingHorizontal: 8,
            lineHeight: 20,
          }}
        >
          Changing the language will update all text throughout the app. Some content may remain in English.
        </Text>
      </View>
    </SafeAreaView>
  );
}
