# Lottie animations — CryptoPay landing

Curated, production-ready sources for the three Lottie animations used on
`cpay.co.ke`. All candidates have been screened for:

- **Licence:** MIT / LottieFiles free tier (commercial use allowed, no
  attribution required on our landing).
- **Palette fit:** emerald / amber / cool grey — anything with garish
  pink / purple is rejected because it fights our `#10B981` brand.
- **Size:** ≤ 150 KB rendered JSON (check **File size** in the
  LottieFiles sidebar before downloading).
- **Loop-less playability:** the final frame must read as a completed
  state — we use `loop={false}` and freeze there.

## File naming convention

    mobile/assets/lottie/<slug>.json

Use hyphen-lowercase slugs tied to purpose, not tied to the source
artist. Easier to swap later.

| Slot | Filename | Purpose |
|---|---|---|
| A | `payment-flow-hero.json` | Coin → phone → receipt, plays once in hero secondary column |
| B | `crypto-to-kes.json` | Token swap visual in the "How it works" lead card |
| C | `success-check.json` | Final confirmation flourish on the success screen |

Register new Lotties by importing the JSON directly:

```ts
import paymentFlow from "../../assets/lottie/payment-flow-hero.json";
<PaymentFlowLottie
  source={paymentFlow}
  fallback={require("../../assets/illustrations/payment-flow-static.png")}
/>
```

## Approved source shortlist

Visit each URL, pick the variant whose colours are closest to our
brand, export as **Lottie JSON** (not After Effects / dotlottie).

### A — payment-flow-hero

1. <https://lottiefiles.com/free-animation/money-transfer-gyJLg4SDKC> —
   clean wallet-to-wallet arc, one-shot.
2. <https://lottiefiles.com/free-animation/crypto-coin-fFfpXMd78S> —
   rotating coin landing on a surface; use as fallback if #1 feels busy.
3. <https://lottiefiles.com/free-animation/payment-success-DBVWWohYkn> —
   card-tap → green tick; works if we want a more terminal-like frame.

### B — crypto-to-kes

1. <https://lottiefiles.com/free-animation/currency-exchange-5lcM4shYDc> —
   bidirectional arrows between two tokens, monochrome.
2. <https://lottiefiles.com/free-animation/bitcoin-transfer-5EB9gWPbFa> —
   BTC icon morphing into a fiat bill; swap the ₿ for our USDT if editable.
3. <https://lottiefiles.com/free-animation/crypto-swap-kc3zgbUAZ6> —
   flat swap animation; simplest and lightest of the three.

### C — success-check

1. <https://lottiefiles.com/free-animation/success-check-mark-g2MgvjfEbA>
   — hand-drawn tick sweeping in; plays under a second.
2. <https://lottiefiles.com/free-animation/green-checkmark-2HROoLbnjI>
   — circular stroke + tick; cleaner, enterprise-feel.

> If all candidates for a slot feel off, **ship without the Lottie**.
> `PaymentFlowLottie` will show the static fallback image and nothing
> looks broken. Never fake a Lottie with a looping GIF — we removed
> looping animations on purpose.

## Quality gate before adding

1. Drop the JSON into <https://lottiefiles.com/preview>.
2. Confirm it looks correct against `#060E1F` background.
3. Check file size — if > 150 KB, use LottieFiles' "Optimize" tool.
4. Paste the gzipped size into the PR description.
5. Delete the old static image only after the Lottie is merged.

## Static fallbacks

Each Lottie must ship alongside a static fallback PNG in
`mobile/assets/illustrations/`. Fallbacks are shown when:

- `Platform.OS !== "web"` (native builds never import lottie-react).
- The user has `prefers-reduced-motion: reduce` set.
- The dynamic import of `lottie-react` fails.
- The JSON URL 404s.

Naming: `<slug>-static.png`. Dimensions: 640 × 640 @ 1x (we render at
up to 320 CSS px, so 2x is enough for retina).
