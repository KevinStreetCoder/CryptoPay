import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  Modal,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useNavigation } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "react-native-qrcode-svg";
import { useWallets } from "../../src/hooks/useWallets";
import { useTransactions, useActivity } from "../../src/hooks/useTransactions";
import { TransactionItem } from "../../src/components/TransactionItem";
import { WalletCardSkeleton, TransactionSkeleton } from "../../src/components/Skeleton";
import { useToast } from "../../src/components/Toast";
import { ratesApi, Rate, normalizeRate } from "../../src/api/rates";
import { walletsApi } from "../../src/api/wallets";
import { CURRENCIES, CurrencyCode, colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { useDisplayCurrency } from "../../src/stores/displayCurrency";
import { getTxKesAmount, getTxRecipient, paymentsApi } from "../../src/api/payments";
import { usePhonePrivacy } from "../../src/utils/privacy";
import { useBalanceVisibility } from "../../src/stores/balance";
import { SectionHeader } from "../../src/components/SectionHeader";
import { CryptoLogo } from "../../src/components/CryptoLogo";
import { DepositTracker, usePendingDeposits } from "../../src/components/DepositTracker";
import { DepositStatusModal } from "../../src/components/DepositStatusModal";
import { BlockchainDeposit } from "../../src/api/wallets";
import { useLocale } from "../../src/hooks/useLocale";
import { Spinner } from "../../src/components/brand/Spinner";
import { TxStatusIcon, type TxStatusKind, EmptyNoTransactions } from "../../src/components/brand/PolishAssets";
import { QrFrame } from "../../src/components/brand/QrFrame";
const SUPPORTED_CRYPTOS: CurrencyCode[] = ["USDC", "USDT", "BTC", "SOL", "ETH"];

function useRates() {
  return useQuery<Rate[]>({
    queryKey: ["rates"],
    queryFn: async () => {
      const currencies = ["USDC", "USDT", "BTC", "SOL", "ETH"];
      const results = await Promise.all(
        currencies.map(async (c) => {
          try {
            const { data } = await ratesApi.getRate(c);
            return normalizeRate(data);
          } catch {
            return null;
          }
        })
      );
      return results.filter(Boolean) as Rate[];
    },
    refetchInterval: 15000,
    staleTime: 0,
  });
}

// Type config for desktop transaction table
function getTxTypeConfig(tc: ReturnType<typeof getThemeColors>) {
  return {
    PAYBILL_PAYMENT: { icon: "receipt-outline", label: "Pay Bill", color: colors.primary[400] },
    TILL_PAYMENT: { icon: "cart-outline", label: "Buy Goods", color: colors.info },
    DEPOSIT: { icon: "arrow-down-circle-outline", label: "Deposit", color: colors.success },
    WITHDRAWAL: { icon: "arrow-up-circle-outline", label: "Withdraw", color: colors.warning },
    SEND_MPESA: { icon: "phone-portrait-outline", label: "Send M-Pesa", color: colors.accent },
    BUY: { icon: "swap-horizontal-outline", label: "Buy", color: colors.primary[400] },
    SELL: { icon: "swap-vertical-outline", label: "Sell", color: colors.accentDark },
    SWAP: { icon: "swap-horizontal-outline", label: "Swap", color: colors.crypto.ETH },
    FEE: { icon: "pricetag-outline", label: "Fee", color: tc.dark.muted },
  } as Record<string, { icon: string; label: string; color: string }>;
}

function getTxStatusConfig(tc: ReturnType<typeof getThemeColors>) {
  return {
    completed: { color: colors.success, bg: colors.success + "1F" },
    pending: { color: colors.warning, bg: colors.warning + "1F" },
    processing: { color: colors.info, bg: colors.info + "1F" },
    failed: { color: colors.error, bg: colors.error + "1F" },
    reversed: { color: tc.dark.muted, bg: tc.dark.muted + "1F" },
  } as Record<string, { color: string; bg: string }>;
}

// ── Animated Asset Card Wrapper ──
function AnimatedAssetCard({
  children,
  index,
  isDesktop,
}: {
  children: React.ReactNode;
  index: number;
  isDesktop: boolean;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;
  const isWeb = Platform.OS === "web";
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        delay: index * 100,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 400,
        delay: index * 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, translateY, index]);

  const hoverStyle =
    isWeb && isDesktop
      ? {
          transition: "box-shadow 0.2s ease, transform 0.2s ease",
          ...(hovered
            ? { boxShadow: "0 8px 32px rgba(16, 185, 129, 0.12)", transform: "translateY(-2px)" }
            : {}),
        }
      : {};

  return (
    <Animated.View
      style={[{ opacity: fadeAnim, transform: [{ translateY }] }, hoverStyle as any]}
      {...(isWeb
        ? {
            onMouseEnter: () => setHovered(true),
            onMouseLeave: () => setHovered(false),
          }
        : {})}
    >
      {children}
    </Animated.View>
  );
}

