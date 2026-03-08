import { useEffect, useRef, useState } from "react";
import { View, TextInput, Pressable, Platform } from "react-native";
import * as Haptics from "expo-haptics";

interface PinInputProps {
  length?: number;
  onComplete: (pin: string) => void;
  error?: boolean;
  testID?: string;
}

export function PinInput({ length = 6, onComplete, error, testID }: PinInputProps) {
  const [pin, setPin] = useState("");
  const inputRef = useRef<TextInput>(null);

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
      <View style={{ flexDirection: "row", justifyContent: "center", gap: 12 }}>
        {Array.from({ length }).map((_, i) => {
          const isFilled = pin.length > i;
          const isActive = pin.length === i;
          const showError = error && pin.length === 0;

          return (
            <View
              key={i}
              style={{
                width: Platform.OS === 'web' ? 54 : 50,
                height: Platform.OS === 'web' ? 62 : 58,
                borderRadius: 14,
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
                  ? "#162742"
                  : "#0C1A2E",
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
                    width: 14,
                    height: 14,
                    borderRadius: 7,
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
        autoFocus
        style={{
          position: "absolute",
          opacity: 0,
          height: 1,
          width: 1,
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
