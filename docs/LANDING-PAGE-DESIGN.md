# Landing Page — Design Audit, Resources, and Backlog

**Scope:** `mobile/app/landing.tsx` (single Expo Router file rendered for
`cpay.co.ke` on web). Goal is a landing page that reads as a professional
fintech (Wise, Revolut, Cash App, Flutterwave, Chipper) — not an AI-generated
template.

---

## Principles (anti-AI-slop checklist)

These are the tells that make a page look AI-generated. Every change to the
landing page should be reviewed against this list.

1. **No purple-to-pink gradients on buttons** — fintechs use solid brand
   colours (we use emerald `#10B981`) with subtle glows.
2. **No 5+ simultaneous hero animations** — one lead animation (hero mockup
   tilt), optionally one accent (Lottie flow). Anything more reads as
   "AI template."
3. **No generic illustrations of abstract 3D blobs** — use line-art / SVG
   (unDraw, Storyset) with intentional colour tokens, or real product
   screenshots.
4. **No "Empower your financial future" marketing lorem ipsum** — copy
   references M-Pesa, paybills, Kenya, crypto — specific and local.
5. **No bottomless parallax / sticky "section everywhere"** — the page has
   discrete sections with natural breath.
6. **No emojis as icons** — always `Ionicons` / `Lucide` / real SVG assets.
   (User preference, see memory `feedback_no_emoji_icons.md`.)
7. **No generic stock headshots** — use real user quotes attributed by
   handle, or leave out the testimonial.
8. **Consistent radii** — 16 px everywhere. No 8/12/16/24/32 mix.
9. **Consistent shadow hierarchy** — one `makeShadow(brand)` helper,
   not inline one-off `boxShadow` strings per card.
10. **Real data** — the "730 Beta Users" counter must be real, not
    fabricated. If we don't have the number, we hide it.

---

## Audit findings (2026-04-17)

Landing-page audit agent reviewed `mobile/app/landing.tsx` and the live
production site. Summary of issues and status.

| # | Issue | File / Line | Severity | Status |
|---|---|---|---|---|
| 1 | Over-engineered splash: 6 parallel animations, 2 expanding rings, ambient blur glow. Users reported 4-6 s perceived load. | `src/components/LoadingScreen.tsx` | High | **Done** 2026-04-17 — rewritten with single shimmer bar + 260ms fade. |
| 2 | `textSecondary #8899AA` fails WCAG AA (3.5:1). | `src/constants/theme.ts:34` | High | **Done** 2026-04-17 — bumped to `#A8BBCC` (≥4.5:1). |
| 3 | Hero mockup `borderRadius: 24` inconsistent with rest of design system. | `app/landing.tsx:815` | Medium | **Done** 2026-04-17 — set to 16. |
| 4 | `cpay-tilt-float 6s` + `cpay-glow-border 4s` too long; decorative motion competes with content. | `app/landing.tsx:584` | Medium | **Done** 2026-04-17 — 5s / 3.5s. |
| 5 | Glow opacity `rgba(16,185,129,0.08)` creates visible pulsing halo. | `app/landing.tsx:572` | Low | **Done** 2026-04-17 — reduced to `0.05`. |
| 6 | No social proof in hero. Trusted Technology strip buried far below the fold. | `app/landing.tsx:876-920` | High | **Partial** 2026-04-17 — added small trust strip (VASP / Kenya / Encryption) under hero CTAs. Full partner-logo move still pending. |
| 7 | Remaining card/section `borderRadius` mix (24 / 32 / 16). | `app/landing.tsx:1478, 1710, various` | Medium | **Todo** — standardise to 16 everywhere. |
| 8 | Hero text-side is static. No tactile cue; the mockup carries all the motion. | `app/landing.tsx:740-795` | Medium | **Todo** — add a single Lottie showing crypto → M-Pesa flow. |
| 9 | Feature cards (Bento) lack an idle micro-animation; feel lifeless until hover. | `app/landing.tsx:591-594` | Low | **Todo** — add a subtle 5s float loop to idle state. |
| 10 | Partner-logo "Trusted Technology" section should be near top (above fold) for fintech credibility. | `app/landing.tsx:876-920` | Medium | **Todo** — either move the section, or condense into a single line under the hero trust strip. |
| 11 | Section reveal animations all identical timing (0.6s). Wise/Revolut stagger for lightness. | `app/landing.tsx` | Low | **Todo** — pass stagger index to `RevealOnScroll`. |
| 12 | Pricing / "How it works" icons feel generic. Could use Storyset for a more editorial tone. | various | Low | **Todo**. |
| 13 | No hero illustration of the core product flow (KES → crypto → paybill). Value prop is text-only on the left. | hero section | High | **Todo** — Lottie or static SVG hero illustration. |

---

## Design resources (researched 2026-04-17)

All free, commercial-use-friendly. Chosen because they produce
professional-looking output without any AI-generation tells.

### Illustrations

