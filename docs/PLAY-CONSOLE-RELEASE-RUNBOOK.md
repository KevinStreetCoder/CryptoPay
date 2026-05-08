# Google Play Console · Release Runbook for Cpay

**Last updated:** 2026-05-08
**App package:** `ke.co.cryptopay.app`
**Developer account:** CPAY TECHNOLOGIES (D-U-N-S 850394732)
**Account ID:** 5539099527688671798

This is the standard developer flow for shipping Cpay updates through
Google Play Console. Follow it for every release · the worst Play
rejections come from skipping the testing tracks.

---

## TL;DR · the four-phase release ladder

```
    ┌─────────────────┐
    │ Internal test   │ <-- you + 1-2 ops · instant, no review
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │ Closed test     │ <-- 50-100 invitees · review takes hours-days
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │ Open test       │ <-- public opt-in · review same as Closed
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │ Production      │ <-- staged rollout · 1% → 5% → 20% → 100%
    └─────────────────┘
```

**Hard rule:** every release stays in Internal Test for ≥ 24 hours,
then Closed Test for ≥ 7 days, BEFORE going to Production. This is
how you catch real-world bugs (battery drain, crash on specific OEMs,
rate-limit issues with M-Pesa) before they hit your full user base.

---

## One-time setup (already done · 2026-05-08)

- ✅ Developer account verified as Organization (D-U-N-S 850394732)
- ✅ App listing created
- ✅ App signing by Google Play (you only manage the upload key)
- 🟡 Privacy policy URL set: https://cpay.co.ke/privacy
- 🟡 Terms of Service URL set: https://cpay.co.ke/terms
- 🔴 Data safety form filled
- 🔴 Content rating questionnaire (IARC) completed
- 🔴 Target audience set (Adults 18+, financial app)
- 🔴 App access (login credentials for Google reviewers)
- 🔴 Internal testing track · added testers
- 🔴 Closed testing track · added testers (~50)

The 🔴 items are operator actions on the Play Console UI · not engineering.

---

## Per-release checklist (every time you ship)

### 1. Bump the version (engineering)

```jsonc
// mobile/app.json
{
  "expo": {
    "version": "1.2.0",                  // semver · feature releases bump minor
    "android": {
      "versionCode": 3                   // INTEGER · MUST always increment
    }
  }
}
```

**Versioning convention:**
- `versionCode` (integer) · the Play Store identifier. Once a value is
  used for a release, it CAN'T be re-used. Always increment by 1.
- `versionName` (semver string) · what users see. `1.0.0` → `1.1.0`
  for new features, `1.1.0` → `1.1.1` for bug fixes, `1.x` → `2.0`
  for breaking changes.

**Mistake we made on the first attempted submission (2026-05-08):**
versionCode stayed at 1 across builds. Play rejected on duplicate
upload. Fixed in commit · now 1.1.0 / versionCode 2.

### 2. Build the AAB (engineering)

```bash
# WSL Ubuntu (root)
cd /mnt/c/Users/Street\ Coder/StartupsIdeas/CryptoPay/mobile
source /root/.android_env  # EXPO_TOKEN
eas build --platform android --profile production --local --non-interactive --output /root/cpay-aab/cpay-$(date +%Y%m%d-%H%M%S).aab
```

The production profile in `eas.json` outputs an Android App Bundle
(AAB), which is what Play Store requires for new uploads since
August 2021. APK uploads are blocked.

**Why AAB and not APK:**
- ~30 % smaller download size for users (Play generates the right APK
  per device).
- Required by Play Store · APK uploads are rejected.
- `eas build --profile preview` still produces APK · use that for
  cpay.co.ke/download/ sideload, NOT for Play submission.

### 3. Internal Testing release (24-48 hours · self-test)

```bash
eas submit --platform android --profile production --path /root/cpay-aab/cpay-<timestamp>.aab
```

Or upload the AAB manually at:
`https://play.google.com/console` → Cpay → Internal testing → Create new release

What goes in this release:
- AAB file
- Release name: `1.2.0 (3)` (versionName + versionCode in parens)
- Release notes ("What's new") in EN and SW · max 500 chars
- Upload the file, click `Save`, then `Review release`, then
  `Start rollout to internal testing`

