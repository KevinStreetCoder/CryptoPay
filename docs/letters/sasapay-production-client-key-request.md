# Email to SasaPay support · production Client Key request

**Send to:** `support@sasapay.app`
**CC:** `merchants@sasapay.co.ke`, `developers@sasapay.app`
**Subject:** Cpay Technologies · merchant 1334777 · production Client Key please

---

## Body

Hi team,

Quick one. Our production application for Cpay Technologies (merchant code 1334777) is approved on the dashboard · I can see the merchant under Production Applications. The Client ID and Client Secret slots are showing as `xxxxxxxxxxxx` placeholders rather than the live values.

We have already finished and tested the integration end-to-end on the sandbox · OAuth, STK Push, B2B Paybill, B2B Till, B2C Send-to-Mobile all working against `sandbox.sasapay.app`. You should see the steady test traffic from `cpay.co.ke` in our sandbox account.

Could you reveal or re-issue the production Client ID + Client Secret on merchant 1334777 so we can flip `PAYMENT_PROVIDER=sasapay` in our production environment and start the live ramp?

If there is a separate review step that needs to clear before the live keys are released, please let me know what's outstanding · happy to provide anything else.

While we wait, also two small follow-ups:

1. The webhook secret value for HMAC signature verification on incoming callbacks · we need this set on our side as `SASAPAY_WEBHOOK_SECRET` before flipping the env. Where can I copy it from on the dashboard?
2. The SasaPay paybill 756756 + sub-account format we use is `1334777-<CRYPTO>-<phone>` (e.g. `1334777-USDT-254712345678`). Just confirming SasaPay forwards the full account string in the `BillRefNumber` field on the C2B IPN without truncating · we have the parser working in sandbox but want to be sure live behaves the same.

Thanks for the quick turn around · we're ready to go live the moment the keys land.

Kevin Isaac Kareithi
Founder · Cpay Technologies
[your phone]
[your email]
https://cpay.co.ke

---

## Why this email and what it is asking for

- **One concrete ask** in the opening · the Client Key. The two follow-ups are clearly secondary so the support agent does not have to triage.
- **States that integration testing is done** · saves SasaPay support a back-and-forth where they ask if we have hit the sandbox.
- **References merchant code 1334777 directly** in the subject + first line · the agent can pull our file in one query.
- **The webhook secret question** is genuinely a follow-up · we don't yet know where SasaPay surfaces it on the dashboard. Putting it inside this email rather than a fresh thread keeps the conversation tight.
- **No em-dashes, brand convention** · middot only.
- **Offers something** ("happy to provide anything else") rather than just demanding · matches the tone of the earlier merchant onboarding email.
