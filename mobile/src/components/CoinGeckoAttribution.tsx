import { View, Text, Image, Linking, Pressable, Platform } from "react-native";
import { getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";

const COINGECKO_LOGO = "https://static.coingecko.com/s/thumbnail-007177f3eca19695592f0b8b0eabbdae282b54154e1be912285c9034ea6cbaf2.png";

export function CoinGeckoAttribution() {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);

  return (
    <Pressable
      onPress={() => Linking.openURL("https://www.coingecko.com")}
      accessibilityRole="link"
      accessibilityLabel="Data provided by CoinGecko"
      style={({ pressed, hovered }: any) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingVertical: 8,
        opacity: pressed ? 0.7 : 1,
        ...(Platform.OS === "web"
          ? { cursor: "pointer", transition: "opacity 0.15s ease" } as any
          : {}),
      })}
    >
      <Image
        source={{ uri: COINGECKO_LOGO }}
        style={{ width: 16, height: 16, borderRadius: 4 }}
        accessibilityIgnoresInvertColors
      />
      <Text
        style={{
          color: tc.textMuted,
          fontSize: 10,
          fontFamily: "DMSans_400Regular",
          letterSpacing: 0.3,
        }}
      >
        Data provided by CoinGecko
      </Text>
    </Pressable>
  );
}
