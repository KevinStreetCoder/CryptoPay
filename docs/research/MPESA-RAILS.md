# M-Pesa rails · what Cpay can do today, and the next step

**Status**: research, partial implementation already shipped
**Owner**: payments
**Effort**: 3-4 days for "Send to Bank" UX, 1 day for Pochi labelling
**Updated**: 2026-04-25

## TL;DR

Cpay's existing payment paths already cover **every M-Pesa rail
Safaricom exposes through Daraja**:

- Pay Bill (corporate / utility / bank)
- Pay Till (Buy Goods)
- Send Money to phone (works for personal accounts AND Pochi la
  Biashara recipients)
- Send to bank account (works today via Pay Bill with the bank's
  paybill number; needs UX wrapper)

No new Daraja endpoint is required. What's missing is **product
surface** for two flows: a dedicated "Send to Bank" picker, and
education that "Send Money" already works for Pochi recipients.

## The four M-Pesa rails

| Rail | Daraja CommandID | Recipient identifier | Cpay status |
|---|---|---|---|
| Pay Bill | `BusinessPayBill` | 6-digit Paybill + account ref | ✅ Live (`/payments/pay-bill/`) |
| Pay Till (Buy Goods) | `BusinessBuyGoods` | 6-digit Till | ✅ Live (`/payments/pay-till/`) |
| Send Money to phone | `BusinessPayment` / `BusinessSendMoney` | Kenyan mobile number | ✅ Live (`/payments/send-mpesa/`) |
| Pay to bank | `BusinessPayBill` | Bank's paybill + customer's account no. | ⚠️ Possible via Pay Bill, no dedicated UX |

These are the only rails Daraja exposes. RTGS, SWIFT, and PesaLink
are NOT Daraja products; they require separate integrations. See
"Out of scope" below.

## Pochi la Biashara

Pochi la Biashara is **NOT a separate API integration**. It's a
Safaricom registration flag on a regular phone number that flips
the recipient classification from "personal" to "business receive".
For the sender, sending to a Pochi recipient is identical to sending
to any other Kenyan phone:

- Customer enters the trader's phone number
- Confirms with M-Pesa PIN
- Funds land on the trader's M-Pesa, but Safaricom records it as
  business income (exempt from monthly P2P caps; subject to the
  trader's Pochi business limits instead)

From Cpay's side, **`SendMpesaView` already works for Pochi
recipients with zero code changes**. The trader's phone number is the
only identifier needed.

What we can add for UX win:

- A "Pay a small business" tile that opens the standard Send Money
  flow but with friendlier placeholder text ("Trader's phone number"
  instead of "Recipient's phone")
- Optional in-history label: when a Send Money is paid and the
  Daraja callback flags the receiver as a business account, surface
  "Business" in the user's transaction list.

Engineering cost: zero for the rail. ~1 day for the UX surface.

## Send to Bank

Most Kenyan commercial banks accept M-Pesa via a dedicated Pay Bill
number. The customer's bank account number is the **account
reference** field on the Pay Bill rail.

So sending crypto → KES → bank account is exactly:
**`Pay Bill (bank_paybill, account_number, amount)`**.

| Bank | Paybill |
|---|---|
| Equity Bank | 247247 |
| KCB Bank | 522522 |
| Cooperative Bank | 400200 |
| NCBA Bank | 888888 |
| Standard Chartered | 329329 |
| I&M Bank | 542542 |
| Diamond Trust Bank (DTB) | 516600 |
| Family Bank | 222111 |
| ABSA Bank Kenya | 303030 |
| Stanbic Bank | 600100 |
| HFC Bank | 100400 |
| Sidian Bank | 111999 |
| Gulf African Bank | 985050 |
| Bank of Africa | 972900 |
| Ecobank | 700201 |

(Verified against publicly published Safaricom merchant directories.
Refresh quarterly, banks add and decommission paybills.)

### What we'd build

A "Send to Bank" UX layer on top of the existing Pay Bill saga:

1. User picks a bank from the list (with logo + name)
2. Enters their (or the recipient's) bank account number
3. Enters amount
4. Cpay quotes the rate + fee, runs the existing pay-bill saga with
   `bank_paybill` as the destination and the account number as
   `account_ref`

Engineering shape:

- **`backend/apps/payments/banks.py`**: static registry of bank
  metadata (name, paybill, logo URI, account-number format hints
  like "10 digits for Equity, 13 for KCB"). Mirror for the mobile
  client.
- **`SendToBankView`**: thin DRF wrapper around `PayBillView` that
  validates the bank exists in the registry and rewrites the request
  to inject the bank's paybill before delegating.
- **Mobile UI**: bank picker grid (12-15 tiles), account-number input
  with format hint, amount, confirmation card showing
  `recipient = "<account_no> @ <bank_name>"`.
- **Fee**: slightly higher than a normal Pay Bill since some banks
  charge a receiving-side ledger fee. Disclose up front.

Engineering cost: 3-4 days end-to-end (registry, view, two mobile
screens, copy, smoke tests).

### Why not direct bank API integration?

Two reasons:

1. **Daraja Pay Bill IS the cheapest, fastest path**. Banks don't
   charge for inbound M-Pesa-to-account transfers (the customer
   pays Safaricom's transaction fee). No per-bank API certification.
2. **Per-bank APIs are uneven**. Some publish OAuth-based REST
   endpoints (Equity, NCBA), some require ISO 8583 partnerships,
   some don't expose anything. Multi-month integration per bank for
   a feature Pay Bill already covers.

If a specific bank API offers value Pay Bill can't (like instant
RTGS-class settlement, or USD account transfers), we revisit per-
bank later.

## Out of scope (deferred)

- **PesaLink** (Integrated Payment Services Ltd). A bank-to-bank
  faster-payments rail. Membership + certification + per-transaction
  fees. Worth evaluating after Daraja is live for 3+ months and we
  have a measurable demand signal for sub-30-second bank-to-bank.
- **RTGS** (Kenya Real-Time Gross Settlement). Direct bank-to-CBK
  rail for transactions over the M-Pesa daily limit
  (KES 250,000/transaction, KES 500,000/day). Requires a partner
  bank's API or membership. 6-12 months out.
- **SWIFT international**. Out of scope for Kenya-only product.
- **Cross-border M-Pesa** (M-Pesa Tanzania, M-Pesa Uganda). Daraja's
  international remittance rail is in beta. Defer to the Tanzania /
  Uganda corridor work on the company brief.

## Recommended landing order

1. **Pochi labelling + UX nudge**, ~1 day. Zero rail cost,
   marketing win, no risk.
2. **Send to Bank wrapper**, ~3-4 days. Biggest UX win, opens up
   the "deposit my paycheck to KCB" flow that the audience asks for.
3. **PesaLink**, post-Daraja-live, post-license. 6-12 months out.
4. **RTGS / SWIFT**, partnership-driven, post-license.

Combined effort to fully cover what Daraja exposes through a clean
UX: ~5 days from where we are today.

## Operational notes

- Bank paybill numbers DO get retired or renumbered occasionally.
  Build the registry as a versioned static file in the repo (not a
  DB table) so it goes through code review and CI smoke tests when
  it changes. A quarterly diff against Safaricom's published list is
  enough.
- M-Pesa daily transaction limit is KES 250,000 per transaction.
  Above that, reject in the quote step before the user even types
  the amount. Future RTGS integration would lift the cap.
- Bank-side processing time: most banks credit M-Pesa-to-account
  within 60 seconds. Cpay's "Send to Bank" success message should
  set that expectation honestly: "Funds will reflect in your
  account within 1 minute, sometimes up to 10 minutes during peak
  hours."
