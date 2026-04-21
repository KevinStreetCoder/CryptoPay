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
    // Fallback for use outside provider · no-op
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
    bg: "#0C2818",
    border: "rgba(16, 185, 129, 0.4)",
    color: "#34D399",
  },
  error: {
    icon: "alert-circle",
    bg: "#2D1114",
    border: "rgba(239, 68, 68, 0.4)",
    color: "#F87171",
  },
  warning: {
    icon: "warning",
    bg: "#2D2006",
    border: "rgba(245, 158, 11, 0.4)",
    color: "#FBBF24",
  },
  info: {
    icon: "information-circle",
    bg: "#0C1A2D",
    border: "rgba(59, 130, 246, 0.4)",
    color: "#60A5FA",
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
          borderRadius: 16,
          paddingHorizontal: 18,
          paddingVertical: 14,
          marginHorizontal: 10,
          gap: 12,
          ...(Platform.OS === "web" ? {
            maxWidth: 460,
            width: "100%",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          } as any : {
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.4,
            shadowRadius: 12,
            elevation: 10,
          }),
        }}
        accessibilityRole="alert"
        accessibilityLabel={`${toast.type}: ${toast.title}${toast.message ? `. ${toast.message}` : ""}`}
      >
        <Ionicons name={config.icon as any} size={24} color={config.color} />
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: "#F1F5F9",
              fontSize: 15,
              fontFamily: "DMSans_600SemiBold",
              lineHeight: 20,
            }}
            maxFontSizeMultiplier={1.3}
          >
            {toast.title}
          </Text>
          {toast.message && (
            <Text
              style={{
                color: "#CBD5E1",
                fontSize: 13,
                fontFamily: "DMSans_400Regular",
                marginTop: 3,
                lineHeight: 18,
              }}
              maxFontSizeMultiplier={1.3}
            >
              {toast.message}
            </Text>
          )}
        </View>
        <Ionicons name="close" size={18} color="#94A3B8" />
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
