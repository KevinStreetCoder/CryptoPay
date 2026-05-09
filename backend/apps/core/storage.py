"""Cloudflare R2 storage backends · S3-compatible, signed URLs by default.

R2 is what Django writes to instead of the local MEDIA_ROOT when the
R2_* settings are configured. Two specialised subclasses exist:

  - `R2MediaStorage` · default backend for FileField / ImageField on
    user models. Signed URLs (1 h expiry) so KYC docs aren't world-
    readable even if a bucket-listing leak ever happens.
  - `R2ReceiptStorage` · path-prefixed to `receipts/` so the receipt
    PDF generator can drop generated files there without colliding
    with KYC uploads.

The `location` prefix means PDFs land at `r2://bucket/receipts/<file>`
and KYC docs at `r2://bucket/kyc/<user>/<kind>.<ext>`. The user-id
slot is opaque so listings don't leak phone/email.
"""
from storages.backends.s3boto3 import S3Boto3Storage


class R2MediaStorage(S3Boto3Storage):
    """Default media backend · signed URLs, no public ACLs.

    Use this for FileField / ImageField on any model that holds
    sensitive content (KYC docs, profile photos, signature scans).
    """
    file_overwrite = False  # respect django's unique-filename suffixing
    default_acl = None       # R2 doesn't support ACLs · explicit None
    querystring_auth = True  # signed URLs only
    location = ""            # use the per-field upload_to instead


class R2ReceiptStorage(S3Boto3Storage):
    """Receipt PDFs · same auth model, but locked to the receipts/
    prefix so a misconfigured KYC field can't accidentally upload
    into the receipts namespace."""
    file_overwrite = False
    default_acl = None
    querystring_auth = True
    location = "receipts"


class R2KYCStorage(S3Boto3Storage):
    """KYC documents · highest sensitivity, shortest signed-URL TTL,
    locked to the kyc/ prefix."""
    file_overwrite = False
    default_acl = None
    querystring_auth = True
    location = "kyc"
    # 5-min signed URLs · KYC viewer must refresh frequently. Limits
    # the blast radius if a signed URL leaks via referer header.
    custom_domain = False  # always use the signed S3 URL path

    def _get_security_token(self):
        return None

    @property
    def querystring_expire(self):
        return 300
