import { useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
  useWindowDimensions,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, shadows } from "../../src/constants/theme";

const isWeb = Platform.OS === "web";

// ── FAQ Data ──────────────────────────────────────────────────────────────────

interface FAQItem {
  question: string;
  answer: string;
}

const FAQ_DATA: FAQItem[] = [
  {
    question: "How do I deposit crypto?",
    answer:
      "Go to the Wallet tab, tap Receive on the currency you want to deposit, and copy the wallet address shown. Send crypto from any external wallet or exchange to that address. Your balance will update once the network confirms the transaction.",
  },
  {
    question: "How long do deposits take?",
    answer:
      "Deposit times depend on the blockchain network:\n\n• Tron (USDT-TRC20): ~19 confirmations, typically 1\u20132 minutes\n• Ethereum (ETH/USDT-ERC20): ~12 confirmations, typically 2\u20133 minutes\n• Bitcoin (BTC): ~3 confirmations, typically 30 minutes\n• Solana (SOL): ~32 confirmations, typically 15 seconds",
  },
  {
    question: "How do I pay a bill?",
    answer:
      "Go to the Pay tab, enter the Paybill or Till number for the merchant, enter the amount you wish to pay, and confirm the transaction with your PIN. You\u2019ll receive a confirmation once the payment is processed.",
  },
  {
    question: "What fees are charged?",
    answer:
      "CryptoPay charges a 1.5% spread on crypto-to-KES conversions plus a flat fee of KSh 10 per transaction. There are no hidden fees\u2014what you see on the confirmation screen is what you pay.",
  },
  {
    question: "How do I verify my identity?",
    answer:
      "Go to Settings > Identity Verification, then follow the prompts to upload a valid government-issued ID document (national ID, passport, or driving licence). Verification is typically completed within a few minutes.",
  },
  {
    question: "Is my crypto safe?",
    answer:
      "Yes. CryptoPay secures your account with a transaction PIN, optional biometric authentication (fingerprint or Face ID), and encrypted local storage. Your private keys are never stored on our servers.",
  },
  {
    question: "What currencies are supported?",
    answer:
      "CryptoPay currently supports:\n\n• USDT (Tether)\n• BTC (Bitcoin)\n• ETH (Ethereum)\n• SOL (Solana)\n\nMore currencies will be added in future updates.",
  },
  {
    question: "How do I contact support?",
    answer:
      "You can reach our support team via email at support@cryptopay.co.ke. We typically respond within 24 hours on business days. You can also reach us on WhatsApp at +254700000000 or on Twitter/X @CryptoPayKE.",
  },
];

// ── Accordion Item ────────────────────────────────────────────────────────────

function AccordionItem({
  item,
  isExpanded,
  onToggle,
  isDesktop,
}: {
  item: FAQItem;
  isExpanded: boolean;
  onToggle: () => void;
  isDesktop: boolean;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed, hovered }: any) => ({
        paddingHorizontal: isDesktop ? 20 : 16,
        paddingVertical: isDesktop ? 16 : 14,
        backgroundColor: hovered ? "rgba(255,255,255,0.03)" : "transparent",
        opacity: pressed ? 0.85 : 1,
        ...(isWeb
          ? ({ cursor: "pointer", transition: "background-color 0.15s ease" } as any)
          : {}),
      })}
      accessibilityRole="button"
      accessibilityLabel={item.question}
      accessibilityState={{ expanded: isExpanded }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text
          style={{
            color: colors.textPrimary,
            fontSize: 15,
            fontWeight: "600",
            flex: 1,
            paddingRight: 12,
          }}
        >
          {item.question}
        </Text>
        <Ionicons
          name={isExpanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.textMuted}
        />
      </View>
      {isExpanded && (
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: 14,
            lineHeight: 22,
            marginTop: 10,
          }}
        >
          {item.answer}
        </Text>
      )}
    </Pressable>
  );
}

// ── Contact Card ──────────────────────────────────────────────────────────────

