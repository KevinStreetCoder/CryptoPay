# Signup email abuse · mitigation plan

**Status**: research, not yet implemented
**Owner**: backend
**Effort**: ~5 days for the meaningful chunk (layers 1-3)
**Updated**: 2026-04-25

## Why this matters now

The audit didn't flag this, but it's a real abuse vector. Fake / disposable
email accounts (mailinator, 10minutemail, guerrillamail, tempmail.dev,
throwawaymail, plus a long tail of newer ones that rotate weekly) let
abusers create Cpay accounts that:

1. Stack referral signups across many fake identities. The clawback path
   exists but the abuser pockets cash before we catch them.
2. Pollute the marketing analytics (campaign attribution, newsletter
   open-rates, churn cohorts).
3. Bypass the email-as-recovery channel we plan to use for tier 2+ KYC.

Cpay's primary identifier is the phone number, not email, which limits
the blast radius. Phone OTP is the real proof-of-human gate. But the
email field is currently optional and unverified, and that hole widens
as we add features that key off it.

## Threat model

The opportunist abuser is the realistic adversary. They want a Cpay
account without exposing real identity. They're not going to buy a
Kenyan SIM to bypass phone OTP, but they will type
`junk@mailinator.com` into the email field every chance they get.

Sophisticated attackers can use real Gmail addresses with `+suffix`
aliases. Gmail ignores the suffix server-side, so
`abuser+1@gmail.com`, `abuser+2@gmail.com`, etc. all hit the same
inbox. Same trick works with `dots.in.local.parts@gmail.com`. We have
to handle both.

## Five-layer plan

### Layer 1 · Disposable-domain blocklist

Maintain a list of known throwaway-email domains. Reject signup if
the email's domain is on it.

Source: the open-source `disposable-email-domains` repo on GitHub
(2,500+ domains, monthly updates). Snapshot to
`backend/apps/accounts/disposable_domains.txt`. Refresh quarterly via
a CI cron that diffs the upstream file and opens a PR.

```python
# apps/accounts/email_validation.py
DISPOSABLE_DOMAINS = _load_blocklist("disposable_domains.txt")

def is_disposable(email: str) -> bool:
    domain = email.lower().rsplit("@", 1)[-1].strip()
    return domain in DISPOSABLE_DOMAINS
```

Apply at:
- `RegisterSerializer.validate_email`
- `RequestEmailVerificationView` (post-signup email-add path)
- `RecoveryEmailSerializer.validate_email`

**Cost**: zero. **Effectiveness**: catches 95% of obvious abuse.

### Layer 2 · MX record validation

Resolve the domain's MX records. Reject if there are no MX records
(domain doesn't accept mail) or the MX points to a known disposable
provider's mail host. Use `dnspython` with a 3-second timeout, cached
in-process for an hour.

```python
import functools, dns.resolver

@functools.lru_cache(maxsize=10000)
def has_valid_mx(domain: str) -> bool:
    try:
        records = dns.resolver.resolve(domain, "MX", lifetime=3)
        return bool(records)
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer,
            dns.resolver.Timeout, dns.exception.DNSException):
        return False
```

**Cost**: one DNS lookup per signup with cache hits afterwards.
**Effectiveness**: catches typosquatted domains, bare-domain
throwaways, and offers a defence against the long-tail blocklist
miss.

### Layer 3 · Email verification before sensitive actions

The system already mints `EmailVerificationToken` (audit HIGH-4
hardened the OTP space to 8 alphanumeric chars). What's missing is
the **gate**: today the token is generated on demand but most flows
don't enforce verification before allowing high-value actions.

Make `email_verified=True` a precondition on:

- `apps/accounts/views.py::AdminVerifyUserView` (admin tier upgrade
  to tier 2+ should refuse if email isn't verified)
- `apps/payments/views.py::WithdrawView` (when bank withdrawal lands)
- All `apps/notifications` channels gated by
  `notify_marketing_enabled`

This is the layer that does the most work, because it shifts the
value of a verified email from "nice to have" to "required for the
action the user came here to do".

### Layer 4 · Gmail dot+plus normalisation

Gmail treats `johndoe@gmail.com`, `j.o.h.n.d.o.e@gmail.com`, and
`johndoe+anything@gmail.com` as the same address. An abuser stacking
referrals via plus-aliases will hit the same inbox repeatedly. Same
trick with `googlemail.com`.

Normalise on the way in. Store both raw and normalised forms.
Uniqueness on the normalised form so the same human can't open ten
accounts.

```python
def normalise_email(email: str) -> str:
    local, domain = email.lower().split("@", 1)
    if "+" in local:
        local = local.split("+", 1)[0]
    if domain in ("gmail.com", "googlemail.com"):
        local = local.replace(".", "")
        domain = "gmail.com"
    return f"{local}@{domain}"
```

Add `normalised_email` field on `User` (DB migration). Unique
constraint there, not on `email`. Display the original `email` to
the user; query by `normalised_email` server-side.

### Layer 5 · Behavioural trust score

Track a per-account score:

- Phone OTP succeeded on first try → +1
- KYC selfie matches ID → +5
- 7 days of activity, no complaints → +1/day
- Multiple accounts from same IP within 24h → -10
- Disposable email even after Layer 1 (a new domain not yet on the
  list) → -5

Block high-value actions when the score is below a threshold. Persist
the score on the user model. Defer to post-MVP.

## Recommended landing order

1. Layer 1 · 1 day · drops in under the existing serializer
2. Layer 4 · 1 day · adds a `normalised_email` migration + uniqueness
3. Layer 2 · 1 day · runtime DNS lookup with cache
4. Layer 3 · 2 days · audit existing flows for the gate
5. Layer 5 · post-MVP

Total for layers 1-3: about 5 days. Closes most of the abuse surface
without third-party dependencies.

## What we're NOT doing

- **Paid email-validation services** (ZeroBounce, Hunter.io,
  EmailListVerify). They cost cents per check and add a third-party
  dependency for a problem layers 1-2 cover. Re-evaluate only if
  layers 1-2 prove inadequate in production data.
- **CAPTCHA at signup**. Phone OTP already serves as the
  proof-of-human gate. CAPTCHAs add friction with limited marginal
  benefit on an SMS-OTP-fronted system.
- **Disposable-detection ML models**. Overkill. The two open-source
  blocklists plus MX validation handle real-world abuse for years
  before pattern-matching becomes worth the engineering.

## Metrics to watch after deployment

- `% of signups rejected at Layer 1` · should plateau in the 2-8%
  range; spikes signal a campaign
- `% of email_verified=True after 24h of signup` · trend should rise
  as Layer 3 lands
- `Avg referrals per email-domain` · the canonical referral-stacking
  signal; outliers worth investigating manually
