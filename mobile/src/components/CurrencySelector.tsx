import { ScrollView, Pressable, View, Text } from "react-native";
import * as Haptics from "expo-haptics";
import { CURRENCIES, CurrencyCode, colors } from "../constants/theme";

interface CurrencyBalance {
  currency: CurrencyCode;
  balance: number;
}

interface CurrencySelectorProps {
  currencies: CurrencyBalance[];
  selected: CurrencyCode;
  onSelect: (currency: CurrencyCode) => void;
  label?: string;
}

export function CurrencySelector({
  currencies,
  selected,
  onSelect,
  label = "Pay with",
}: CurrencySelectorProps) {
  return (
    <View>
      {label && (
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: 14,
            fontFamily: "Inter_500Medium",
            marginBottom: 10,
          }}
        >
          {label}
        </Text>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10 }}
      >
        {currencies.map(({ currency, balance }) => {
          const info = CURRENCIES[currency];
          const isSelected = selected === currency;
          const isEmpty = balance <= 0;

          return (
            <Pressable
              key={currency}
              onPress={() => {
                if (isEmpty) return;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onSelect(currency);
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderRadius: 16,
                borderWidth: isSelected ? 2 : 1,
                borderColor: isSelected
                  ? colors.primary[500]
                  : isEmpty
                  ? "rgba(71, 85, 105, 0.5)"
                  : colors.dark.border,
                backgroundColor: isSelected
                  ? "rgba(13, 159, 110, 0.1)"
                  : colors.dark.card,
                opacity: isEmpty ? 0.5 : 1,
                gap: 10,
                minWidth: 130,
              }}
            >
              {/* Currency icon */}
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: isSelected
                    ? "rgba(13, 159, 110, 0.2)"
                    : colors.dark.elevated,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ fontSize: 18 }}>{info.icon}</Text>
              </View>

              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: isSelected ? colors.primary[400] : "#FFFFFF",
                    fontSize: 14,
                    fontFamily: "Inter_600SemiBold",
                  }}
                >
                  {info.symbol}
                </Text>
                <Text
                  style={{
                    color: colors.textMuted,
                    fontSize: 11,
                    fontFamily: "Inter_400Regular",
                    marginTop: 1,
                  }}
                  numberOfLines={1}
                >
                  {isEmpty
                    ? "No balance"
                    : `${balance.toFixed(info.decimals > 4 ? 4 : info.decimals)} available`}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
