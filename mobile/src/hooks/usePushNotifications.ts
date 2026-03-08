import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
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
    // Only register for push on physical devices (not web or simulators without support)
    if (Platform.OS === "web") {
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
 * Handle notification tap responses.
 * Route the user based on the notification data payload.
 */
function handleNotificationResponse(data: Record<string, unknown>) {
  // Navigation based on notification type can be handled here.
  // For example: if data.type === "transaction", navigate to transaction details.
  console.log("Notification tapped with data:", data);
}
