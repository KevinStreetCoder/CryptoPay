import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getThemeColors, getThemeShadows, colors } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { api } from "../../src/api/client";

const isWeb = Platform.OS === "web";

const CATEGORIES = [
  { key: "update", label: "Update", icon: "megaphone-outline", color: "#10B981" },
  { key: "security", label: "Security", icon: "shield-outline", color: "#EF4444" },
  { key: "maintenance", label: "Maintenance", icon: "construct-outline", color: "#F59E0B" },
  { key: "promotion", label: "Promotion", icon: "gift-outline", color: "#8B5CF6" },
] as const;

const CHANNELS = [
  { key: "email", label: "Email", icon: "mail-outline" },
  { key: "sms", label: "SMS", icon: "chatbubble-outline" },
  { key: "in_app", label: "In-App", icon: "notifications-outline" },
] as const;

const PRIORITIES = [
  { key: "low", label: "Low", color: "#64748B" },
  { key: "normal", label: "Normal", color: "#10B981" },
  { key: "high", label: "High", color: "#F59E0B" },
  { key: "critical", label: "Critical", color: "#EF4444" },
] as const;

export default function AdminBroadcastScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<string>("update");
  const [priority, setPriority] = useState<string>("normal");
  const [selectedChannels, setSelectedChannels] = useState<string[]>(["email", "in_app"]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const toggleChannel = (key: string) => {
    setSelectedChannels((prev) =>
      prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]
    );
  };

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) {
      setError("Title and message are required");
      return;
    }
    if (selectedChannels.length === 0) {
      setError("Select at least one channel");
      return;
    }
    setSending(true);
    setError("");
    try {
      await api.post("/notifications/broadcast/", {
        title: title.trim(),
        body: body.trim(),
        category,
        priority,
        channels: selectedChannels,
      });
      setSent(true);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const inputStyle = {
    backgroundColor: tc.dark.elevated,
    borderRadius: 12,
    padding: 14,
    color: tc.textPrimary,
    fontSize: 15,
    fontFamily: "DMSans_400Regular",
    borderWidth: 1,
    borderColor: tc.glass.border,
    ...(isWeb ? { outlineStyle: "none" as any } : {}),
  };

  if (sent) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
          <View style={{
            width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primary[500] + "20",
            alignItems: "center", justifyContent: "center", marginBottom: 20,
          }}>
            <Ionicons name="checkmark-circle" size={48} color={colors.primary[500]} />
          </View>
          <Text style={{ color: tc.textPrimary, fontSize: 24, fontFamily: "DMSans_700Bold", marginBottom: 8 }}>
            Notification Sent
          </Text>
          <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_400Regular", textAlign: "center", marginBottom: 24 }}>
            Your broadcast has been delivered to all users via {selectedChannels.join(", ")}.
          </Text>
          <Pressable
            onPress={() => { setSent(false); setTitle(""); setBody(""); }}
            style={{
              backgroundColor: colors.primary[500],
              paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12,
            }}
          >
            <Text style={{ color: "#fff", fontSize: 15, fontFamily: "DMSans_600SemiBold" }}>Send Another</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <ScrollView
        contentContainerStyle={{
          padding: isDesktop ? 40 : 20,
          maxWidth: isDesktop ? 700 : undefined,
          alignSelf: isDesktop ? "center" : undefined,
          width: isDesktop ? "100%" : undefined,
        }}
      >
        {/* Back */}
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace("/profile" as any)}
          style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 }}
        >
          <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
          <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_500Medium" }}>Back</Text>
        </Pressable>

        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <View style={{
            width: 48, height: 48, borderRadius: 14, backgroundColor: "#8B5CF6" + "20",
            alignItems: "center", justifyContent: "center",
          }}>
            <Ionicons name="megaphone" size={24} color="#8B5CF6" />
          </View>
          <View>
            <Text style={{ color: tc.textPrimary, fontSize: 24, fontFamily: "DMSans_700Bold" }}>
              Broadcast Notification
            </Text>
            <Text style={{ color: tc.textMuted, fontSize: 14, fontFamily: "DMSans_400Regular" }}>
              Send announcements to all CryptoPay users
            </Text>
          </View>
        </View>

        {/* Title */}
        <Text style={{ color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_600SemiBold", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Title *
        </Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. System Maintenance Notice"
          placeholderTextColor={tc.textMuted}
          style={{ ...inputStyle, marginBottom: 16 }}
        />

        {/* Message */}
        <Text style={{ color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_600SemiBold", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Message *
        </Text>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Write your announcement..."
          placeholderTextColor={tc.textMuted}
          multiline
          numberOfLines={5}
          style={{ ...inputStyle, minHeight: 120, textAlignVertical: "top", marginBottom: 20 }}
        />

        {/* Category */}
        <Text style={{ color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_600SemiBold", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Category
        </Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
          {CATEGORIES.map((cat) => (
            <Pressable
              key={cat.key}
              onPress={() => setCategory(cat.key)}
              style={{
                flexDirection: "row", alignItems: "center", gap: 8,
                paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
                backgroundColor: category === cat.key ? cat.color + "20" : tc.dark.elevated,
                borderWidth: 1,
                borderColor: category === cat.key ? cat.color + "50" : tc.glass.border,
                ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
              }}
            >
              <Ionicons name={cat.icon as any} size={16} color={category === cat.key ? cat.color : tc.textMuted} />
              <Text style={{
                color: category === cat.key ? cat.color : tc.textSecondary,
                fontSize: 13, fontFamily: "DMSans_600SemiBold",
              }}>
                {cat.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Priority */}
        <Text style={{ color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_600SemiBold", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Priority
        </Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
          {PRIORITIES.map((p) => (
            <Pressable
              key={p.key}
              onPress={() => setPriority(p.key)}
              style={{
                paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
                backgroundColor: priority === p.key ? p.color + "20" : tc.dark.elevated,
                borderWidth: 1,
                borderColor: priority === p.key ? p.color + "50" : tc.glass.border,
                ...(isWeb ? { cursor: "pointer" } as any : {}),
              }}
            >
              <Text style={{
                color: priority === p.key ? p.color : tc.textSecondary,
                fontSize: 13, fontFamily: "DMSans_600SemiBold",
              }}>
                {p.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Channels */}
        <Text style={{ color: tc.textSecondary, fontSize: 13, fontFamily: "DMSans_600SemiBold", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Delivery Channels
        </Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
          {CHANNELS.map((ch) => {
            const selected = selectedChannels.includes(ch.key);
            return (
              <Pressable
                key={ch.key}
                onPress={() => toggleChannel(ch.key)}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 8,
                  paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
                  backgroundColor: selected ? colors.primary[500] + "20" : tc.dark.elevated,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary[500] + "50" : tc.glass.border,
                  ...(isWeb ? { cursor: "pointer" } as any : {}),
                }}
              >
                <Ionicons name={selected ? "checkmark-circle" : (ch.icon as any)} size={16} color={selected ? colors.primary[500] : tc.textMuted} />
                <Text style={{
                  color: selected ? colors.primary[400] : tc.textSecondary,
                  fontSize: 13, fontFamily: "DMSans_600SemiBold",
                }}>
                  {ch.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Error */}
        {error ? (
          <View style={{ backgroundColor: "#EF4444" + "15", borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: "#EF4444" + "30" }}>
            <Text style={{ color: "#EF4444", fontSize: 13, fontFamily: "DMSans_500Medium" }}>{error}</Text>
          </View>
        ) : null}

        {/* Send Button */}
        <Pressable
          onPress={handleSend}
          disabled={sending}
          style={({ pressed }: any) => ({
            backgroundColor: sending ? tc.textMuted : colors.primary[500],
            paddingVertical: 16, borderRadius: 14, alignItems: "center",
            flexDirection: "row", justifyContent: "center", gap: 8,
            opacity: pressed ? 0.9 : 1,
            maxWidth: isDesktop ? 400 : undefined,
            ...(isWeb ? { cursor: sending ? "not-allowed" : "pointer", transition: "all 0.15s ease" } as any : {}),
          })}
        >
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="send" size={18} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 16, fontFamily: "DMSans_700Bold" }}>
                Send to All Users
              </Text>
            </>
          )}
        </Pressable>

        <Text style={{ color: tc.textMuted, fontSize: 12, fontFamily: "DMSans_400Regular", textAlign: "center", marginTop: 12 }}>
          This will send to all active users. Make sure the message is correct.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
