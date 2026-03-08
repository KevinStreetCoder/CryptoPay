import { useState } from "react";
import { View, Text, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { PinInput } from "../../src/components/PinInput";
import { Button } from "../../src/components/Button";
import { useToast } from "../../src/components/Toast";
import { useAuth } from "../../src/stores/auth";
import { useScreenSecurity } from "../../src/hooks/useScreenSecurity";
import { normalizeError } from "../../src/utils/apiErrors";
import { colors } from "../../src/constants/theme";

type Step = "phone" | "pin";

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const toast = useToast();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [pinError, setPinError] = useState(false);

  // Prevent screenshots on PIN step
  useScreenSecurity(step === "pin");

  const handlePhoneSubmit = () => {
    if (phone.length < 9) {
      toast.warning("Invalid Number", "Please enter a valid phone number");
      return;
    }
    setStep("pin");
  };

  const handlePinComplete = async (pin: string) => {
    setLoading(true);
    setPinError(false);
    try {
      await login(phone, pin);
      router.replace("/(tabs)");
    } catch (err: unknown) {
      setPinError(true);
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-dark-bg">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <View className="flex-1 px-6 pt-8">
          {/* Logo / Brand */}
          <View className="items-center mb-10" accessibilityRole="header">
            <View className="w-16 h-16 rounded-2xl bg-primary-500 items-center justify-center mb-4">
              <Ionicons name="wallet" size={32} color="#fff" />
            </View>
            <Text className="text-white text-2xl font-inter-bold" maxFontSizeMultiplier={1.3}>
              CryptoPay
            </Text>
            <Text className="text-textSecondary text-sm font-inter mt-1" maxFontSizeMultiplier={1.3}>
              Pay bills with crypto, instantly
            </Text>
          </View>

          {step === "phone" ? (
            <View>
              <Text className="text-white text-lg font-inter-semibold mb-2" maxFontSizeMultiplier={1.3}>
                Enter your phone number
              </Text>
              <Text className="text-textMuted text-sm font-inter mb-6" maxFontSizeMultiplier={1.3}>
                Use the number registered with M-Pesa
              </Text>

              <View className="flex-row items-center bg-dark-card rounded-xl border border-dark-border px-4">
                <Text className="text-textSecondary text-base font-inter-medium mr-2">
                  +254
                </Text>
                <View className="w-px h-6 bg-dark-border mr-2" />
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="712 345 678"
                  placeholderTextColor={colors.dark.muted}
                  keyboardType="phone-pad"
                  maxLength={10}
                  autoFocus
                  className="flex-1 text-white text-base font-inter py-4"
                  accessibilityLabel="Phone number"
                  accessibilityHint="Enter your M-Pesa registered phone number"
                  testID="phone-input"
                  maxFontSizeMultiplier={1.3}
                />
              </View>

              <View className="mt-8">
                <Button
                  title="Continue"
                  onPress={handlePhoneSubmit}
                  disabled={phone.length < 9}
                  size="lg"
                  testID="continue-button"
                />
              </View>

              <Text
                className="text-primary-400 text-sm font-inter-medium text-center mt-6"
                onPress={() => router.push("/auth/register")}
                accessibilityRole="link"
                accessibilityLabel="Don't have an account? Register"
                maxFontSizeMultiplier={1.3}
              >
                Don't have an account? Register
              </Text>
            </View>
          ) : (
            <View>
              <Text className="text-white text-lg font-inter-semibold mb-2" maxFontSizeMultiplier={1.3}>
                Enter your PIN
              </Text>
              <Text className="text-textMuted text-sm font-inter mb-8" maxFontSizeMultiplier={1.3}>
                Enter your 6-digit security PIN
              </Text>

              <PinInput onComplete={handlePinComplete} error={pinError} testID="login-pin-input" />

              {loading && (
                <Text className="text-primary-400 text-sm font-inter text-center mt-6">
                  Signing in...
                </Text>
              )}

              <Text
                className="text-textMuted text-sm font-inter text-center mt-8"
                onPress={() => setStep("phone")}
                accessibilityRole="button"
                accessibilityLabel="Go back to phone number"
                maxFontSizeMultiplier={1.3}
              >
                ← Back to phone number
              </Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
