"""
M-Pesa Daraja callback endpoints.

These receive async results from Safaricom after STK Push, B2C, B2B operations.
They must be publicly accessible HTTPS endpoints.

Security: IP whitelist (middleware) + per-transaction HMAC tokens (URL path) +
replay prevention (one-time token consumption via Redis).
"""

import logging
from decimal import Decimal, InvalidOperation

from django.db import transaction as db_tx
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.payments.models import Transaction

from .middleware import verify_callback_token
from .models import MpesaCallback

logger = logging.getLogger(__name__)


def _verify_token_if_present(kwargs: dict) -> bool:
    """
    Verify the callback token from the URL path if present.

    If no token in the URL (static path), allow through — IP whitelist
    is the primary defense for static paths.
    If token is present, verify and consume it (one-time use).
    """
    token = kwargs.get("token")
    if not token:
        return True  # Static callback path — IP whitelist handles security

    is_valid, tx_id = verify_callback_token(token)
    if not is_valid:
        logger.warning(f"Invalid/expired callback token: {token[:16]}...")
    return is_valid


class STKCallbackView(APIView):
    """Handle STK Push (Lipa Na M-Pesa) callbacks — user buying crypto."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, token=None):
        # Verify token if present in URL
        if token and not _verify_token_if_present({"token": token}):
            return Response(
                {"ResultCode": 1, "ResultDesc": "Invalid token"},
                status=status.HTTP_403_FORBIDDEN,
            )

        payload = request.data
        logger.debug(f"STK callback payload: {payload}")

        body = payload.get("Body", {}).get("stkCallback", {})
        merchant_request_id = body.get("MerchantRequestID", "")
        checkout_request_id = body.get("CheckoutRequestID", "")
        result_code = body.get("ResultCode")
        result_desc = body.get("ResultDesc", "")

        # Extract callback metadata
        mpesa_receipt = ""
        amount = None
        phone = ""

        if result_code == 0 and body.get("CallbackMetadata"):
            items = body["CallbackMetadata"].get("Item", [])
            for item in items:
                name = item.get("Name", "")
                value = item.get("Value")
                if name == "MpesaReceiptNumber":
                    mpesa_receipt = str(value)
                elif name == "Amount":
                    amount = value
                elif name == "PhoneNumber":
                    phone = str(value)

        # Save callback record
        callback = MpesaCallback.objects.create(
            merchant_request_id=merchant_request_id,
            checkout_request_id=checkout_request_id,
            result_code=result_code,
            result_desc=result_desc,
            mpesa_receipt=mpesa_receipt,
            phone=phone,
            amount=amount,
            raw_payload=payload,
        )

        # Link to transaction and update status — use select_for_update to prevent
        # duplicate callback race condition
        with db_tx.atomic():
            tx = Transaction.objects.select_for_update().filter(
                saga_data__mpesa_checkout_request_id=checkout_request_id,
            ).first()

            if tx:
                callback.transaction = tx
                callback.save(update_fields=["transaction"])

                # Guard: skip if already in a terminal state (duplicate callback)
                if tx.status in (Transaction.Status.COMPLETED, Transaction.Status.FAILED, Transaction.Status.REVERSED):
                    logger.info(f"STK callback for already-{tx.status} tx {tx.id}, skipping")
                    return Response({"ResultCode": 0, "ResultDesc": "Accepted"}, status=status.HTTP_200_OK)

                if result_code == 0:
                    # B12: refuse to credit if Safaricom-reported Amount disagrees
                    # with the transaction's expected source_amount. Allow ≤ 1 KES
                    # rounding slop (Safaricom displays integer KES on M-Pesa side).
                    try:
                        from decimal import Decimal, InvalidOperation
                        if amount is not None and tx.source_amount is not None:
                            callback_amt = Decimal(str(amount))
                            expected = Decimal(str(tx.source_amount))
                            if abs(callback_amt - expected) > Decimal("1"):
                                logger.critical(
                                    f"STK amount mismatch · tx {tx.id}: expected {expected} "
                                    f"got {callback_amt} · rejecting credit"
                                )
                                tx.status = Transaction.Status.FAILED
                                tx.failure_reason = "amount_mismatch"
                                tx.save(update_fields=["status", "failure_reason", "updated_at"])
                                return Response(
                                    {"ResultCode": 0, "ResultDesc": "Accepted"},
                                    status=status.HTTP_200_OK,
                                )
                    except (InvalidOperation, TypeError, ValueError):
                        logger.exception("STK amount parse failed")

                    # BUY flow: credit crypto + mark COMPLETED atomically
                    if tx.type == Transaction.Type.BUY and tx.dest_currency and tx.dest_amount:
                        try:
                            import uuid as _uuid
                            from apps.wallets.models import Wallet
                            from apps.wallets.services import WalletService

                            tx.mpesa_receipt = mpesa_receipt
                            tx.status = Transaction.Status.COMPLETED
                            tx.completed_at = timezone.now()
                            tx.save(update_fields=["mpesa_receipt", "status", "completed_at", "updated_at"])

                            wallet, _ = Wallet.objects.get_or_create(
                                user=tx.user, currency=tx.dest_currency,
                            )
                            # Deterministic tx_id to prevent double-credit on retry
                            credit_tx_id = _uuid.uuid5(
                                _uuid.NAMESPACE_URL,
                                f"buy_credit:{tx.id}",
                            )
                            WalletService.credit(
                                wallet.id,
                                tx.dest_amount,
                                credit_tx_id,
                                f"Buy {tx.dest_currency}: M-Pesa receipt {mpesa_receipt}",
                            )
                            logger.info(
                                f"Credited {tx.dest_amount} {tx.dest_currency} to "
                                f"user {tx.user_id} for BUY tx {tx.id}"
                            )
                        except Exception as e:
                            logger.critical(
                                f"FAILED to credit crypto for BUY tx {tx.id}: {e}. "
                                f"MANUAL INTERVENTION REQUIRED.",
                            exc_info=True,
                            )
                    else:
                        tx.mpesa_receipt = mpesa_receipt
                        tx.status = Transaction.Status.COMPLETED
                        tx.completed_at = timezone.now()
                        tx.save(update_fields=["mpesa_receipt", "status", "completed_at", "updated_at"])

                    # Send notifications for completed transactions
                    try:
                        from apps.core.email import send_transaction_notifications
                        send_transaction_notifications(tx.user, tx)
                    except Exception as e:
                        logger.error(f"Notification dispatch failed for tx {tx.id}: {e}")
                else:
                    tx.failure_reason = result_desc
                    tx.status = Transaction.Status.FAILED
                    tx.save(update_fields=["failure_reason", "status", "updated_at"])

        return Response({"ResultCode": 0, "ResultDesc": "Accepted"}, status=status.HTTP_200_OK)


class B2BCallbackView(APIView):
    """Handle B2B (Paybill/Till payment) callbacks — core crypto-to-bill flow."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, token=None):
        if token and not _verify_token_if_present({"token": token}):
            return Response(
                {"ResultCode": 1, "ResultDesc": "Invalid token"},
                status=status.HTTP_403_FORBIDDEN,
            )

        payload = request.data
        logger.debug(f"B2B callback payload: {payload}")

        result = payload.get("Result", {})
        result_code = result.get("ResultCode")
        result_desc = result.get("ResultDesc", "")
        conversation_id = result.get("ConversationID", "")
        originator_id = result.get("OriginatorConversationID", "")

        # Extract receipt from result parameters
        mpesa_receipt = ""
        if result_code == 0 and result.get("ResultParameters"):
            params = result["ResultParameters"].get("ResultParameter", [])
            for param in params:
                if param.get("Key") == "TransactionReceipt":
                    mpesa_receipt = str(param.get("Value", ""))

        callback = MpesaCallback.objects.create(
            result_code=result_code,
            result_desc=result_desc,
            mpesa_receipt=mpesa_receipt,
            raw_payload=payload,
        )

        # Find the transaction by conversation ID — use select_for_update to prevent
        # duplicate callback race condition
        with db_tx.atomic():
            tx = Transaction.objects.select_for_update().filter(
                saga_data__mpesa_conversation_id=conversation_id,
            ).first() or Transaction.objects.select_for_update().filter(
                saga_data__mpesa_originator_id=originator_id,
            ).first()

            if tx:
                callback.transaction = tx
                callback.save(update_fields=["transaction"])

                # Guard: skip if already in a terminal state (duplicate callback)
                if tx.status in (Transaction.Status.COMPLETED, Transaction.Status.FAILED, Transaction.Status.REVERSED):
                    logger.info(f"B2B callback for already-{tx.status} tx {tx.id}, skipping")
                    return Response({"ResultCode": 0, "ResultDesc": "Accepted"}, status=status.HTTP_200_OK)

                if result_code == 0:
                    from apps.payments.saga import PaymentSaga
                    saga = PaymentSaga(tx)
                    saga.complete(mpesa_receipt)
                else:
                    tx.failure_reason = result_desc
                    tx.status = Transaction.Status.FAILED
                    tx.save(update_fields=["failure_reason", "status", "updated_at"])
                    # Trigger compensation
                    from apps.payments.saga import PaymentSaga
                    saga = PaymentSaga(tx)
                    try:
                        saga.compensate_convert()
                        logger.info(f"B2B failed, compensated crypto for tx {tx.id}")
                    except Exception as comp_err:
                        logger.critical(
                            f"B2B compensation failed for tx {tx.id}: {comp_err}. "
                            f"MANUAL INTERVENTION REQUIRED."
                        )

        return Response({"ResultCode": 0, "ResultDesc": "Accepted"}, status=status.HTTP_200_OK)


