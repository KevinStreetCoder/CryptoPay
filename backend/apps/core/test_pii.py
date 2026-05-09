"""Tests for apps/core/pii.py · Phase-3 PII encryption.

Real exercises against the helpers · NO mocking out the encrypt/
decrypt path itself. We mock at the master-key boundary because
each test needs a known key in memory; the actual Fernet round-
trip and HMAC determinism run for real.
"""
from __future__ import annotations

from unittest import mock

from cryptography.fernet import Fernet
from django.test import TestCase, override_settings


def _stub_master_fernet(test):
    """Helper · install a Fernet-with-known-key into the keystore for
    the duration of the test. Returns the Fernet so the test can
    independently encrypt/decrypt and verify."""
    from apps.core import totp_keystore
    totp_keystore.reset_cache()
    key = Fernet.generate_key()
    fernet = Fernet(key)
    patch = mock.patch.object(
        totp_keystore, "get_totp_fernet", return_value=fernet
    )
    patch.start()
    test.addCleanup(patch.stop)
    test.addCleanup(totp_keystore.reset_cache)
    return fernet


class PIIEncryptionRoundTripTests(TestCase):
    """encrypt_pii / decrypt_pii roundtrips."""

    def setUp(self):
        self.fernet = _stub_master_fernet(self)

    def test_encrypt_returns_fernet_ciphertext_prefix(self):
        from apps.core.pii import encrypt_pii
        ct = encrypt_pii("+254700123456")
        self.assertTrue(ct.startswith("gAAAAA"))
        self.assertNotIn("254700123456", ct)

    def test_round_trip_returns_original(self):
        from apps.core.pii import encrypt_pii, decrypt_pii
        for plain in ["+254700000000", "user@example.com", "Kevin Kareithi", "🔐 unicode test"]:
            ct = encrypt_pii(plain)
            self.assertEqual(decrypt_pii(ct), plain)

    def test_each_encrypt_produces_different_ciphertext(self):
        """Fernet adds a random IV · same plaintext → different ct each call."""
        from apps.core.pii import encrypt_pii
        a = encrypt_pii("same-input")
        b = encrypt_pii("same-input")
        self.assertNotEqual(a, b)

    def test_decrypt_passes_plaintext_through_unchanged(self):
        """Legacy plaintext (no Fernet prefix) round-trips as-is."""
        from apps.core.pii import decrypt_pii
        self.assertEqual(decrypt_pii("plain text"), "plain text")
        self.assertEqual(decrypt_pii(""), "")
        self.assertEqual(decrypt_pii(None), None)


class PIIDeterministicTests(TestCase):
    """The HMAC-keyed deterministic encryption · same plaintext +
    same field → same ciphertext, equality search works."""

    def setUp(self):
        _stub_master_fernet(self)

    def test_same_input_produces_same_ciphertext(self):
        from apps.core.pii import pii_eq
        a = pii_eq("phone", "+254700123456")
        b = pii_eq("phone", "+254700123456")
        self.assertEqual(a, b)
        self.assertTrue(a.startswith("det1:"))

    def test_different_inputs_produce_different_ciphertexts(self):
        from apps.core.pii import pii_eq
        self.assertNotEqual(
            pii_eq("phone", "+254700123456"),
            pii_eq("phone", "+254700999999"),
        )

    def test_same_input_different_fields_diverge(self):
        """Cross-field linking is impossible · same plaintext under
        a different field name encrypts differently. Stops a leaked
        phone column from being linked to a leaked email column."""
        from apps.core.pii import pii_eq
        self.assertNotEqual(
            pii_eq("phone", "test@example.com"),
            pii_eq("email", "test@example.com"),
        )

    def test_empty_input_returns_empty(self):
        from apps.core.pii import pii_eq
        self.assertEqual(pii_eq("phone", ""), "")


