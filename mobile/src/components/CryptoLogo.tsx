import React, { useState } from "react";
import { View, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CRYPTO_LOGOS } from "../constants/logos";

interface CryptoLogoProps {
  currency: string;
  size?: number;
  fallbackIcon?: string;
  fallbackColor?: string;
}

export function CryptoLogo({
  currency,
  size = 28,
  fallbackIcon = "wallet-outline",
  fallbackColor = "#8899AA",
}: CryptoLogoProps) {
  const [failed, setFailed] = useState(false);
  const logoUrl = CRYPTO_LOGOS[currency];

  if (!logoUrl || failed) {
    return (
      <Ionicons name={fallbackIcon as any} size={size * 0.7} color={fallbackColor} />
    );
  }

  return (
    <Image
      source={{ uri: logoUrl }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      onError={() => setFailed(true)}
      accessibilityLabel={`${currency} logo`}
    />
  );
}
