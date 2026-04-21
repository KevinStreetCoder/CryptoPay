import { useEffect, useRef, useState } from "react";
import { View, TextInput, Pressable, Platform, useWindowDimensions, Keyboard } from "react-native";
import * as Haptics from "expo-haptics";
import { getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";

interface PinInputProps {
  length?: number;
  onComplete: (pin: string) => void;
  error?: boolean;
  loading?: boolean;
  testID?: string;
}

export function PinInput({ length = 6, onComplete, error, testID }: PinInputProps) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const [pin, setPin] = useState("");
  const inputRef = useRef<TextInput>(null);
  const { width: screenWidth } = useWindowDimensions();

  // Fixed box sizes · simple and reliable across all screen sizes
  const isMobile = screenWidth < 768;
  const isVerySmall = screenWidth < 360;
  const gap = isVerySmall ? 6 : isMobile ? 8 : 10;
  const maxContainerWidth = isMobile ? Math.min(screenWidth - 60, 300) : 340;
  const boxSize = isMobile ? Math.min(44, Math.floor((maxContainerWidth) / length - gap)) : 46;
  const boxHeight = Math.round(boxSize * 1.15);
  const boxRadius = 12;
  const dotSize = isVerySmall ? 10 : 12;
  // Total width of all boxes + gaps · used to constrain the container
  const totalWidth = (boxSize * length) + (gap * (length - 1));

  // Auto-focus on native with delay (web uses autoFocus prop)
  useEffect(() => {
    if (Platform.OS !== "web") {
      const timer = setTimeout(() => inputRef.current?.focus(), 300);
      return () => clearTimeout(timer);
    }
  }, []);

  // Reset PIN when error changes to true so user can retry
  useEffect(() => {
    if (error) {
      setPin("");
      // Re-focus the hidden input after clearing
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [error]);

  const handleChange = (text: string) => {
    const cleaned = text.replace(/[^0-9]/g, "").slice(0, length);
    setPin(cleaned);
    if (cleaned.length === length) {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Keyboard.dismiss();
      }
      onComplete(cleaned);
    }
  };

  return (
    <Pressable
      onPress={() => inputRef.current?.focus()}
      accessibilityRole="none"
      accessibilityLabel={`PIN entry, ${pin.length} of ${length} digits entered`}
    >
      <View style={{ flexDirection: "row", justifyContent: "center", gap, width: totalWidth, maxWidth: "100%", alignSelf: "center" }}>
        {Array.from({ length }).map((_, i) => {
          const isFilled = pin.length > i;
          const isActive = pin.length === i;
          const showError = error && pin.length === 0;

          return (
            <View
              key={i}
              style={{
                width: boxSize,
                height: boxHeight,
                borderRadius: boxRadius,
                borderWidth: 2,
                alignItems: "center",
                justifyContent: "center",
                borderColor: showError
                  ? "rgba(239, 68, 68, 0.4)"
                  : isActive
                  ? "#10B981"
                  : isFilled
                  ? "rgba(16, 185, 129, 0.4)"
                  : "rgba(255, 255, 255, 0.08)",
                backgroundColor: showError
                  ? "rgba(239, 68, 68, 0.06)"
                  : isFilled
                  ? "rgba(16, 185, 129, 0.06)"
                  : isActive
                  ? tc.dark.elevated
                  : tc.dark.card,
                ...(Platform.OS === 'web' ? { transition: 'all 0.2s ease' } as any : {}),
                ...(isActive && Platform.OS === 'web' ? { boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.2), 0 0 12px rgba(16, 185, 129, 0.1)' } as any : {}),
                ...(isFilled && Platform.OS === 'web' ? { boxShadow: '0 0 0 2px rgba(16, 185, 129, 0.12)' } as any : {}),
                ...(showError && Platform.OS === 'web' ? { boxShadow: '0 0 0 3px rgba(239, 68, 68, 0.2), 0 0 12px rgba(239, 68, 68, 0.1)' } as any : {}),
              }}
              accessibilityLabel={isFilled ? "Digit entered" : "Empty digit"}
            >
              {isFilled && (
                <View
                  style={{
                    width: dotSize,
                    height: dotSize,
                    borderRadius: dotSize / 2,
                    backgroundColor: "#34D399",
                  }}
                />
              )}
            </View>
          );
        })}
      </View>
      <TextInput
        ref={inputRef}
        value={pin}
        onChangeText={handleChange}
        keyboardType="number-pad"
        maxLength={length}
        autoFocus={Platform.OS === "web"}
        style={{
          position: "absolute",
          opacity: 0,
          height: Platform.OS === "android" ? 48 : 1,
          width: Platform.OS === "android" ? "100%" : 1,
          ...(Platform.OS === "web" ? { outline: "none", border: "none", caretColor: "transparent" } as any : {}),
        }}
        secureTextEntry
        accessibilityLabel="PIN input"
        accessibilityHint={`Enter your ${length}-digit PIN`}
        testID={testID || "pin-input"}
      />
    </Pressable>
  );
}
