# Email to SasaPay · merchant onboarding application

**Send to:** `merchants@sasapay.co.ke`

**Subject:** Cpay Technologies (BN-B8S6JP89) · Merchant Application · Crypto-to-M-Pesa payment platform

---

## Body of email

Dear SasaPay Merchant Onboarding Team,

I am writing to apply for a SasaPay merchant account on behalf of Cpay Technologies, business name reservation BN-B8S6JP89. We are a Kenyan-incorporated technology company that has built a digital asset payment platform allowing our users to pay everyday bills, M-Pesa numbers, and bank accounts using their digital asset balances. Behind the scenes the user's payment is converted into Kenya Shillings and routed onto M-Pesa rails, so the recipient experiences an ordinary M-Pesa transfer.

We are looking for a CBK-licensed payment service provider to handle the M-Pesa side of our flow, and SasaPay's combination of CBK PSP licensing and developer-friendly API has put you at the top of our shortlist. We have already prototyped against your sandbox documentation at docs.sasapay.app and the integration with our backend (Django, sub-second saga orchestration, full reconciliation queues) is ready for production credentials.

I want to be upfront about our category. We are a digital-asset-to-fiat payment processor, similar in spirit to international remittance fintechs but with the crypto leg internalised. We are aware this falls under the new VASP Act 2025 and we have separately engaged the Central Bank of Kenya for a Letter of No Objection while VASP regulations are finalised. We mention this so there are no surprises during your KYB review.

To take the application forward, please find attached:

1. The completed SasaPay Merchant Application Form
2. Our business profile (a short, plain-English description of what Cpay does, our risk controls, and our settlement model)
3. The BN-B8S6JP89 Name Reservation Certificate
4. Director identification

We would also welcome a short call with your compliance team, in person at SasaPay's office or virtually, before you start the formal review. A 20-minute conversation tends to surface any open questions faster than email back-and-forth, and we would rather front-load any concerns than discover them at the production-credentials stage.

A few questions on our side:

1. Are crypto-onramp / crypto-payment-processor merchants accepted as a category, or is there a separate stream for VASP-adjacent businesses?
2. What is your typical approval timeline from a complete KYB file to production credentials?
3. Do you support all four payment types we need · C2B / STK Push, B2C, B2B Paybill, and B2B Till?
4. Per-transaction caps and daily merchant limits for an account of our profile?
5. Is the M-Pesa receipt sender name customisable (e.g. "Cpay" via a sub-account) or is it fixed to "SASAPAY"?

Thank you for the work you do making M-Pesa rails accessible to smaller fintechs. We look forward to your reply.

Yours faithfully,

[Operator full name]
Founder and Director
Cpay Technologies (BN-B8S6JP89)

Email: [operator email]
Mobile: [operator phone]
Website: https://cpay.co.ke

---

## Attachments

- Filled `Merchant_Application_Form.pdf` (download from https://sasapay.co.ke/files/Merchant_Application_Form.pdf, complete, sign, scan)
- `docs/Cpay-Technologies-Business-Profile.docx` (already prepared)
- `docs/BN-B8S6JP89-Name Reservation Certificate.pdf`
- Director's national ID / passport scan

## What to expect after sending

| Stage | Typical timeline |
|---|---|
| Initial reply with questions | 1-3 working days |
| KYB compliance review | 1-2 weeks |
| Merchant Code issued + welcome email | 1-2 weeks after compliance approval |
| Production API credentials (Client ID + Secret) | Same day as merchant code |

Total: typically 2-4 weeks for a clean file. The "compliance call" we offer in the email tends to compress this because it eliminates the back-and-forth on category questions.

## What NOT to do

- ❌ Don't apply via the dev console (`apps.sasapay.app/console`) without a Merchant Code · that's where you go AFTER merchant approval
- ❌ Don't hide the crypto angle · they'll find it on cpay.co.ke anyway, and being upfront is what speeds approval
- ❌ Don't reply to Safaricom Falcon yet · separate track, separate timing

## Tone choices in this email

- Plain English, no legalese · same as the CBK letter
- No em-dashes (brand convention)
- Discloses the crypto category in paragraph 3 · avoids any "they didn't tell us" surprises during compliance
- Asks 5 specific questions so the reply structures their thinking
- Offers a pre-application call · faster path to clarity than email back-and-forth
