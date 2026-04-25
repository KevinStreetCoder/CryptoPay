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

export function PinInput({ length = 6, onComplete, error, loading, testID }: PinInputProps) {
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

  // Reset PIN when error fires so the user can retry without
  // backspacing six dots. Also: when `loading` was true and goes
  // back to false WITHOUT error (i.e. the parent finished its API
  // call cleanly), still reset · this catches an edge case where
  // the parent dispatched a successful unlock but the screen
  // didn't unmount before AppState briefly toggled, leaving stale
  // dots that confuse the next attempt.
  const prevLoading = useRef(loading);
  useEffect(() => {
    if (error) {
      setPin("");
      setTimeout(() => inputRef.current?.focus(), 100);
    } else if (prevLoading.current && !loading) {
      // Loading just finished without error · reset for a clean slate.
      setPin("");
    }
    prevLoading.current = loading;
  }, [error, loading]);

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
                  // Empty-box border was hardcoded to white-08 (visible
                  // only on dark BG · invisible against light theme's
                  // #FFFFFF box on #F5F7FA page). Use the theme-aware
                  // glass border so the boxes outline cleanly in both
                  // modes.
                  : isDark
                    ? "rgba(255, 255, 255, 0.10)"
                    : "rgba(15, 23, 42, 0.14)",
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
