"""
One-shot Django shell script to email the user a complete audit-cycle
+ APK-ready summary.

Run with:
    docker compose -f docker-compose.prod.yml exec -T web \
      python manage.py shell -c "$(cat scripts/_mail-audit-report.py)"

Delivers via mail_admins-compatible path (uses Django's configured email
backend and signed from DEFAULT_FROM_EMAIL).

Content is inlined here so the email is one rendered HTML body — no
external template dependency. Safe to re-run; sends a fresh email each
time.
"""
from django.core.mail import EmailMultiAlternatives
from django.conf import settings

RECIPIENT = "jimvuetutor@gmail.com"
DATE = "2026-04-24"

subject = f"CPay · Audit cycle-2 closed + new APK live · {DATE}"

html = """
<!doctype html>
<html>
<body style="margin:0;padding:0;background:#060E1F;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="background:#0E1D35;border-radius:12px;overflow:hidden;">
  <tr><td style="background:#0B1220;padding:24px 32px;border-bottom:4px solid #10B981;">
    <h1 style="margin:0;color:#F1F5F9;font-size:24px;font-weight:700;letter-spacing:-0.5px;">
      <span style="color:#10B981;">C</span>pay — Audit Report
    </h1>
    <p style="margin:6px 0 0;color:#94A3B8;font-size:12px;letter-spacing:0.3px;">
      2026-04-24 · Cycle-2 complete, APK live on VPS
    </p>
  </td></tr>

  <tr><td style="padding:28px 32px;color:#CBD5E1;font-size:14px;line-height:1.6;">

    <h2 style="color:#F1F5F9;font-size:18px;margin:0 0 12px;">What's live right now</h2>
    <ul style="padding-left:20px;margin:0 0 20px;">
      <li><strong style="color:#10B981;">https://cpay.co.ke</strong> — health 200, latest commit <code style="color:#F59E0B;">a665fa4</code></li>
      <li><strong style="color:#10B981;">https://cpay.co.ke/apk/</strong> — tracker redirects to the nginx-served binary, counter ticks in Redis on every hit</li>
      <li><strong style="color:#10B981;">Admin APK counter</strong> — Settings → Admin · Users · top presence bar shows running total</li>
    </ul>

    <h2 style="color:#F1F5F9;font-size:18px;margin:24px 0 12px;">Cycle-1 findings closed (5 + 2 bonus)</h2>
    <table cellpadding="6" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="color:#10B981;vertical-align:top;width:70px;">A1</td><td>Welcome / OTP / KYC / security emails now gate on <code>notify_email_enabled</code> and localise via <code>user.language</code>. Safety-critical kinds (OTP, security alert, KYC) bypass the gate.</td></tr>
      <tr><td style="color:#10B981;vertical-align:top;">A2</td><td>Quote <code>fee_kes</code> now reports the TOTAL platform fee (spread + flat) instead of just flat — fixes KRA excise reconciliation risk.</td></tr>
      <tr><td style="color:#10B981;vertical-align:top;">A3</td><td>DepositQuoteView fee mismatch — verified false positive (saga at <code>mpesa/tasks.py:279</code> already applies the fee).</td></tr>
      <tr><td style="color:#10B981;vertical-align:top;">A4</td><td>Referral clawback on REVERSED qualifying deposit. Celery-broker-down fallback to in-process.</td></tr>
      <tr><td style="color:#10B981;vertical-align:top;">A5</td><td>C2BValidationView no longer leaks the 30s daily-limit Redis lock (context-manager form).</td></tr>
      <tr><td style="color:#10B981;vertical-align:top;">5.1</td><td>Swap fee routed to explicit <code>SystemWallet(wallet_type=FEE)</code> — aborts loud when missing instead of silently swallowing revenue.</td></tr>
      <tr><td style="color:#10B981;vertical-align:top;">5.5</td><td>Referral credit now refunds the crypto-equivalent back to the user's source wallet (was a real money bug).</td></tr>
    </table>

    <h2 style="color:#F1F5F9;font-size:18px;margin:24px 0 12px;">Cycle-2 findings closed (7 + 3 LOW)</h2>
    <table cellpadding="6" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="color:#EF4444;vertical-align:top;width:70px;">CRIT 1</td><td>SwapView <code>NameError</code> (<code>ser.validated_data</code> vs <code>serializer</code>) — every swap 500'd. One-line fix + regression test.</td></tr>
      <tr><td style="color:#F59E0B;vertical-align:top;">HIGH 2</td><td><code>lock_funds</code> / <code>unlock_funds</code> now idempotent via Redis tx-id flag. Saga retries can't double-lock.</td></tr>
      <tr><td style="color:#F59E0B;vertical-align:top;">HIGH 3</td><td><code>MpesaCallback.mpesa_receipt</code> partial-unique DB constraint + atomic <code>get_or_create</code> (migration 0002).</td></tr>
      <tr><td style="color:#F59E0B;vertical-align:top;">HIGH 4</td><td>Referral status labels exhaustive across all 6 <code>Referral.Status</code> values.</td></tr>
      <tr><td style="color:#F59E0B;vertical-align:top;">MED 5</td><td><code>MyReferralSerializer</code> declares the fields the view actually returns.</td></tr>
      <tr><td style="color:#F59E0B;vertical-align:top;">MED 6</td><td>Transaction-receipt signed URL is now one-shot (Redis nonce consumed on first hit).</td></tr>
      <tr><td style="color:#F59E0B;vertical-align:top;">MED 7</td><td>RequestOTPView response is constant-shape — no more <code>email_fallback</code> leak.</td></tr>
      <tr><td style="color:#64748B;vertical-align:top;">LOW 9</td><td>Security-critical email with no address on file now logs a WARNING instead of silently dropping.</td></tr>
      <tr><td style="color:#64748B;vertical-align:top;">LOW 10</td><td>TOTP verify endpoint returns a single generic 401 for every precondition — no 2FA-enabled enumeration.</td></tr>
      <tr><td style="color:#64748B;vertical-align:top;">LOW 11</td><td>PIN-lockout thresholds lowered from 5/10/15 to 3/6/10 — first lockout fires at the same attempt count as the OTP challenge.</td></tr>
    </table>

    <h2 style="color:#F1F5F9;font-size:18px;margin:24px 0 12px;">Mobile / APK fixes in this build</h2>
    <ul style="padding-left:20px;margin:0 0 20px;">
      <li>Splash no longer truncates to <strong>"Cpa"</strong> — LoadingScreen uses an <code>&lt;Image&gt;</code> Coin-C mark + hand-rolled Text with safe metrics (<code>lineHeight:40</code>, <code>includeFontPadding:true</code>, <code>allowFontScaling:false</code>). Renders correctly even before DM Sans loads.</li>
      <li>Tab bar "phantom strip" / "tabs under system nav" both fixed — honours <code>insets.bottom</code> exactly (no floor, no zero-override).</li>
      <li>Profile / header / settings avatars are now <strong>perfect circles</strong> (UserAvatar default <code>borderRadius = size/2</code>).</li>
      <li>Receipt PDF now renders a real "Paid To" header for <strong>swap / buy / sell / chain deposit / chain withdrawal</strong> (was blank for non-M-Pesa types).</li>
      <li>Onboarding slides now wrap the hard-coded paddings with <code>insets.bottom / .top</code> — "Get started" button never clips behind the system nav again.</li>
      <li>9-step tour aligned to the design-bundle <code>TOUR_STEPS</code> spec (copy updated in English + Swahili; step 8 = rate-lock preview wrapping MobileCryptoCharts; step 9 = transaction history).</li>
    </ul>

    <h2 style="color:#F1F5F9;font-size:18px;margin:24px 0 12px;">Testing pipeline shipped</h2>
    <ul style="padding-left:20px;margin:0 0 20px;">
      <li><code>.github/workflows/ci.yml</code> — secret-scan job (keystore / PEM / AWS / Expo / GitHub tokens) + backend + frontend + <code>deploy-gate</code>.</li>
      <li><code>docker-compose.staging.yml</code> — prod-mirror overlay; isolated DB, sandbox payment endpoints, backup BlockCypher token.</li>
      <li><code>scripts/smoke-staging.sh</code> — 6 fail-fast checks; exit 1 aborts the prod deploy.</li>
      <li><code>scripts/deploy-production.sh</code> — refuses to deploy unless GitHub deploy-gate is green AND staging smoke is green.</li>
    </ul>

    <h2 style="color:#F1F5F9;font-size:18px;margin:24px 0 12px;">Balance-lock feature research</h2>
    <p style="margin:0 0 12px;">
      <code>docs/research/BALANCE-LOCK.md</code> — 2,400-word viability assessment.
      <strong style="color:#EF4444;">Verdict: red-light the hedge product; green-light a stop-loss order instead.</strong>
      Five disqualifying dimensions (actuarial economics, no hedge instrument in KES, 12-24 month CBK / CMA / KRA clearance, concentrated-expiry custody risk, user problem already solved by swap-to-USDT / swap-to-KES / stop-loss). Recommended build: stop-loss order, 2-3 engineer-weeks, zero capital risk.
    </p>

    <h2 style="color:#F1F5F9;font-size:18px;margin:24px 0 12px;">APK build & upload</h2>
    <ul style="padding-left:20px;margin:0 0 20px;">
      <li>Latest binary: <code>https://cpay.co.ke/download/cryptopay.apk</code></li>
      <li>Short-URL tracker: <code>https://cpay.co.ke/apk/</code> → 302 → download (counter ticks)</li>
      <li><strong>If you're testing on Android and still see old UI</strong>: Settings → Apps → Cpay → Force Stop → Uninstall → reinstall from the link above. Android caches APK installations aggressively.</li>
    </ul>

    <p style="margin:20px 0 0;color:#64748B;font-size:12px;border-top:1px solid #1F2937;padding-top:16px;">
      Tests: 337/337 backend pytest pass · 9 AWS-path skipped (no boto3 in dev).
      Commit history: <code>210b7e5</code> → <code>eb59c22</code> → <code>6453ab8</code> → <code>a665fa4</code>.
    </p>

  </td></tr>

  <tr><td style="background:#0A1628;padding:18px 32px;text-align:center;border-top:1px solid #1F2937;">
    <p style="margin:0;color:#64748B;font-size:11px;">
      <strong style="color:#94A3B8;"><span style="color:#10B981;">C</span>pay</strong> · Automated audit report · cpay.co.ke
    </p>
  </td></tr>
</table>
</td></tr></table>
</body>
</html>
"""

