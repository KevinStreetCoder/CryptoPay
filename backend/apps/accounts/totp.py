"""
Production-ready TOTP (Time-based One-Time Password) service for CryptoPay.

Uses pyotp for RFC 6238 compliant TOTP generation and verification.
Backup codes are hashed with bcrypt before storage.
"""

import secrets

import bcrypt
import pyotp


def generate_totp_secret() -> str:
    """Generate a cryptographically secure base32-encoded TOTP secret."""
    return pyotp.random_base32(length=32)


def get_totp_uri(secret: str, phone: str, issuer: str = "CryptoPay") -> str:
    """
    Generate an otpauth:// URI for QR code provisioning.

    Args:
        secret: Base32-encoded TOTP secret.
        phone: User's phone number (used as the account name).
        issuer: The service name shown in authenticator apps.

    Returns:
        otpauth:// URI string suitable for QR code generation.
    """
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=phone, issuer_name=issuer)


def verify_totp(secret: str, code: str) -> bool:
    """
    Verify a 6-digit TOTP code against the given secret.

    Allows +/- 1 time step drift (valid_window=1) to account for
    slight clock differences between server and authenticator app.

    Args:
        secret: Base32-encoded TOTP secret.
        code: The 6-digit code to verify.

    Returns:
        True if the code is valid within the allowed time window.
    """
    if not secret or not code:
        return False
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)


def generate_backup_codes(count: int = 8) -> list[str]:
    """
    Generate a list of single-use backup codes.

    Each code is 8 uppercase alphanumeric characters (hex-encoded).
    These are returned in plaintext to the user once, then hashed for storage.

    Args:
        count: Number of backup codes to generate (default 8).

    Returns:
        List of plaintext backup code strings.
    """
    return [secrets.token_hex(4).upper() for _ in range(count)]


def hash_backup_codes(codes: list[str]) -> list[str]:
    """
    Hash a list of plaintext backup codes with bcrypt for secure storage.

    Args:
        codes: List of plaintext backup codes.

    Returns:
        List of bcrypt-hashed backup code strings.
    """
    return [
        bcrypt.hashpw(code.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        for code in codes
    ]


def verify_backup_code(user, code: str) -> bool:
    """
    Check a backup code against the user's stored hashed codes.

    If valid, the code is consumed (removed from the user's backup codes)
    and the user record is saved. Each backup code can only be used once.

    Args:
        user: User model instance with totp_backup_codes field.
        code: The plaintext backup code to verify.

    Returns:
        True if the code matched and was consumed.
    """
    if not code or not user.totp_backup_codes:
        return False

    for i, hashed_code in enumerate(user.totp_backup_codes):
        if bcrypt.checkpw(code.encode("utf-8"), hashed_code.encode("utf-8")):
            # Remove the used backup code
            codes = list(user.totp_backup_codes)
            codes.pop(i)
            user.totp_backup_codes = codes
            user.save(update_fields=["totp_backup_codes"])
            return True

    return False
