/**
 * ResendOTPButton · brand-aligned OTP resend with rate-limit cooldown.
 *
 * Three visible states:
 *   1. COUNTDOWN · "Resend in 28s" · greyed out, non-pressable
 *   2. READY     · "Resend code" · primary[300] mint, pressable
 *   3. SENDING   · brand Spinner + "Sending..." · disabled
 *
 * Cooldown defaults to 30 s (matches the SMS provider's per-msisdn
 * rate limit on Africa's Talking + eSMS Africa). The first tap
 * starts the timer; subsequent renders count down the remainder.
 *
 * Used in register / forgot-pin / google-complete-profile / login
 * OTP-challenge screens. Keep the prop surface small (just onResend
 * + loading) so wiring is one line wherever an OTP screen needs it.
 */
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Spinner } from "./brand/Spinner";

interface ResendOTPButtonProps {
  /** Called when the user taps the button while in READY state. */
  onResend: () => void | Promise<void>;
  /** Drives the SENDING state · the parent's loading flag. */
  loading?: boolean;
  /** Cooldown in seconds before the next resend is allowed. */
  cooldownSec?: number;
  /** Whether the user has tapped at least once (for parent-driven start). */
  startedExternally?: boolean;
  textColor?: string;
  mutedColor?: string;
}

export function ResendOTPButton({
  onResend,
  loading = false,
  cooldownSec = 30,
  startedExternally = false,
  textColor = "#6EE7B7",
  mutedColor = "#8396AD",
}: ResendOTPButtonProps) {
  const [secondsLeft, setSecondsLeft] = useState(cooldownSec);
  const [hasFired, setHasFired] = useState(startedExternally);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tick down every second once the cooldown is active.
  useEffect(() => {
    if (!hasFired) return;
    if (secondsLeft <= 0) return;
    intervalRef.current = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [hasFired, secondsLeft]);

  const handlePress = async () => {
    if (secondsLeft > 0 || loading) return;
    setHasFired(true);
    setSecondsLeft(cooldownSec);
    await onResend();
  };

  const isCooldown = hasFired && secondsLeft > 0;
  const isReady = !isCooldown && !loading;

  if (loading) {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingVertical: 6,
        }}
        accessibilityRole="progressbar"
        accessibilityLabel="Sending verification code"
      >
        <Spinner variant="arc" size={14} color={textColor} />
        <Text
          style={{
            color: textColor,
            fontSize: 14,
            fontFamily: "DMSans_500Medium",
          }}
          maxFontSizeMultiplier={1.3}
        >
          Sending...
        </Text>
      </View>
    );
  }

  if (isCooldown) {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingVertical: 6,
        }}
        accessibilityRole="text"
        accessibilityLabel={`Resend available in ${secondsLeft} seconds`}
      >
        <Text
          style={{
            color: mutedColor,
            fontSize: 13,
            fontFamily: "DMSans_500Medium",
          }}
          maxFontSizeMultiplier={1.3}
        >
          Didn't get it?
        </Text>
        <Text
          style={{
            color: mutedColor,
            fontSize: 13,
            fontFamily: "DMSans_600SemiBold",
            opacity: 0.7,
          }}
          maxFontSizeMultiplier={1.3}
        >
          Resend in {secondsLeft}s
        </Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={!isReady}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 12,
        backgroundColor: pressed
          ? "rgba(110, 231, 183, 0.18)"
          : "rgba(110, 231, 183, 0.10)",
        borderWidth: 1,
        borderColor: "rgba(110, 231, 183, 0.30)",
        opacity: pressed ? 0.85 : 1,
      })}
      accessibilityRole="button"
      accessibilityLabel="Resend verification code"
    >
      <Text
        style={{
          color: textColor,
          fontSize: 13,
          fontFamily: "DMSans_600SemiBold",
          letterSpacing: 0.2,
        }}
        maxFontSizeMultiplier={1.3}
      >
        Resend code
      </Text>
    </Pressable>
  );
}