| Source | URL | When to use | Notes |
|---|---|---|---|
| **unDraw** | https://undraw.co/illustrations | Hero, empty states, explainer sections | Already partially integrated. Text-editable SVG, colour token `--primary`. MIT licence. |
| **Storyset** (Freepik) | https://storyset.com | Section illustrations with slight editorial animation | Has animated + static variants. Free with attribution at launch; pro $3/mo later. |
| **Scale** (undraw alt) | https://www.scale.com/app/landing-illustrations | Tight, minimal fintech illustrations | CC0. Great for pricing/FAQ sections. |
| **IRA Design** | https://iradesign.io | Hero illustrations matched to a colour set | Free SVG, select colour scheme first. |
| **Open Peeps** | https://openpeeps.com | People in explainer scenes (KYC, onboarding) | CC0 hand-drawn. Avoids stock-photo feel. |

### Animations (Lottie)

| Source | URL | When to use |
|---|---|---|
| **LottieFiles Featured** | https://lottiefiles.com/featured | Scroll/browse hand-curated loops |
| **LottieFiles "Finance"** | https://lottiefiles.com/free-animations/finance | Specific fintech flows (payment success, coin transfer, wallet) |
| **Useanimations** | https://useanimations.com | Tiny UI micro-loaders (SVG / Lottie) — pagination, buttons |

**Integration:** install `lottie-react-native`, drop `.lottie` or `.json`
into `mobile/assets/lottie/`. One Lottie in the hero is fine; more than
one on screen at once crosses into AI-slop territory.

### Icon sets

| Source | URL | Use |
|---|---|---|
| **Heroicons** | https://heroicons.com | 300+ clean outlines, MIT |
| **Tabler Icons** | https://tabler.io/icons | 4000+ free SVG, MIT — broad coverage |
| **Lucide** | https://lucide.dev | Fork of Feather, actively maintained |
| **Ionicons** | (built-in to Expo) | Already in use |

### Stock photography (when we need it)

| Source | URL | Notes |
|---|---|---|
| **Pexels** | https://www.pexels.com | CC0. Avoid the generic "diverse team pointing at laptop" shots. |
| **Unsplash** | https://unsplash.com | CC0. Use Kenya-specific searches ("Nairobi", "M-Pesa", "Kenyan market"). |
| **Humaaans** | https://www.humaaans.com | Mix-and-match illustrated people; CC BY. |

### Fonts

Currently using **DM Sans** (Google Fonts, via `@expo-google-fonts/dm-sans`).
Modern, tight, works well for fintech. **Do not change.**

### Colour + palette tools

- **Coolors** https://coolors.co — explore accents around `#10B981`
- **RealtimeColors** https://realtimecolors.com — preview contrast ratios
- **WebAIM Contrast Checker** https://webaim.org/resources/contrastchecker/ — verify WCAG AA before shipping

---

## Remaining backlog (prioritised)

### Priority 1 — Before beta launch
1. **Move the partner-logo "Trusted Technology" section directly under the
   hero**, or condense to a single-line strip: *"Payment rails: M-Pesa /
   Daraja • SasaPay. KYC: Smile Identity. Rates: CoinGecko."* First-time
   visitors need the credibility cue in the first 3 seconds.
2. **Add a hero illustration or Lottie** showing crypto → M-Pesa flow.
   Best candidates on LottieFiles: search "payment flow", "crypto
   transfer", "money send". Keep it under 2 MB.
3. **Standardise remaining radii to 16 px** across feature cards,
   testimonial cards, CTA boxes (currently 24 / 32 scattered).

### Priority 2 — Polish sprint
4. **Idle micro-animation on feature cards** — 5-second subtle float,
   same easing as `cpay-float` keyframe, offset indexed so they don't
   pulse in sync.
5. **Stagger section reveals** — pass index to `RevealOnScroll` so
   sibling children reveal 100 ms apart, like Wise's homepage.
6. **Audit all `borderRadius` values** in `landing.tsx` with a grep and
   normalise. Set a constant `RADIUS_CARD = 16` and use it everywhere.

### Priority 3 — Post-beta
7. **Real user testimonials** with real names and Twitter/X handles
   (opt-in form post-launch).
8. **Animated usage counter** — only if the number is real and signals
   growth (e.g. "KES 2.4M paid via CPay this week").
9. **Localised copy** — English + Swahili toggle in footer.
10. **Server-rendered landing page** (Next.js) for SEO. Expo web
    renders entirely client-side; Googlebot can index but slowly.
    Not urgent until we need paid ads or SEO-driven growth.

---

## How to make a change without breaking the page

1. Run `npx expo export --platform web --output-dir dist` locally.
2. Open `dist/index.html` in a browser and smoke-test the hero.
3. `tar czf /tmp/cpay-dist.tar.gz -C dist .` — **never** `scp -r` (breaks
   on Expo fonts with spaces; see `feedback_deploy_method.md`).
4. `scp /tmp/cpay-dist.tar.gz root@173.249.4.109:/tmp/ && ssh ... "rm -rf
   /var/www/cpay/* && cd /var/www/cpay && tar xzf /tmp/cpay-dist.tar.gz
   && chown -R www-data:www-data . && systemctl reload nginx"`.
5. Verify at https://cpay.co.ke/ — hashed JS bundles auto-bust the
   Cloudflare cache, no manual purge needed.
