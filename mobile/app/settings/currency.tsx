import { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
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
import { useToast } from "../../src/components/Toast";
import { storage } from "../../src/utils/storage";

const isWeb = Platform.OS === "web";
const useNative = Platform.OS !== "web";
const STORAGE_KEY = "cryptopay_display_currency";

interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  flag: string;
  description: string;
}

const CURRENCIES: CurrencyInfo[] = [
  {
    code: "KES",
    name: "Kenyan Shilling",
    symbol: "KSh",
    flag: "KE",
    description: "Default currency for all M-Pesa transactions",
  },
  {
    code: "USD",
    name: "US Dollar",
    symbol: "$",
    flag: "US",
    description: "International reference currency",
  },
];

function CurrencyCard({
  currency,
  isActive,
  onSelect,
  tc,
  ts,
}: {
  currency: CurrencyInfo;
  isActive: boolean;
  onSelect: () => void;
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
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
          flexDirection: "row" as const,
          alignItems: "center" as const,
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
        accessibilityLabel={`${currency.name} (${currency.code})`}
      >
        {/* Currency symbol icon */}
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            backgroundColor: isActive ? colors.success + "18" : tc.dark.elevated,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: isActive ? colors.success + "30" : tc.glass.border,
          }}
        >
          <Text
            style={{
              fontSize: 22,
              fontFamily: "DMSans_700Bold",
              color: isActive ? colors.success : tc.textSecondary,
            }}
          >
            {currency.symbol}
          </Text>
        </View>

        {/* Currency Info */}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 17,
                fontFamily: "DMSans_700Bold",
              }}
            >
              {currency.code}
            </Text>
            <View
              style={{
                backgroundColor: tc.glass.highlight,
                borderRadius: 6,
                paddingHorizontal: 6,
                paddingVertical: 2,
              }}
            >
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 10,
                  fontFamily: "DMSans_500Medium",
                }}
              >
                {currency.flag}
              </Text>
            </View>
          </View>
          <Text
            style={{
              color: isActive ? colors.primary[400] : tc.textSecondary,
              fontSize: 14,
              fontFamily: "DMSans_500Medium",
              marginTop: 2,
            }}
          >
            {currency.name}
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 12,
              fontFamily: "DMSans_400Regular",
              marginTop: 2,
            }}
          >
            {currency.description}
          </Text>
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

export default function CurrencyScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const { t } = useLocale();
  const toast = useToast();
  const [selected, setSelected] = useState("KES");

  // Load persisted preference
  useEffect(() => {
    storage.getItemAsync(STORAGE_KEY).then((val) => {
      if (val && CURRENCIES.some((c) => c.code === val)) {
        setSelected(val);
      }
    });
  }, []);

  const handleSelect = useCallback(async (code: string) => {
    setSelected(code);
    await storage.setItemAsync(STORAGE_KEY, code);
    const curr = CURRENCIES.find((c) => c.code === code);
    toast.success(
      t("settings.defaultCurrency"),
      `${t("settings.currencyChanged")} ${curr?.name || code}`
    );
  }, [t, toast]);

  const content = (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: isDesktop ? 48 : 16,
        paddingBottom: 40,
      }}
    >
      {/* Page Title — mobile only */}
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
            {t("settings.defaultCurrency")}
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
            {t("settings.currencyPageDesc")}
          </Text>
        </View>
      )}

      {/* Currency Cards */}
      <View
        style={{
          gap: 12,
          marginTop: 20,
          ...(isDesktop ? { flexDirection: "row", flexWrap: "wrap" } : {}),
        }}
      >
        {CURRENCIES.map((curr) => (
          <View
            key={curr.code}
            style={isDesktop ? { flex: 1, minWidth: 320 } : {}}
          >
            <CurrencyCard
              currency={curr}
              isActive={selected === curr.code}
              onSelect={() => handleSelect(curr.code)}
              tc={tc}
              ts={ts}
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
            {t("settings.currencyNote")}
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 12,
              fontFamily: "DMSans_400Regular",
              lineHeight: 18,
            }}
          >
            {t("settings.currencyNoteDesc")}
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
          {t("settings.defaultCurrency")}:{" "}
          <Text style={{ color: colors.primary[400], fontFamily: "DMSans_700Bold" }}>
            {CURRENCIES.find((c) => c.code === selected)?.name || "KES"}
          </Text>
        </Text>
      </View>
    </ScrollView>
  );

  if (isDesktop) {
    return (
      <View style={{ flex: 1, backgroundColor: tc.dark.bg }}>
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
              backgroundColor: hovered ? tc.glass.highlight : pressed ? tc.dark.elevated : "transparent",
              alignSelf: "flex-start",
              opacity: pressed ? 0.9 : 1,
              ...(isWeb ? ({ cursor: "pointer", transition: "all 0.2s ease" } as any) : {}),
            })}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
            <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_500Medium" }}>
              {t("common.back")}
            </Text>
          </Pressable>
        </View>
        <View style={{ paddingHorizontal: 48, paddingTop: 16, paddingBottom: 8 }}>
          <Text
            style={{ color: tc.textPrimary, fontSize: 28, fontFamily: "DMSans_700Bold", letterSpacing: -0.5 }}
          >
            {t("settings.defaultCurrency")}
          </Text>
          <Text style={{ color: tc.textMuted, fontSize: 15, fontFamily: "DMSans_400Regular", marginTop: 6 }}>
            {t("settings.currencyPageDesc")}
          </Text>
        </View>
        {content}
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 }}>
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
          <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_500Medium" }}>
            {t("common.back")}
          </Text>
        </Pressable>
      </View>
      {content}
    </SafeAreaView>
  );
}
