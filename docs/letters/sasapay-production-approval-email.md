# Email to SasaPay · production approval follow-up

**Send to:** `merchants@sasapay.co.ke`
**CC:** `support@sasapay.app`, `developers@sasapay.app`
**Subject:** Cpay Technologies (Merchant 1334777) · ready for production review · live integration evidence

---

## Body

Hi team,

Following up on our merchant onboarding · Cpay Technologies, merchant code 1334777. Our application is showing under Production Applications on the dashboard and we have the Client ID + Client Secret in hand.

Quick recap of where we are so the review goes smoothly:

We have built and tested the full integration on your sandbox. OAuth handshake works (we are pulling tokens cleanly from `/auth/token/` against `sandbox.sasapay.app`), and we have wired up all four of the flows we need · STK Push for crypto purchases, B2B Paybill and B2B Till for our outgoing flows, and B2C for refunds. Webhook signature verification is in place against the `X-SasaPay-Signature` HMAC header, plus a per-tx URL-token fallback we control on our side.

You should see a steady-low volume of test calls hitting our sandbox account from `cpay.co.ke` · that is our smoke-test command we run after each deploy. Happy to up the pace if it helps the review.

A few small things on your side that would unblock us:

1. Production approval on merchant 1334777 so we can flip our `PAYMENT_PROVIDER=sasapay` env in production. Once that goes through we will start with KES 100 live test transactions and ramp from there.
2. The webhook secret value we should configure for HMAC verification on incoming callbacks · we have not seen it on the dashboard yet. Currently using `SASAPAY_WEBHOOK_SECRET` as a placeholder env name; we will swap in your value the moment we have it.
3. Confirmation that the C2B paybill 756756 with our merchant account 1334777 works for sub-account suffixes (we use the form `1334777-USDT-254712345678` so we can route a single deposit to the right user + asset). We have implemented the parser on our side; just want to confirm SasaPay forwards the full account string in `BillRefNumber` without truncation.

On the regulatory side · we are tracking the CBK Letter of No Objection process in parallel and will share progress as it lands. Nothing about the technical integration is contingent on it; our product is positioned as a digital asset payment processor under the VASP Act 2025 framework.

Happy to jump on a 15-minute call to walk through anything that needs clarifying. Whatever works for your team.

Thanks for the support so far.

Kevin Isaac Kareithi
Founder · Cpay Technologies
[your phone]
[your email]
https://cpay.co.ke

---

## Attachments to send

- Updated business profile (`docs/Cpay-Technologies-Business-Profile.docx`)
- Director ID front + back (already on file from initial application)

## Tone notes

- Reads like a human ops update, not a templated form letter
- Three concrete asks numbered so they cannot be overlooked in their queue
- Mentions the test traffic by name · proves we are actually building, not just talking
- The CBK paragraph lands the regulatory disclosure without making it the headline
- No em-dashes (brand convention · middot only)
- No buzzword-heavy phrases · "robust", "synergy", "leverage" deliberately avoided
- One small typo / sloppy sentence is fine if you want · humans write that way
