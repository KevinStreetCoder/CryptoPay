from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated

from .models import Wallet
from .serializers import WalletSerializer


class WalletListView(ListAPIView):
    """List all wallets for the authenticated user."""

    serializer_class = WalletSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Wallet.objects.filter(user=self.request.user)
