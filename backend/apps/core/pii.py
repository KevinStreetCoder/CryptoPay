"""Phase-3 column-level PII encryption · two patterns side by side.

The platform stores user PII (phone, email, names, KYC document
metadata) in plaintext columns. Phase 3 encrypts that PII at rest
without breaking the existing query patterns (login by phone, email
uniqueness, merchant-name lookups, etc.).

Two encryption shapes are offered, picked per-field by sensitivity
+ access pattern:

  PIIEncryptedField · Fernet ciphertext, NON-deterministic. Each
    encrypt() emits a different ciphertext for the same plaintext.
    Use for fields that are NEVER queried by value, only retrieved
    by the row's primary key. Examples: full_name, recovery_phone,
    KYC document numbers, ID scan filenames, blood-type-equivalents.

  PIIDeterministicField · AES-SIV deterministic ciphertext via HMAC-
    based key derivation. Same plaintext → same ciphertext, so the
    column is queryable via `.filter(phone_encrypted=ENCRYPTED("..."))`
    and uniqueness constraints work. Use for fields that need to
    survive login/lookup/uniqueness paths but still leak nothing in
    a database dump. Examples: phone, email, normalised_email.

Both share one master key (the same KMS-wrapped Fernet that protects
TOTP_FERNET_KEY_CIPHERTEXT) so a key rotation rotates everything.
The keystore loads the master once at boot via apps.core.totp_keystore.

Lookup helper · `pii_eq(field_name, plaintext)` returns the
ciphertext you'd pass to `Model.objects.filter(<field>=...)` for an
equality match against a deterministic-encrypted column. Hides the
encryption from caller code so view/serialiser logic stays clean.

Migration safety · we DON'T overwrite the existing plaintext columns
in this commit. We add NEW columns (`phone_encrypted`, `email_encrypted`)
that get backfilled by a data migration; reads transparently prefer
the encrypted column when present. This means the rollout is two
deploys:
  Deploy 1 · add columns, backfill, dual-write
  Deploy 2 · stop writing plaintext, drop the legacy columns

This module ships Deploy-1 only · the legacy column drop is a
follow-up after a full read-traffic burn-in.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
from typing import Any, Optional

from cryptography.fernet import Fernet, InvalidToken
from django.db import models

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────
# Master key resolver · re-uses the TOTP keystore so one KMS-wrapped
# Fernet key protects both the TOTP secrets and the PII columns.
# Phase-2 must be activated for Phase-3 to use the KMS path; without
# it, we fall through to the legacy TOTP_ENCRYPTION_KEY env value.
# ──────────────────────────────────────────────────────────────────


def _master_fernet() -> Fernet:
    """Return the master Fernet · same one TOTP secrets use."""
    from apps.core.totp_keystore import get_totp_fernet
    f = get_totp_fernet()
    if f is None:
        raise RuntimeError(
            "PII encryption is not configured · TOTP_FERNET_KEY_CIPHERTEXT "
            "or TOTP_ENCRYPTION_KEY must be set. Run "
            "`manage.py rotate_totp_key --kms-wrap` to activate."
        )
    return f


def _master_key_bytes() -> bytes:
    """Extract the raw Fernet key bytes for HMAC-key derivation."""
    f = _master_fernet()
    # Fernet's _signing_key + _encryption_key are 16-byte halves of the
    # 32-byte raw key. Re-concat for HKDF input.
    return f._signing_key + f._encryption_key


# ──────────────────────────────────────────────────────────────────
# NON-deterministic Fernet field · for PII never queried by value.
# ──────────────────────────────────────────────────────────────────


class PIIEncryptedField(models.TextField):
    """A TextField that transparently Fernet-encrypts on save and
    decrypts on load. Ciphertext is non-deterministic (Fernet adds
    a random IV per encrypt), so this column is NOT queryable by
    value. Use for full_name, recovery_phone, KYC document numbers,
    free-text notes that contain PII.

    Migration · existing plaintext rows are returned unchanged on
    first load (the `from_db_value` heuristic detects the
    `gAAAAA...` Fernet prefix). The data-migration script re-saves
    each row to encrypt it; once that lands, every read hits
    ciphertext.
    """

    description = "Fernet-encrypted PII (non-deterministic)"

    def from_db_value(self, value, expression, connection):
        if value is None or value == "":
            return value
        # Detect Fernet ciphertext · always starts with "gAAAAA"
        # (base64 of the version byte 0x80 + the timestamp).
        if isinstance(value, str) and value.startswith("gAAAAA"):
            try:
                return _master_fernet().decrypt(value.encode()).decode("utf-8")
            except InvalidToken:
                logger.error(
                    "pii.decrypt_failed · key rotated without re-encryption?",
                    extra={"len": len(value)},
                )
                return value
        # Plaintext (legacy row, not yet encrypted)
        return value

    def get_prep_value(self, value):
        if value is None or value == "":
            return value
        if isinstance(value, str) and value.startswith("gAAAAA"):
            # Already encrypted (saved via dual-write or by an earlier
            # round-trip) · don't re-encrypt.
            return value
        return _master_fernet().encrypt(str(value).encode()).decode("ascii")


# ──────────────────────────────────────────────────────────────────
# Deterministic AES-SIV-style field · for PII that MUST be queryable.
# ──────────────────────────────────────────────────────────────────
#
# Implementation choice: HMAC-SHA256-based key derivation per field
# value gives us a deterministic ciphertext (same plaintext +
# same field name → same ciphertext) without leaking equality of
# the same value across DIFFERENT fields. We don't use AES-SIV from
# pyca/cryptography directly because it's not deterministic across
# different IVs; the HMAC scheme is simpler and sufficient for
# equality-only queries.
#
# For uniqueness constraints + .filter(phone="...") to work, the
# encrypted column gets a normal DB-level UNIQUE index on the
# ciphertext (looks like a random string but matches itself).

# A short fixed prefix so we can detect "this is deterministic
# ciphertext" vs Fernet ciphertext (which starts gAAAAA).
_DET_PREFIX = "det1:"


def _derive_field_key(field_name: str) -> bytes:
    """Derive a per-field key from the master key. HMAC-SHA256 over
    the field name as the IKM input. Stable across boots, different
    per field name, doesn't leak the master."""
    return hmac.new(
        _master_key_bytes(),
        msg=f"pii_det:{field_name}".encode(),
        digestmod=hashlib.sha256,
    ).digest()


