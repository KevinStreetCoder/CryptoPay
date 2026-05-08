# Play Console upload · v1.1.0 (tonight)

The literal click-by-click for tonight's upload. Print or keep this
window open while you upload.

**Status:** Organization account verified ✓ · prior rejection was on
the personal account, so this is effectively a fresh submission.

**File you're uploading:** `cpay-v1.1.0-vc2-<timestamp>.aab` from
`\\wsl.localhost\Ubuntu\root\cpay-aab\` (build in flight, ~25 min).

---

## Step 0 · Before you click anything

Open three tabs:

1. https://play.google.com/console (Play Console)
2. https://cpay.co.ke/privacy (privacy policy · you'll paste this URL)
3. https://cpay.co.ke/terms (terms of service · paste URL)

Have these values ready in a notepad:

| Field | Value |
|---|---|
| App name | `Cpay` |
| Package | `ke.co.cryptopay.app` |
| Version name | `1.1.0` |
| Version code | `2` |
| Privacy policy URL | `https://cpay.co.ke/privacy` |
| Terms URL | `https://cpay.co.ke/terms` |
| Test user phone | `+254700000000` (or the dedicated reviewer test account) |
| Test user PIN | `123456` |
| Support email | `support@cpay.co.ke` |
| Developer name | `CPAY TECHNOLOGIES` |
| D-U-N-S | `850394732` |
| Business reg | `BN-B8S6JP89` |

---

## Step 1 · App content (one-time setup · skip if done)

These eight items must show green ✓ on the App Content page or your
release will be auto-rejected. Click each that's not green:

1. **Privacy policy** — paste `https://cpay.co.ke/privacy` and Save.
2. **App access** — Tick "All or some functionality is restricted" →
   Add credentials → Username: `+254700000000` Password: `123456`
   Notes: "Test account for Google reviewers. PIN-only login. Skip
   the OTP step using the dev shortcut documented in the privacy
   policy." Save.
3. **Ads** — "No, my app does not contain ads." Save.
4. **Content rating** — Start questionnaire. Category: **Utility,
   productivity, communication, or other** (NOT entertainment).
   Email: `kevinisaackareithi@gmail.com`. Then for every question:
   - Violence: No
   - Sexual content: No
   - Profanity: No
   - Controlled substances: No
   - Gambling: **No** (this is critical · we are NOT gambling even
     though we touch crypto)
   - Cryptocurrency: Yes (declare it)
   - Health-sensitive content: No
   - User-generated content: No
   - Personal info shared: Yes (self · phone, email)
   Submit. Expected rating: **Everyone** or **Teen**.
5. **Target audience and content** — Select age 18+ (we're a
   financial app under VASP Act 2025, which requires adult users).
   Tick "All ages" off. Save.
6. **News apps** — No, we are not a news app. Save.
7. **Data safety** — see Step 2 below.
8. **Government apps** — No, we are not a government app. Save.

## Step 2 · Data safety form

Most-rejected section · take 10 minutes to fill correctly.

**Does your app collect or share any user data?** → **Yes**

**Is all of the data encrypted in transit?** → **Yes** (we use HTTPS
exclusively, TLS 1.3).

**Do you provide a way for users to request data deletion?** → **Yes**
URL: `https://cpay.co.ke/privacy#data-deletion` (we have the
`/account/delete/` endpoint in the app + a 14-day grace period).

### Data types collected

Tick these in the data-types matrix:

| Category | Data type | Collected | Shared | Optional | Purposes |
|---|---|---|---|---|---|
| Personal info | Name | ✓ | — | No | App functionality, Account management |
| Personal info | Email address | ✓ | — | No | Account management, Communications |
| Personal info | Phone number | ✓ | — | No | App functionality, Account management |
| Personal info | User IDs | ✓ | — | No | Account management |
| Financial info | User payment info | ✓ | — | No | App functionality |
| Financial info | Purchase history | ✓ | — | No | App functionality, Account management |
| Financial info | Other financial info | ✓ | — | No | App functionality (KES + crypto balances) |
| Files & docs | Photos | ✓ | — | Yes (KYC tier 1+) | App functionality (KYC verification per VASP Act 2025) |
| App activity | App interactions | ✓ | — | No | Analytics |
| App activity | Other actions | ✓ | — | No | Analytics |
| Device or other IDs | Device IDs | ✓ | — | No | Fraud prevention, security |

**Shared with third parties:**
- ✓ Personal info (Phone, Name) shared with **SasaPay Communications
  Limited** (CBK-licensed PSP, merchant code 1334777) for M-Pesa rail
- ✓ Personal info (Phone) shared with **IntaSend** (CBK-licensed
  payments aggregator) when used as fallback rail
- (When wired) Personal info + Photos shared with **Smile Identity**
  for KYC verification

**Data NOT collected:**
- ❌ Location (any granularity)
- ❌ Contacts
- ❌ SMS / MMS
- ❌ Audio / Video
- ❌ Browsing / search history
- ❌ Health & fitness
- ❌ Web browsing data

