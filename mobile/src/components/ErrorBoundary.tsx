import React, { Component, ErrorInfo, ReactNode } from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
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

      return (
        <View
          style={{
            flex: 1,
            backgroundColor: "#060E1F",
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
              <Ionicons name="warning-outline" size={36} color="#EF4444" />
            </View>
          </View>

          <Text
            style={{
              color: "#F0F4F8",
              fontSize: 22,
              fontFamily: "Inter_700Bold",
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
              color: "#8899AA",
              fontSize: 15,
              fontFamily: "Inter_400Regular",
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
          {__DEV__ && this.state.error && (
            <View
              style={{
                backgroundColor: "#0C1A2E",
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
                <Ionicons name="bug-outline" size={14} color="#EF4444" />
                <Text
                  style={{
                    color: "#EF4444",
                    fontSize: 11,
                    fontFamily: "Inter_600SemiBold",
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
                  fontFamily: "Inter_400Regular",
                  lineHeight: 18,
                }}
                numberOfLines={6}
                selectable
              >
                {this.state.error.message}
              </Text>
            </View>
          )}

          {/* Retry button */}
          <Pressable
            onPress={this.handleRetry}
            style={({ pressed }) => ({
              backgroundColor: "#10B981",
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
                    shadowColor: "#10B981",
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
                fontFamily: "Inter_600SemiBold",
                letterSpacing: 0.3,
              }}
            >
              Try Again
            </Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}
