import React, { Component, ErrorInfo, ReactNode } from "react";
import { View, Text, Pressable } from "react-native";
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
    // Log to error reporting service in production
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
            backgroundColor: "#0F172A",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          {/* Error icon */}
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: "rgba(239, 68, 68, 0.15)",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 24,
            }}
          >
            <Ionicons name="warning-outline" size={40} color="#EF4444" />
          </View>

          <Text
            style={{
              color: "#FFFFFF",
              fontSize: 20,
              fontFamily: "Inter_700Bold",
              marginBottom: 8,
              textAlign: "center",
            }}
          >
            Something went wrong
          </Text>

          <Text
            style={{
              color: "#94A3B8",
              fontSize: 14,
              fontFamily: "Inter_400Regular",
              textAlign: "center",
              marginBottom: 32,
              lineHeight: 20,
            }}
          >
            We encountered an unexpected error.{"\n"}
            Please try again or restart the app.
          </Text>

          {/* Error details (dev only) */}
          {__DEV__ && this.state.error && (
            <View
              style={{
                backgroundColor: "#1E293B",
                borderRadius: 12,
                padding: 16,
                marginBottom: 24,
                width: "100%",
              }}
            >
              <Text
                style={{
                  color: "#EF4444",
                  fontSize: 12,
                  fontFamily: "Inter_400Regular",
                }}
                numberOfLines={5}
              >
                {this.state.error.message}
              </Text>
            </View>
          )}

          {/* Retry button */}
          <Pressable
            onPress={this.handleRetry}
            style={{
              backgroundColor: "#0D9F6E",
              paddingHorizontal: 32,
              paddingVertical: 14,
              borderRadius: 16,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              minWidth: 160,
              justifyContent: "center",
            }}
          >
            <Ionicons name="refresh" size={20} color="#FFFFFF" />
            <Text
              style={{
                color: "#FFFFFF",
                fontSize: 16,
                fontFamily: "Inter_600SemiBold",
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
