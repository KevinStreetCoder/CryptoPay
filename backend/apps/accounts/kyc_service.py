import hashlib
import hmac
import logging
import time
import uuid

import requests
from django.conf import settings

from .models import AuditLog, KYCDocument, User

logger = logging.getLogger(__name__)

SMILE_API_BASE = "https://api.smileidentity.com/v2/"


class SmileIdentityError(Exception):
    """Raised when a Smile Identity API call fails."""


class SmileIdentityService:
    """Integration with Smile Identity KYC verification platform."""

    def __init__(self):
        self.partner_id = settings.SMILE_IDENTITY_PARTNER_ID
        self.api_key = settings.SMILE_IDENTITY_API_KEY
        self.callback_url = settings.SMILE_IDENTITY_CALLBACK_URL

    # ------------------------------------------------------------------
    # Authentication helpers
    # ------------------------------------------------------------------

    def _generate_signature(self, timestamp: str) -> str:
        """
        Generate HMAC-SHA256 signature for Smile Identity API requests.
        Signature = HMAC-SHA256(api_key, partner_id + timestamp)
        """
        message = f"{self.partner_id}{timestamp}"
        signature = hmac.new(
            self.api_key.encode("utf-8"),
            message.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return signature

    def _build_auth_payload(self) -> dict:
        """Return the common authentication fields for every request."""
        timestamp = str(int(time.time()))
        return {
            "partner_id": self.partner_id,
            "timestamp": timestamp,
            "signature": self._generate_signature(timestamp),
        }

    def _make_request(self, endpoint: str, payload: dict) -> dict:
        """
        POST to a Smile Identity API endpoint.
        Merges authentication fields into *payload* automatically.
        """
        url = f"{SMILE_API_BASE}{endpoint}"
        payload.update(self._build_auth_payload())

        try:
            response = requests.post(url, json=payload, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.HTTPError as exc:
            body = exc.response.text if exc.response is not None else ""
            logger.error(
                "Smile Identity HTTP error on %s: %s – %s",
                endpoint,
                exc,
                body,
            )
            raise SmileIdentityError(
                f"Smile Identity API error ({exc.response.status_code}): {body}"
            ) from exc
        except requests.exceptions.RequestException as exc:
            logger.error("Smile Identity request failed on %s: %s", endpoint, exc)
            raise SmileIdentityError(f"Smile Identity connection error: {exc}") from exc

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def verify_id(
        self,
        user: User,
        id_type: str,
        id_number: str,
        country: str = "KE",
    ) -> dict:
        """
        Enhanced KYC – verify a national ID, passport, etc. against
        government databases via Smile Identity.

        Returns the raw API response dict which includes a ``job_id``
        that can be polled later with :meth:`check_job_status`.
        """
        job_id = str(uuid.uuid4())

        payload = {
            "country": country,
            "id_type": id_type,
            "id_number": id_number,
            "job_id": job_id,
            "user_id": str(user.id),
            "callback_url": self.callback_url,
        }

        logger.info(
            "Submitting Enhanced KYC for user=%s id_type=%s country=%s job_id=%s",
            user.id,
            id_type,
            country,
            job_id,
        )

        result = self._make_request("verify", payload)

        AuditLog.objects.create(
            user=user,
            action="KYC_ID_VERIFY_SUBMITTED",
            entity_type="kyc_job",
            entity_id=job_id,
            details={
                "id_type": id_type,
                "country": country,
                "smile_response": result,
            },
        )

        return {**result, "job_id": job_id}

    def verify_document(
        self,
        user: User,
        document_image_url: str,
        selfie_image_url: str,
    ) -> dict:
        """
        Document + selfie verification via Smile Identity.

        *document_image_url* – publicly-accessible URL of the ID document photo.
        *selfie_image_url*   – publicly-accessible URL of the user selfie.
        """
        job_id = str(uuid.uuid4())

        payload = {
            "job_id": job_id,
            "user_id": str(user.id),
            "image_links": {
                "document_image": document_image_url,
                "selfie_image": selfie_image_url,
            },
            "callback_url": self.callback_url,
        }

        logger.info(
            "Submitting document+selfie verification for user=%s job_id=%s",
            user.id,
            job_id,
        )

        result = self._make_request("verify", payload)

        AuditLog.objects.create(
            user=user,
            action="KYC_DOC_VERIFY_SUBMITTED",
            entity_type="kyc_job",
            entity_id=job_id,
            details={"smile_response": result},
        )

        return {**result, "job_id": job_id}

    def check_job_status(self, job_id: str) -> dict:
        """Poll Smile Identity for the result of a verification job."""
        payload = {
            "job_id": job_id,
        }

        logger.info("Checking job status for job_id=%s", job_id)
        return self._make_request("job_status", payload)

    # ------------------------------------------------------------------
    # Webhook / callback handling
    # ------------------------------------------------------------------

    def verify_callback_signature(self, payload: dict) -> bool:
        """
        Validate that the webhook payload really came from Smile Identity
        by recomputing the HMAC-SHA256 signature.
        """
        received_signature = payload.get("signature", "")
        timestamp = payload.get("timestamp", "")
        if not received_signature or not timestamp:
            return False

        expected = self._generate_signature(timestamp)
        return hmac.compare_digest(expected, received_signature)

    def handle_callback(self, payload: dict) -> dict:
        """
        Process an incoming Smile Identity webhook callback.

        On success  -> approve the KYCDocument and upgrade the user's tier.
        On failure  -> reject the KYCDocument with the reason from Smile.

        Returns a summary dict suitable for logging / API response.
        """
        job_id = payload.get("job_id", "")
        user_id = payload.get("user_id", "")
        result_code = payload.get("result", {}).get("ResultCode", "")
        result_text = payload.get("result", {}).get("ResultText", "")
        job_success = payload.get("job_success", False)

        logger.info(
            "KYC callback received: job_id=%s user_id=%s success=%s code=%s",
            job_id,
            user_id,
            job_success,
            result_code,
        )

        # Locate user ------------------------------------------------
        try:
            user = User.objects.get(id=user_id)
        except (User.DoesNotExist, ValueError):
            logger.warning("KYC callback for unknown user_id=%s", user_id)
            return {"status": "error", "detail": "User not found"}

        # Locate pending KYC document(s) for this user ----------------
        pending_docs = KYCDocument.objects.filter(
            user=user,
            status=KYCDocument.Status.PENDING,
        ).order_by("-created_at")

        if job_success:
            # Approve all pending documents for this user
            pending_docs.update(status=KYCDocument.Status.APPROVED)

            # Upgrade KYC tier (cap at 3)
            new_tier = min(user.kyc_tier + 1, 3)
            user.kyc_tier = new_tier
            user.kyc_status = User.KYCStatus.VERIFIED
            user.save(update_fields=["kyc_tier", "kyc_status"])

            AuditLog.objects.create(
                user=user,
                action="KYC_APPROVED",
                entity_type="kyc_job",
                entity_id=job_id,
                details={
                    "result_code": result_code,
                    "result_text": result_text,
                    "new_tier": new_tier,
                },
            )

            logger.info(
                "KYC approved for user=%s, upgraded to tier=%s",
                user.id,
                new_tier,
            )

            return {
                "status": "approved",
                "user_id": str(user.id),
                "new_tier": new_tier,
            }

        else:
            # Reject pending documents
            rejection_reason = result_text or "Verification failed"
            pending_docs.update(
                status=KYCDocument.Status.REJECTED,
                rejection_reason=rejection_reason,
            )

            user.kyc_status = User.KYCStatus.REJECTED
            user.save(update_fields=["kyc_status"])

            AuditLog.objects.create(
                user=user,
                action="KYC_REJECTED",
                entity_type="kyc_job",
                entity_id=job_id,
                details={
                    "result_code": result_code,
                    "result_text": result_text,
                },
            )

            logger.info(
                "KYC rejected for user=%s: %s",
                user.id,
                rejection_reason,
            )

            return {
                "status": "rejected",
                "user_id": str(user.id),
                "reason": rejection_reason,
            }
