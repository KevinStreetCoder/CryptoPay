import { useState } from "react";
import { View, Text, TextInput, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { PinInput } from "../../src/components/PinInput";
import { Button } from "../../src/components/Button";
import { useAuth } from "../../src/stores/auth";
import { colors } from "../../src/constants/theme";

type Step = "phone" | "pin";

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [pinError, setPinError] = useState(false);

  const handlePhoneSubmit = () => {
    if (phone.length < 9) {
      Alert.alert("Error", "Please enter a valid phone number");
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
    } catch (err: any) {
      setPinError(true);
      const message = err.response?.data?.error || "Invalid phone or PIN";
      Alert.alert("Login Failed", message);
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
          <View className="items-center mb-10">
            <View className="w-16 h-16 rounded-2xl bg-primary-500 items-center justify-center mb-4">
              <Ionicons name="wallet" size={32} color="#fff" />
            </View>
            <Text className="text-white text-2xl font-inter-bold">M-Crypto</Text>
            <Text className="text-textSecondary text-sm font-inter mt-1">
              Crypto to M-Pesa, instantly
            </Text>
          </View>

          {step === "phone" ? (
            <View>
              <Text className="text-white text-lg font-inter-semibold mb-2">
                Enter your phone number
              </Text>
              <Text className="text-textMuted text-sm font-inter mb-6">
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
                />
              </View>

              <View className="mt-8">
                <Button
                  title="Continue"
                  onPress={handlePhoneSubmit}
                  disabled={phone.length < 9}
                  size="lg"
                />
              </View>

              <Text
                className="text-primary-400 text-sm font-inter-medium text-center mt-6"
                onPress={() => router.push("/auth/register")}
              >
                Don't have an account? Register
              </Text>
            </View>
          ) : (
            <View>
              <Text className="text-white text-lg font-inter-semibold mb-2">
                Enter your PIN
              </Text>
              <Text className="text-textMuted text-sm font-inter mb-8">
                Enter your 6-digit security PIN
              </Text>

              <PinInput onComplete={handlePinComplete} error={pinError} />

              {loading && (
                <Text className="text-primary-400 text-sm font-inter text-center mt-6">
                  Signing in...
                </Text>
              )}

              <Text
                className="text-textMuted text-sm font-inter text-center mt-8"
                onPress={() => setStep("phone")}
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
