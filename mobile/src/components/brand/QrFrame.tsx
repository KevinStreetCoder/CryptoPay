/**
 * QrFrame · wraps a QR code with brand corner brackets, wordmark stamp
 * top-right, and a monospace code label below.
 *
 * Use for every QR surface: deposit address, paybill receive, referral.
 * The frame is what makes the QR feel Cpay-branded; the QR itself is
 * provided by the caller (react-native-qrcode-svg or similar).
 */
import { View, Text, Platform } from "react-native";
import { colors } from "../../constants/theme";

const INK = "#0B1220";
const INK2 = "#1F2937";
const EMERALD = "#10B981";
const PAPER = "#FFFFFF";
const MUTED = "#64748B";

export interface QrFrameProps {
  /** The rendered <QRCode /> or <Svg /> element. */
  children: React.ReactNode;
  /** QR render size in px (matches the child). */
  size?: number;
  /** The code / address rendered underneath. */
  label?: string;
  /** Show the Cpay wordmark stamp top-right. Default true. */
  showStamp?: boolean;
}

export function QrFrame({ children, size = 220, label, showStamp = true }: QrFrameProps) {
  // Bracket thickness scales with size; ~6% of the QR width.
  const br = Math.round(size * 0.06);
  const bt = Math.max(3, Math.round(size * 0.02));

  const bracket = {
    position: "absolute" as const,
    width: br,
    height: br,
  };

  return (
    <View style={{ alignItems: "center" }}>
      <View
        style={{
          width: size + 32,
          padding: 16,
          backgroundColor: PAPER,
          borderRadius: 16,
          position: "relative",
          ...(Platform.OS === "web"
            ? { boxShadow: "0 12px 32px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)" }
            : { elevation: 4 }),
        }}
      >
        {/* Corner brackets · emerald, drawn with L-shapes via borders. */}
        <View style={{ ...bracket, top: 8, left: 8, borderTopWidth: bt, borderLeftWidth: bt, borderColor: EMERALD }} />
        <View style={{ ...bracket, top: 8, right: 8, borderTopWidth: bt, borderRightWidth: bt, borderColor: EMERALD }} />
        <View style={{ ...bracket, bottom: 8, left: 8, borderBottomWidth: bt, borderLeftWidth: bt, borderColor: EMERALD }} />
        <View style={{ ...bracket, bottom: 8, right: 8, borderBottomWidth: bt, borderRightWidth: bt, borderColor: EMERALD }} />

        {/* Wordmark stamp · top-right inside the paper frame. */}
        {showStamp ? (
          <View style={{ position: "absolute", top: 14, right: 22 }}>
            <Text style={{ fontSize: 11, fontFamily: "DMSans_700Bold", letterSpacing: -0.3, color: INK }}>
              <Text style={{ color: colors.primary[500] }}>C</Text>pay
            </Text>
          </View>
        ) : null}

        <View style={{ marginTop: showStamp ? 14 : 0, width: size, height: size, alignSelf: "center" }}>
          {children}
        </View>
      </View>

      {label ? (
        <Text
          style={{
            marginTop: 12,
            fontSize: 13,
            color: INK2,
            fontFamily: Platform.OS === "web" ? "JetBrainsMono_500Medium, 'JetBrains Mono', monospace" : "JetBrainsMono_500Medium",
            letterSpacing: 0.4,
            textAlign: "center",
          }}
          selectable
        >
          {label}
        </Text>
      ) : null}
    </View>
  );
}