class PIIEncryptedFieldTests(TestCase):
    """The Django field subclass · model save/load round-trip."""

    def setUp(self):
        _stub_master_fernet(self)

    def test_field_get_prep_value_encrypts(self):
        from apps.core.pii import PIIEncryptedField
        field = PIIEncryptedField()
        ct = field.get_prep_value("user@example.com")
        self.assertTrue(ct.startswith("gAAAAA"))
        self.assertNotIn("user", ct)

    def test_field_get_prep_value_does_not_re_encrypt(self):
        """Saving an already-encrypted value doesn't re-wrap it ·
        prevents Fernet-of-Fernet which would break decrypt."""
        from apps.core.pii import PIIEncryptedField, encrypt_pii
        already_ct = encrypt_pii("user@example.com")
        field = PIIEncryptedField()
        # Same ct returned · no new encryption layer
        self.assertEqual(field.get_prep_value(already_ct), already_ct)

    def test_field_from_db_value_decrypts_fernet(self):
        from apps.core.pii import PIIEncryptedField, encrypt_pii
        field = PIIEncryptedField()
        ct = encrypt_pii("hello@cpay.co.ke")
        self.assertEqual(
            field.from_db_value(ct, None, None),
            "hello@cpay.co.ke",
        )

    def test_field_from_db_value_passes_legacy_plaintext_through(self):
        """Legacy rows · returned unchanged so the migration window
        doesn't break reads."""
        from apps.core.pii import PIIEncryptedField
        field = PIIEncryptedField()
        self.assertEqual(
            field.from_db_value("legacy@plain.com", None, None),
            "legacy@plain.com",
        )

    def test_field_handles_empty_and_none(self):
        from apps.core.pii import PIIEncryptedField
        field = PIIEncryptedField()
        self.assertEqual(field.get_prep_value(""), "")
        self.assertIsNone(field.get_prep_value(None))
        self.assertEqual(field.from_db_value("", None, None), "")
        self.assertIsNone(field.from_db_value(None, None, None))


class PIIEncryptedFieldOnUserModelTests(TestCase):
    """End-to-end · save a User with recovery_email + recovery_phone,
    re-fetch from DB, verify the column is ciphertext but the model
    attribute is plaintext (transparent encryption)."""

    def setUp(self):
        _stub_master_fernet(self)

    def test_recovery_email_encrypted_at_rest(self):
        from apps.accounts.models import User
        u = User.objects.create(
            phone="+254700111111",
            email="primary@cpay.co.ke",
            recovery_email="recovery@cpay.co.ke",
            recovery_phone="+254700222222",
        )
        # Pull the raw DB value via the connection · bypass the field
        # decryptor.
        from django.db import connection
        with connection.cursor() as c:
            c.execute(
                "SELECT recovery_email, recovery_phone FROM users WHERE id = %s",
                [str(u.id)],
            )
            raw_email, raw_phone = c.fetchone()

        self.assertTrue(raw_email.startswith("gAAAAA"))
        self.assertNotIn("recovery@cpay.co.ke", raw_email)
        self.assertTrue(raw_phone.startswith("gAAAAA"))
        self.assertNotIn("254700222222", raw_phone)

        # Now re-fetch through the ORM · plaintext returned
        u_fresh = User.objects.get(id=u.id)
        self.assertEqual(u_fresh.recovery_email, "recovery@cpay.co.ke")
        self.assertEqual(u_fresh.recovery_phone, "+254700222222")

    def test_existing_plaintext_row_still_reads(self):
        """A row inserted via raw SQL with plaintext recovery_*
        values must still come back as plaintext (legacy support
        during the migration window)."""
        from apps.accounts.models import User
        u = User.objects.create(
            phone="+254700333333",
            email="legacy@cpay.co.ke",
        )
        # Stamp plaintext directly into the DB · simulating a row
        # that existed before the migration.
        from django.db import connection
        with connection.cursor() as c:
            c.execute(
                "UPDATE users SET recovery_email = %s, recovery_phone = %s WHERE id = %s",
                ["plain-recovery@cpay.co.ke", "+254700444444", str(u.id)],
            )

        u_fresh = User.objects.get(id=u.id)
        self.assertEqual(u_fresh.recovery_email, "plain-recovery@cpay.co.ke")
        self.assertEqual(u_fresh.recovery_phone, "+254700444444")
