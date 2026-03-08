import { useEffect, useRef } from "react";
import { View, Animated, Easing, ViewStyle } from "react-native";

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
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [shimmer]);

  const opacity = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: "#334155",
          opacity,
        },
        style,
      ]}
    />
  );
}

export function BalanceCardSkeleton() {
  return (
    <View
      style={{
        backgroundColor: "#0D9F6E",
        borderRadius: 16,
        padding: 20,
        marginHorizontal: 16,
      }}
    >
      <Skeleton width={100} height={14} style={{ marginBottom: 8 }} />
      <Skeleton width={180} height={32} style={{ marginBottom: 16 }} />
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Skeleton height={48} borderRadius={12} />
        </View>
        <View style={{ flex: 1 }}>
          <Skeleton height={48} borderRadius={12} />
        </View>
        <View style={{ flex: 1 }}>
          <Skeleton height={48} borderRadius={12} />
        </View>
      </View>
    </View>
  );
}

export function TransactionSkeleton() {
  return (
    <View style={{ padding: 16 }}>
      {[1, 2, 3].map((i) => (
        <View
          key={i}
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingVertical: 12,
          }}
        >
          <Skeleton width={40} height={40} borderRadius={20} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Skeleton width={120} height={14} style={{ marginBottom: 6 }} />
            <Skeleton width={80} height={12} />
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Skeleton width={70} height={14} style={{ marginBottom: 6 }} />
            <Skeleton width={50} height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function WalletCardSkeleton() {
  return (
    <View
      style={{
        backgroundColor: "#1E293B",
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Skeleton width={40} height={40} borderRadius={20} />
          <View style={{ marginLeft: 12 }}>
            <Skeleton width={80} height={14} style={{ marginBottom: 6 }} />
            <Skeleton width={50} height={12} />
          </View>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Skeleton width={90} height={14} style={{ marginBottom: 6 }} />
          <Skeleton width={60} height={12} />
        </View>
      </View>
    </View>
  );
}
