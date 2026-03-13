import { View, Text, Pressable, ScrollView, Platform } from "react-native";
import { CryptoLogo } from "./CryptoLogo";
import { Wallet } from "../api/wallets";
import { CURRENCIES, CurrencyCode, colors, getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";

interface CryptoSelectorProps {
  options: CurrencyCode[];
  selected: CurrencyCode;
  wallets?: Wallet[];
  onSelect: (currency: CurrencyCode) => void;
}

export function CryptoSelector({ options, selected, wallets, onSelect }: CryptoSelectorProps) {
  const isWeb = Platform.OS === "web";
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
    >
      {options.map((crypto) => {
        const info = CURRENCIES[crypto];
        const isSelected = selected === crypto;
        const wallet = wallets?.find((w) => w.currency === crypto);
        const bal = wallet ? parseFloat(wallet.balance) : 0;

        return (
          <Pressable
            key={crypto}
            onPress={() => onSelect(crypto)}
            style={({ pressed, hovered }: any) => ({
              borderRadius: 16,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderWidth: 1,
              minWidth: 72,
              alignItems: "center",
              borderColor: isSelected
                ? colors.primary[500]
                : isWeb && hovered
                  ? tc.glass.borderStrong
                  : tc.dark.border,
              backgroundColor: isSelected
                ? colors.primary[500] + "1A"
                : isWeb && hovered
                  ? tc.dark.elevated
                  : tc.dark.card,
              opacity: pressed ? 0.85 : 1,
              ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
            })}
            accessibilityRole="button"
            accessibilityLabel={`Pay with ${crypto}`}
            accessibilityState={{ selected: isSelected }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginBottom: 4,
              }}
            >
              <View style={{ marginRight: 5 }}>
                <CryptoLogo currency={crypto} size={20} />
              </View>
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: "DMSans_600SemiBold",
                  color: isSelected ? colors.primary[400] : tc.textPrimary,
                }}
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
              >
                {info.symbol}
              </Text>
            </View>
            <Text
              style={{
                color: tc.dark.muted,
                fontSize: 11,
                fontFamily: "DMSans_500Medium",
              }}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
            >
              {bal.toFixed(info.decimals > 4 ? 4 : info.decimals)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
