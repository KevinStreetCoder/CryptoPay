import { useEffect, useRef, useState } from "react";
import { View, Text, Animated, Platform, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// Check once at module load time if we're in a web dev environment
const IS_WEB_DEV = (() => {
  if (Platform.OS !== "web") return false;
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    host.includes("local")
  );
})();

export function NetworkStatus() {
  // Never render on web dev — CORS failures and API errors are not connectivity issues
  if (IS_WEB_DEV) return null;

  return <NetworkStatusInner />;
}

function NetworkStatusInner() {
  const [isOffline, setIsOffline] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const slideAnim = useRef(new Animated.Value(-80)).current;

  useEffect(() => {
    if (Platform.OS === "web") {
      const handleOnline = () => {
        setIsOffline(false);
        setDismissed(false);
      };
      const handleOffline = () => {
        setIsOffline(true);
        setDismissed(false);
      };

      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      setIsOffline(offline);

      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }

    // Native: periodically ping with retry
    let mounted = true;
    let interval: ReturnType<typeof setInterval>;
    let failCount = 0;

    const checkConnection = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        await fetch("https://clients3.google.com/generate_204", {
          method: "HEAD",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (mounted) {
          failCount = 0;
          setIsOffline(false);
          setDismissed(false);
        }
      } catch {
        if (mounted) {
          failCount++;
          if (failCount >= 2) {
            setIsOffline(true);
          }
        }
      }
    };

    checkConnection();
    interval = setInterval(checkConnection, 15000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const show = isOffline && !dismissed;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: show ? 0 : -80,
      useNativeDriver: Platform.OS !== "web",
      tension: 60,
      friction: 14,
    }).start();
  }, [show, slideAnim]);

  if (!show) return null;

  return (
    <Animated.View
      style={[styles.outer, { transform: [{ translateY: slideAnim }] }]}
    >
      <View
        style={[
          styles.banner,
          {
            paddingTop:
              Platform.OS === "ios" ? 52 : Platform.OS === "web" ? 12 : 38,
          },
        ]}
      >
        <View style={styles.content}>
          <Ionicons name="cloud-offline-outline" size={20} color="#FFFFFF" />
          <View>
            <Text style={styles.text}>No Connection</Text>
            <Text style={styles.subtext}>
              Please check your internet and try again.
            </Text>
          </View>
        </View>
        <Pressable
          onPress={() => setDismissed(true)}
          style={styles.dismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <Ionicons name="close" size={18} color="rgba(255,255,255,0.7)" />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
  },
  banner: {
    backgroundColor: "#DC2626",
    paddingBottom: 12,
    paddingHorizontal: 16,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 4px 12px rgba(220,38,38,0.3)" }
      : {
          shadowColor: "#DC2626",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 12,
          elevation: 10,
        }),
  } as any,
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  text: {
    color: "#FFFFFF",
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.2,
  },
  subtext: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  dismiss: {
    position: "absolute",
    top: 8,
    right: 12,
    padding: 4,
  },
});