Wait for the release to show `Available to testers` (~5-15 min for
Internal · no Google review).

**Add yourself + ops as testers** (one-time, then reuse the list):
Internal testing → Testers tab → Create email list → paste your Gmail.

Testers install via the opt-in URL (Play Console gives you one · share
in your ops Slack / WhatsApp). The Play Store app shows a "[Internal
testing]" badge on your install screen.

### 4. Closed Testing release (7+ days · ~50 beta users)

When Internal smoke is clean, **promote** the same release to Closed:

`Internal testing → Releases → Latest → Promote release → Closed testing`

Or build fresh and submit directly to Closed if the build changes.

Closed testing requires:
- Up to 200,000 testers across email lists
- Google review (~hours-days, faster after first approval)
- Open the opt-in URL to your beta list

This is where you find the bugs that don't show up on your own Pixel.

### 5. Production with staged rollout

After ≥ 7 days on Closed without escalating crash rate:

`Closed testing → Releases → Latest → Promote release → Production`

**Set rollout percentage:** start at **1%** · monitor for 24h ·
then 5% · 20% · 50% · 100%.

Why staged: a bug that escapes Closed testing only hits 1% of users
before you can halt rollout. Halt = stop new updates from reaching
users; existing 1% keeps the buggy version. Then publish a fix on
the next versionCode.

---

## Release notes · template

Save this in `docs/release-notes/v1.X.0.md` for each release.

```
## What's new in 1.1.0

We've made depositing KES smoother and added new safety controls.

• New: deposit codes that expire in 30 minutes · paste once, no
  long account numbers to type
• New: SasaPay rail · Pay Bill 756756 + your code to top up your
  Cpay wallet
• Improved: payment status updates · we now actively check with
  M-Pesa instead of waiting forever
• Fixed: a tab-bar visual artifact on Chrome mobile

EN max 500 chars. SW translation in app/release-notes/v1.1.0.sw.md.
```

---

## Pre-launch report (automatic · monitor it)

Every Internal/Closed/Production release triggers Google's Pre-launch
Report · a robot installs your AAB on real devices (Pixel, Samsung,
OnePlus) and runs your app for ~5 minutes. It reports:

- Crashes (`adb logcat` style)
- ANRs (Application Not Responding > 5 sec)
- Performance issues (jank, slow startup)
- Security warnings (insecure HTTP, leaked secrets in logs)
- Accessibility issues

**Action:** Read the report on every release. A green report doesn't
guarantee no bugs but a red one is a hard signal. Fix in the next
versionCode.

---

## Data safety form · what to declare

