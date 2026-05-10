/**
 * useTabScrollPadding · 2026-05-10.
 *
 * Returns the right `paddingBottom` value for a tab page's main
 * ScrollView so the page reads compact instead of leaving a thick
 * dead zone above the floating tab bar.
 *
 * Background · React Navigation v7 renders the bottom tab bar as an
 * absolutely-positioned overlay. Naively setting `paddingBottom:
 * useBottomTabBarHeight()` reserves the FULL tab-bar height (icon
 * column + label row + safe-area inset, ~68–94 px) so the last
 * content item sits exactly at the top edge of the bar. That works,
 * but on devices with a real safe-area inset (iOS home indicator,
 * gesture nav Android) it left visible empty space inside the
 * scroll area while the tab bar's safe-area gutter is just opaque
 * background underneath. User reported this as "wasted space ·
 * compact energy" on every tab page.
 *
 * Fix · trim a reduction value off the reserved padding, with a
 * sensible floor so the last 8 px of the last item still has
 * breathing room above the bar's icon row. Default reduction is
 * 40 px · enough to be visible (the user said "by a big number")
 * without burying useful content under the bar.
 *
 * Desktop · the tab bar is hidden via `tabBarStyle.display='none'`
 * (see `(tabs)/_layout.tsx`) so `useBottomTabBarHeight()` returns 0
 * and we just want a small breathing-room gutter (24 px).
 */
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useWindowDimensions, Platform } from "react-native";

/** Width breakpoint for "this is desktop, no tab bar" · matches the
 *  isDesktop checks scattered across the tab pages. */
const DESKTOP_BREAKPOINT = 900;

/** Default reduction off the measured tab-bar height. The tab bar
 *  comes in around 68–94 px depending on device safe-area inset; we
 *  carve 40 px out of that so the last content item lands ~28–54 px
 *  above the icon row. */
const DEFAULT_REDUCTION = 40;

/** Floor we never go below on mobile · keeps the last item's bottom
 *  edge from getting clipped by the icon row even on devices with
 *  an unusually tight tab bar. */
const MOBILE_MIN_PADDING = 24;

/** Desktop bottom gutter · no tab bar, just breathing room. */
const DESKTOP_PADDING = 24;

export function useTabScrollPadding(reduction: number = DEFAULT_REDUCTION): number {
  const tabBarHeight = useBottomTabBarHeight();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === "web" && width >= DESKTOP_BREAKPOINT;

  if (isDesktop) {
    return DESKTOP_PADDING;
  }
  return Math.max(tabBarHeight - reduction, MOBILE_MIN_PADDING);
}
