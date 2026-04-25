"""Email abuse defence · disposable blocklist, MX checks, gmail normalisation.

Three independent helpers that signup, recovery-email, and email-verify
endpoints chain together. Per `docs/research/SIGNUP-EMAIL-ABUSE.md`:

  Layer 1 · `is_disposable(email)` · file-backed blocklist load.
  Layer 2 · `has_valid_mx(domain)` · DNS lookup with lru cache.
  Layer 4 · `normalise_email(email)` · plus-suffix and gmail-dot stripping.

The validators reject in this order: blocklist first (free, deterministic,
catches 95 % of the noise), MX second (one DNS lookup, slower but catches
typo-squatted domains that aren't yet on the list).

The `normalise_email` helper feeds the dedicated `User.normalised_email`
column (migration 0018), which carries a partial unique constraint so the
same human can't open multiple accounts via gmail-alias tricks.
"""
from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

from django.conf import settings
from rest_framework import serializers

logger = logging.getLogger(__name__)


# Audit H5 fix · resolve the dnspython availability ONCE at module load
# instead of every call to has_valid_mx, AND refuse to boot in production
# when the dependency is missing. The previous code logged a warning and
# silently treated every domain as MX-valid, which meant a deploy missing
# `dnspython` from `pip install` would silently disable Layer 2 forever.
try:
    import dns.exception  # type: ignore[import-untyped]  # noqa: F401
    import dns.resolver  # type: ignore[import-untyped]  # noqa: F401
    _DNS_AVAILABLE = True
except ImportError:
    _DNS_AVAILABLE = False
    if not getattr(settings, "DEBUG", False):
        raise RuntimeError(
            "dnspython is required for email validation in production. "
            "Add `dnspython==2.6.1` to backend/requirements.txt and "
            "rebuild the image."
        )
    logger.warning(
        "dnspython not installed · MX validation disabled in DEBUG only."
    )


# Cached at import time. The file ships in the same directory as this module.
_BLOCKLIST_PATH = Path(__file__).resolve().parent / "disposable_domains.txt"


def _load_blocklist(path: Path) -> frozenset[str]:
    """Read the blocklist file once. Strips comments, blanks, and case.

    File format: one domain per line; `#` introduces a comment; blank lines
    ignored. Anything else is normalised to lowercase and added to the set.
    """
    if not path.exists():
        logger.warning(
            "Disposable-domains blocklist missing at %s · email abuse "
            "Layer 1 disabled until file is restored.",
            path,
        )
        return frozenset()

    domains: set[str] = set()
    with path.open("r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            # Strip any inline comment after the domain.
            line = line.split("#", 1)[0].strip()
            if line:
                domains.add(line.lower())
    return frozenset(domains)


DISPOSABLE_DOMAINS: frozenset[str] = _load_blocklist(_BLOCKLIST_PATH)


def _split_email(email: str) -> tuple[str, str] | None:
    """Return `(local, domain)` lowercased, or None if the address is malformed."""
    if not email or "@" not in email:
        return None
    local, _, domain = email.lower().rpartition("@")
    local = local.strip()
    domain = domain.strip()
    if not local or not domain:
        return None
    return local, domain


def is_disposable(email: str) -> bool:
    """Return True if the address's domain is in our blocklist."""
    parts = _split_email(email)
    if parts is None:
        return False
    _, domain = parts
    return domain in DISPOSABLE_DOMAINS


def normalise_email(email: str) -> str:
    """Canonical form used for uniqueness checks. Idempotent.

    Rules:
      - Lowercase everything.
      - Strip `+suffix` from the local part for ALL providers (a near-
        universal convention for sub-addressing; abusers exploit it most
        on gmail but every major provider treats it this way).
      - For `gmail.com` and `googlemail.com` only, also strip dots from
        the local part and rewrite the domain to `gmail.com`. Gmail
        ignores both server-side, so `j.o.h.n+abuse@googlemail.com` and
        `john@gmail.com` deliver to the same inbox.

    Returns an empty string if the input is malformed; callers should
    treat empty-normalised as "do not enforce uniqueness for this row".
    """
    parts = _split_email(email)
    if parts is None:
        return ""
    local, domain = parts
    if "+" in local:
        local = local.split("+", 1)[0]
    if domain in ("gmail.com", "googlemail.com"):
        local = local.replace(".", "")
        domain = "gmail.com"
    if not local:
        return ""
    return f"{local}@{domain}"


@lru_cache(maxsize=10000)
def has_valid_mx(domain: str) -> bool:
    """Resolve the domain's MX records. Cached to avoid repeat DNS hits.

    3-second timeout. Returns False on NXDOMAIN, NoAnswer, Timeout, and
    every other DNSException · we can't reach the domain so we won't
    pretend the email is real. When dnspython isn't available (DEBUG
    only · production raises at module import per H5 audit fix),
    returns True so dev tests don't depend on network.
    """
    if not domain:
        return False
    if not _DNS_AVAILABLE:
        return True

    import dns.exception  # type: ignore[import-untyped]
    import dns.resolver  # type: ignore[import-untyped]
    try:
        records = dns.resolver.resolve(domain, "MX", lifetime=3)
        return bool(records)
    except (
        dns.resolver.NXDOMAIN,
        dns.resolver.NoAnswer,
        dns.resolver.NoNameservers,
    ):
        return False
    except dns.exception.Timeout:
        return False
    except dns.exception.DNSException:
        return False
    except Exception as e:
        # Defensive · DNS libs are noisy. Log and treat as missing MX.
        logger.warning("MX lookup raised unexpected error for %s: %s", domain, e)
        return False


# Plumbing for serializers · mirrors the wording the research doc spells out.
DISPOSABLE_REJECTION = (
    "This email provider is not accepted. Please use a personal or work "
    "email address."
)
NO_MX_REJECTION = (
    "We can't reach this email's domain. Please double-check the address."
)


def _mx_required() -> bool:
    """Whether MX validation is mandatory in the current environment.

    Audit H7 fix · explicit opt-in via `EMAIL_VALIDATION_REQUIRE_MX`.
    Default OFF (False). The previous default of `not settings.DEBUG`
    meant any non-DEBUG environment without internet (e.g. a sandboxed
    CI runner) would flake every signup test that touched
    `RegisterSerializer.validate_email`. Production sets this to True
    explicitly in `config/settings/production.py`.
    """
    return bool(getattr(settings, "EMAIL_VALIDATION_REQUIRE_MX", False))


def validate_email_address(email: str) -> str:
    """Run blocklist + MX checks and return the normalised form.

    Used as a single entry point for serializers. Raises
    `serializers.ValidationError` when any check fails, otherwise returns
    the normalised email so the caller can persist it on the user row.

    If the input is empty / malformed, returns an empty string · the
    caller decides whether absence is allowed (signup permits no email,
    recovery requires one).
    """
    if not email:
        return ""
    parts = _split_email(email)
    if parts is None:
        raise serializers.ValidationError("Enter a valid email address.")
    _, domain = parts
    if domain in DISPOSABLE_DOMAINS:
        raise serializers.ValidationError(DISPOSABLE_REJECTION)
    if _mx_required() and not has_valid_mx(domain):
        raise serializers.ValidationError(NO_MX_REJECTION)
    return normalise_email(email)
