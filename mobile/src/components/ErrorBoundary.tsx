import React, { Component, ErrorInfo, ReactNode } from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getThemeColors } from "../constants/theme";
import { useThemeMode } from "../stores/theme";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/** Themed fallback UI extracted as a function component so it can use hooks */
function ErrorFallbackUI({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: tc.dark.bg,
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
      }}
    >
      {/* Error icon with glow layers */}
      <View
        style={{
          width: 100,
          height: 100,
          borderRadius: 32,
          backgroundColor: "rgba(239, 68, 68, 0.06)",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 8,
        }}
      >
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 24,
            backgroundColor: "rgba(239, 68, 68, 0.12)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="warning-outline" size={36} color={tc.error} />
        </View>
      </View>

      <Text
        style={{
          color: tc.textPrimary,
          fontSize: 22,
          fontFamily: "DMSans_700Bold",
          marginBottom: 8,
          marginTop: 16,
          textAlign: "center",
          letterSpacing: -0.3,
        }}
      >
        Something went wrong
      </Text>

      <Text
        style={{
          color: tc.textSecondary,
          fontSize: 15,
          fontFamily: "DMSans_400Regular",
          textAlign: "center",
          marginBottom: 32,
          lineHeight: 22,
          maxWidth: 300,
        }}
      >
        We encountered an unexpected error.{"\n"}
        Please try again or restart the app.
      </Text>

      {/* Error details (dev only) */}
      {error && (
        <View
          style={{
            backgroundColor: tc.dark.card,
            borderRadius: 16,
            padding: 16,
            marginBottom: 28,
            width: "100%",
            maxWidth: 400,
            borderWidth: 1,
            borderColor: "rgba(239, 68, 68, 0.2)",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginBottom: 8,
            }}
          >
            <Ionicons name="bug-outline" size={14} color={tc.error} />
            <Text
              style={{
                color: tc.error,
                fontSize: 11,
                fontFamily: "DMSans_600SemiBold",
                letterSpacing: 0.5,
                textTransform: "uppercase",
              }}
            >
              Debug Info
            </Text>
          </View>
          <Text
            style={{
              color: "#F87171",
              fontSize: 13,
              fontFamily: "DMSans_400Regular",
              lineHeight: 18,
            }}
            numberOfLines={6}
            selectable
          >
            {error.message}
          </Text>
        </View>
      )}

      {/* Retry button */}
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => ({
          backgroundColor: tc.primary[500],
          paddingHorizontal: 36,
          paddingVertical: 16,
          borderRadius: 18,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          minWidth: 180,
          justifyContent: "center",
          opacity: pressed ? 0.9 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
          ...(Platform.OS === "web"
            ? ({
                shadowColor: tc.primary[500],
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 16,
              } as any)
            : { elevation: 8 }),
        })}
      >
        <Ionicons name="refresh" size={20} color="#FFFFFF" />
        <Text
          style={{
            color: "#FFFFFF",
            fontSize: 16,
            fontFamily: "DMSans_600SemiBold",
            letterSpacing: 0.3,
          }}
        >
          Try Again
        </Text>
      </Pressable>
    </View>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return <ErrorFallbackUI error={this.state.error} onRetry={this.handleRetry} />;
    }

    return this.props.children;
  }
}