export default function WalletScreen() {
  const router = useRouter();
  const { t } = useLocale();
  const { width } = useWindowDimensions();
  const bottomTabBarHeight = useBottomTabBarHeight();
  const isWeb = Platform.OS === "web";
  const isDesktop = isWeb && width >= 900;
  const isLargeDesktop = isWeb && width >= 1200;
  const isXLDesktop = isWeb && width >= 1500;
  const hPad = isLargeDesktop ? 48 : isDesktop ? 32 : 16;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const { formatPhone } = usePhonePrivacy();
  const { data: wallets, isLoading: walletsLoading, refetch: refetchWallets } = useWallets();
  const { data: txData, isLoading: txLoading, refetch: refetchTx } = useActivity();
  const { data: rates } = useRates();
  const [refreshing, setRefreshing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [depositModal, setDepositModal] = useState<{
    address: string;
    currency: string;
  } | null>(null);
  const [hoverReceive, setHoverReceive] = useState(false);
  const [hoverSend, setHoverSend] = useState(false);
  const [hoverClose, setHoverClose] = useState(false);
  const [generatingAddress, setGeneratingAddress] = useState<string | null>(null);
  const [showSendPicker, setShowSendPicker] = useState(false);
  const { balanceHidden, toggleBalance, formatAmount, formatCrypto } = useBalanceVisibility();
  const { code: displayCode, symbol: displaySymbol, formatKes } = useDisplayCurrency();
  const [modalCurrency, setModalCurrency] = useState<CurrencyCode>("USDT");
  const [depositStatusModal, setDepositStatusModal] = useState<BlockchainDeposit | null>(null);
  const { hasPending: hasPendingDeposits } = usePendingDeposits();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);

  const handleExportCSV = useCallback(async () => {
    setExporting(true);
    try {
      // Default to last 30 days
      const dateTo = new Date();
      const dateFrom = new Date();
      dateFrom.setDate(dateFrom.getDate() - 30);
      const params = {
        date_from: dateFrom.toISOString().split("T")[0],
        date_to: dateTo.toISOString().split("T")[0],
      };

      const { data } = await paymentsApi.exportTransactions(params);

      if (Platform.OS === "web") {
        // Web: trigger browser download via blob URL
        const blob = new Blob([data], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "cryptopay_transactions.csv";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("Exported", "CSV file downloaded");
      } else {
        // Native: write CSV to cache dir and share as file attachment
        const { Share } = require("react-native");
        const { cacheDirectory, writeAsStringAsync, EncodingType } = require("expo-file-system");
        const fileName = `cryptopay_transactions_${new Date().toISOString().split("T")[0]}.csv`;
        const filePath = `${cacheDirectory}${fileName}`;
        await writeAsStringAsync(filePath, data, { encoding: EncodingType.UTF8 });
        await Share.share({ url: filePath, title: "Cpay Transactions" });
        toast.success("Exported", "CSV file ready to share");
      }
    } catch {
      toast.error("Export Failed", "Could not export transactions. Please try again.");
    } finally {
      setExporting(false);
    }
  }, [toast]);

  // Modal slide-up animation
  const modalSlide = useRef(new Animated.Value(400)).current;
  const modalOpacity = useRef(new Animated.Value(0)).current;

  // Animate modal in/out
  useEffect(() => {
    if (depositModal) {
      modalSlide.setValue(400);
      modalOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(modalSlide, {
          toValue: 0,
          tension: 65,
          friction: 11,
          useNativeDriver: true,
        }),
        Animated.timing(modalOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [depositModal, modalSlide, modalOpacity]);

  const closeModalAnimated = useCallback(
    (callback?: () => void) => {
      Animated.parallel([
        Animated.timing(modalSlide, {
          toValue: 400,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(modalOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setDepositModal(null);
        callback?.();
      });
    },
    [modalSlide, modalOpacity]
  );

  const handleReceive = useCallback(
    async (wallet: { id: string; deposit_address: string | null; currency: string }) => {
      if (wallet.deposit_address) {
        setModalCurrency(wallet.currency as CurrencyCode);
        setDepositModal({ address: wallet.deposit_address, currency: wallet.currency });
        return;
      }
      // Generate address on demand
      setGeneratingAddress(wallet.id);
      try {
        const { data } = await walletsApi.generateAddress(wallet.id);
        queryClient.invalidateQueries({ queryKey: ["wallets"] });
        if (data.deposit_address) {
          setModalCurrency(data.currency as CurrencyCode);
          setDepositModal({ address: data.deposit_address, currency: data.currency });
        }
      } catch {
        toast.error("Address Error", "Failed to generate deposit address. Please try again.");
      } finally {
        setGeneratingAddress(null);
      }
    },
    [queryClient, toast]
  );

  // Open receive modal without specific wallet (shows wallet switcher)
  const handleReceiveGeneric = useCallback(() => {
    const safeW = Array.isArray(wallets) ? wallets : [];
    const firstCrypto = safeW.find(
      (w) => SUPPORTED_CRYPTOS.includes(w.currency as CurrencyCode) && w.deposit_address
    );
    if (firstCrypto && firstCrypto.deposit_address) {
      setModalCurrency(firstCrypto.currency as CurrencyCode);
      setDepositModal({ address: firstCrypto.deposit_address, currency: firstCrypto.currency });
    } else if (safeW.length > 0) {
      const first = safeW.find((w) => SUPPORTED_CRYPTOS.includes(w.currency as CurrencyCode));
      if (first) handleReceive(first);
    }
  }, [wallets, handleReceive]);

  // Switch currency in modal
  const switchModalCurrency = useCallback(
    (currency: CurrencyCode) => {
      const safeW = Array.isArray(wallets) ? wallets : [];
      const wallet = safeW.find((w) => w.currency === currency);
      if (wallet) {
        setModalCurrency(currency);
        if (wallet.deposit_address) {
          setDepositModal({ address: wallet.deposit_address, currency: wallet.currency });
        } else {
          handleReceive(wallet);
        }
      }
    },
    [wallets, handleReceive]
  );

  // Refetch wallet balances when this tab gains focus (e.g., after payment)
  const navigation = useNavigation();
  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      refetchWallets();
      refetchTx();
    });
    return unsubscribe;
  }, [navigation, refetchWallets, refetchTx]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchWallets(), refetchTx()]);
    setRefreshing(false);
  };

  const copyAddress = async (address: string, id: string) => {
    await Clipboard.setStringAsync(address);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    setTimeout(() => {
      Clipboard.setStringAsync("").catch(() => {});
    }, 30000);
  };

  const safeWallets = Array.isArray(wallets) ? wallets : [];
  const cryptoWallets = safeWallets.filter((w) => w.currency !== "KES");
  const transactions = txData?.results || [];

  // Use kes_value from backend wallet API (includes spread) · matches BalanceCard
  const totalKES = cryptoWallets.reduce((sum, w) => {
    const kesVal = (w as any).kes_value ? parseFloat((w as any).kes_value) : 0;
    if (kesVal > 0) return sum + kesVal;
    // Fallback to rate calculation if kes_value not available
    const balance = parseFloat(w.balance) || 0;
    const rate = rates?.find((r) => r.currency === w.currency);
    const kesRate = rate ? parseFloat(rate.kes_rate) || 0 : 0;
    return sum + balance * kesRate;
  }, 0);

  const kesWallet = safeWallets.find((w) => w.currency === "KES");
  const kesBalance = kesWallet ? parseFloat(kesWallet.balance) || 0 : 0;
  const grandTotal = totalKES + kesBalance;

  const getCurrencyColor = (currency: string) =>
    tc.crypto[currency] || colors.primary[400];

  // ── Currency Tabs for Modal ──
  const renderCurrencyTabs = (isDesktopDialog: boolean) => {
    return (
      <View
        style={{
          flexDirection: "row",
          alignSelf: "center",
          backgroundColor: tc.dark.bg,
          borderRadius: 14,
          padding: 4,
          marginBottom: isDesktopDialog ? 20 : 24,
          borderWidth: 1,
          borderColor: tc.glass.border,
        }}
      >
        {SUPPORTED_CRYPTOS.map((c) => {
          const isActive = modalCurrency === c;
          const cColor = getCurrencyColor(c);
          return (
            <Pressable
              key={c}
              onPress={() => switchModalCurrency(c)}
              style={{
                paddingHorizontal: isDesktopDialog ? 16 : 14,
                paddingVertical: 8,
                borderRadius: 10,
                backgroundColor: isActive ? cColor + "25" : "transparent",
                borderWidth: isActive ? 1 : 0,
                borderColor: isActive ? cColor + "40" : "transparent",
              }}
            >
              <Text
                style={{
                  color: isActive ? cColor : tc.textMuted,
                  fontSize: 13,
                  fontFamily: isActive ? "DMSans_700Bold" : "DMSans_500Medium",
                }}
              >
                {c}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  };

  // ── Desktop Deposit Dialog ──
  const renderDesktopDepositDialog = () => {
    if (!depositModal) return null;
    const activeCurrency = modalCurrency;
    const cColor = getCurrencyColor(activeCurrency);

    return (
      <View
        style={{
          position: "fixed" as any,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.6)",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}
      >
        <Pressable
          onPress={() => closeModalAnimated()}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        />
        <Animated.View
          style={{
            backgroundColor: tc.dark.card,
            borderRadius: 24,
            width: "100%",
            maxWidth: 480,
            padding: 36,
            borderWidth: 1,
            borderColor: tc.glass.borderStrong,
            overflow: "hidden",
            opacity: modalOpacity,
            transform: [{ translateY: modalSlide }],
            ...ts.lg,
          }}
        >
          {/* Glass highlight at top */}
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 120,
              backgroundColor: tc.glass.highlight,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
            }}
          />

          {/* Close button */}
          <Pressable
            onPress={() => closeModalAnimated()}
            onHoverIn={() => setHoverClose(true)}
            onHoverOut={() => setHoverClose(false)}
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: hoverClose ? tc.dark.elevated : "transparent",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1,
            }}
          >
            <Ionicons name="close" size={20} color={tc.textSecondary} />
          </Pressable>

          <Text
            style={{
              color: "#FFFFFF",
              fontSize: 24,
              fontFamily: "DMSans_700Bold",
              textAlign: "center",
              marginBottom: 6,
            }}
          >
            Receive Crypto
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 14,
              fontFamily: "DMSans_400Regular",
              textAlign: "center",
              marginBottom: 20,
            }}
          >
            Select a wallet and scan or copy the address
          </Text>

          {/* Currency Tabs */}
          {renderCurrencyTabs(true)}

          {/* QR Code in brand QrFrame (emerald corners + Cpay stamp) */}
          <View style={{ alignSelf: "center", marginBottom: 24 }}>
            <QrFrame size={200}>
              <QRCode
                value={depositModal.address || "empty"}
                size={200}
                backgroundColor="#FFFFFF"
                color="#060E1F"
              />
            </QrFrame>
          </View>

          {/* Deposit Address Display */}
          <View
            style={{
              backgroundColor: tc.dark.bg,
              borderRadius: 16,
              padding: 20,
              alignSelf: "center",
              marginBottom: 24,
              width: "100%",
              maxWidth: 400,
              borderWidth: 1,
              borderColor: tc.glass.border,
            }}
          >
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 11,
                fontFamily: "DMSans_600SemiBold",
                textTransform: "uppercase",
                letterSpacing: 1,
                textAlign: "center",
                marginBottom: 12,
              }}
            >
              {activeCurrency} Deposit Address
            </Text>
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 13,
                fontFamily: Platform.OS === "web" ? "monospace" : "Courier",
                textAlign: "center",
                lineHeight: 22,
                letterSpacing: 0.5,
              }}
              selectable
            >
              {depositModal.address}
            </Text>
          </View>

          {/* Copy Address Button */}
          <Pressable
            onPress={() => {
              if (depositModal.address) {
                Clipboard.setStringAsync(depositModal.address);
                if (Platform.OS !== "web") {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
                setCopiedId("desktop-deposit");
                setTimeout(() => setCopiedId(null), 2000);
                setTimeout(() => {
                  Clipboard.setStringAsync("").catch(() => {});
                }, 30000);
              }
            }}
            accessibilityRole="button"
            accessibilityLabel="Copy deposit address"
            accessibilityHint="Copies the address to clipboard. It will be cleared after 30 seconds."
            style={({ pressed }) => ({
              backgroundColor: copiedId === "desktop-deposit" ? colors.success : cColor,
              borderRadius: 14,
              paddingVertical: 14,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity: pressed ? 0.85 : 1,
              ...(isWeb
                ? ({ transition: "background-color 0.2s ease" } as any)
                : {}),
            })}
          >
            <Ionicons
              name={copiedId === "desktop-deposit" ? "checkmark-circle" : "copy-outline"}
              size={18}
              color="#FFFFFF"
            />
            <Text
              style={{
                color: "#FFFFFF",
                fontSize: 15,
                fontFamily: "DMSans_600SemiBold",
              }}
            >
              {copiedId === "desktop-deposit" ? t("wallet.copied") : t("wallet.copyAddress")}
            </Text>
          </Pressable>

          {/* Warning */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              backgroundColor: colors.warning + "10",
              borderRadius: 14,
              padding: 14,
              marginTop: 16,
              gap: 10,
              borderWidth: 1,
              borderColor: colors.warning + "18",
            }}
          >
            <Ionicons name="warning" size={18} color={colors.warning} style={{ marginTop: 1 }} />
            <Text
              style={{
                color: colors.warning,
                fontSize: 12,
                fontFamily: "DMSans_400Regular",
                flex: 1,
                lineHeight: 18,
              }}
            >
              Only send {activeCurrency} to this address. Sending other tokens may result in
              permanent loss.
            </Text>
          </View>
        </Animated.View>
      </View>
    );
  };

  // ── Send Payment Picker ──
  const SEND_OPTIONS = [
    {
      id: "send",
      icon: "send-outline" as const,
      label: t("home.sendMoney"),
      subtitle: "Send money to a phone number",
      route: "/payment/send" as const,
      color: colors.primary[400],
    },
    {
      id: "paybill",
      icon: "receipt-outline" as const,
      label: t("payment.payBill"),
      subtitle: "Pay a business via Paybill number",
      route: "/payment/paybill" as const,
      color: "#F59E0B",
    },
    {
      id: "till",
      icon: "cart-outline" as const,
      label: t("payment.payTill"),
      subtitle: "Pay a merchant via Till number",
      route: "/payment/till" as const,
      color: "#8B5CF6",
    },
    {
      id: "withdraw",
      icon: "arrow-up-circle-outline" as const,
      label: "Withdraw Crypto",
      subtitle: "Send crypto to external wallet",
      route: "/payment/withdraw" as const,
      color: "#EF4444",
    },
  ];

  const renderSendPicker = () => (
    <Modal
      visible={showSendPicker}
      animationType="fade"
      transparent
      onRequestClose={() => setShowSendPicker(false)}
    >
      <Pressable
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.6)",
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
        }}
        onPress={() => setShowSendPicker(false)}
      >
        <Pressable
          style={{
            backgroundColor: tc.dark.card,
            borderRadius: 24,
            padding: 24,
            width: "100%",
            maxWidth: 380,
            borderWidth: 1,
            borderColor: tc.glass.border,
            ...ts.lg,
          }}
          onPress={(e) => e.stopPropagation()}
        >
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 20,
              fontFamily: "DMSans_700Bold",
              marginBottom: 4,
            }}
          >
            {t("wallet.send")}
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 13,
              fontFamily: "DMSans_400Regular",
              marginBottom: 20,
            }}
          >
            Choose how you want to pay
          </Text>

          <View style={{ gap: 10 }}>
            {SEND_OPTIONS.map((opt) => (
              <Pressable
                key={opt.id}
                onPress={() => {
                  setShowSendPicker(false);
                  router.push(opt.route);
                }}
                style={({ pressed, hovered }: any) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 14,
                  padding: 16,
                  borderRadius: 16,
                  backgroundColor: hovered
                    ? tc.glass.highlight
                    : pressed
                      ? tc.dark.elevated
                      : tc.dark.bg,
                  borderWidth: 1,
                  borderColor: tc.glass.border,
                  ...(isWeb ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
                })}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    backgroundColor: opt.color + "15",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name={opt.icon} size={22} color={opt.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 15,
                      fontFamily: "DMSans_600SemiBold",
                    }}
                  >
                    {opt.label}
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 12,
                      fontFamily: "DMSans_400Regular",
                      marginTop: 2,
                    }}
                  >
                    {opt.subtitle}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={tc.textMuted} />
              </Pressable>
            ))}
          </View>

          <Pressable
            onPress={() => setShowSendPicker(false)}
            style={({ pressed }) => ({
              marginTop: 16,
              paddingVertical: 14,
              borderRadius: 14,
              backgroundColor: pressed ? tc.dark.elevated : tc.dark.bg,
              borderWidth: 1,
              borderColor: tc.glass.border,
              alignItems: "center",
            })}
          >
            <Text
              style={{
                color: tc.textSecondary,
                fontSize: 14,
                fontFamily: "DMSans_500Medium",
              }}
            >
              {t("common.cancel")}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );

  // ── Mobile Deposit Modal (bottom sheet with spring animation) ──
  const renderMobileDepositModal = () => (
    <Modal
      visible={!!depositModal}
      animationType="none"
      transparent
      onRequestClose={() => closeModalAnimated()}
    >
      <Animated.View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.7)",
          justifyContent: "flex-end",
          opacity: modalOpacity,
        }}
      >
        <Pressable
          onPress={() => closeModalAnimated()}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        />
        <Animated.View
          style={{
            backgroundColor: tc.dark.card,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingHorizontal: 24,
            paddingTop: 12,
            paddingBottom: 44,
            borderWidth: 1,
            borderBottomWidth: 0,
            borderColor: tc.glass.borderStrong,
            overflow: "hidden",
            transform: [{ translateY: modalSlide }],
          }}
        >
          {/* Glass highlight */}
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 100,
              backgroundColor: tc.glass.highlight,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
            }}
          />

          {/* Handle */}
          <View
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: tc.dark.elevated,
              alignSelf: "center",
              marginBottom: 20,
            }}
          />

          <Text
            style={{
              color: "#FFFFFF",
              fontSize: 22,
              fontFamily: "DMSans_700Bold",
              textAlign: "center",
              marginBottom: 6,
            }}
          >
            Receive Crypto
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 14,
              fontFamily: "DMSans_400Regular",
              textAlign: "center",
              marginBottom: 16,
            }}
          >
            Select a wallet and scan or copy the address
          </Text>

          {/* Currency Tabs */}
          {renderCurrencyTabs(false)}

          {/* QR Code in brand QrFrame */}
          <View style={{ alignSelf: "center", marginBottom: 20 }}>
            <QrFrame size={200}>
              <QRCode
                value={depositModal?.address || ""}
                size={200}
                backgroundColor="#FFFFFF"
                color="#060E1F"
              />
            </QrFrame>
          </View>

          {/* Deposit Address Display */}
          <View
            style={{
              backgroundColor: tc.dark.bg,
              borderRadius: 20,
              padding: 20,
              alignSelf: "center",
              marginBottom: 24,
              width: "100%",
              borderWidth: 1,
              borderColor: tc.glass.border,
            }}
          >
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 11,
                fontFamily: "DMSans_600SemiBold",
                textTransform: "uppercase",
                letterSpacing: 1,
                textAlign: "center",
                marginBottom: 14,
              }}
            >
              {modalCurrency} Deposit Address
            </Text>
            <Text
              style={{
                color: tc.textPrimary,
                fontSize: 13,
                fontFamily: Platform.OS === "web" ? "monospace" : "Courier",
                textAlign: "center",
                lineHeight: 22,
                letterSpacing: 0.5,
              }}
              selectable
            >
              {depositModal?.address}
            </Text>
          </View>

          {/* Copy Address Button */}
          <Pressable
            onPress={() => {
              if (depositModal?.address) {
                Clipboard.setStringAsync(depositModal.address);
                if (Platform.OS !== "web") {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
                setCopiedId("mobile-deposit");
                setTimeout(() => setCopiedId(null), 2000);
                setTimeout(() => {
                  Clipboard.setStringAsync("").catch(() => {});
                }, 30000);
              }
            }}
            accessibilityRole="button"
            accessibilityLabel="Copy deposit address"
            accessibilityHint="Copies the address to clipboard. It will be cleared after 30 seconds."
            style={({ pressed }) => ({
              backgroundColor:
                copiedId === "mobile-deposit"
                  ? colors.success
                  : getCurrencyColor(modalCurrency),
              borderRadius: 16,
              paddingVertical: 16,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Ionicons
              name={copiedId === "mobile-deposit" ? "checkmark-circle" : "copy-outline"}
              size={20}
              color="#FFFFFF"
            />
            <Text
              style={{
                color: "#FFFFFF",
                fontSize: 16,
                fontFamily: "DMSans_600SemiBold",
              }}
            >
              {copiedId === "mobile-deposit" ? t("wallet.copied") : t("wallet.copyAddress")}
            </Text>
          </Pressable>

          {/* Warning */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              backgroundColor: colors.warning + "10",
              borderRadius: 14,
              padding: 14,
              marginTop: 16,
              gap: 10,
              borderWidth: 1,
              borderColor: colors.warning + "18",
            }}
          >
            <Ionicons name="warning" size={18} color={colors.warning} style={{ marginTop: 1 }} />
            <Text
              style={{
                color: colors.warning,
                fontSize: 12,
                fontFamily: "DMSans_400Regular",
                flex: 1,
                lineHeight: 18,
              }}
            >
              Only send {modalCurrency} to this address. Sending other tokens may result in
              permanent loss.
            </Text>
          </View>

          {/* Done button */}
          <Pressable
            onPress={() => closeModalAnimated()}
            style={({ pressed }) => ({
              backgroundColor: pressed ? tc.dark.border : tc.dark.elevated,
              borderRadius: 16,
              paddingVertical: 16,
              alignItems: "center",
              marginTop: 20,
              borderWidth: 1,
              borderColor: tc.glass.border,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text
              style={{
                color: "#FFFFFF",
                fontSize: 16,
                fontFamily: "DMSans_600SemiBold",
              }}
            >
              Done
            </Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );

  // ── Eye Toggle Button ──
  const renderEyeToggle = () => (
    <Pressable
      onPress={toggleBalance}
      accessibilityRole="button"
      accessibilityLabel={balanceHidden ? "Show balance" : "Hide balance"}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 12,
        backgroundColor: tc.dark.elevated,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: tc.glass.border,
        opacity: pressed ? 0.7 : 1,
        marginLeft: 12,
      })}
    >
      <Ionicons
        name={balanceHidden ? "eye-off-outline" : "eye-outline"}
        size={18}
        color={tc.textMuted}
      />
    </Pressable>
  );

  // ── Asset Card (shared between mobile and desktop) ──
  const renderAssetCard = (w: (typeof cryptoWallets)[0], index: number) => {
    const info = CURRENCIES[w.currency as CurrencyCode];
    const balance = parseFloat(w.balance);
    const locked = parseFloat(w.locked_balance);
    const rate = rates?.find((r) => r.currency === w.currency);
    const kesValue = rate ? balance * parseFloat(rate.kes_rate) : 0;
    const currencyColor = getCurrencyColor(w.currency);

    return (
      <AnimatedAssetCard key={w.id} index={index} isDesktop={isDesktop}>
        <View
          style={{
            backgroundColor: tc.dark.card,
            borderRadius: 20,
            padding: isDesktop ? 22 : 18,
            borderWidth: 1,
            borderColor: tc.glass.border,
            ...(isDesktop ? ts.md : {}),
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              {/* Currency icon with brand color circle */}
              <View
                style={{
                  width: isDesktop ? 52 : 46,
                  height: isDesktop ? 52 : 46,
                  borderRadius: isDesktop ? 16 : 14,
                  backgroundColor: currencyColor + "1F",
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: 14,
                  borderWidth: 1.5,
                  borderColor: currencyColor + "33",
                }}
              >
                <CryptoLogo
                  currency={w.currency}
                  size={isDesktop ? 32 : 28}
                  fallbackColor={currencyColor}
                />
              </View>
              <View>
                <Text
                  style={{
                    color: tc.textPrimary,
                    fontSize: isDesktop ? 16 : 15,
                    fontFamily: "DMSans_600SemiBold",
                    marginBottom: 2,
                  }}
                >
                  {info?.name || w.currency}
                </Text>
                <Text
                  style={{
                    color: tc.textMuted,
                    fontSize: 12,
                    fontFamily: "DMSans_500Medium",
                  }}
                >
                  {info?.symbol || w.currency}
                </Text>
              </View>
            </View>

            <View style={{ alignItems: "flex-end" }}>
              <Text
                style={{
                  color: tc.textPrimary,
                  fontSize: isDesktop ? 18 : 16,
                  fontFamily: "DMSans_700Bold",
                  marginBottom: 2,
                }}
              >
                {formatCrypto(balance, info?.decimals ?? 4)}
              </Text>
              <Text
                style={{
                  color: tc.textSecondary,
                  fontSize: 13,
                  fontFamily: "DMSans_500Medium",
                }}
              >
                {balanceHidden ? `~${displaySymbol} ****` : `~${formatKes(kesValue, { digits: 0, compact: true })}`}
              </Text>
              {locked > 0 && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: colors.warning + "18",
                    borderRadius: 8,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    gap: 4,
                    marginTop: 4,
                  }}
                >
                  <Ionicons name="lock-closed" size={10} color={colors.warning} />
                  <Text
                    style={{
                      color: colors.warning,
                      fontSize: 11,
                      fontFamily: "DMSans_500Medium",
                    }}
                  >
                    {formatCrypto(locked, info?.decimals ?? 4)} locked
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Deposit Address Row */}
          {w.deposit_address ? (
            <Pressable
              onPress={() => copyAddress(w.deposit_address!, w.id)}
              onLongPress={() => {
                setModalCurrency(w.currency as CurrencyCode);
                setDepositModal({
                  address: w.deposit_address!,
                  currency: w.currency,
                });
              }}
              style={({ pressed }) => ({
                backgroundColor: tc.dark.bg,
                borderRadius: 14,
                paddingHorizontal: 14,
                paddingVertical: 12,
                flexDirection: "row",
                alignItems: "center",
                borderWidth: 1,
                borderColor: pressed ? colors.primary[500] + "40" : tc.glass.border,
              })}
            >
              <Ionicons name="wallet-outline" size={14} color={tc.textMuted} />
              <Text
                style={{
                  color: tc.textMuted,
                  fontSize: 12,
                  fontFamily: "DMSans_400Regular",
                  marginLeft: 8,
                  flex: 1,
                }}
                numberOfLines={1}
              >
                {w.deposit_address}
              </Text>
              <View
                style={{
                  backgroundColor:
                    copiedId === w.id ? colors.success + "20" : colors.primary[500] + "15",
                  borderRadius: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  marginLeft: 8,
                }}
              >
                <Ionicons
                  name={copiedId === w.id ? "checkmark" : "copy-outline"}
                  size={13}
                  color={copiedId === w.id ? colors.success : colors.primary[400]}
                />
                <Text
                  style={{
                    color: copiedId === w.id ? colors.success : colors.primary[400],
                    fontSize: 11,
                    fontFamily: "DMSans_500Medium",
                  }}
                >
                  {copiedId === w.id ? t("wallet.copied") : t("wallet.copyAddress")}
                </Text>
              </View>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => handleReceive(w)}
              disabled={generatingAddress === w.id}
              style={({ pressed }) => ({
                backgroundColor: tc.dark.bg,
                borderRadius: 14,
                paddingHorizontal: 14,
                paddingVertical: 12,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: colors.primary[500] + "30",
                borderStyle: "dashed" as const,
                opacity: pressed ? 0.85 : generatingAddress === w.id ? 0.6 : 1,
                gap: 8,
              })}
            >
              {generatingAddress === w.id ? (
                <Spinner size={16} color={colors.primary[400]} />
              ) : (
                <Ionicons name="add-circle-outline" size={16} color={colors.primary[400]} />
              )}
              <Text
                style={{
                  color: colors.primary[400],
                  fontSize: 13,
                  fontFamily: "DMSans_500Medium",
                }}
              >
                {generatingAddress === w.id ? "Generating address..." : "Generate Deposit Address"}
              </Text>
            </Pressable>
          )}
        </View>
      </AnimatedAssetCard>
    );
  };

  // ── Desktop Transaction Table Row ──
  const renderDesktopTransactionRow = (tx: (typeof transactions)[0], index: number) => {
    const TX_TYPE_CONFIG = getTxTypeConfig(tc);
    const TX_STATUS_CONFIG = getTxStatusConfig(tc);
    const config = TX_TYPE_CONFIG[tx.type] || {
      icon: "ellipsis-horizontal",
      label: tx.type,
      color: tc.dark.muted,
    };
    const statusConfig = TX_STATUS_CONFIG[tx.status] || {
      color: tc.dark.muted,
      bg: tc.dark.muted + "1F",
    };
    const kesAmount = getTxKesAmount(tx);
    const date = new Date(tx.created_at);
    const timeStr = date.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
    const dateStr = date.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
    const rawRecipient = getTxRecipient(tx);
    const recipient = rawRecipient ? formatPhone(rawRecipient) : "";

    return (
      <Pressable
        key={tx.id}
        onPress={() => router.push(`/payment/detail?id=${tx.id}` as any)}
        style={({ pressed, hovered }: any) => ({
          flexDirection: "row" as const,
          alignItems: "center" as const,
          paddingHorizontal: 20,
          paddingVertical: 14,
          borderBottomWidth: index < transactions.length - 1 ? 1 : 0,
          borderBottomColor: tc.glass.border,
          backgroundColor: hovered ? tc.glass.highlight : pressed ? tc.dark.elevated : "transparent",
          ...(isWeb ? { cursor: "pointer", transition: "background-color 0.15s ease" } as any : {}),
        })}
      >
        {/* Type */}
        <View style={{ flexDirection: "row", alignItems: "center", width: "22%", minWidth: 140 }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: config.color + "1A",
              alignItems: "center",
              justifyContent: "center",
              marginRight: 10,
            }}
          >
            <Ionicons name={config.icon as any} size={18} color={config.color} />
          </View>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 14,
              fontFamily: "DMSans_600SemiBold",
            }}
          >
            {config.label}
          </Text>
        </View>

        {/* Details */}
        <View style={{ flex: 1, minWidth: 100 }}>
          <Text
            style={{
              color: tc.textSecondary,
              fontSize: 13,
              fontFamily: "DMSans_400Regular",
            }}
            numberOfLines={1}
          >
            {recipient || "--"}
          </Text>
        </View>

        {/* Amount */}
        <View style={{ width: "18%", minWidth: 120, alignItems: "flex-end" }}>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 14,
              fontFamily: "DMSans_700Bold",
            }}
          >
            {balanceHidden ? `${displaySymbol} ****` : formatKes(kesAmount, { digits: 0, compact: true })}
          </Text>
        </View>

        {/* Status */}
        <View style={{ width: "14%", minWidth: 100, alignItems: "center" }}>
          <View
            style={{
              backgroundColor: statusConfig.bg,
              borderRadius: 10,
              paddingHorizontal: 10,
              paddingVertical: 4,
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
            }}
          >
            {/* Brand TxStatusIcon per design handoff · 4 canonical glyphs
                (pending / processing / confirmed / failed). Map backend
                statuses onto those: `completed` → confirmed, transient
                in-flight (awaiting, processing, confirming) → processing,
                `reversed` → failed. */}
            <TxStatusIcon
              kind={(
                tx.status === "completed"
                  ? "confirmed"
                  : tx.status === "failed" || tx.status === "reversed"
                    ? "failed"
                    : tx.status === "pending"
                      ? "pending"
                      : "processing"
              ) as TxStatusKind}
              size={14}
            />
            <Text
              style={{
                color: statusConfig.color,
                fontSize: 12,
                fontFamily: "DMSans_500Medium",
                textTransform: "capitalize",
              }}
            >
              {tx.status}
            </Text>
          </View>
        </View>

        {/* Date */}
        <View style={{ width: "16%", minWidth: 110, alignItems: "flex-end" }}>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 13,
              fontFamily: "DMSans_400Regular",
            }}
          >
            {dateStr}
          </Text>
          <Text
            style={{
              color: tc.dark.muted,
              fontSize: 11,
              fontFamily: "DMSans_400Regular",
              marginTop: 1,
            }}
          >
            {timeStr}
          </Text>
        </View>
      </Pressable>
    );
  };

  // Desktop content fills available width (no maxWidth constraint)
  const contentStyle = isDesktop
    ? { width: "100%" as const }
    : {};

  // ══════════════════════════════════════════
  //  DESKTOP LAYOUT (width >= 900)
  // ══════════════════════════════════════════
  if (isDesktop) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }} edges={["top", "left", "right"]}>
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary[400]}
              progressBackgroundColor={tc.dark.card}
            />
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: bottomTabBarHeight + 16 }}
        >
          <View style={contentStyle}>
            {/* Top spacing */}
            <View style={{ height: 8 }} />

            {/* ── Portfolio + Actions (single card) ── */}
            <View
              style={{
                paddingHorizontal: hPad,
                marginTop: 8,
                marginBottom: 16,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  backgroundColor: tc.dark.card,
                  borderRadius: 20,
                  padding: 24,
                  borderWidth: 1,
                  borderColor: tc.glass.border,
                  overflow: "hidden",
                  ...ts.sm,
                }}
              >
                {/* Left: Portfolio Value */}
                <View style={{ flex: 6 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      marginBottom: 10,
                    }}
                  >
                    <Text
                      style={{
                        color: tc.textMuted,
                        fontSize: 12,
                        fontFamily: "DMSans_600SemiBold",
                        textTransform: "uppercase",
                        letterSpacing: 1.2,
                      }}
                    >
                      Total Portfolio
                    </Text>
                    {renderEyeToggle()}
                  </View>
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 40,
                      fontFamily: "DMSans_700Bold",
                      letterSpacing: -1,
                      marginBottom: 4,
                    }}
                  >
                    {balanceHidden ? `${displaySymbol} ****` : formatKes(grandTotal, { digits: 2 })}
                  </Text>
                  {kesBalance > 0 && (
                    <Text
                      style={{
                        color: tc.textMuted,
                        fontSize: 13,
                        fontFamily: "DMSans_400Regular",
                        marginBottom: 4,
                      }}
                    >
                      {balanceHidden
                        ? `KES Balance: ${displaySymbol} ****`
                        : `KES Balance: ${formatKes(kesBalance, { digits: 2 })}`}
                    </Text>
                  )}
                  <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6, gap: 6 }}>
                    <View
                      style={{
                        backgroundColor: colors.success + "20",
                        borderRadius: 8,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                      }}
                    >
                      <Text
                        style={{
                          color: colors.success,
                          fontSize: 12,
                          fontFamily: "DMSans_600SemiBold",
                        }}
                      >
                        {cryptoWallets.length} asset{cryptoWallets.length !== 1 ? "s" : ""}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Right: Action Buttons */}
                <View
                  style={{
                    flex: 4,
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
                  {/* Receive Button */}
                  <Pressable
                    onPress={handleReceiveGeneric}
                    disabled={generatingAddress !== null}
                    onHoverIn={() => setHoverReceive(true)}
                    onHoverOut={() => setHoverReceive(false)}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: hoverReceive
                        ? colors.primary[400]
                        : colors.primary[500],
                      borderRadius: 14,
                      height: 48,
                      flex: 1,
                      minWidth: 130,
                      maxWidth: 200,
                      gap: 8,
                      opacity: pressed ? 0.85 : generatingAddress ? 0.7 : 1,
                      transform: [{ scale: pressed ? 0.97 : 1 }],
                      ...ts.glow(colors.primary[500], 0.3),
                    })}
                  >
                    {generatingAddress ? (
                      <Spinner size={16} color="#FFFFFF" />
                    ) : (
                      <View
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 14,
                          backgroundColor: "rgba(255,255,255,0.15)",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name="arrow-down" size={14} color="#FFFFFF" />
                      </View>
                    )}
                    <Text
                      style={{
                        color: "#FFFFFF",
                        fontSize: 14,
                        fontFamily: "DMSans_600SemiBold",
                      }}
                    >
                      {generatingAddress ? t("wallet.generating") : t("wallet.receive")}
                    </Text>
                  </Pressable>

                  {/* Send Button */}
                  <Pressable
                    onPress={() => setShowSendPicker(true)}
                    onHoverIn={() => setHoverSend(true)}
                    onHoverOut={() => setHoverSend(false)}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: hoverSend
                        ? (isDark ? tc.dark.border : "#E2E8F0")
                        : (isDark ? tc.dark.elevated : "#0F172A"),
                      borderRadius: 14,
                      height: 48,
                      flex: 1,
                      minWidth: 130,
                      maxWidth: 200,
                      gap: 8,
                      borderWidth: 1,
                      borderColor: hoverSend
                        ? tc.glass.borderStrong
                        : (isDark ? tc.glass.border : "transparent"),
                      opacity: pressed ? 0.85 : 1,
                      transform: [{ scale: pressed ? 0.97 : 1 }],
                      ...ts.sm,
                    })}
                  >
                    <View
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 14,
                        backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.2)",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="arrow-up" size={14} color={isDark ? "#FFFFFF" : "#FFFFFF"} />
                    </View>
                    <Text
                      style={{
                        color: isDark ? "#FFFFFF" : "#FFFFFF",
                        fontSize: 14,
                        fontFamily: "DMSans_600SemiBold",
                      }}
                    >
                      {t("wallet.send")}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
            </View>

            {/* ── Assets Section ── */}
            <View
              style={{
                paddingHorizontal: hPad,
                marginBottom: 16,
              }}
            >
              <SectionHeader
                title={t("wallet.cryptoAssets")}
                icon="layers-outline"
                iconColor={colors.primary[400]}
                count={cryptoWallets.length}
              />
              {/* Assets Grid - 2 cols default, 3 cols on large desktop */}
              {walletsLoading ? (
                <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
                  <View style={{ flex: 1, minWidth: 300 }}>
                    <WalletCardSkeleton />
                  </View>
                  <View style={{ flex: 1, minWidth: 300 }}>
                    <WalletCardSkeleton />
                  </View>
                </View>
              ) : cryptoWallets.length === 0 ? (
                <View
                  style={{
                    backgroundColor: tc.dark.card,
                    borderRadius: 20,
                    padding: 48,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: tc.glass.border,
                    maxWidth: 480,
                    ...ts.sm,
                  }}
                >
                  <View
                    style={{
                      width: 80,
                      height: 80,
                      borderRadius: 24,
                      backgroundColor: colors.primary[500] + "15",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 20,
                    }}
                  >
                    <Ionicons name="wallet-outline" size={36} color={colors.primary[400]} />
                  </View>
                  <Text
                    style={{
                      color: tc.textPrimary,
                      fontSize: 18,
                      fontFamily: "DMSans_600SemiBold",
                      marginBottom: 8,
                    }}
                  >
                    {t("wallet.noAssets")}
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 14,
                      fontFamily: "DMSans_400Regular",
                      textAlign: "center",
                      lineHeight: 22,
                      maxWidth: 260,
                    }}
                  >
                    Deposit crypto to start paying bills instantly with M-Pesa
                  </Text>
                </View>
              ) : (
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 16,
                    // @ts-ignore web-only CSS
                    transition: "all 0.2s ease",
                  }}
                >
                  {cryptoWallets.map((w, i) => (
                    <View
                      key={w.id}
                      style={{
                        flex: 1,
                        minWidth: 260,
                        maxWidth: isXLDesktop
                          ? "24%"
                          : isLargeDesktop
                          ? "32%"
                          : ("48%" as any),
                      }}
                    >
                      {renderAssetCard(w, i)}
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* ── Pending Deposits Tracker (desktop) ── */}
            {hasPendingDeposits && (
              <View style={{ marginBottom: 8 }}>
                <DepositTracker
                  pendingOnly
                  maxItems={3}
                  hPad={hPad}
                  onOpenModal={(d) => setDepositStatusModal(d)}
                />
              </View>
            )}

            {/* ── Transaction History ── */}
            <View style={{ paddingHorizontal: hPad, marginBottom: 32 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flex: 1 }}>
                  <SectionHeader
                    title={t("wallet.recentActivity")}
                    uppercase={false}
                    icon="time-outline"
                    iconColor={tc.textSecondary}
                    count={transactions.length}
                  />
                </View>
                {transactions.length > 0 && (
                  <Pressable
                    onPress={handleExportCSV}
                    disabled={exporting}
                    style={({ pressed, hovered }: any) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 10,
                      backgroundColor: hovered ? tc.dark.elevated : tc.dark.card,
                      borderWidth: 1,
                      borderColor: hovered ? colors.primary[400] + "40" : tc.glass.border,
                      opacity: pressed ? 0.85 : exporting ? 0.6 : 1,
                      ...(isWeb ? { cursor: exporting ? "wait" : "pointer", transition: "all 0.15s ease" } as any : {}),
                    })}
                    accessibilityRole="button"
                    accessibilityLabel="Export transactions as CSV"
                  >
                    {exporting ? (
                      <Spinner size={14} color={colors.primary[400]} />
                    ) : (
                      <Ionicons name="download-outline" size={14} color={colors.primary[400]} />
                    )}
                    <Text
                      style={{
                        color: colors.primary[400],
                        fontSize: 12,
                        fontFamily: "DMSans_600SemiBold",
                      }}
                    >
                      {exporting ? "Exporting..." : "Export CSV"}
                    </Text>
                  </Pressable>
                )}
              </View>

              {txLoading ? (
                <TransactionSkeleton />
              ) : (
                <View
                  style={{
                    backgroundColor: tc.dark.card,
                    borderRadius: 20,
                    overflow: "hidden",
                    borderWidth: 1,
                    borderColor: tc.glass.border,
                    ...ts.sm,
                  }}
                >
                  {transactions.length === 0 ? (
                    <View
                      style={{
                        paddingVertical: 48,
                        alignItems: "center",
                        maxWidth: 320,
                        alignSelf: "center",
                      }}
                    >
                      <View style={{ marginBottom: 16, opacity: 0.9 }}>
                        <EmptyNoTransactions size={140} />
                      </View>
                      <Text
                        style={{
                          color: tc.textSecondary,
                          fontSize: 15,
                          fontFamily: "DMSans_600SemiBold",
                          marginBottom: 4,
                        }}
                      >
                        No transactions yet
                      </Text>
                      <Text
                        style={{
                          color: tc.textMuted,
                          fontSize: 13,
                          fontFamily: "DMSans_400Regular",
                          textAlign: "center",
                        }}
                      >
                        Your activity will appear here
                      </Text>
                    </View>
                  ) : (
                    <>
                      {/* Table Header */}
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          paddingHorizontal: 20,
                          paddingVertical: 12,
                          borderBottomWidth: 1,
                          borderBottomColor: tc.glass.border,
                          backgroundColor: tc.dark.elevated + "40",
                        }}
                      >
                        <Text
                          style={{
                            width: "22%",
                            minWidth: 140,
                            color: tc.textMuted,
                            fontSize: 11,
                            fontFamily: "DMSans_600SemiBold",
                            textTransform: "uppercase",
                            letterSpacing: 0.8,
                          }}
                        >
                          Type
                        </Text>
                        <Text
                          style={{
                            flex: 1,
                            minWidth: 100,
                            color: tc.textMuted,
                            fontSize: 11,
                            fontFamily: "DMSans_600SemiBold",
                            textTransform: "uppercase",
                            letterSpacing: 0.8,
                          }}
                        >
                          Details
                        </Text>
                        <Text
                          style={{
                            width: "18%",
                            minWidth: 120,
                            color: tc.textMuted,
                            fontSize: 11,
                            fontFamily: "DMSans_600SemiBold",
                            textTransform: "uppercase",
                            letterSpacing: 0.8,
                            textAlign: "right",
                          }}
                        >
                          Amount
                        </Text>
                        <Text
                          style={{
                            width: "14%",
                            minWidth: 100,
                            color: tc.textMuted,
                            fontSize: 11,
                            fontFamily: "DMSans_600SemiBold",
                            textTransform: "uppercase",
                            letterSpacing: 0.8,
                            textAlign: "center",
                          }}
                        >
                          Status
                        </Text>
                        <Text
                          style={{
                            width: "16%",
                            minWidth: 110,
                            color: tc.textMuted,
                            fontSize: 11,
                            fontFamily: "DMSans_600SemiBold",
                            textTransform: "uppercase",
                            letterSpacing: 0.8,
                            textAlign: "right",
                          }}
                        >
                          Date
                        </Text>
                      </View>
                      {/* Table Rows */}
                      {transactions.map((tx, index) => renderDesktopTransactionRow(tx, index))}
                    </>
                  )}
                </View>
              )}
            </View>

            <View style={{ height: 32 }} />
          </View>
        </ScrollView>

        {/* Desktop Deposit Dialog */}
        {renderDesktopDepositDialog()}
        {renderSendPicker()}
        {/* Deposit Status Tracking Modal */}
        <DepositStatusModal
          deposit={depositStatusModal}
          visible={!!depositStatusModal}
          onClose={() => setDepositStatusModal(null)}
        />
      </SafeAreaView>
    );
  }

  // ══════════════════════════════════════════
  //  MOBILE LAYOUT
  // ══════════════════════════════════════════
  return (
    // edges excludes bottom · prevents dead strip above tab bar.
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }} edges={["top", "left", "right"]}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary[400]}
            progressBackgroundColor={tc.dark.card}
          />
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomTabBarHeight + 16 }}
      >
        {/* Portfolio Value Card */}
        <View
          style={{
            marginHorizontal: hPad,
            marginTop: 6,
            marginBottom: 16,
            backgroundColor: tc.dark.card,
            borderRadius: 28,
            padding: 24,
            borderWidth: 1,
            borderColor: tc.glass.border,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 12,
                fontFamily: "DMSans_600SemiBold",
                textTransform: "uppercase",
                letterSpacing: 1.2,
              }}
            >
              Total Portfolio
            </Text>
            {renderEyeToggle()}
          </View>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: 38,
              fontFamily: "DMSans_700Bold",
              letterSpacing: -1,
              marginBottom: 4,
            }}
          >
            {balanceHidden ? `${displaySymbol} ****` : formatKes(grandTotal, { digits: 2 })}
          </Text>
          {kesBalance > 0 && (
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 13,
                fontFamily: "DMSans_400Regular",
                marginBottom: 8,
              }}
            >
              {balanceHidden
                ? `KES Balance: ${displaySymbol} ****`
                : `KES Balance: ${formatKes(kesBalance, { digits: 2 })}`}
            </Text>
          )}

          {/* Action Buttons */}
          <View style={{ flexDirection: "row", gap: 12, marginTop: 14 }}>
            <Pressable
              onPress={handleReceiveGeneric}
              disabled={generatingAddress !== null}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.primary[500],
                borderRadius: 16,
                height: 52,
                gap: 8,
                opacity: pressed ? 0.85 : generatingAddress ? 0.7 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
                ...ts.glow(colors.primary[500], 0.3),
              })}
            >
              {generatingAddress ? (
                <Spinner size={16} color="#FFFFFF" />
              ) : (
                <View
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    backgroundColor: "rgba(255,255,255,0.15)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="arrow-down" size={16} color="#FFFFFF" />
                </View>
              )}
              <Text
                style={{
                  color: "#FFFFFF",
                  fontSize: 15,
                  fontFamily: "DMSans_600SemiBold",
                }}
              >
                {generatingAddress ? t("wallet.generating") : t("wallet.receive")}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setShowSendPicker(true)}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: isDark ? tc.dark.elevated : "#0F172A",
                borderRadius: 16,
                height: 52,
                gap: 8,
                borderWidth: 1,
                borderColor: isDark ? tc.glass.border : "transparent",
                opacity: pressed ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <View
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  backgroundColor: "rgba(255,255,255,0.15)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="arrow-up" size={16} color="#FFFFFF" />
              </View>
              <Text
                style={{
                  color: "#FFFFFF",
                  fontSize: 15,
                  fontFamily: "DMSans_600SemiBold",
                }}
              >
                {t("wallet.send")}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Assets Section */}
        <View style={{ paddingHorizontal: hPad }}>
          <SectionHeader
            title={t("wallet.assets")}
            icon="layers-outline"
            iconColor={colors.primary[400]}
            count={cryptoWallets.length}
          />
        </View>

        {/* Crypto Wallets */}
        {walletsLoading ? (
          <View style={{ paddingHorizontal: hPad, gap: 12 }}>
            <WalletCardSkeleton />
            <WalletCardSkeleton />
            <WalletCardSkeleton />
          </View>
        ) : cryptoWallets.length === 0 ? (
          <View
            style={{
              marginHorizontal: hPad,
              backgroundColor: tc.dark.card,
              borderRadius: 24,
              padding: 40,
              alignItems: "center",
              borderWidth: 1,
              borderColor: tc.glass.border,
            }}
          >
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 24,
                backgroundColor: colors.primary[500] + "15",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 20,
              }}
            >
              <Ionicons name="wallet-outline" size={36} color={colors.primary[400]} />
            </View>
            <Text
              style={{
                color: "#FFFFFF",
                fontSize: 18,
                fontFamily: "DMSans_600SemiBold",
                marginBottom: 8,
              }}
            >
              No crypto yet
            </Text>
            <Text
              style={{
                color: tc.textMuted,
                fontSize: 14,
                fontFamily: "DMSans_400Regular",
                textAlign: "center",
                lineHeight: 22,
                maxWidth: 260,
              }}
            >
              Deposit crypto to start paying bills instantly with M-Pesa
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: hPad, gap: 12 }}>
            {cryptoWallets.map((w, i) => renderAssetCard(w, i))}
          </View>
        )}

        {/* Pending Deposits Tracker */}
        {hasPendingDeposits && (
          <View style={{ marginTop: 16 }}>
            <DepositTracker
              pendingOnly
              maxItems={3}
              hPad={hPad}
              onOpenModal={(d) => setDepositStatusModal(d)}
            />
          </View>
        )}

        {/* Transaction History */}
        <View style={{ marginTop: 20 }}>
          <View style={{ paddingHorizontal: hPad }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <SectionHeader
                  title={t("wallet.recentActivity")}
                  uppercase={false}
                  icon="time-outline"
                  iconColor={tc.textSecondary}
                  count={transactions.length}
                />
              </View>
              {transactions.length > 0 && (
                <Pressable
                  onPress={handleExportCSV}
                  disabled={exporting}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 5,
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: 10,
                    backgroundColor: tc.dark.card,
                    borderWidth: 1,
                    borderColor: tc.glass.border,
                    opacity: pressed ? 0.85 : exporting ? 0.6 : 1,
                  })}
                  accessibilityRole="button"
                  accessibilityLabel="Export transactions as CSV"
                >
                  {exporting ? (
                    <Spinner size={12} color={colors.primary[400]} />
                  ) : (
                    <Ionicons name="download-outline" size={13} color={colors.primary[400]} />
                  )}
                  <Text
                    style={{
                      color: colors.primary[400],
                      fontSize: 11,
                      fontFamily: "DMSans_600SemiBold",
                    }}
                  >
                    {exporting ? "..." : "Export"}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>

          {txLoading ? (
            <View style={{ marginHorizontal: hPad }}>
              <TransactionSkeleton />
            </View>
          ) : (
            <View
              style={{
                backgroundColor: tc.dark.card,
                borderRadius: 20,
                marginHorizontal: hPad,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: tc.glass.border,
              }}
            >
              {transactions.length === 0 ? (
                <View style={{ paddingVertical: 48, alignItems: "center" }}>
                  <View style={{ marginBottom: 16, opacity: 0.9 }}>
                    <EmptyNoTransactions size={140} />
                  </View>
                  <Text
                    style={{
                      color: tc.textSecondary,
                      fontSize: 15,
                      fontFamily: "DMSans_600SemiBold",
                      marginBottom: 4,
                    }}
                  >
                    No transactions yet
                  </Text>
                  <Text
                    style={{
                      color: tc.textMuted,
                      fontSize: 13,
                      fontFamily: "DMSans_400Regular",
                    }}
                  >
                    Your activity will appear here
                  </Text>
                </View>
              ) : (
                transactions.map((tx) => <TransactionItem key={tx.id} transaction={tx} />)
              )}
            </View>
          )}
        </View>

        <View style={{ height: Platform.OS === "android" ? 100 : 48 }} />
      </ScrollView>

      {/* Mobile Deposit Modal */}
      {renderMobileDepositModal()}
      {renderSendPicker()}
      {/* Deposit Status Tracking Modal */}
      <DepositStatusModal
        deposit={depositStatusModal}
        visible={!!depositStatusModal}
        onClose={() => setDepositStatusModal(null)}
      />
    </SafeAreaView>
  );
}
