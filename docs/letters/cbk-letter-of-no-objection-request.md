# Email to CBK · request for Letter of No Objection

**Send to:**
- Primary: `nps@centralbank.go.ke`
- CC: `info@centralbank.go.ke`, `psp@centralbank.go.ke`

**Postal address (also for couriered hard-copy of supporting documents):**

> The Director
> National Payments System Department
> Central Bank of Kenya
> Haile Selassie Avenue
> P.O. Box 60000 · 00200
> Nairobi, Kenya

**Subject line:**

> Cpay Technologies (BN-B8S6JP89) · Application for Letter of No Objection · Crypto-to-M-Pesa payment processing

---

## Body of email

Dear Director,

I am writing on behalf of Cpay Technologies, business name reservation BN-B8S6JP89, to formally request the documentation checklist and process for obtaining a Letter of No Objection from the Central Bank of Kenya in respect of our intended payment processing activity.

We are a Kenyan-incorporated technology company building a digital asset payment platform that allows users in Kenya to convert their digital asset holdings into Kenya Shillings and use the proceeds to pay everyday bills, M-Pesa numbers, and bank accounts. The user experience mirrors a normal M-Pesa transaction. Behind the scenes we hold a small float of digital assets and a corresponding KES float at a licensed payment service provider, and we settle each transaction by debiting the user's digital asset balance and crediting the destination through M-Pesa rails.

Our activity falls within the categories described in the Virtual Asset Service Providers Act 2025, specifically a virtual asset wallet provider and a virtual asset payment processor, both of which we understand are licensed by the Central Bank under the Act once the regulations are gazetted. We are aware that detailed regulations are still being finalised, and we are prepared to operate under a Letter of No Objection in the interim while we work toward a full licence.

We have already taken the following steps in good faith:

1. Reserved the business name with the Business Registration Service (BN-B8S6JP89).
2. Built an end-to-end production system that includes envelope encryption of customer wallet keys via Google Cloud KMS, a saga-based payment orchestration layer with full reconciliation queues, and an AML and CFT framework aligned with POCAMLA and the FATF Travel Rule.
3. Engaged Safaricom for direct Daraja merchant access. The Safaricom team reached the validation stage of our application and asked us to provide the Letter of No Objection from the Central Bank as a precondition for issuing a merchant code. That feedback prompts this letter.

We respectfully request the following from your office:

1. The complete application checklist of documents required for the Letter of No Objection at our activity tier.
2. Confirmation of the application fee, currently understood to be Kenya Shillings 100,000.
3. Indicative timelines from a complete file submission to a decision.
4. Guidance on the capital adequacy bracket most appropriate for a virtual asset payment processor of our scale, given the brackets in the National Payment System Regulations 2014 (KES 5 million for an electronic retail PSP, KES 20 million for an e-money issuer, and KES 50 million for a designated payment instrument issuer).
5. Whether the Letter of No Objection can be issued in advance of the VASP regulations being gazetted, or whether the Bank prefers a coordinated application alongside the future VASP licence.

We have appointed counsel and will be submitting the formal application file shortly. We are happy to attend a preliminary meeting with the National Payments System Department at your convenience, in person at the Bank or virtually, to walk you through our business model, custody arrangements, and risk controls before the application file is submitted.

Should you require any clarification or additional information, please contact me directly at the details below.

Thank you for your time and for the work the Bank does in keeping the Kenyan payment ecosystem secure and inclusive.

Yours faithfully,

[Operator full name]
Founder and Director
Cpay Technologies (BN-B8S6JP89)

Email: [operator email]
Mobile: [operator phone]
Website: https://cpay.co.ke
Postal: [operator postal address, Nairobi]

---

## Attachments to include with the email

- Cpay Technologies Business Profile (`docs/Cpay-Technologies-Business-Profile.docx`)
- Business Name Reservation Certificate (`docs/BN-B8S6JP89-Name Reservation Certificate.pdf`)
- BN-B8S6JP89 signed registration document (`docs/BN-B8S6JP89-BN_Signed_2.pdf`)
- A one-page summary of the technical architecture (we have this in `docs/SYSTEM-DESIGN.md`; export to PDF and trim to a single page covering custody, KMS, ledger, and settlement)
- (optional) Cpay Investor Brief if useful (`docs/Cpay-Company-Brief.docx`)

## Why this email is structured the way it is

- **Tone is human, not legalistic.** The Bank receives many of these. Reading like a person who actually does the thing tends to land better than a lawyer's template.
- **No em dashes, only middot or commas.** Brand convention.
- **States the activity clearly** in the opening paragraph so the reader has the model in mind before any regulatory framing.
- **Acknowledges Safaricom's request** explicitly so the Bank knows where the trigger came from, and frames it as us responding in good faith rather than going around them.
- **Asks five specific questions** so the Bank's reply has a clear structure and we get a complete checklist back instead of a vague "submit your file."
- **Offers a meeting** before the formal file lands. This converts a paper review into a conversation; faster path to clarity on what they actually want.
- **Closes with "thank you for the work the Bank does."** Civil servant readers notice the difference.

## Operator todos before sending

- [ ] Replace `[Operator full name]`, `[operator email]`, `[operator phone]`, `[operator postal address, Nairobi]` with the real values.
- [ ] Confirm the BN-B8S6JP89 status. The name reservation expires Apr 24, 2026; if a full Certificate of Incorporation has now been issued, attach that instead and update the email's BN reference to the Company Number.
- [ ] Engage Kenyan counsel (AMG Advocates or CM Advocates LLP) before sending the formal application file. Counsel should review this email before it goes out so the early framing matches what they will file later.
- [ ] Have a separate ready-to-send email to SasaPay's compliance address (not blocked by the CBK conversation; goes out the same day).

---

*Companion docs · `DARAJA-CBK-BLOCKER-2026-04-30.md` and `PAYMENT-RAILS-COMPARISON-2026-04-30.md` in `docs/research/`.*
