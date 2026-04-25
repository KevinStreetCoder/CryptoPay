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

`category` groups banks for the picker UI:
    tier1            ·  Top commercial banks by deposit base
    midtier          ·  Mid-sized commercial / family-owned
    regional         ·  Pan-African / international subsidiaries
    sharia           ·  Sharia-compliant banks (Gulf, etc.)

`logo_url` points at Clearbit's logo API · `https://logo.clearbit.com/
<canonical-domain>`. Clearbit serves a transparent-PNG logo for any
registered company by domain. The mobile picker drops any bank whose
logo fails to load, so a stale entry never renders as a letter-tile
placeholder (which the user explicitly asked us never to do). When a
bank rebrands and Clearbit hasn't caught up, swap in
`https://upload.wikimedia.org/.../File:<...>.png` from Wikimedia
Commons as a stable fallback.
"""
from __future__ import annotations

import re


# Categories used by the mobile picker to group sections.
CATEGORIES = ("tier1", "midtier", "regional", "sharia")


_BANKS: dict[str, dict] = {
    # ── Tier 1 · top commercial banks (KCB, Equity, Co-op, NCBA) ──
    "equity": {
        "slug": "equity",
        "name": "Equity Bank",
        "paybill": "247247",
        "category": "tier1",
        "logo_url": "https://logo.clearbit.com/equitygroupholdings.com",
        "account_format_hint": "Account number (typically 13 digits)",
    },
    "kcb": {
        "slug": "kcb",
        "name": "KCB Bank",
        "paybill": "522522",
        "category": "tier1",
        "logo_url": "https://logo.clearbit.com/kcbgroup.com",
        "account_format_hint": "Account number (typically 10 digits)",
    },
    "coop": {
        "slug": "coop",
        "name": "Cooperative Bank",
        "paybill": "400200",
        "category": "tier1",
        "logo_url": "https://logo.clearbit.com/co-opbank.co.ke",
        "account_format_hint": "Account number (typically 12 digits)",
    },
    "ncba": {
        "slug": "ncba",
        "name": "NCBA Bank",
        "paybill": "888888",
        "category": "tier1",
        "logo_url": "https://logo.clearbit.com/ncbagroup.com",
        "account_format_hint": "Account number (typically 13 digits)",
    },
    "absa": {
        "slug": "absa",
        "name": "ABSA Bank Kenya",
        "paybill": "303030",
        "category": "tier1",
        "logo_url": "https://logo.clearbit.com/absabank.co.ke",
        "account_format_hint": "Account number (typically 10 digits)",
    },
    "stanbic": {
        "slug": "stanbic",
        "name": "Stanbic Bank",
        "paybill": "600100",
        "category": "tier1",
        "logo_url": "https://logo.clearbit.com/stanbicbank.co.ke",
        "account_format_hint": "Account number (typically 13 digits)",
    },
    "stanchart": {
        "slug": "stanchart",
        "name": "Standard Chartered",
        "paybill": "329329",
        "category": "tier1",
        "logo_url": "https://logo.clearbit.com/sc.com",
        "account_format_hint": "Account number (typically 10 digits)",
    },

    # ── Mid-tier · regional + family-owned commercial banks ──
    "im": {
        "slug": "im",
        "name": "I&M Bank",
        "paybill": "542542",
        "category": "midtier",
        "logo_url": "https://logo.clearbit.com/imbank.com",
        "account_format_hint": "Account number (typically 10 digits)",
    },
    "dtb": {
        "slug": "dtb",
        "name": "Diamond Trust Bank",
        "paybill": "516600",
        "category": "midtier",
        "logo_url": "https://logo.clearbit.com/dtbafrica.com",
        "account_format_hint": "Account number (typically 13 digits)",
    },
    "family": {
        "slug": "family",
        "name": "Family Bank",
        "paybill": "222111",
        "category": "midtier",
        "logo_url": "https://logo.clearbit.com/familybank.co.ke",
        "account_format_hint": "Account number (typically 12 digits)",
    },
    "hfc": {
        "slug": "hfc",
        "name": "HFC Bank",
        "paybill": "100400",
        "category": "midtier",
        "logo_url": "https://logo.clearbit.com/hfgroup.co.ke",
        "account_format_hint": "Account number (typically 10 digits)",
    },
    "sidian": {
        "slug": "sidian",
        "name": "Sidian Bank",
        "paybill": "111999",
        "category": "midtier",
        "logo_url": "https://logo.clearbit.com/sidianbank.co.ke",
        "account_format_hint": "Account number (typically 10 digits)",
    },

    # ── Regional · pan-African / international subsidiaries ──
    "boa": {
        "slug": "boa",
        "name": "Bank of Africa",
        "paybill": "972900",
        "category": "regional",
        "logo_url": "https://logo.clearbit.com/boakenya.com",
        "account_format_hint": "Account number (typically 13 digits)",
    },
    "ecobank": {
        "slug": "ecobank",
        "name": "Ecobank",
        "paybill": "700201",
        "category": "regional",
        "logo_url": "https://logo.clearbit.com/ecobank.com",
        "account_format_hint": "Account number (typically 13 digits)",
    },

    # ── Sharia · interest-free banking ──
    "gulf": {
        "slug": "gulf",
        "name": "Gulf African Bank",
        "paybill": "985050",
        "category": "sharia",
        "logo_url": "https://logo.clearbit.com/gulfafricanbank.com",
        "account_format_hint": "Account number (typically 10 digits)",
    },
}


# Defensive · every paybill must be exactly 6 numeric digits, every
# category must be in the known set, and every logo_url must be HTTPS.
# Any future edit that ships a bad value crashes at import time rather
# than silently routing money to a typo.
_PAYBILL_RE = re.compile(r"^\d{6}$")
for _slug, _meta in _BANKS.items():
    assert _PAYBILL_RE.match(_meta["paybill"]), (
        f"Bank registry has invalid paybill for {_slug!r}: {_meta['paybill']!r}"
    )
    assert _meta.get("category") in CATEGORIES, (
        f"Bank {_slug!r} has unknown category {_meta.get('category')!r}; "
        f"must be one of {CATEGORIES}"
    )
    assert (_meta.get("logo_url") or "").startswith("https://"), (
        f"Bank {_slug!r} logo_url must be HTTPS, got {_meta.get('logo_url')!r}"
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


def banks_by_category() -> dict[str, list[dict]]:
    """Group banks by category, sorted alphabetically within each group.

    Returned dict keys are the categories present in the registry. The
    mobile client can iterate the dict in display order (tier1 first,
    sharia last) by matching against `CATEGORIES`.
    """
    grouped: dict[str, list[dict]] = {c: [] for c in CATEGORIES}
    for meta in _BANKS.values():
        grouped[meta["category"]].append({**meta})
    for category in grouped:
        grouped[category].sort(key=lambda b: b["name"].lower())
    # Drop empty categories so the response stays compact.
    return {c: rows for c, rows in grouped.items() if rows}