**Security practices:**
- ✓ Data is encrypted in transit
- ✓ Users can request data deletion
- ✓ I have committed to the Play Families Policy: N/A (we're 18+)
- ✓ Independent security review: Yes · 2026-04-22 audit, all
  CRITICAL/HIGH closed

Click Save. The form might warn you about apparent inconsistencies
(e.g. "you said no location but the app requests INTERNET" · that's
fine, INTERNET is not location). Confirm and submit for review.

## Step 3 · Store listing

Main store listing tab:

**App name:** `Cpay`

**Short description (80 chars max):**
```
Pay any Kenyan bill or merchant directly from your USDT, BTC, ETH or SOL.
```

**Long description:** Paste the proven-safe copy from
`docs/PLAY-CONSOLE-RELEASE-RUNBOOK.md` (the "App listing copy" section).

**Graphics:**
- App icon · 512×512 · `mobile/assets/icon.png`
- Feature graphic · 1024×500 · need to design (placeholder OK for
  Internal Test, must be real for Closed/Production)
- Phone screenshots · 7-8 shots, 1080×1920 portrait · pull from a
  Pixel emulator · Show: home, deposit short-code, pay bill flow,
  wallet, transaction history
- Tablet screenshots (optional)

**Categorization:**
- App category: `Finance`
- Tags: cryptocurrency, payments, m-pesa, kenya, fintech

**Contact details:**
- Email: `support@cpay.co.ke`
- Phone: your business number
- Website: `https://cpay.co.ke`

Click Save.

## Step 4 · Create the Internal Testing release

This skips Google review entirely · safe to do FIRST every time.

1. Left sidebar → **Testing → Internal testing**
2. Tab "Releases" → **Create new release**
3. Use **Google-managed signing key** (Play App Signing) · accept
   the prompt to enrol if not already done. **DO NOT** opt out · this
   is the modern best practice and prevents you losing your signing
   key forever.
4. Drag-and-drop the `.aab` file from
   `\\wsl.localhost\Ubuntu\root\cpay-aab\cpay-v1.1.0-vc2-...aab`
5. Release name: `1.1.0 (2)` (auto-suggested · accept)
6. Release notes: paste the EN block from
   `docs/release-notes/v1.1.0.md`. Click `+` to add Swahili and
   paste the SW block.
7. Save.
8. Review release. Address any warnings (likely none).
9. **Start rollout to Internal testing**.

Wait 5-15 minutes. The Internal release will show "Available to
testers".

**Add yourself as a tester:**
- Internal testing → Testers tab → Create email list · name it
  "Cpay ops"
- Paste your Gmail (the one your Play Store app is signed into)
- Save.
- Copy the **opt-in URL** (looks like
  `https://play.google.com/apps/internaltest/<long-id>`)
- Open it on your Android phone, tap "Become a tester", then
  "Download it on Google Play"
- The Play Store opens to your app's listing with an "[Internal
  testing]" tag · install.

## Step 5 · Smoke-test the Internal install (24h)

Run through the full flow on your phone:
- Sign in
- Deposit screen → Pick USDT → Get short code → Pay paybill 756756 →
  Confirm USDT credited
- Pay Bill (any utility you have) → Confirm M-Pesa SMS lands
- Wallet balance reads correctly
- Transaction history shows the deposit

If anything misbehaves, fix in code, bump versionCode to `3`,
rebuild AAB, upload as a NEW release in Internal testing. Don't
promote to Closed until Internal is clean.

## Step 6 · Promote to Closed Testing (after 24h, ≥7 days at this stage)

Internal Testing → Releases → Latest release → **Promote release →
Closed testing**.

**Closed testing** means Google reviews the app (~hours-days, faster
after the first approval). 50-200 testers can opt in.

After Closed Testing approval (you'll get an email):
- Go to Closed testing → Testers tab → Create your beta list (paste
  50 names you trust)
- Send them the opt-in URL via WhatsApp / email
- Stay on Closed for ≥ 7 days. Watch the Pre-launch Report + Vitals
  for crash rate / ANR rate.

## Step 7 · Promote to Production with staged rollout

After Closed for ≥ 7 days with no escalating issues:

Closed testing → Latest release → **Promote release → Production**.

**Set rollout to 1% first.** Wait 24-48h. Watch:
- Play Vitals (crash rate < 0.5%, ANR rate < 0.2%)
- Sentry for backend errors
- Customer support tickets

Then promote to 5% → 20% → 50% → 100% over a week.

---

## If Play rejects again

The runbook (`docs/PLAY-CONSOLE-RELEASE-RUNBOOK.md`) has the
recovery flow. Two-line summary: read the policy reason, fix the
underlying issue, bump versionCode to 3, rebuild, re-upload to
Internal Testing first. Don't argue with the bot · use the Appeal
flow if you genuinely think the rejection is wrong.

---

## After the upload · what I'll do

Once the AAB is ready I'll:
1. Save it to `\\wsl.localhost\Ubuntu\root\cpay-aab\` (built there
   directly · accessible from Windows Explorer at `\\wsl.localhost`)
2. Also copy a backup to the VPS at `/root/cpay-aab-archive/` so
   we have an offsite copy.

You'll then drag-and-drop into the Play Console release form.
