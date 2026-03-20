import { View } from "react-native";
import { getThemeColors } from "../src/constants/theme";
import { useThemeMode } from "../src/stores/theme";

// Lazy import the terms screen to avoid duplicating 700 lines of legal content
const TermsScreen = require("./settings/terms").default;

/**
 * Public route: /terms
 * Renders terms of service directly — accessible without login.
 * Required by Google OAuth consent screen and app store listings.
 */
export default function TermsPage() {
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);

  return (
    <View style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <TermsScreen />
    </View>
  );
}
