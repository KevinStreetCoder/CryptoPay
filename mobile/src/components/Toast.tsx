import { useEffect, useRef, useState, createContext, useContext, useCallback } from "react";
import { View, Text, Animated, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

type ToastType = "success" | "error" | "warning" | "info";

interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  show: (type: ToastType, title: string, message?: string, duration?: number) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback for use outside provider — no-op
    return {
      show: () => {},
      success: () => {},
      error: () => {},
      warning: () => {},
      info: () => {},
    };
  }
  return ctx;
}

const TOAST_CONFIG: Record<ToastType, { icon: string; bg: string; border: string; color: string }> = {
  success: {
    icon: "checkmark-circle",
    bg: "rgba(16, 185, 129, 0.12)",
    border: "rgba(16, 185, 129, 0.3)",
    color: "#10B981",
  },
  error: {
    icon: "alert-circle",
    bg: "rgba(239, 68, 68, 0.12)",
    border: "rgba(239, 68, 68, 0.3)",
    color: "#EF4444",
  },
  warning: {
    icon: "warning",
    bg: "rgba(245, 158, 11, 0.12)",
    border: "rgba(245, 158, 11, 0.3)",
    color: "#F59E0B",
  },
  info: {
    icon: "information-circle",
    bg: "rgba(59, 130, 246, 0.12)",
    border: "rgba(59, 130, 246, 0.3)",
    color: "#3B82F6",
  },
};

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: string) => void }) {
  const translateY = useRef(new Animated.Value(-100)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const config = TOAST_CONFIG[toast.type];

  useEffect(() => {
    // Haptic feedback (native only)
    if (Platform.OS !== "web") {
      if (toast.type === "error") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else if (toast.type === "success") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }

    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: Platform.OS !== "web",
        tension: 80,
        friction: 10,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: Platform.OS !== "web",
      }),
    ]).start();

    const timer = setTimeout(() => {
      dismiss();
    }, toast.duration || 4000);

    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -100,
        duration: 200,
        useNativeDriver: Platform.OS !== "web",
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: Platform.OS !== "web",
      }),
    ]).start(() => onDismiss(toast.id));
  };

  return (
    <Animated.View
      style={{
        transform: [{ translateY }],
        opacity,
        marginBottom: 8,
      }}
    >
      <Pressable
        onPress={dismiss}
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: config.bg,
          borderWidth: 1,
          borderColor: config.border,
          borderRadius: 14,
          paddingHorizontal: 16,
          paddingVertical: 12,
          marginHorizontal: 16,
          gap: 12,
          ...(Platform.OS === "web" ? {
            maxWidth: 440,
            width: "100%",
            boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            backdropFilter: "blur(12px)",
          } as any : {}),
        }}
        accessibilityRole="alert"
        accessibilityLabel={`${toast.type}: ${toast.title}${toast.message ? `. ${toast.message}` : ""}`}
      >
        <Ionicons name={config.icon as any} size={22} color={config.color} />
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: 14,
              fontFamily: "DMSans_600SemiBold",
            }}
            maxFontSizeMultiplier={1.3}
          >
            {toast.title}
          </Text>
          {toast.message && (
            <Text
              style={{
                color: "#94A3B8",
                fontSize: 12,
                fontFamily: "DMSans_400Regular",
                marginTop: 2,
              }}
              maxFontSizeMultiplier={1.3}
            >
              {toast.message}
            </Text>
          )}
        </View>
        <Ionicons name="close" size={16} color="#64748B" />
      </Pressable>
    </Animated.View>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const insets = useSafeAreaInsets();

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((type: ToastType, title: string, message?: string, duration?: number) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev.slice(-2), { id, type, title, message, duration }]);
  }, []);

  const contextValue = useCallback(
    () => ({
      show,
      success: (title: string, message?: string) => show("success", title, message),
      error: (title: string, message?: string) => show("error", title, message),
      warning: (title: string, message?: string) => show("warning", title, message),
      info: (title: string, message?: string) => show("info", title, message),
    }),
    [show]
  );

  return (
    <ToastContext.Provider value={contextValue()}>
      {children}
      <View
        style={{
          position: "absolute",
          top: Platform.OS === "web" ? 16 : insets.top + 8,
          left: 0,
          right: 0,
          zIndex: 9999,
          alignItems: Platform.OS === "web" ? "center" : "stretch",
          pointerEvents: "box-none",
        }}
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}
