import { useEffect, useRef } from "react";
import { View, Animated, Easing, ViewStyle, StyleSheet, Platform } from "react-native";
import { colors } from "../constants/theme";

const useNative = Platform.OS !== "web";

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({
  width = "100%",
  height = 20,
  borderRadius = 8,
  style,
}: SkeletonProps) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: useNative,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: useNative,
        }),
      ])
    ).start();
  }, [shimmer]);

  const opacity = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [0.25, 0.55],
  });

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: colors.dark.elevated,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function BalanceCardSkeleton() {
  return (
    <View style={skeletonStyles.balanceCard}>
      <Skeleton width={100} height={14} style={{ marginBottom: 10 }} />
      <Skeleton width={200} height={34} borderRadius={10} style={{ marginBottom: 20 }} />
      <View style={skeletonStyles.row}>
        <View style={{ flex: 1 }}>
          <Skeleton height={50} borderRadius={14} />
        </View>
        <View style={{ flex: 1 }}>
          <Skeleton height={50} borderRadius={14} />
        </View>
        <View style={{ flex: 1 }}>
          <Skeleton height={50} borderRadius={14} />
        </View>
      </View>
    </View>
  );
}

export function TransactionSkeleton() {
  return (
    <View style={skeletonStyles.transactionContainer}>
      {[1, 2, 3].map((i) => (
        <View key={i} style={skeletonStyles.transactionRow}>
          <Skeleton width={44} height={44} borderRadius={14} />
          <View style={skeletonStyles.transactionDetails}>
            <Skeleton width={120} height={15} style={{ marginBottom: 6 }} />
            <Skeleton width={80} height={12} />
          </View>
          <View style={skeletonStyles.transactionAmount}>
            <Skeleton width={75} height={15} style={{ marginBottom: 6 }} />
            <Skeleton width={55} height={12} borderRadius={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function WalletCardSkeleton() {
  return (
    <View style={skeletonStyles.walletCard}>
      <View style={skeletonStyles.walletRow}>
        <View style={skeletonStyles.walletLeft}>
          <Skeleton width={44} height={44} borderRadius={14} />
          <View style={{ marginLeft: 12 }}>
            <Skeleton width={80} height={15} style={{ marginBottom: 6 }} />
            <Skeleton width={50} height={12} />
          </View>
        </View>
        <View style={skeletonStyles.walletRight}>
          <Skeleton width={90} height={15} style={{ marginBottom: 6 }} />
          <Skeleton width={60} height={12} />
        </View>
      </View>
    </View>
  );
}

/** Skeleton for a single crypto price card with sparkline */
export function CryptoCardSkeleton() {
  return (
    <View style={skeletonStyles.cryptoCard}>
      {/* Icon + symbol row */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Skeleton width={32} height={32} borderRadius={10} />
        <View>
          <Skeleton width={40} height={13} style={{ marginBottom: 4 }} />
          <Skeleton width={55} height={10} />
        </View>
      </View>
      {/* Price */}
      <Skeleton width={80} height={14} style={{ marginBottom: 4 }} />
      {/* Change % */}
      <Skeleton width={50} height={11} style={{ marginBottom: 8 }} />
      {/* Sparkline area */}
      <Skeleton width="100%" height={48} borderRadius={6} />
    </View>
  );
}

/** Row of 4 crypto card skeletons */
export function CryptoChartsSkeleton() {
  return (
    <View style={{ marginBottom: 24 }}>
      <Skeleton width={110} height={11} style={{ marginBottom: 14, marginLeft: 4 }} />
      <View style={{ flexDirection: "row", gap: 16 }}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={{ flex: 1 }}>
            <CryptoCardSkeleton />
          </View>
        ))}
      </View>
    </View>
  );
}

/** Rate ticker skeleton */
export function RateTickerSkeleton() {
  return (
    <View style={skeletonStyles.rateTicker}>
      <View style={{ flexDirection: "row", gap: 24, alignItems: "center" }}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Skeleton width={28} height={14} />
            <Skeleton width={70} height={14} />
            <Skeleton width={42} height={14} borderRadius={6} />
          </View>
        ))}
      </View>
    </View>
  );
}

/** Portfolio chart skeleton (sidebar panel) */
export function PortfolioChartSkeleton() {
  return (
    <View style={skeletonStyles.portfolioChart}>
      <Skeleton width={100} height={12} style={{ marginBottom: 8 }} />
      <Skeleton width={60} height={22} borderRadius={8} style={{ marginBottom: 4 }} />
      <Skeleton width={80} height={12} style={{ marginBottom: 16 }} />
      <Skeleton width="100%" height={120} borderRadius={10} style={{ marginBottom: 12 }} />
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <Skeleton key={i} width={28} height={10} />
        ))}
      </View>
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  balanceCard: {
    backgroundColor: colors.dark.card,
    borderRadius: 24,
    padding: 24,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.glass.border,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  transactionContainer: {
    padding: 16,
  },
  transactionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
  },
  transactionDetails: {
    flex: 1,
    marginLeft: 12,
  },
  transactionAmount: {
    alignItems: "flex-end",
  },
  walletCard: {
    backgroundColor: colors.dark.card,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.glass.border,
  },
  walletRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  walletLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  walletRight: {
    alignItems: "flex-end",
  },
  cryptoCard: {
    backgroundColor: colors.dark.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.glass.border,
  },
  rateTicker: {
    backgroundColor: colors.dark.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.glass.border,
  },
  portfolioChart: {
    backgroundColor: colors.dark.card,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.glass.border,
  },
});
