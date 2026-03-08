import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { PinInput } from "../../src/components/PinInput";
import { Button } from "../../src/components/Button";
import { useToast } from "../../src/components/Toast";
import { useAuth } from "../../src/stores/auth";
import { authApi } from "../../src/api/auth";
import { useScreenSecurity } from "../../src/hooks/useScreenSecurity";
import { normalizeError } from "../../src/utils/apiErrors";
import { colors } from "../../src/constants/theme";

type Step = "phone" | "otp" | "pin" | "name";

export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuth();
  const toast = useToast();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [pin, setPin] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  // Prevent screenshots on PIN step
  useScreenSecurity(step === "pin");

  const handleSendOTP = async () => {
    if (phone.length < 9) {
      toast.warning("Invalid Number", "Please enter a valid phone number");
      return;
    }
    setLoading(true);
    try {
      await authApi.requestOTP(phone);
      setStep("otp");
      toast.success("Code Sent", "Check your SMS for the verification code");
    } catch (err: unknown) {
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = () => {
    if (otp.length < 4) {
      toast.warning("Invalid Code", "Please enter the OTP code");
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
    } catch (err: unknown) {
      const appError = normalizeError(err);
      toast.error(appError.title, appError.message);
    } finally {
      setLoading(false);
    }
  };

  const steps: Step[] = ["phone", "otp", "name", "pin"];
  const currentIndex = steps.indexOf(step);

  const stepIndicator = (
    <View
      className="flex-row items-center justify-center mb-8 gap-2"
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${currentIndex + 1} of ${steps.length}`}
      accessibilityValue={{ min: 0, max: steps.length, now: currentIndex + 1 }}
    >
      {steps.map((s, i) => (
        <View
          key={s}
          className={`h-1 rounded-full ${
            currentIndex >= i
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
              <Text className="text-white text-xl font-inter-bold mb-2" maxFontSizeMultiplier={1.3}>
                Create your account
              </Text>
              <Text className="text-textMuted text-sm font-inter mb-6" maxFontSizeMultiplier={1.3}>
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
                  accessibilityLabel="Phone number"
                  accessibilityHint="Enter your phone number for registration"
                  testID="register-phone-input"
                  maxFontSizeMultiplier={1.3}
                />
              </View>

              <View className="mt-8">
                <Button
                  title="Send Verification Code"
                  onPress={handleSendOTP}
                  loading={loading}
                  disabled={phone.length < 9}
                  size="lg"
                  testID="send-otp-button"
                />
              </View>

              <Text
                className="text-primary-400 text-sm font-inter-medium text-center mt-6"
                onPress={() => router.push("/auth/login")}
                accessibilityRole="link"
                accessibilityLabel="Already have an account? Login"
                maxFontSizeMultiplier={1.3}
              >
                Already have an account? Login
              </Text>
            </View>
          )}

          {step === "otp" && (
            <View>
              <Text className="text-white text-xl font-inter-bold mb-2" maxFontSizeMultiplier={1.3}>
                Verification Code
              </Text>
              <Text className="text-textMuted text-sm font-inter mb-6" maxFontSizeMultiplier={1.3}>
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
                accessibilityLabel="Verification code"
                accessibilityHint="Enter the 6-digit code sent to your phone"
                testID="otp-input"
                maxFontSizeMultiplier={1.2}
              />

              <View className="mt-8">
                <Button
                  title="Verify"
                  onPress={handleVerifyOTP}
                  disabled={otp.length < 4}
                  size="lg"
                  testID="verify-otp-button"
                />
              </View>

              <Text
                className="text-textMuted text-sm font-inter text-center mt-6"
                onPress={() => setStep("phone")}
                accessibilityRole="button"
                accessibilityLabel="Change phone number"
                maxFontSizeMultiplier={1.3}
              >
                ← Change phone number
              </Text>
            </View>
          )}

          {step === "name" && (
            <View>
              <Text className="text-white text-xl font-inter-bold mb-2" maxFontSizeMultiplier={1.3}>
                What's your name?
              </Text>
              <Text className="text-textMuted text-sm font-inter mb-6" maxFontSizeMultiplier={1.3}>
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
                accessibilityLabel="Full name"
                accessibilityHint="Enter your full name"
                testID="name-input"
                maxFontSizeMultiplier={1.3}
              />

              <View className="mt-8">
                <Button
                  title="Continue"
                  onPress={handleNameSubmit}
                  size="lg"
                  testID="name-continue-button"
                />
              </View>
            </View>
          )}

          {step === "pin" && (
            <View>
              <Text className="text-white text-xl font-inter-bold mb-2" maxFontSizeMultiplier={1.3}>
                Create a PIN
              </Text>
              <Text className="text-textMuted text-sm font-inter mb-8" maxFontSizeMultiplier={1.3}>
                Choose a 6-digit PIN to secure your account
              </Text>

              <PinInput onComplete={handlePinComplete} testID="register-pin-input" />

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