(Tell the user what to fill on the Play Console UI · this is not
engineering, but the form's wording matters.)

**Data collected:**
- ✅ Personal Info → Name, Email, Phone number, User IDs
   - Purposes: App functionality, Account management
   - Required (yes)
   - Encrypted in transit, encrypted at rest
- ✅ Financial Info → Purchase history, Other Financial Info (KES
  balance, transaction history)
   - Purpose: App functionality
   - Required
   - Encrypted in transit + at rest
- ✅ Location → No (we don't use location)
- ✅ Files & Docs → KYC documents (national ID images)
   - Purpose: App functionality (KYC compliance · CBK / VASP Act 2025)
   - Required for tier ≥ 1
   - Encrypted at rest

**Data shared with third parties:**
- SasaPay (CBK-licensed PSP) · for M-Pesa rail
- IntaSend (CBK-licensed payments aggregator) · fallback rail
- Smile Identity · KYC verification (when wired)

**Security practices:**
- ✅ Encrypted in transit (TLS 1.3 between client and server)
- ✅ Independent security review (audit 2026-04-22 · CRITICAL/HIGH closed)
- ✅ User can request data deletion (`/account/delete/` endpoint)

---

## Content rating

The IARC questionnaire will ask:
- Violence: None
- Sexual content: None
- Profanity: None
- Controlled substances: None
- Gambling: None (key · we are NOT a gambling app even though we touch
  digital assets · the Play Store has a separate "Real-money gambling"
  category which we are NOT in)
- User-generated content: None
- Personal info shared: Yes · self-declared (your phone number)

Expected rating: **Teen (13+)** · because of the financial nature.
Some markets restrict to 18+ via the Adults setting.

---

## App access for Google reviewers

Google needs to log in to test your app. Options:
- Provide a test phone number + PIN combo that bypasses OTP (we
  already have this in `apps.accounts.views.LoginView` for the
  `+254700000000` test user · pin `123456`)
- Add the test creds in: Play Console → App content → App access →
  All or some functionality is restricted → Add credentials

**Do NOT use a real customer's account.** Create a test user
specifically for Google reviewers.

---

## In-app updates (optional · UX win)

Once the Play submission is live, add the Play Core in-app updates
SDK so users get a banner inside the app saying "A new version is
available · Update now" without leaving the app.

Two flavours:
- **Flexible** · banner stays visible, user can dismiss. Good for
  feature releases.
- **Immediate** · full-screen "Update now" required to use the app.
  Reserve for security fixes.

We'll wire this in a later sprint (post first Play release) · the
SDK lives in `expo-updates` adjacent code, takes ~half a day to
integrate.

---

## Common rejection reasons (avoid these)

| Reason | Fix |
|---|---|
| Duplicate `versionCode` | Always increment · we hit this on first try |
| Missing privacy policy URL | Set in Play Console → App content → Privacy policy |
| Crashes in pre-launch report | Don't ignore the report · fix and resubmit |
| App targets API < 33 | Set `compileSdkVersion: 35` in app.json (we already do) |
| Network security · cleartext HTTP | We use HTTPS only · safe |
| Permissions you don't actually use | We `blockedPermissions` everything except internet, camera (KYC), biometric, notifications · safe |
| Restricted financial app without disclosure | Done · the Play Console listing must say "We facilitate digital asset to M-Pesa transfers under VASP Act 2025" in the app description |

---

## When the build is rejected

Don't panic. Google Console shows the reason. Common flow:

1. Read the rejection reason
2. Fix the code OR fix the Play listing
3. Bump `versionCode` (you can't reuse `2` once Play has seen it · go to `3`)
4. Rebuild AAB
5. Upload as a NEW release in Internal testing
6. Once Internal-clean, promote through Closed → Production

The Play review team is reasonable but strict on financial apps.
First-time approval can take 5-7 days. Subsequent updates · 24-48 h.

---

## Distribution alternatives (we use both today)

- **Sideload via cpay.co.ke/download/cryptopay.apk** · for the closed
  beta. Faster than Play Store, no review delay. Build with `eas
  build --profile preview --local --output ...apk`.
- **Play Store** · for the public launch. AAB only.

After Play approval, we should keep both up · users on Play get
Play updates, sideload users continue to download from cpay.co.ke
(though we want to migrate them to Play eventually for auto-update
hygiene).

---

## Operator runbook · 2026-05-08 release (current)

You're shipping v1.1.0 · here's the literal sequence of clicks /
commands:

1. ✅ Engineering · version bumped to 1.1.0 / versionCode 2 (commit
   pending push as part of the SasaPay deposit-intent feature)
2. ✅ Engineering · APK rebuilt with new version (PID 23452 in WSL ·
   ~15 min from when this doc was written)
3. 🟡 Operator · upload the v1.1.0 APK to cpay.co.ke (replaces
   today's `58dd2f3c…` build) · steps automated by the build script
4. 🔴 Engineering · build the AAB:
   ```
   wsl -d Ubuntu -u root -- bash /tmp/_build.sh   # APK · already running
   # Then for AAB:
   eas build --platform android --profile production --local --non-interactive --output /root/cpay-aab/cpay-v1_1_0.aab
   ```
5. 🔴 Operator · Play Console → Cpay → Internal testing → Create new
   release → Upload `cpay-v1_1_0.aab` → Release name `1.1.0 (2)` →
   add release notes → Save → Review → Start rollout
6. 🔴 Operator · install on your Pixel / Samsung from the Internal
   tester opt-in URL · live-test the full deposit flow:
   - SasaPay paybill 756756 + 6-char intent code
   - Send-to-Mpesa
   - Pay Bill (any utility)
   - Pochi la Biashara
7. 🔴 Operator · 24h after Internal · promote to Closed testing,
   add the 50-name beta list, send the opt-in URL
8. 🔴 Operator · 7 days after Closed (zero crash escalations) ·
   promote to Production with 1% staged rollout.
