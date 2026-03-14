import logging

from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.blockchain.models import BlockchainDeposit
from apps.blockchain.services import generate_deposit_address, get_next_address_index

from .models import RebalanceOrder, Wallet
from .serializers import (
    BlockchainDepositSerializer,
    CancelOrderSerializer,
    ConfirmSettlementSerializer,
    CustodyTransferSerializer,
    FailOrderSerializer,
    RebalanceOrderSerializer,
    TriggerCustodyRebalanceSerializer,
    TriggerRebalanceSerializer,
    WalletSerializer,
)

logger = logging.getLogger(__name__)


# ── User-facing wallet views ─────────────────────────────────────────────────

class WalletListView(ListAPIView):
    """List all wallets for the authenticated user."""

    serializer_class = WalletSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Wallet.objects.filter(user=self.request.user).order_by("currency")


class GenerateDepositAddressView(APIView):
    """Generate a deposit address for a user's wallet."""

    permission_classes = [IsAuthenticated]

    def post(self, request, wallet_id):
        try:
            wallet = Wallet.objects.get(id=wallet_id, user=request.user)
        except Wallet.DoesNotExist:
            return Response(
                {"detail": "Wallet not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if wallet.currency == "KES":
            return Response(
                {"detail": "KES wallets do not support crypto deposits. Use M-Pesa to deposit KES."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if wallet.deposit_address:
            return Response(
                WalletSerializer(wallet).data,
                status=status.HTTP_200_OK,
            )

        # Lock the wallet row to prevent race condition on address generation
        from django.db import transaction as db_transaction
        with db_transaction.atomic():
            wallet = Wallet.objects.select_for_update().get(id=wallet_id)
            # Re-check after acquiring lock (another request may have generated it)
            if wallet.deposit_address:
                return Response(
                    WalletSerializer(wallet).data,
                    status=status.HTTP_200_OK,
                )

            index = get_next_address_index(str(request.user.id), wallet.currency)
            address = generate_deposit_address(
                str(request.user.id), wallet.currency, index
            )

            wallet.deposit_address = address
            wallet.address_index = index
            wallet.save(update_fields=["deposit_address", "address_index"])

        logger.info(
            f"Generated deposit address for user {request.user.id}, "
            f"currency {wallet.currency}: {address[:10]}..."
        )

        return Response(
            WalletSerializer(wallet).data,
            status=status.HTTP_201_CREATED,
        )


class DepositListView(ListAPIView):
    """List blockchain deposits for the authenticated user's wallets."""

    serializer_class = BlockchainDepositSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user_addresses = list(
            Wallet.objects.filter(
                user=self.request.user,
                deposit_address__gt="",
            ).values_list("deposit_address", flat=True)
        )

        if not user_addresses:
            return BlockchainDeposit.objects.none()

        return BlockchainDeposit.objects.filter(
            to_address__in=user_addresses,
        ).order_by("-created_at")


# ── Admin rebalance views ────────────────────────────────────────────────────

class RebalanceStatusView(APIView):
    """GET /admin/rebalance/status/ — Full rebalance dashboard."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        from .rebalance import get_rebalance_status
        from apps.payments.circuit_breaker import PaymentCircuitBreaker

        data = get_rebalance_status()
        data["circuit_breaker"] = PaymentCircuitBreaker.get_status_dict()
        return Response(data)


class RebalanceOrderListView(ListAPIView):
    """GET /admin/rebalance/orders/ — List all rebalance orders."""

    serializer_class = RebalanceOrderSerializer
    permission_classes = [IsAdminUser]
    queryset = RebalanceOrder.objects.all().order_by("-created_at")


class TriggerRebalanceView(APIView):
    """POST /admin/rebalance/trigger/ — Manually trigger a rebalance."""

    permission_classes = [IsAdminUser]

    def post(self, request):
        serializer = TriggerRebalanceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from .rebalance import create_rebalance_order, submit_rebalance_order

        reason = serializer.validated_data.get("reason") or f"Manual trigger by {request.user}"
        order = create_rebalance_order(
            trigger=RebalanceOrder.TriggerType.MANUAL,
            reason=reason,
            sell_currency=serializer.validated_data["sell_currency"],
            force=serializer.validated_data["force"],
        )

        if not order:
            return Response(
                {"detail": "Rebalance not needed or preconditions not met."},
                status=status.HTTP_409_CONFLICT,
            )

        # Immediately submit (notifies admin in manual mode)
        try:
            submit_rebalance_order(str(order.id))
        except Exception as e:
            logger.error(f"Failed to submit rebalance order: {e}")
            return Response(
                RebalanceOrderSerializer(order).data,
                status=status.HTTP_201_CREATED,
            )

        order.refresh_from_db()
        return Response(
            RebalanceOrderSerializer(order).data,
            status=status.HTTP_201_CREATED,
        )


class ConfirmRebalanceView(APIView):
    """POST /admin/rebalance/{id}/confirm/ — Confirm KES settlement."""

    permission_classes = [IsAdminUser]

    def post(self, request, order_id):
        serializer = ConfirmSettlementSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from .rebalance import confirm_rebalance_settlement

        try:
            order = confirm_rebalance_settlement(
                order_id=str(order_id),
                **serializer.validated_data,
            )
        except RebalanceOrder.DoesNotExist:
            return Response(
                {"detail": "Rebalance order not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        except ValueError as e:
            return Response(
                {"detail": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(RebalanceOrderSerializer(order).data)


class FailRebalanceView(APIView):
    """POST /admin/rebalance/{id}/fail/ — Mark order as failed."""

    permission_classes = [IsAdminUser]

    def post(self, request, order_id):
        serializer = FailOrderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from .rebalance import fail_rebalance_order

        try:
            order = fail_rebalance_order(
                order_id=str(order_id),
                **serializer.validated_data,
            )
        except RebalanceOrder.DoesNotExist:
            return Response(
                {"detail": "Rebalance order not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        except ValueError as e:
            return Response(
                {"detail": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(RebalanceOrderSerializer(order).data)


class CancelRebalanceView(APIView):
    """POST /admin/rebalance/{id}/cancel/ — Cancel an active order."""

    permission_classes = [IsAdminUser]

    def post(self, request, order_id):
        serializer = CancelOrderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from .rebalance import cancel_rebalance_order

        try:
            order = cancel_rebalance_order(
                order_id=str(order_id),
                reason=serializer.validated_data.get("reason", "Cancelled by admin"),
            )
        except RebalanceOrder.DoesNotExist:
            return Response(
                {"detail": "Rebalance order not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        except ValueError as e:
            return Response(
                {"detail": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(RebalanceOrderSerializer(order).data)


# ── Custody views ─────────────────────────────────────────────────────────────

class CustodyReportView(APIView):
    """GET /wallets/custody/report/ — Full custody tier report (staff only)."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        from .custody import CustodyService

        service = CustodyService()
        report = service.get_custody_report()
        return Response(report)


class CustodyRebalanceView(APIView):
    """POST /wallets/custody/rebalance/ — Trigger manual custody rebalance (staff only)."""

    permission_classes = [IsAdminUser]

    def post(self, request):
        serializer = TriggerCustodyRebalanceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from .custody import CustodyService

        service = CustodyService()
        currency = serializer.validated_data.get("currency")
        force = serializer.validated_data.get("force", False)
        initiated_by = str(request.user)

        currencies = [currency] if currency else service.CRYPTO_CURRENCIES
        results = {}

        for curr in currencies:
            try:
                rebalance = service.check_rebalance_needed(curr)

                if not rebalance and not force:
                    results[curr] = {"status": "no_rebalance_needed"}
                    continue

                if not rebalance and force:
                    results[curr] = {"status": "force_mode_no_imbalance_detected"}
                    continue

                direction = rebalance["direction"]
                amount = rebalance["amount"]

                if direction == "hot_to_warm":
                    transfer = service.initiate_hot_to_warm_transfer(
                        currency=curr,
                        amount=amount,
                        initiated_by=initiated_by,
                        reason=f"Manual rebalance by {initiated_by}: {rebalance['reason']}",
                    )
                elif direction == "warm_to_hot":
                    transfer = service.initiate_warm_to_hot_transfer(
                        currency=curr,
                        amount=amount,
                        initiated_by=initiated_by,
                        reason=f"Manual rebalance by {initiated_by}: {rebalance['reason']}",
                    )
                elif direction == "warm_to_cold":
                    transfer = service.initiate_warm_to_cold_transfer(
                        currency=curr,
                        amount=amount,
                        initiated_by=initiated_by,
                        reason=f"Manual rebalance by {initiated_by}: {rebalance['reason']}",
                    )
                elif direction == "cold_to_warm":
                    results[curr] = {
                        "status": "requires_manual_cold_release",
                        "amount": str(amount),
                        "reason": rebalance["reason"],
                    }
                    continue
                else:
                    results[curr] = {"status": "unknown_direction", "direction": direction}
                    continue

                results[curr] = {
                    "status": "transfer_initiated",
                    "transfer": CustodyTransferSerializer(transfer).data,
                }

            except ValueError as e:
                results[curr] = {"status": "error", "message": str(e)}
            except Exception as e:
                logger.error(f"Custody rebalance failed for {curr}: {e}", exc_info=True)
                results[curr] = {"status": "error", "message": str(e)}

        return Response(results)
