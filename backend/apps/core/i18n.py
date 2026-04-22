"""Backend-side i18n helper.

Mirrors the keys used by `mobile/src/i18n/en.ts` and `sw.ts` so every
message we originate server-side (welcome email, OTP SMS, transaction
notification, receipt cover letter) speaks the user's chosen language
(`user.language`).

Keep the dictionary minimal and format-string friendly. We intentionally
don't pull in Django's `gettext` stack because the mobile app + backend
share a single translation catalogue under mobile/src/i18n; copying the
subset here avoids drift without needing a .po pipeline.
"""
from __future__ import annotations

from typing import Any, Optional


_CATALOG: dict[str, dict[str, str]] = {
    # Auth / OTP
    "sms.welcome": {
        "en": "Welcome to Cpay, {name}. Your account is ready. Pay M-Pesa bills directly from crypto at cpay.co.ke.",
        "sw": "Karibu Cpay, {name}. Akaunti yako iko tayari. Lipa bili za M-Pesa moja kwa moja kutoka kwa crypto: cpay.co.ke.",
    },
    "sms.otp.login": {
        "en": "Cpay login code: {otp}. Valid 5 min. Don't share.",
        "sw": "Nambari ya kuingia Cpay: {otp}. Itumike ndani ya dakika 5. Usishiriki.",
    },
    "sms.otp.register": {
        "en": "Cpay verification code: {otp}. Expires in 5 min.",
        "sw": "Nambari ya uthibitishaji wa Cpay: {otp}. Itaisha baada ya dakika 5.",
    },
    "sms.otp.pin_reset": {
        "en": "Cpay PIN reset code: {otp}. If you didn't request this, ignore.",
        "sw": "Nambari ya kuweka upya PIN ya Cpay: {otp}. Ikiwa hukuomba, puuza.",
    },
    "sms.otp.google_link": {
        "en": "Cpay: confirm Google sign-in with code {otp}. If you didn't request this, ignore.",
        "sw": "Cpay: thibitisha kuingia kwa Google ukitumia nambari {otp}. Ikiwa hukuomba, puuza.",
    },
    # Transactions
    "sms.payment.success": {
        "en": "Cpay: KES {amount} paid to {recipient}. Ref {ref}. New balance: KES {balance}.",
        "sw": "Cpay: KES {amount} imelipwa kwa {recipient}. Kumbukumbu {ref}. Salio jipya: KES {balance}.",
    },
    "sms.payment.failed": {
        "en": "Cpay: payment of KES {amount} failed. Crypto returned to wallet. Ref {ref}.",
        "sw": "Cpay: malipo ya KES {amount} yameshindwa. Crypto imerudishwa kwenye mkoba. Kumbukumbu {ref}.",
    },
    "sms.deposit.received": {
        "en": "Cpay: deposit of KES {amount} received. New balance: KES {balance}.",
        "sw": "Cpay: umepokea amana ya KES {amount}. Salio jipya: KES {balance}.",
    },
    "sms.withdraw.sent": {
        "en": "Cpay: withdrawal of {amount} {currency} sent. Tx: {tx_hash}.",
        "sw": "Cpay: utoaji wa {amount} {currency} umetumwa. Tx: {tx_hash}.",
    },
    # Security
    "sms.security.new_device": {
        "en": "Cpay: new device sign-in from {location}. If this wasn't you, open the app and sign out all sessions.",
        "sw": "Cpay: kuingia kutoka kifaa kipya, {location}. Ikiwa si wewe, fungua programu na utoke katika vipindi vyote.",
    },
    "email.welcome.subject": {
        "en": "Welcome to Cpay",
        "sw": "Karibu Cpay",
    },
    "email.welcome.intro": {
        "en": "Hi {name}, your Cpay account is live. Deposit crypto, pay M-Pesa bills, and withdraw to any wallet.",
        "sw": "Habari {name}, akaunti yako ya Cpay ipo hai. Weka crypto, lipa bili za M-Pesa, na toa kwa mkoba wowote.",
    },
    "email.receipt.subject": {
        "en": "Cpay receipt · {ref}",
        "sw": "Risiti ya Cpay · {ref}",
    },
}


def _norm_lang(lang: Optional[str]) -> str:
    if not lang:
        return "en"
    lang = lang.lower().split("-")[0]
    return lang if lang in ("en", "sw") else "en"


def t(key: str, lang: Optional[str] = None, **kwargs: Any) -> str:
    """Translate `key` into `lang`, formatting with `kwargs`.

    Missing key → returns `key` itself so callers don't crash.
    Missing lang → English fallback.
    """
    lang = _norm_lang(lang)
    entry = _CATALOG.get(key)
    if entry is None:
        return key
    template = entry.get(lang) or entry.get("en") or key
    try:
        return template.format(**kwargs)
    except Exception:
        # Bad format kwargs shouldn't break a notification · return template as-is.
        return template


def user_lang(user) -> str:
    """Return the user's language code, normalized. Safe for None."""
    if user is None:
        return "en"
    return _norm_lang(getattr(user, "language", None))