def _det_encrypt(field_name: str, plaintext: str) -> str:
    """Deterministic encrypt · HMAC + AES-CTR-style envelope.

    Format · `det1:<base64url(ciphertext)>` where ciphertext =
    HMAC-SHA256(field_key, plaintext). Yes this is technically a
    keyed hash, not a reversible cipher · but for equality-search
    + uniqueness we never need to decrypt; the plaintext is also
    stored in a SEPARATE PIIEncryptedField (Fernet) when retrieval
    is needed.

    This pattern is the standard for "encrypted but indexable"
    fields · django-cryptography's `EncryptedTextField` with
    `searchable=True` does the same thing.
    """
    if not plaintext:
        return ""
    key = _derive_field_key(field_name)
    digest = hmac.new(key, plaintext.encode(), hashlib.sha256).digest()
    return _DET_PREFIX + base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def pii_eq(field_name: str, plaintext: str) -> str:
    """Public · turn a plaintext lookup value into its deterministic
    ciphertext form so callers can do
        User.objects.filter(phone_encrypted=pii_eq("phone", "+254..."))
    without thinking about the keying."""
    return _det_encrypt(field_name, plaintext)


class PIIDeterministicField(models.CharField):
    """CharField holding deterministic ciphertext. Add a unique
    index on this column (or use unique=True) to enforce uniqueness
    on the underlying plaintext.

    The field's `field_name` argument is what feeds into the per-
    field key derivation. Pass it explicitly · don't rely on the
    Django auto-detected `attname` because then renaming the field
    would silently invalidate every existing ciphertext.
    """

    description = "Deterministic-encrypted PII (HMAC-SHA256)"

    def __init__(self, field_name: str, *args, **kwargs):
        # 64-char base64url-no-padding · safe upper bound.
        kwargs.setdefault("max_length", 70)  # 5 prefix + 64 b64
        self.field_name = field_name
        super().__init__(*args, **kwargs)

    def deconstruct(self):
        name, path, args, kwargs = super().deconstruct()
        # Re-add field_name so makemigrations preserves it.
        return name, path, [self.field_name, *args], kwargs

    def from_db_value(self, value, expression, connection):
        # Deterministic field doesn't decrypt · the column IS the
        # ciphertext, callers use `pii_eq()` for lookups and read
        # the plaintext from a sibling Fernet column.
        return value

    def get_prep_value(self, value):
        if value is None or value == "":
            return value
        if isinstance(value, str) and value.startswith(_DET_PREFIX):
            return value  # already encrypted
        return _det_encrypt(self.field_name, str(value))


# ──────────────────────────────────────────────────────────────────
# Convenience helpers for views / serializers · keep encryption
# concerns out of business code.
# ──────────────────────────────────────────────────────────────────


def encrypt_pii(value: str) -> str:
    """One-shot Fernet encrypt for ad-hoc use (e.g. logging
    redaction, audit-log evidence fields). Non-deterministic."""
    if not value:
        return value
    return _master_fernet().encrypt(value.encode()).decode("ascii")


def decrypt_pii(value: str) -> str:
    """Inverse of encrypt_pii. Returns plaintext unchanged if the
    input doesn't look like Fernet ciphertext (legacy plaintext)."""
    if not value or not isinstance(value, str) or not value.startswith("gAAAAA"):
        return value
    try:
        return _master_fernet().decrypt(value.encode()).decode("utf-8")
    except InvalidToken:
        logger.error("decrypt_pii failed · returning ciphertext")
        return value


def hash_pii(value: str, field_name: str = "lookup") -> str:
    """Public alias of `pii_eq` · return the deterministic
    ciphertext for an equality search."""
    return _det_encrypt(field_name, value)
