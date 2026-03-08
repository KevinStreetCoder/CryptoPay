import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { PinInput } from "../../src/components/PinInput";
import { Button } from "../../src/components/Button";
import { useAuth } from "../../src/stores/auth";
import { authApi } from "../../src/api/auth";
import { colors } from "../../src/constants/theme";

type Step = "phone" | "otp" | "pin" | "name";

export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuth();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [pin, setPin] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSendOTP = async () => {
    if (phone.length < 9) {
      Alert.alert("Error", "Please enter a valid phone number");
      return;
    }
    setLoading(true);
    try {
      await authApi.requestOTP(phone);
      setStep("otp");
    } catch (err: any) {
      Alert.alert("Error", err.response?.data?.error || "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = () => {
    if (otp.length < 4) {
      Alert.alert("Error", "Please enter the OTP code");
      return;
    }
    setStep("name");
  };

  const handleNameSubmit = () => {
    setStep("pin");
  };

  const handlePinComplete = async (pinValue: string) => {
    setPin(pinValue);
    setLoading(true);
    try {
      await register(phone, pinValue, otp, fullName || undefined);
      router.replace("/(tabs)");
    } catch (err: any) {
      Alert.alert(
        "Registration Failed",
        err.response?.data?.error || "Failed to create account"
      );
    } finally {
      setLoading(false);
    }
  };

  const stepIndicator = (
    <View className="flex-row items-center justify-center mb-8 gap-2">
      {["phone", "otp", "name", "pin"].map((s, i) => (
        <View
          key={s}
          className={`h-1 rounded-full ${
            ["phone", "otp", "name", "pin"].indexOf(step) >= i
              ? "bg-primary-500 w-8"
              : "bg-dark-elevated w-4"
          }`}
        />
      ))}
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-dark-bg">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <ScrollView className="flex-1 px-6 pt-8" keyboardShouldPersistTaps="handled">
          {stepIndicator}

          {step === "phone" && (
            <View>
              <Text className="text-white text-xl font-inter-bold mb-2">
                Create your account
              </Text>
              <Text className="text-textMuted text-sm font-inter mb-6">
                We'll send a verification code to your phone
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
                  title="Send Verification Code"
                  onPress={handleSendOTP}
                  loading={loading}
                  disabled={phone.length < 9}
                  size="lg"
                />
              </View>

              <Text
                className="text-primary-400 text-sm font-inter-medium text-center mt-6"
                onPress={() => router.push("/auth/login")}
              >
                Already have an account? Login
              </Text>
            </View>
          )}

          {step === "otp" && (
            <View>
              <Text className="text-white text-xl font-inter-bold mb-2">
                Verification Code
              </Text>
              <Text className="text-textMuted text-sm font-inter mb-6">
                Enter the 6-digit code sent to +254{phone}
              </Text>

              <TextInput
                value={otp}
                onChangeText={setOtp}
                placeholder="Enter OTP"
                placeholderTextColor={colors.dark.muted}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
                className="bg-dark-card text-white text-center text-2xl font-inter-bold rounded-xl border border-dark-border py-4 tracking-widest"
              />

              <View className="mt-8">
                <Button
                  title="Verify"
                  onPress={handleVerifyOTP}
                  disabled={otp.length < 4}
                  size="lg"
                />
              </View>

              <Text
                className="text-textMuted text-sm font-inter text-center mt-6"
                onPress={() => setStep("phone")}
              >
                ← Change phone number
              </Text>
            </View>
          )}

          {step === "name" && (
            <View>
              <Text className="text-white text-xl font-inter-bold mb-2">
                What's your name?
              </Text>
              <Text className="text-textMuted text-sm font-inter mb-6">
                This will be shown on your profile
              </Text>

              <TextInput
                value={fullName}
                onChangeText={setFullName}
                placeholder="Full name"
                placeholderTextColor={colors.dark.muted}
                autoFocus
                autoCapitalize="words"
                className="bg-dark-card text-white text-base font-inter rounded-xl border border-dark-border px-4 py-4"
              />

              <View className="mt-8">
                <Button
                  title="Continue"
                  onPress={handleNameSubmit}
                  size="lg"
                />
              </View>
            </View>
          )}

          {step === "pin" && (
            <View>
              <Text className="text-white text-xl font-inter-bold mb-2">
                Create a PIN
              </Text>
              <Text className="text-textMuted text-sm font-inter mb-8">
                Choose a 6-digit PIN to secure your account
              </Text>

              <PinInput onComplete={handlePinComplete} />

              {loading && (
                <Text className="text-primary-400 text-sm font-inter text-center mt-6">
                  Creating your account...
                </Text>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
