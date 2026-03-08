import { View, Platform, useWindowDimensions } from "react-native";

/**
 * Responsive web container for the main app screens (tabs, payment).
 * Auth screens handle their own full-width layout separately.
 *
 * - Mobile (<768px): Full width, no frame
 * - Tablet (768-1024px): Centered with max-width 720px
 * - Desktop (1024-1440px): Centered with max-width 920px
 * - Large Desktop (>1440px): Centered with max-width 1080px
 *
 * On native, renders children directly with no wrapper.
 */
export function WebContainer({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== "web") {
    return <>{children}</>;
  }

  return <ResponsiveWeb>{children}</ResponsiveWeb>;
}

function ResponsiveWeb({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();

  // Mobile: full screen, no constraints
  if (width < 768) {
    return (
      <View style={{ flex: 1, backgroundColor: "#060E1F" }}>
        {children}
      </View>
    );
  }

  // Tablet & Desktop: centered column with elegant side borders
  const maxWidth =
    width >= 1440 ? 1080 : width >= 1024 ? 920 : 720;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#040A14",
        alignItems: "center",
      }}
    >
      <View
        style={{
          flex: 1,
          width: "100%",
          maxWidth,
          backgroundColor: "#060E1F",
          ...(({
            borderLeftWidth: 1,
            borderRightWidth: 1,
            borderColor: "rgba(30, 51, 80, 0.25)",
            boxShadow: "0 0 60px -10px rgba(0, 0, 0, 0.5)",
          }) as any),
        }}
      >
        {children}
      </View>
    </View>
  );
}
