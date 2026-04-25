"""Curated registry of Kenyan bank paybills for the Send-to-Bank flow.

Each bank publishes a single Paybill number that any Safaricom customer
can use to top up an account at that bank. Sending crypto to a Kenyan
bank account is therefore the same Daraja BusinessPayBill rail we
already run for utility payments · the bank's paybill is the
destination, the customer's account number is the reference. See
`docs/research/MPESA-RAILS.md` for the full rationale.

Operationally this is a static registry that ships in the repo, not a
DB table. Bank paybills change rarely (once or twice a year industry
wide); when they do, the change goes through code review and CI rather
than a hotfix DB poke. Refresh quarterly via diff against Safaricom's
published merchant directory.

`account_format_hint` is shown under the selected bank on the mobile
picker · it's UX guidance, NOT validation. Different account types
within the same bank can have different lengths (Equity savings vs
Equity merchant), so we deliberately keep validation loose.
"""
from __future__ import annotations

import re


_BANKS: dict[str, dict] = {
    "equity": {
        "slug": "equity",
        "name": "Equity Bank",
        "paybill": "247247",
        "logo_url": "https://cpay.co.ke/static/banks/equity.png",
        "account_format_hint": "Account number (typically 13 digits)",
    },
    "kcb": {
        "slug": "kcb",
        "name": "KCB Bank",
        "paybill": "522522",
        "logo_url": "https://cpay.co.ke/static/banks/kcb.png",
        "account_format_hint": "Account number (typically 10 digits)",
    },
    "coop": {
        "slug": "coop",
        "name": "Cooperative Bank",
        "paybill": "400200",
        "logo_url": "https://cpay.co.ke/static/banks/coop.png",
        "account_format_hint": "Account number (typically 12 digits)",
    },
    "ncba": {
        "slug": "ncba",
        "name": "NCBA Bank",
        "paybill": "888888",
        "logo_url": "https://cpay.co.ke/static/banks/ncba.png",
        "account_format_hint": "Account number (typically 13 digits)",
    },
    "stanchart": {
        "slug": "stanchart",
        "name": "Standard Chartered",
        "paybill": "329329",
        "logo_url": "https://cpay.co.ke/static/banks/stanchart.png",
        "account_format_hint": "Account number (typically 10 digits)",
    },
    "im": {
        "slug": "im",
        "name": "I&M Bank",
        "paybill": "542542",
        "logo_url": "https://cpay.co.ke/static/banks/im.png",
        "account_format_hint": "Account number (typically 10 digits)",
    },
    "dtb": {
        "slug": "dtb",
        "name": "Diamond Trust Bank",
        "paybill": "516600",
        "logo_url": "https://cpay.co.ke/static/banks/dtb.png",
        "account_format_hint": "Account number (typically 13 digits)",
    },
    "family": {
        "slug": "family",
        "name": "Family Bank",
        "paybill": "222111",
        "logo_url": "https://cpay.co.ke/static/banks/family.png",
        "account_format_hint": "Account number (typically 12 digits)",
    },
    "absa": {
        "slug": "absa",
        "name": "ABSA Bank Kenya",
        "paybill": "303030",
        "logo_url": "https://cpay.co.ke/static/banks/absa.png",
        "account_format_hint": "Account number (typically 10 digits)",
    },
    "stanbic": {
        "slug": "stanbic",
        "name": "Stanbic Bank",
        "paybill": "600100",
        "logo_url": "https://cpay.co.ke/static/banks/stanbic.png",
        "account_format_hint": "Account number (typically 13 digits)",
    },
    "hfc": {
        "slug": "hfc",
        "name": "HFC Bank",
        "paybill": "100400",
        "logo_url": "https://cpay.co.ke/static/banks/hfc.png",
        "account_format_hint": "Account number (typically 10 digits)",
    },
    "sidian": {
        "slug": "sidian",
        "name": "Sidian Bank",
        "paybill": "111999",
        "logo_url": "https://cpay.co.ke/static/banks/sidian.png",
        "account_format_hint": "Account number (typically 10 digits)",
    },
    "gulf": {
        "slug": "gulf",
        "name": "Gulf African Bank",
        "paybill": "985050",
        "logo_url": "https://cpay.co.ke/static/banks/gulf.png",
        "account_format_hint": "Account number (typically 10 digits)",
    },
    "boa": {
        "slug": "boa",
        "name": "Bank of Africa",
        "paybill": "972900",
        "logo_url": "https://cpay.co.ke/static/banks/boa.png",
        "account_format_hint": "Account number (typically 13 digits)",
    },
    "ecobank": {
        "slug": "ecobank",
        "name": "Ecobank",
        "paybill": "700201",
        "logo_url": "https://cpay.co.ke/static/banks/ecobank.png",
        "account_format_hint": "Account number (typically 13 digits)",
    },
}


# Defensive · every paybill must be exactly 6 numeric digits. Any future
# edit that ships a bad value crashes at import time rather than silently
# routing money to a typo.
_PAYBILL_RE = re.compile(r"^\d{6}$")
for _slug, _meta in _BANKS.items():
    assert _PAYBILL_RE.match(_meta["paybill"]), (
        f"Bank registry has invalid paybill for {_slug!r}: {_meta['paybill']!r}"
    )


def get_bank(slug: str) -> dict | None:
    """Return the bank metadata for `slug`, or None if unknown."""
    if not slug:
        return None
    return _BANKS.get(slug.lower())


def list_banks() -> list[dict]:
    """All known banks, alphabetised by display name. Returns copies so
    callers can't mutate the registry."""
    return sorted(
        ({**meta} for meta in _BANKS.values()),
        key=lambda b: b["name"].lower(),
    )


def bank_slugs() -> list[str]:
    """Just the slug strings · used to populate ChoiceField at import."""
    return sorted(_BANKS.keys())