text = (
    "CPay audit report · 2026-04-24\n"
    "=" * 50 + "\n\n"
    "Cycle-1 closed: A1-A5 (emails gate, fee_kes spread, clawback on reversed, C2B lock leak) + 5.1 (swap fee wallet) + 5.5 (crypto refund on credit).\n"
    "Cycle-2 closed: CRIT 1 SwapView NameError, HIGH 2 lock idempotency, HIGH 3 C2B callback atomic, HIGH 4 status labels exhaustive, MED 5 serializer drift, MED 6 receipt one-shot URL, MED 7 OTP response shape, LOW 9 undeliverable-email warn log, LOW 10 TOTP uniform 401, LOW 11 PIN-lockout 3/6/10.\n"
    "Mobile/APK: splash truncation fixed, tab-bar safe-area correct, avatar circles, receipt Paid-To headers for swap/buy/sell/chain, onboarding SafeAreaView, 9-step tour aligned to design.\n"
    "CI + staging: .github/workflows/ci.yml (secret scan + deploy-gate), docker-compose.staging.yml, smoke-staging.sh, deploy-production.sh.\n"
    "Research: docs/research/BALANCE-LOCK.md — RED-LIGHT the hedge, GREEN-LIGHT a stop-loss order.\n\n"
    "APK live: https://cpay.co.ke/apk/ (force-stop + reinstall if you still see old UI).\n"
    "Tests: 337/337 pass. Commits: 210b7e5 → eb59c22 → 6453ab8 → a665fa4.\n"
)

msg = EmailMultiAlternatives(
    subject=subject,
    body=text,
    from_email=getattr(settings, "DEFAULT_FROM_EMAIL", "CPay <noreply@cpay.co.ke>"),
    to=[RECIPIENT],
)
msg.attach_alternative(html, "text/html")
sent = msg.send(fail_silently=False)
print(f"RESULT: {sent} message(s) sent to {RECIPIENT}")
