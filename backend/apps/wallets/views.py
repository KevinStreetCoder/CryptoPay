import logging

from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.blockchain.models import BlockchainDeposit
from apps.blockchain.services import generate_deposit_address, get_next_address_index

from .models import Wallet
from .serializers import BlockchainDepositSerializer, WalletSerializer

logger = logging.getLogger(__name__)


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

        # KES wallets don't have blockchain deposit addresses
        if wallet.currency == "KES":
            return Response(
                {"detail": "KES wallets do not support crypto deposits. Use M-Pesa to deposit KES."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # If address already exists, return it
        if wallet.deposit_address:
            return Response(
                WalletSerializer(wallet).data,
                status=status.HTTP_200_OK,
            )

        # Generate new address
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
        # Get all deposit addresses for this user
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