function ContactCard({
  icon,
  iconColor,
  iconBg,
  label,
  value,
  onPress,
  isDesktop,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  label: string;
  value: string;
  onPress: () => void;
  isDesktop: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => ({
        backgroundColor: hovered
          ? "rgba(255,255,255,0.04)"
          : colors.dark.card,
        borderRadius: 16,
        padding: isDesktop ? 18 : 16,
        borderWidth: 1,
        borderColor: colors.glass.border,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        opacity: pressed ? 0.85 : 1,
        ...shadows.sm,
        ...(isWeb
          ? ({ cursor: "pointer", transition: "background-color 0.15s ease" } as any)
          : {}),
      })}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 13,
          backgroundColor: iconBg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={20} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: 12,
            fontWeight: "500",
          }}
        >
          {label}
        </Text>
        <Text
          style={{
            color: colors.textPrimary,
            fontSize: 15,
            fontWeight: "600",
            marginTop: 2,
          }}
        >
          {value}
        </Text>
      </View>
      <Ionicons name="open-outline" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function HelpScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;

  const [searchQuery, setSearchQuery] = useState("");
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const filteredFAQ = useMemo(() => {
    if (!searchQuery.trim()) return FAQ_DATA;
    const q = searchQuery.toLowerCase();
    return FAQ_DATA.filter(
      (item) =>
        item.question.toLowerCase().includes(q) ||
        item.answer.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const handleToggle = (index: number) => {
    setExpandedIndex((prev) => (prev === index ? null : index));
  };

  const handleEmail = () => {
    Linking.openURL("mailto:support@cryptopay.co.ke");
  };

  const handleWhatsApp = () => {
    Linking.openURL("https://wa.me/254700000000");
  };

  const handleTwitter = () => {
    Linking.openURL("https://x.com/CryptoPayKE");
  };

  const contentMaxW = isDesktop ? 860 : undefined;
  const isLargeDesktop = isWeb && width >= 1100;

  const content = (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: isDesktop ? 32 : 16,
        paddingTop: isDesktop ? 0 : 4,
        paddingBottom: 40,
        ...(contentMaxW
          ? {
              maxWidth: contentMaxW,
              alignSelf: "center" as const,
              width: "100%" as const,
            }
          : {}),
      }}
    >
      {/* Title (mobile only) */}
      {!isDesktop && (
        <View style={{ marginBottom: 16, marginTop: 4 }}>
          <Text
            style={{
              color: colors.textPrimary,
              fontSize: 24,
              fontWeight: "700",
              letterSpacing: -0.3,
            }}
          >
            Help & Support
          </Text>
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 14,
              marginTop: 4,
              lineHeight: 20,
            }}
          >
            Find answers or get in touch with our team
          </Text>
        </View>
      )}

      {/* Search Bar */}
      <View
        style={{
          backgroundColor: colors.dark.card,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.glass.border,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 14,
          marginBottom: 24,
          ...shadows.sm,
        }}
      >
        <Ionicons name="search-outline" size={20} color={colors.textMuted} />
        <TextInput
          value={searchQuery}
          onChangeText={(text) => {
            setSearchQuery(text);
            setExpandedIndex(null);
          }}
          placeholder="Search FAQs..."
          placeholderTextColor={colors.textMuted}
          style={{
            flex: 1,
            color: colors.textPrimary,
            fontSize: 15,
            paddingVertical: 14,
            paddingHorizontal: 10,
            ...(isWeb ? ({ outlineStyle: "none" } as any) : {}),
          }}
          accessibilityLabel="Search frequently asked questions"
        />
        {searchQuery.length > 0 && (
          <Pressable
            onPress={() => {
              setSearchQuery("");
              setExpandedIndex(null);
            }}
            style={({ pressed }) => ({
              opacity: pressed ? 0.6 : 1,
              padding: 4,
              ...(isWeb ? ({ cursor: "pointer" } as any) : {}),
            })}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Ionicons
              name="close-circle"
              size={20}
              color={colors.textMuted}
            />
          </Pressable>
        )}
      </View>

      {/* FAQ + Contact Sections */}
      <View
        style={{
          ...(isLargeDesktop
            ? { flexDirection: "row" as const, gap: 24 }
            : {}),
        }}
      >
        {/* FAQ Section */}
        <View style={{ marginBottom: 28, ...(isLargeDesktop ? { flex: 6 } : {}) }}>
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 12,
              fontWeight: "600",
              letterSpacing: 0.8,
              textTransform: "uppercase",
              paddingHorizontal: 4,
              marginBottom: 10,
            }}
          >
            Frequently Asked Questions
          </Text>
          <View
            style={{
              backgroundColor: colors.dark.card,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: colors.glass.border,
              overflow: "hidden",
              ...shadows.sm,
            }}
          >
            {filteredFAQ.length === 0 ? (
              <View
                style={{
                  paddingVertical: 32,
                  alignItems: "center",
                }}
              >
                <Ionicons
                  name="search-outline"
                  size={32}
                  color={colors.textMuted}
                />
                <Text
                  style={{
                    color: colors.textMuted,
                    fontSize: 14,
                    marginTop: 10,
                  }}
                >
                  No results found for "{searchQuery}"
                </Text>
              </View>
            ) : (
              filteredFAQ.map((item, index) => {
                // Use original index to keep expanded state consistent during filtering
                const originalIndex = FAQ_DATA.indexOf(item);
                return (
                  <View key={item.question}>
                    {index > 0 && (
                      <View
                        style={{
                          height: 1,
                          backgroundColor: colors.glass.border,
                          marginLeft: isDesktop ? 20 : 16,
                        }}
                      />
                    )}
                    <AccordionItem
                      item={item}
                      isExpanded={expandedIndex === originalIndex}
                      onToggle={() => handleToggle(originalIndex)}
                      isDesktop={isDesktop}
                    />
                  </View>
                );
              })
            )}
          </View>
        </View>

        {/* Contact Section */}
        <View style={{ marginBottom: 28, ...(isLargeDesktop ? { flex: 4 } : {}) }}>
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 12,
              fontWeight: "600",
              letterSpacing: 0.8,
              textTransform: "uppercase",
              paddingHorizontal: 4,
              marginBottom: 10,
            }}
          >
            Contact Us
          </Text>
          <View style={{ gap: 10 }}>
            <ContactCard
              icon="mail-outline"
              iconColor={colors.primary[400]}
              iconBg={colors.primary[500] + "18"}
              label="Email"
              value="support@cryptopay.co.ke"
              onPress={handleEmail}
              isDesktop={isDesktop}
            />
            <ContactCard
              icon="logo-whatsapp"
              iconColor="#25D366"
              iconBg="rgba(37,211,102,0.15)"
              label="WhatsApp"
              value="+254700000000"
              onPress={handleWhatsApp}
              isDesktop={isDesktop}
            />
            <ContactCard
              icon="logo-twitter"
              iconColor="#1DA1F2"
              iconBg="rgba(29,161,242,0.15)"
              label="Twitter / X"
              value="@CryptoPayKE"
              onPress={handleTwitter}
              isDesktop={isDesktop}
            />
          </View>
        </View>
      </View>

      {/* App Version */}
      <View style={{ alignItems: "center", marginTop: 8 }}>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: 13,
            fontWeight: "500",
          }}
        >
          CryptoPay v1.0.0
        </Text>
      </View>
    </ScrollView>
  );

  // Desktop layout
  if (isDesktop) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.dark.bg }}>
        {/* Back button header */}
        <View style={{ paddingHorizontal: 24, paddingTop: 24 }}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: pressed ? colors.dark.elevated : "transparent",
              alignSelf: "flex-start",
              opacity: pressed ? 0.9 : 1,
              ...(isWeb
                ? ({ cursor: "pointer", transition: "background-color 0.15s ease" } as any)
                : {}),
            })}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons
              name="arrow-back"
              size={20}
              color={colors.textSecondary}
            />
            <Text
              style={{
                color: colors.textSecondary,
                fontSize: 15,
                fontWeight: "500",
              }}
            >
              Back
            </Text>
          </Pressable>
        </View>

        {/* Title */}
        <View
          style={{
            paddingHorizontal: 24,
            paddingTop: 16,
            paddingBottom: 8,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: colors.textPrimary,
              fontSize: 28,
              fontWeight: "700",
              letterSpacing: -0.5,
            }}
          >
            Help & Support
          </Text>
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 15,
              marginTop: 6,
            }}
          >
            Find answers or get in touch with our team
          </Text>
        </View>

        {content}
      </View>
    );
  }

  // Mobile layout
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.dark.bg }}>
      {/* Back button header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 6,
            paddingHorizontal: 8,
            borderRadius: 10,
            backgroundColor: pressed ? colors.dark.elevated : "transparent",
            opacity: pressed ? 0.9 : 1,
          })}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons
            name="arrow-back"
            size={20}
            color={colors.textSecondary}
          />
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: 15,
              fontWeight: "500",
            }}
          >
            Back
          </Text>
        </Pressable>
      </View>

      {content}
    </SafeAreaView>
  );
}
