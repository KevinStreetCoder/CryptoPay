import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=10,
    acks_late=True,
)
def process_kyc_verification(self, user_id: str, document_id: str):
    """
    Kick off a Smile Identity verification for the given user / document.

    This task reads the KYCDocument, determines whether to run an Enhanced
    KYC (ID number check) or a document + selfie verification, then
    submits the job to Smile Identity.  The actual result arrives later
    via the webhook handled by ``KYCCallbackView``.
    """
    from .kyc_service import SmileIdentityError, SmileIdentityService
    from .models import KYCDocument, User

    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        logger.error("process_kyc_verification: user %s not found", user_id)
        return

    try:
        document = KYCDocument.objects.get(id=document_id, user=user)
    except KYCDocument.DoesNotExist:
        logger.error(
            "process_kyc_verification: document %s not found for user %s",
            document_id,
            user_id,
        )
        return

    service = SmileIdentityService()

    try:
        if document.document_type in (
            KYCDocument.DocumentType.NATIONAL_ID,
            KYCDocument.DocumentType.PASSPORT,
            KYCDocument.DocumentType.KRA_PIN,
        ):
            # For ID-based documents we need a selfie to pair with
            selfie = KYCDocument.objects.filter(
                user=user,
                document_type=KYCDocument.DocumentType.SELFIE,
            ).order_by("-created_at").first()

            if selfie:
                result = service.verify_document(
                    user=user,
                    document_image_url=document.file_url,
                    selfie_image_url=selfie.file_url,
                )
            else:
                # Fall back to Enhanced KYC without selfie
                # Derive id_type from document_type
                id_type_map = {
                    KYCDocument.DocumentType.NATIONAL_ID: "NATIONAL_ID",
                    KYCDocument.DocumentType.PASSPORT: "PASSPORT",
                    KYCDocument.DocumentType.KRA_PIN: "KRA_PIN",
                }
                result = service.verify_id(
                    user=user,
                    id_type=id_type_map.get(document.document_type, "NATIONAL_ID"),
                    id_number=document.file_url,  # file_url stores the ID number for ID-only checks
                    country="KE",
                )
        else:
            # selfie or proof_of_address — nothing to verify standalone
            logger.info(
                "Document type %s does not trigger standalone verification",
                document.document_type,
            )
            return

        logger.info(
            "KYC verification submitted: user=%s document=%s job_id=%s",
            user_id,
            document_id,
            result.get("job_id"),
        )

    except SmileIdentityError as exc:
        logger.error(
            "Smile Identity error for user=%s doc=%s: %s",
            user_id,
            document_id,
            exc,
        )
        # Retry with exponential backoff
        raise self.retry(exc=exc)


@shared_task(
    bind=True,
    max_retries=10,
    default_retry_delay=30,
    acks_late=True,
)
def check_kyc_job_status(self, job_id: str, user_id: str, document_id: str):
    """
    Poll Smile Identity for the result of a verification job.

    Typically used as a fallback when the webhook callback has not arrived
    within the expected time window.  Retries up to 10 times with a 30-second
    delay (total polling window ~5 minutes).
    """
    from .kyc_service import SmileIdentityError, SmileIdentityService
    from .models import KYCDocument, User

    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        logger.error("check_kyc_job_status: user %s not found", user_id)
        return

    try:
        document = KYCDocument.objects.get(id=document_id, user=user)
    except KYCDocument.DoesNotExist:
        logger.error(
            "check_kyc_job_status: document %s not found for user %s",
            document_id,
            user_id,
        )
        return

    # If the document has already been processed (via callback), skip polling
    if document.status != KYCDocument.Status.PENDING:
        logger.info(
            "Document %s already processed (status=%s), skipping poll",
            document_id,
            document.status,
        )
        return

    service = SmileIdentityService()

    try:
        result = service.check_job_status(job_id)
    except SmileIdentityError as exc:
        logger.error(
            "Smile Identity poll error for job=%s: %s",
            job_id,
            exc,
        )
        raise self.retry(exc=exc)

    job_complete = result.get("job_complete", False)

    if not job_complete:
        logger.info("Job %s not yet complete, will retry", job_id)
        raise self.retry(
            exc=Exception(f"Job {job_id} still pending"),
        )

    # Process the completed result through the same callback handler
    service.handle_callback(result)

    logger.info(
        "Job %s processed via polling for user=%s document=%s",
        job_id,
        user_id,
        document_id,
    )