class B2CCallbackView(APIView):
    """Handle B2C callbacks — user selling crypto, receiving M-Pesa."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, token=None):
        if token and not _verify_token_if_present({"token": token}):
            return Response(
                {"ResultCode": 1, "ResultDesc": "Invalid token"},
                status=status.HTTP_403_FORBIDDEN,
            )

        payload = request.data
        logger.debug(f"B2C callback payload: {payload}")

        result = payload.get("Result", {})
        result_code = result.get("ResultCode")
        result_desc = result.get("ResultDesc", "")
        conversation_id = result.get("ConversationID", "")

        mpesa_receipt = ""
        if result_code == 0 and result.get("ResultParameters"):
            params = result["ResultParameters"].get("ResultParameter", [])
            for param in params:
                if param.get("Key") == "TransactionReceipt":
                    mpesa_receipt = str(param.get("Value", ""))

        callback = MpesaCallback.objects.create(
            result_code=result_code,
            result_desc=result_desc,
            mpesa_receipt=mpesa_receipt,
            raw_payload=payload,
        )

        # Use select_for_update to prevent duplicate callback race condition
        with db_tx.atomic():
            tx = Transaction.objects.select_for_update().filter(
                saga_data__mpesa_conversation_id=conversation_id,
            ).first()

            if tx:
                # Link callback to transaction (was missing for B2C)
                callback.transaction = tx
                callback.save(update_fields=["transaction"])

                # Guard: skip if already in a terminal state (duplicate callback)
                if tx.status in (Transaction.Status.COMPLETED, Transaction.Status.FAILED, Transaction.Status.REVERSED):
                    logger.info(f"B2C callback for already-{tx.status} tx {tx.id}, skipping")
                    return Response({"ResultCode": 0, "ResultDesc": "Accepted"}, status=status.HTTP_200_OK)

                if result_code == 0:
                    from apps.payments.saga import PaymentSaga
                    saga = PaymentSaga(tx)
                    saga.complete(mpesa_receipt=mpesa_receipt)
                else:
                    # B2C failed — compensate: credit crypto back to user
                    from apps.payments.saga import PaymentSaga
                    saga = PaymentSaga(tx)
                    tx.failure_reason = result_desc
                    tx.status = Transaction.Status.FAILED
                    tx.save(update_fields=["failure_reason", "status", "updated_at"])
                    try:
                        saga.compensate_convert()
                        logger.info(f"B2C failed, compensated crypto for tx {tx.id}")
                    except Exception as comp_err:
                        logger.critical(
                            f"B2C compensation failed for tx {tx.id}: {comp_err}. "
                            f"MANUAL INTERVENTION REQUIRED."
                        )

        return Response({"ResultCode": 0, "ResultDesc": "Accepted"}, status=status.HTTP_200_OK)


class C2BValidationView(APIView):
    """
    Validate incoming C2B payment before M-Pesa processes it.

    Safaricom calls this URL when a customer initiates a payment to our Paybill.
    We validate the account reference and amount before accepting.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        logger.debug(f"C2B validation payload: {request.data}")

        bill_ref = request.data.get("BillRefNumber", "").strip()
        amount = request.data.get("TransAmount", 0)
        phone = request.data.get("MSISDN", "")

        # Parse account reference to find user and target currency
        user, currency = _parse_c2b_account_ref(bill_ref, phone)

        if not user:
            logger.warning(f"C2B validation rejected: unknown account ref '{bill_ref}' from {phone}")
            return Response({"ResultCode": "C2B00012", "ResultDesc": "Invalid Account"})

        # Validate amount
        try:
            kes_amount = Decimal(str(amount))
        except (ValueError, InvalidOperation):
            return Response({"ResultCode": "C2B00013", "ResultDesc": "Invalid amount"})

        from django.conf import settings as app_settings

        if kes_amount < app_settings.DEPOSIT_MIN_KES:
            return Response({"ResultCode": "C2B00013", "ResultDesc": f"Minimum deposit is KES {app_settings.DEPOSIT_MIN_KES}"})
        if kes_amount > app_settings.DEPOSIT_MAX_KES:
            return Response({"ResultCode": "C2B00013", "ResultDesc": f"Maximum deposit is KES {app_settings.DEPOSIT_MAX_KES:,}"})

        # Check if user is suspended
        if getattr(user, "is_suspended", False):
            return Response({"ResultCode": "C2B00014", "ResultDesc": "Account suspended"})

        # Check daily limit
        try:
            from apps.payments.services import check_daily_limit, DailyLimitExceededError
            check_daily_limit(user, kes_amount)
        except DailyLimitExceededError:
            return Response({"ResultCode": "C2B00013", "ResultDesc": "Daily transaction limit exceeded"})
        except Exception:
            pass  # Don't reject on check failure — let it through

        # Accept
        logger.debug(f"C2B validation accepted: {kes_amount} KES from {phone} -> {currency} for user {user.id}")
        return Response({"ResultCode": 0, "ResultDesc": "Accepted"})


