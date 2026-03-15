/**
 * DepositStatusModal — full-screen modal with animated timeline stepper
 * showing deposit progress: Detected -> Confirming (X/N) -> Credited.
 * Success animation when credited. Links to block explorer.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  Platform,
  Modal,
  Animated,
  Linking,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { BlockchainDeposit } from "../api/wallets";
import { CryptoLogo } from "./CryptoLogo";
import { useToast } from "./Toast";
import { colors, getThemeColors, getThemeShadows } from "../constants/theme";
import { useThemeMode } from "../stores/theme";

const isWeb = Platform.OS === "web";
const useNative = Platform.OS !== "web";

// ── Block explorer URLs ──
const EXPLORER_TX: Record<string, string> = {
  tron: "https://tronscan.org/#/transaction/",
  ethereum: "https://etherscan.io/tx/",
  bitcoin: "https://mempool.space/tx/",
  solana: "https://solscan.io/tx/",
  polygon: "https://polygonscan.com/tx/",
};

function truncateHash(hash: string): string {
  if (hash.length <= 20) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

// ── Timeline Step ──
type StepState = "completed" | "active" | "upcoming";

interface TimelineStepProps {
  label: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  state: StepState;
  color: string;
  isLast: boolean;
  index: number;
}

function TimelineStep({
  label,
  subtitle,
  icon,
  state,
  color,
  isLast,
  index,
}: TimelineStepProps) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        delay: index * 150,
        useNativeDriver: useNative,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 400,
        delay: index * 150,
        useNativeDriver: useNative,
      }),
    ]).start();
  }, [fadeAnim, slideAnim, index]);

  useEffect(() => {
    if (state === "active") {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 1000,
            useNativeDriver: useNative,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: useNative,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [state, pulseAnim]);

  const dotBg =
    state === "completed"
      ? color
      : state === "active"
        ? color + "30"
        : tc.dark.elevated;
  const dotBorder =
    state === "completed"
      ? color
      : state === "active"
        ? color
        : tc.dark.muted + "40";
  const lineColor =
    state === "completed" ? color + "60" : tc.dark.muted + "20";
  const textColor =
    state === "upcoming" ? tc.textMuted : tc.textPrimary;
  const subColor =
    state === "upcoming" ? tc.textMuted + "80" : tc.textMuted;

  return (
    <Animated.View
      style={{
        flexDirection: "row",
        opacity: fadeAnim,
        transform: [{ translateY: slideAnim }],
      }}
    >
      {/* Dot + Line column */}
      <View style={{ alignItems: "center", width: 40 }}>
        <Animated.View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: dotBg,
            borderWidth: 2,
            borderColor: dotBorder,
            alignItems: "center",
            justifyContent: "center",
            transform: state === "active" ? [{ scale: pulseAnim }] : [],
          }}
        >
          <Ionicons
            name={
              state === "completed" ? "checkmark" : icon
            }
            size={16}
            color={
              state === "completed"
                ? "#FFFFFF"
                : state === "active"
                  ? color
                  : tc.dark.muted
            }
          />
        </Animated.View>
        {!isLast && (
          <View
            style={{
              width: 2,
              flex: 1,
              minHeight: 24,
              backgroundColor: lineColor,
              marginVertical: 4,
            }}
          />
        )}
      </View>

      {/* Label column */}
      <View style={{ flex: 1, paddingLeft: 14, paddingBottom: isLast ? 0 : 20 }}>
        <Text
          style={{
            color: textColor,
            fontSize: 15,
            fontFamily: "DMSans_600SemiBold",
            marginBottom: 2,
          }}
        >
          {label}
        </Text>
        <Text
          style={{
            color: subColor,
            fontSize: 12,
            fontFamily: "DMSans_400Regular",
            lineHeight: 18,
          }}
        >
          {subtitle}
        </Text>
      </View>
    </Animated.View>
  );
}

// ── Circular Progress ──
function CircularProgress({
  current,
  required,
  color,
  size = 96,
}: {
  current: number;
  required: number;
  color: string;
  size?: number;
}) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const pct = Math.min(current / Math.max(required, 1), 1);
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (pct < 1) {
      const spin = Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 3000,
          useNativeDriver: useNative,
        })
      );
      spin.start();
      return () => spin.stop();
    }
  }, [pct, rotateAnim]);

  // Use a simplified visual: ring border + text in center
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Background ring */}
      <View
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: strokeWidth,
          borderColor: color + "20",
        }}
      />
      {/* Progress ring — use conic gradient on web, simplified on native */}
      {isWeb ? (
        <View
          style={{
            position: "absolute",
            width: size,
            height: size,
            borderRadius: size / 2,
            background: `conic-gradient(${color} ${pct * 360}deg, transparent ${pct * 360}deg)`,
            WebkitMask: `radial-gradient(circle ${radius - strokeWidth}px at center, transparent 100%, black 100%)`,
            mask: `radial-gradient(circle ${radius - strokeWidth}px at center, transparent 100%, black 100%)`,
          } as any}
        />
      ) : (
        <View
          style={{
            position: "absolute",
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: strokeWidth,
            borderColor: color,
            borderTopColor: pct >= 0.25 ? color : "transparent",
            borderRightColor: pct >= 0.5 ? color : "transparent",
            borderBottomColor: pct >= 0.75 ? color : "transparent",
            borderLeftColor: pct >= 1 ? color : "transparent",
          }}
        />
      )}

      {/* Center text */}
      <View style={{ alignItems: "center" }}>
        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 22,
            fontFamily: "DMSans_700Bold",
          }}
        >
          {current}
        </Text>
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 11,
            fontFamily: "DMSans_500Medium",
            marginTop: -2,
          }}
        >
          of {required}
        </Text>
      </View>
    </View>
  );
}

