import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { router } from "expo-router";
import { authApi } from "../api/auth";

// Configure how notifications are handled when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Hook to manage Expo push notifications.
 *
 * - Requests permission and registers the Expo push token with the backend.
 * - Listens for incoming notifications (foreground and background tap).
 * - Returns the push token and the last received notification.
 */
export function usePushNotifications() {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [notification, setNotification] =
    useState<Notifications.Notification | null>(null);
  const notificationListener = useRef<Notifications.EventSubscription | null>(
    null
  );
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") {
      // Web: use the browser Notification API
      requestWebNotificationPermission().then((granted) => {
        if (granted) setExpoPushToken("web-notifications-enabled");
      }).catch(() => {});
      return;
    }

    registerForPushNotifications().then((token) => {
      if (token) {
        setExpoPushToken(token);
      }
    });

    // Listener for notifications received while the app is foregrounded
    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        setNotification(notification);
      });

    // Listener for when the user taps on a notification
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data ?? {};
        handleNotificationResponse(data as Record<string, unknown>);
      });

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, []);

  return { expoPushToken, notification };
}

/**
 * Request notification permissions and get the Expo push token.
 * Registers the token with the backend API.
 */
async function registerForPushNotifications(): Promise<string | null> {
  // Push notifications only work on physical devices
  if (!Device.isDevice) {
    console.log(
      "Push notifications require a physical device. Skipping registration."
    );
    return null;
  }

  try {
    // Check existing permissions
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request permissions if not already granted
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.log("Push notification permission not granted.");
      return null;
    }

    // Set up Android notification channel
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#00D4AA",
      });
    }

    // Get the Expo push token
    const tokenResponse = await Notifications.getExpoPushTokenAsync();
    const token = tokenResponse.data;

    // Register the token with the backend
    const platform = Platform.OS === "ios" ? "ios" : "android";
    try {
      await authApi.registerPushToken(token, platform);
      console.log("Push token registered with backend successfully.");
    } catch (error) {
      // Don't block the app if token registration fails — it will retry next launch
      console.warn("Failed to register push token with backend:", error);
    }

    return token;
  } catch (error) {
    console.error("Error registering for push notifications:", error);
    return null;
  }
}

/**
 * Request browser Web Notification permission.
 * Returns true if permission was granted.
 */
async function requestWebNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false;
  }
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  const permission = await Notification.requestPermission();
  return permission === "granted";
}

/**
 * Show a native browser notification on web.
 * Call from anywhere to trigger a web notification.
 */
export function showWebNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  if (Platform.OS !== "web" || typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const notification = new Notification(title, {
    body,
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: data?.transaction_id as string | undefined,
  });

  notification.onclick = () => {
    window.focus();
    if (data) handleNotificationResponse(data);
    notification.close();
  };
}

/**
 * Handle notification tap responses.
 * Route the user to the relevant screen based on notification payload.
 */
function handleNotificationResponse(data: Record<string, unknown>) {
  const type = data.type as string | undefined;
  const id = data.transaction_id as string | undefined;

  switch (type) {
    case "transaction":
    case "payment_complete":
    case "payment_failed":
      if (id) {
        router.push(`/payment/detail?id=${id}` as any);
      } else {
        router.push("/(tabs)/wallet" as any);
      }
      break;
    case "deposit":
      router.push("/(tabs)/wallet" as any);
      break;
    case "kyc_approved":
    case "kyc_rejected":
      router.push("/settings/kyc" as any);
      break;
    case "security":
    case "device_login":
      router.push("/settings/devices" as any);
      break;
    default:
      // Fallback: navigate to home
      router.push("/(tabs)" as any);
      break;
  }
}