class C2BConfirmationView(APIView):
    """
    Process confirmed C2B payment — credit crypto to user's wallet.

    Safaricom calls this after payment is confirmed. We create a deposit
    transaction and convert KES to crypto at the live market rate.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        logger.debug(f"C2B confirmation payload: {request.data}")

        trans_id = request.data.get("TransID", "")
        amount = request.data.get("TransAmount", 0)
        phone = request.data.get("MSISDN", "")
        bill_ref = request.data.get("BillRefNumber", "").strip()

        # Idempotency: check if we already processed this TransID
        if MpesaCallback.objects.filter(mpesa_receipt=trans_id).exists():
            logger.info(f"C2B confirmation already processed: {trans_id}")
            return Response({"ResultCode": 0, "ResultDesc": "Already processed"})

        # Save raw callback immediately
        MpesaCallback.objects.create(
            result_code=0,
            result_desc="C2B confirmation",
            mpesa_receipt=trans_id,
            phone=phone,
            amount=amount,
            raw_payload=request.data,
        )

        # Process deposit asynchronously via Celery
        from .tasks import process_c2b_deposit

        process_c2b_deposit.delay(trans_id, str(amount), phone, bill_ref, request.data)

        return Response({"ResultCode": 0, "ResultDesc": "Accepted"})


def _parse_c2b_account_ref(bill_ref: str, phone: str):
    """
    Parse a C2B account reference to find the user and target currency.

    Supported formats:
    - "CP-0712345678" or "CP-254712345678" -> user by phone, default USDT
    - "USDT-0712345678" -> user by phone, USDT currency
    - "BTC-0712345678" -> user by phone, BTC currency
    - "ETH-0712345678" -> user by phone, ETH currency
    - "SOL-0712345678" -> user by phone, SOL currency
    - Plain phone number -> user by phone, default USDT

    Returns (user, currency) or (None, None) if not found.
    """
    from apps.accounts.models import User

    VALID_CURRENCIES = {"USDT", "USDC", "BTC", "ETH", "SOL"}
    currency = "USDT"  # Default
    lookup_phone = ""

    if "-" in bill_ref:
        prefix, phone_part = bill_ref.split("-", 1)
        prefix = prefix.upper()
        if prefix in VALID_CURRENCIES:
            currency = prefix
        lookup_phone = phone_part
    elif bill_ref:
        lookup_phone = bill_ref
    else:
        lookup_phone = phone

    # Normalize phone to +254 format
    lookup_phone = lookup_phone.strip().replace(" ", "").replace("-", "")
    if lookup_phone.startswith("0"):
        lookup_phone = "+254" + lookup_phone[1:]
    elif lookup_phone.startswith("254"):
        lookup_phone = "+" + lookup_phone
    elif not lookup_phone.startswith("+"):
        lookup_phone = "+254" + lookup_phone

    # Also try the MSISDN from the M-Pesa payload
    msisdn = phone.strip()
    if msisdn.startswith("254"):
        msisdn = "+" + msisdn

    user = User.objects.filter(phone=lookup_phone).first()
    if not user and msisdn != lookup_phone:
        user = User.objects.filter(phone=msisdn).first()

    if user:
        return user, currency
    return None, None


class BalanceCallbackView(APIView):
    """
    Handle M-Pesa Account Balance API callback.

    Parses the balance from the M-Pesa response and updates the payment
    circuit breaker state. The balance result contains a multi-line string
    like: "Working Account|KES|2000000.00|2000000.00|0.00|0.00"
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, token=None):
        # B11: verify per-transaction callback token when present.
        if token is not None:
            is_valid, _tx_id = verify_callback_token(token)
            if not is_valid:
                logger.warning(f"Balance callback rejected · bad token: {token[:16]}...")
                return Response(
                    {"ResultCode": 1, "ResultDesc": "Invalid token"},
                    status=status.HTTP_403_FORBIDDEN,
                )
        logger.info(f"Balance callback received: {request.data}")

        MpesaCallback.objects.create(
            result_code=0,
            result_desc="Balance callback",
            raw_payload=request.data,
        )

        try:
            result = request.data.get("Result", {})
            result_code = result.get("ResultCode", -1)

            if result_code != 0:
                logger.error(f"Balance query failed: {result.get('ResultDesc', 'Unknown')}")
                return Response({"ResultCode": 0, "ResultDesc": "Accepted"})

            # Parse balance from ResultParameters
            params = result.get("ResultParameters", {}).get("ResultParameter", [])
            balance_str = None
            for param in params:
                if param.get("Key") == "AccountBalance":
                    balance_str = param.get("Value", "")
                    break

            if balance_str:
                # Format: "Working Account|KES|available|actual|reserved|uncleared"
                # Can have multiple accounts separated by "&"
                total_available = Decimal("0")
                for account in balance_str.split("&"):
                    parts = account.split("|")
                    if len(parts) >= 3 and parts[1].strip() == "KES":
                        try:
                            total_available += Decimal(parts[2].strip())
                        except (ValueError, InvalidOperation) as e:
                            logger.warning(f"Failed to parse M-Pesa balance amount '{parts[2]}': {e}")

                if total_available > 0:
                    # Feed into circuit breaker via async task
                    from .tasks import process_balance_result

                    process_balance_result.delay(str(total_available))
                    logger.info(f"M-Pesa float balance: KES {total_available:,.0f}")
                else:
                    logger.warning(f"Could not parse balance from: {balance_str}")
            else:
                logger.warning("No AccountBalance parameter in balance callback")

        except Exception as e:
            logger.error(f"Error processing balance callback: {e}")

        return Response({"ResultCode": 0, "ResultDesc": "Accepted"}, status=status.HTTP_200_OK)