// ── Success Animation ──
function SuccessAnimation() {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const ripple1 = useRef(new Animated.Value(0)).current;
  const ripple2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Main checkmark
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 100,
          friction: 8,
          useNativeDriver: useNative,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: useNative,
        }),
      ]),
      // Ripple effects
      Animated.parallel([
        Animated.timing(ripple1, {
          toValue: 1,
          duration: 800,
          useNativeDriver: useNative,
        }),
        Animated.sequence([
          Animated.delay(200),
          Animated.timing(ripple2, {
            toValue: 1,
            duration: 800,
            useNativeDriver: useNative,
          }),
        ]),
      ]),
    ]).start();
  }, [scaleAnim, opacityAnim, ripple1, ripple2]);

  return (
    <View
      style={{
        width: 100,
        height: 100,
        alignItems: "center",
        justifyContent: "center",
        alignSelf: "center",
        marginVertical: 16,
      }}
    >
      {/* Ripple 1 */}
      <Animated.View
        style={{
          position: "absolute",
          width: 100,
          height: 100,
          borderRadius: 50,
          borderWidth: 2,
          borderColor: colors.success,
          opacity: ripple1.interpolate({
            inputRange: [0, 1],
            outputRange: [0.5, 0],
          }),
          transform: [
            {
              scale: ripple1.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 2],
              }),
            },
          ],
        }}
      />
      {/* Ripple 2 */}
      <Animated.View
        style={{
          position: "absolute",
          width: 100,
          height: 100,
          borderRadius: 50,
          borderWidth: 2,
          borderColor: colors.success,
          opacity: ripple2.interpolate({
            inputRange: [0, 1],
            outputRange: [0.4, 0],
          }),
          transform: [
            {
              scale: ripple2.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 1.7],
              }),
            },
          ],
        }}
      />
      {/* Checkmark circle */}
      <Animated.View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: colors.success,
          alignItems: "center",
          justifyContent: "center",
          opacity: opacityAnim,
          transform: [{ scale: scaleAnim }],
        }}
      >
        <Ionicons name="checkmark" size={36} color="#FFFFFF" />
      </Animated.View>
    </View>
  );
}

// ── Main Modal ──
interface DepositStatusModalProps {
  deposit: BlockchainDeposit | null;
  visible: boolean;
  onClose: () => void;
}

