import { useRef, useState } from "react";
import { View, TextInput, Pressable } from "react-native";
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

  const handleChange = (text: string) => {
    const cleaned = text.replace(/[^0-9]/g, "").slice(0, length);
    setPin(cleaned);
    if (cleaned.length === length) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onComplete(cleaned);
    }
  };

  return (
    <Pressable
      onPress={() => inputRef.current?.focus()}
      accessibilityRole="none"
      accessibilityLabel={`PIN entry, ${pin.length} of ${length} digits entered`}
    >
      <View className="flex-row justify-center gap-3">
        {Array.from({ length }).map((_, i) => (
          <View
            key={i}
            className={`w-12 h-14 rounded-xl items-center justify-center border-2 ${
              error
                ? "border-error bg-error/10"
                : pin.length === i
                ? "border-primary-500 bg-dark-elevated"
                : pin.length > i
                ? "border-primary-500/50 bg-dark-elevated"
                : "border-dark-border bg-dark-card"
            }`}
            accessibilityLabel={pin.length > i ? "Digit entered" : "Empty digit"}
          >
            {pin.length > i && (
              <View className="w-3 h-3 rounded-full bg-primary-400" />
            )}
          </View>
        ))}
      </View>
      <TextInput
        ref={inputRef}
        value={pin}
        onChangeText={handleChange}
        keyboardType="number-pad"
        maxLength={length}
        autoFocus
        className="absolute opacity-0 h-0 w-0"
        secureTextEntry
        accessibilityLabel="PIN input"
        accessibilityHint={`Enter your ${length}-digit PIN`}
        testID={testID || "pin-input"}
      />
    </Pressable>
  );
}