class TimeoutCallbackView(APIView):
    """Generic timeout handler for any M-Pesa queue timeout.

    When Safaricom can't process a request in time, they call this URL.
    We must find the related transaction and handle it — otherwise it stays
    stuck in CONFIRMING forever with the user's crypto debited.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, token=None):
        # B11: verify per-transaction callback token when present.
        if token is not None:
            is_valid, _tx_id = verify_callback_token(token)
            if not is_valid:
                logger.warning(f"Timeout callback rejected · bad token: {token[:16]}...")
                return Response(
                    {"ResultCode": 1, "ResultDesc": "Invalid token"},
                    status=status.HTTP_403_FORBIDDEN,
                )
        logger.warning(f"M-Pesa timeout callback: {request.data}")

        payload = request.data
        callback = MpesaCallback.objects.create(
            result_code=-1,
            result_desc="Queue timeout",
            raw_payload=payload,
        )

        # Try to find the related transaction from the result payload
        result = payload.get("Result", {})
        conversation_id = result.get("ConversationID", "")
        originator_id = result.get("OriginatorConversationID", "")

        tx = None
        if conversation_id:
            tx = Transaction.objects.filter(
                saga_data__mpesa_conversation_id=conversation_id,
            ).first()
        if not tx and originator_id:
            tx = Transaction.objects.filter(
                saga_data__mpesa_originator_id=originator_id,
            ).first()

        if tx:
            callback.transaction = tx
            callback.save(update_fields=["transaction"])

            # Only process if still in CONFIRMING (not already resolved by another callback)
            if tx.status == Transaction.Status.CONFIRMING:
                logger.warning(f"M-Pesa timeout for tx {tx.id} — marking FAILED and compensating")
                tx.failure_reason = "M-Pesa queue timeout. Crypto returned to wallet."
                tx.status = Transaction.Status.FAILED
                tx.save(update_fields=["failure_reason", "status", "updated_at"])

                # Compensate: credit crypto back to user
                try:
                    from apps.payments.saga import PaymentSaga
                    saga = PaymentSaga(tx)
                    saga.compensate_convert()
                    logger.info(f"Compensated timeout tx {tx.id} — crypto returned")
                except Exception as comp_err:
                    logger.critical(
                        f"Timeout compensation failed for tx {tx.id}: {comp_err}. "
                        f"MANUAL INTERVENTION REQUIRED."
                    )

        return Response({"ResultCode": 0, "ResultDesc": "Accepted"}, status=status.HTTP_200_OK)
