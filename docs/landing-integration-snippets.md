# Landing page integration — 3 real visualisations

Drop-in snippets for `mobile/app/landing.tsx`. These replace three
decorative unDraw illustrations with real rendered visualisations.

## 1. Stats section — add BTC sparkline as underlay

Near the top of the file, add:

```tsx
import { KesRateSparkline } from "../src/components/landing/KesRateSparkline";
```

Inside `statsSection` (the `<View>` that wraps the 4-tile stat strip),
add the sparkline absolutely-positioned behind the tiles:

```tsx
{isWeb && (
  <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 120, opacity: 0.55, pointerEvents: "box-none" }}>
    <KesRateSparkline currency="BTC" height={120} />
  </View>
)}
```

Place this before the `<RevealOnScroll>` that renders the tiles so it
sits underneath them. The `pointerEvents: "box-none"` lets clicks pass
through to tiles while the sparkline itself still receives hover events.

## 2. Hero secondary column — add PaymentFlowLottie

```tsx
import { PaymentFlowLottie } from "../src/components/landing/PaymentFlowLottie";
import paymentFlow from "../assets/lottie/payment-flow-hero.json";
```

In the hero (desktop) layout, opposite the mockup card:

```tsx
{isDesktop && (
  <View style={{ flex: 1, alignItems: "center" }}>
    <PaymentFlowLottie
      source={paymentFlow}
      fallback={require("../assets/illustrations/payment-flow-static.png")}
      width={320}
      height={320}
      ariaLabel="Animation of a paybill being paid with crypto"
    />
  </View>
)}
```

Until the Lottie JSON is curated per the Lottie README, pass a placeholder
`require()` of any existing hero-sized PNG — the component gracefully
falls back.

## 3. How-it-works section — replace the unDraw cartoon

Find the existing `<Image source={U(...)} />` for the
`credit_card_payment_vzc8` illustration. Replace with:

```tsx
import { HowItWorksMockup } from "../src/components/landing/HowItWorksMockup";
// ...
<HowItWorksMockup width={280} />
```

The phone card auto-sizes with the `aspect` prop (default 0.54 =
roughly modern phone). Use `width={240}` on mobile viewports and
`width={280}` on desktop.

## Testing checklist

1. `npx expo export --platform web --output-dir dist` — build passes.
2. Open `dist/index.html` locally — static fallback images show where
   Lotties haven't been added yet.
3. Hover the sparkline — scrubbing cursor should appear, tooltip in
   upper-right corner shows date and BTC/USD price.
4. Hover the phone mockup — subtle 4 px lift, no internal animation.
5. Verify lottie-react only loads on web:
   `grep lottie dist/_expo/static/js/web/entry-*.js` should return 0
   matches; the Lottie chunk is lazy-loaded separately.