export function DepositStatusModal({
  deposit,
  visible,
  onClose,
}: DepositStatusModalProps) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const toast = useToast();
  const { width, height } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;

  const slideAnim = useRef(new Animated.Value(height)).current;
  const bgOpacity = useRef(new Animated.Value(0)).current;
  const [copiedHash, setCopiedHash] = useState(false);

  useEffect(() => {
    if (visible && deposit) {
      slideAnim.setValue(height);
      bgOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 65,
          friction: 11,
          useNativeDriver: useNative,
        }),
        Animated.timing(bgOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: useNative,
        }),
      ]).start();
    }
  }, [visible, deposit, slideAnim, bgOpacity, height]);

  const animatedClose = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: height,
        duration: 250,
        useNativeDriver: useNative,
      }),
      Animated.timing(bgOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: useNative,
      }),
    ]).start(() => onClose());
  }, [slideAnim, bgOpacity, height, onClose]);

  if (!deposit) return null;

  const isCredited =
    deposit.status === "credited" || deposit.status === "confirmed";
  const isConfirming = deposit.status === "confirming";
  const isDetecting = deposit.status === "detecting";
  const chainLabel =
    deposit.chain.charAt(0).toUpperCase() + deposit.chain.slice(1);
  const pct = Math.min(
    deposit.confirmations / Math.max(deposit.required_confirmations, 1),
    1
  );
  const mainColor = isCredited
    ? colors.success
    : isConfirming
      ? colors.info
      : colors.warning;

  // Determine step states
  const getStepState = (step: number): StepState => {
    if (step === 0) {
      // Detected step
      return isDetecting ? "active" : "completed";
    }
    if (step === 1) {
      // Confirming step
      if (isDetecting) return "upcoming";
      if (isConfirming) return "active";
      return "completed";
    }
    // Credited step
    if (isCredited) return "completed";
    if (isConfirming && pct >= 1) return "active";
    return "upcoming";
  };

  const steps = [
    {
      label: "Deposit Detected",
      subtitle: `${parseFloat(deposit.amount).toLocaleString(undefined, { maximumFractionDigits: 8 })} ${deposit.currency} on ${chainLabel}`,
      icon: "radio-outline" as keyof typeof Ionicons.glyphMap,
      color: colors.warning,
    },
    {
      label: "Confirming on Chain",
      subtitle: isConfirming || isCredited
        ? `${deposit.confirmations}/${deposit.required_confirmations} confirmations`
        : "Waiting for blockchain confirmations",
      icon: "hourglass-outline" as keyof typeof Ionicons.glyphMap,
      color: colors.info,
    },
    {
      label: isCredited ? "Credited to Wallet" : "Credit to Wallet",
      subtitle: isCredited
        ? `${deposit.currency} has been added to your balance`
        : "Will be credited once confirmations are complete",
      icon: "wallet-outline" as keyof typeof Ionicons.glyphMap,
      color: colors.success,
    },
  ];

  const copyTxHash = async () => {
    await Clipboard.setStringAsync(deposit.tx_hash);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setCopiedHash(true);
    toast.success("Copied", "Transaction hash copied");
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const openExplorer = () => {
    const baseUrl = EXPLORER_TX[deposit.chain] || EXPLORER_TX.ethereum;
    Linking.openURL(baseUrl + deposit.tx_hash);
  };

  const modalContent = (
    <Animated.View
      style={
        isDesktop
          ? {
              backgroundColor: tc.dark.card,
              borderRadius: 28,
              width: "100%",
              maxWidth: 500,
              maxHeight: height * 0.9,
              padding: 32,
              borderWidth: 1,
              borderColor: tc.glass.borderStrong,
              overflow: "hidden",
              opacity: bgOpacity,
              transform: [{ translateY: slideAnim }],
              ...ts.lg,
            }
          : {
              backgroundColor: tc.dark.card,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              paddingHorizontal: 24,
              paddingTop: 12,
              paddingBottom: 40,
              maxHeight: height * 0.92,
              borderWidth: 1,
              borderBottomWidth: 0,
              borderColor: tc.glass.borderStrong,
              overflow: "hidden",
              transform: [{ translateY: slideAnim }],
            }
      }
    >
      {/* Glass highlight at top */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 100,
          backgroundColor: mainColor + "08",
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
        }}
      />

      {/* Drag handle (mobile) */}
      {!isDesktop && (
        <View
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            backgroundColor: tc.dark.muted + "40",
            alignSelf: "center",
            marginBottom: 16,
          }}
        />
      )}

      {/* Close button */}
      <Pressable
        onPress={animatedClose}
        style={({ pressed, hovered }: any) => ({
          position: "absolute",
          top: isDesktop ? 16 : 12,
          right: isDesktop ? 16 : 16,
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: hovered
            ? tc.dark.elevated
            : pressed
              ? tc.dark.elevated
              : "transparent",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10,
          ...(isWeb ? ({ cursor: "pointer" } as any) : {}),
        })}
      >
        <Ionicons name="close" size={20} color={tc.textSecondary} />
      </Pressable>

      {/* Header */}
      <View style={{ alignItems: "center", marginBottom: 24, marginTop: 8 }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 18,
            backgroundColor: mainColor + "1F",
            borderWidth: 1.5,
            borderColor: mainColor + "40",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 14,
          }}
        >
          <CryptoLogo
            currency={deposit.currency}
            size={32}
            fallbackColor={mainColor}
          />
        </View>
        <Text
          style={{
            color: tc.textPrimary,
            fontSize: 22,
            fontFamily: "DMSans_700Bold",
            marginBottom: 4,
          }}
        >
          {isCredited ? "Deposit Complete" : "Deposit In Progress"}
        </Text>
        <Text
          style={{
            color: tc.textMuted,
            fontSize: 14,
            fontFamily: "DMSans_400Regular",
          }}
        >
          {parseFloat(deposit.amount).toLocaleString(undefined, {
            maximumFractionDigits: 8,
          })}{" "}
          {deposit.currency} via {chainLabel}
        </Text>
      </View>

      {/* Success animation */}
      {isCredited && <SuccessAnimation />}

      {/* Confirmation counter (when confirming) */}
      {isConfirming && (
        <View style={{ alignItems: "center", marginBottom: 24 }}>
          <CircularProgress
            current={deposit.confirmations}
            required={deposit.required_confirmations}
            color={colors.info}
          />
        </View>
      )}

      {/* Timeline */}
      <View
        style={{
          backgroundColor: tc.dark.bg,
          borderRadius: 20,
          padding: 20,
          borderWidth: 1,
          borderColor: tc.glass.border,
          marginBottom: 20,
        }}
      >
        {steps.map((step, i) => (
          <TimelineStep
            key={i}
            label={step.label}
            subtitle={step.subtitle}
            icon={step.icon}
            state={getStepState(i)}
            color={step.color}
            isLast={i === steps.length - 1}
            index={i}
          />
        ))}
      </View>

      {/* Transaction details */}
      <View
        style={{
          backgroundColor: tc.dark.bg,
          borderRadius: 16,
          padding: 16,
          borderWidth: 1,
          borderColor: tc.glass.border,
          gap: 10,
          marginBottom: 20,
        }}
      >
        {/* Tx Hash */}
        <Pressable
          onPress={copyTxHash}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 12,
              fontFamily: "DMSans_500Medium",
            }}
          >
            Tx Hash
          </Text>
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
          >
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: 12,
                fontFamily: isWeb ? "monospace" : "Courier",
              }}
            >
              {truncateHash(deposit.tx_hash)}
            </Text>
            <Ionicons
              name={copiedHash ? "checkmark" : "copy-outline"}
              size={13}
              color={copiedHash ? colors.success : tc.textMuted}
            />
          </View>
        </Pressable>

        {/* Network */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 12,
              fontFamily: "DMSans_500Medium",
            }}
          >
            Network
          </Text>
          <Text
            style={{
              color: tc.textSecondary,
              fontSize: 12,
              fontFamily: "DMSans_500Medium",
            }}
          >
            {chainLabel}
          </Text>
        </View>

        {/* Confirmations */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 12,
              fontFamily: "DMSans_500Medium",
            }}
          >
            Confirmations
          </Text>
          <Text
            style={{
              color: mainColor,
              fontSize: 12,
              fontFamily: "DMSans_600SemiBold",
            }}
          >
            {deposit.confirmations}/{deposit.required_confirmations}
          </Text>
        </View>

        {/* Block */}
        {deposit.block_number && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 12,
                fontFamily: "DMSans_500Medium",
              }}
            >
              Block
            </Text>
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: 12,
                fontFamily: "DMSans_500Medium",
              }}
            >
              {deposit.block_number.toLocaleString()}
            </Text>
          </View>
        )}
      </View>

      {/* View on Explorer button */}
      <Pressable
        onPress={openExplorer}
        style={({ pressed, hovered }: any) => ({
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          paddingVertical: 14,
          borderRadius: 14,
          backgroundColor: hovered
            ? mainColor + "25"
            : mainColor + "15",
          borderWidth: 1,
          borderColor: mainColor + "30",
          opacity: pressed ? 0.85 : 1,
          maxWidth: isDesktop ? 420 : undefined,
          alignSelf: isDesktop ? "center" : undefined,
          width: isDesktop ? "100%" : undefined,
          ...(isWeb
            ? ({
                cursor: "pointer",
                transition: "all 0.15s ease",
              } as any)
            : {}),
        })}
      >
        <Ionicons name="open-outline" size={16} color={mainColor} />
        <Text
          style={{
            color: mainColor,
            fontSize: 14,
            fontFamily: "DMSans_600SemiBold",
          }}
        >
          View on Explorer
        </Text>
      </Pressable>

      {/* Done button (when credited) */}
      {isCredited && (
        <Pressable
          onPress={animatedClose}
          style={({ pressed }) => ({
            paddingVertical: 14,
            borderRadius: 14,
            backgroundColor: colors.success,
            alignItems: "center",
            justifyContent: "center",
            marginTop: 12,
            opacity: pressed ? 0.85 : 1,
            maxWidth: isDesktop ? 420 : undefined,
            alignSelf: isDesktop ? "center" : undefined,
            width: isDesktop ? "100%" : undefined,
            ...(isWeb
              ? ({
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                } as any)
              : {}),
          })}
        >
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: 15,
              fontFamily: "DMSans_600SemiBold",
            }}
          >
            Done
          </Text>
        </Pressable>
      )}
    </Animated.View>
  );

  // Desktop: centered dialog. Mobile: bottom sheet.
  if (isDesktop) {
    return (
      <Modal
        visible={visible}
        animationType="none"
        transparent
        onRequestClose={animatedClose}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.6)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Pressable
            onPress={animatedClose}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          />
          {modalContent}
        </View>
      </Modal>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={animatedClose}
    >
      <Animated.View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.7)",
          justifyContent: "flex-end",
          opacity: bgOpacity,
        }}
      >
        <Pressable
          onPress={animatedClose}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        />
        {modalContent}
      </Animated.View>
    </Modal>
  );
}
