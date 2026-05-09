"""DRF views for the external-exchange link / withdraw flow.

Endpoints (all under /api/v1/exchanges/):

  GET    /                              · list user's links + balances
  GET    /providers/                    · static metadata for the
                                          mobile UI (name, logo, status)

  POST   /binance/link/                 · API-key paste flow
  DELETE /binance/                      · unlink

  GET    /coinbase/oauth/start/         · returns authorize_url + state
  POST   /coinbase/oauth/complete/      · exchange code → persist link
  DELETE /coinbase/                     · revoke + unlink

  GET    /noones/oauth/start/
  POST   /noones/oauth/complete/
  DELETE /noones/

  POST   /<provider>/withdraw/          · initiate a withdrawal pull
  GET    /withdrawals/                  · list user's pulls + status
  GET    /withdrawals/<id>/             · poll a single pull's status

State tokens for OAuth are persisted in Redis with a 10-min TTL
keyed on `oauth_state:<user_id>:<provider>`. The callback verifies
the state matches before exchanging the code.
"""
from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.conf import settings as app_settings
from django.core.cache import cache
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from apps.wallets.models import Wallet

from . import binance, coinbase, noones
from .models import ExchangeLink, ExchangeWithdrawal


logger = logging.getLogger(__name__)


# Rate limit · same shape as PaymentRateThrottle. 10/hr is generous
# for a UX flow that's user-initiated only.
class ExchangeRateThrottle(UserRateThrottle):
    scope = "exchange"
    rate = "20/hour"


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────


_OAUTH_STATE_TTL = 600  # 10 minutes


def _state_key(user_id, provider: str) -> str:
    return f"oauth_state:{user_id}:{provider}"


def _put_state(user_id, provider: str, state: str, scheme: str = "app") -> None:
    """Persist state alongside the scheme so the complete endpoint
    uses the SAME redirect_uri the start endpoint did. Audit fix H3 ·
    previously the complete endpoint accepted client-supplied scheme
    which could mismatch start, breaking OAuth and (worse) opening
    a future authorization-code-injection vector if a third scheme
    is ever added without an allow-list."""
    cache.set(
        _state_key(user_id, provider),
        {"state": state, "scheme": scheme},
        timeout=_OAUTH_STATE_TTL,
    )


def _check_state(user_id, provider: str, state: str) -> tuple[bool, str]:
    """Return (ok, scheme) · scheme is the one persisted at start.

    The complete endpoint MUST use the returned scheme to build the
    redirect_uri for the token-exchange call · ignoring whatever
    scheme the client passes in the body.
    """
    raw = cache.get(_state_key(user_id, provider))
    if not raw:
        return (False, "app")
    # Backwards-compat · old format was just a string
    if isinstance(raw, str):
        if raw != state:
            return (False, "app")
        cache.delete(_state_key(user_id, provider))
        return (True, "app")
    if not isinstance(raw, dict) or raw.get("state") != state:
        return (False, "app")
    # One-time use · delete after match
    cache.delete(_state_key(user_id, provider))
    return (True, raw.get("scheme", "app"))


def _link_for(user, provider: str) -> ExchangeLink | None:
    return (
        ExchangeLink.objects
        .filter(user=user, provider=provider, revoked_at__isnull=True)
        .first()
    )


def _client_ip(request) -> str:
    """Trusted-proxy-aware IP extraction.

    2026-05-09 audit fix · the previous version took the FIRST token
    of `X-Forwarded-For` whether or not the request came from a
    trusted proxy · attackers can forge that header. We trust the
    chain only if the immediate peer (`REMOTE_ADDR`) is one of the
    operator-configured trusted proxies (Cloudflare CIDRs, the
    nginx LB IP). Fallback · use `REMOTE_ADDR`.
    """
    remote = request.META.get("REMOTE_ADDR", "") or ""
    trusted = set(
        getattr(settings, "TRUSTED_PROXY_IPS", [
            # Default · localhost (for the docker-internal nginx)
            "127.0.0.1", "::1",
            # Cloudflare's published IPv4 ranges are on
            # https://www.cloudflare.com/ips-v4 · we keep this list
            # tight by trusting only the immediate peer rather than
            # any header. Operators add more via `TRUSTED_PROXY_IPS`.
        ])
    )
    if remote in trusted:
        # Take the LAST token of XFF (the closest non-trusted client),
        # not the first (which is the original remote client and most
        # easily forged). For typical 1-hop CDN setups this is the
        # ONLY token. For multi-hop (CF → nginx → app), it's the IP
        # immediately before the trusted chain.
        xff = request.META.get("HTTP_X_FORWARDED_FOR", "") or ""
        tokens = [t.strip() for t in xff.split(",") if t.strip()]
        if tokens:
            return tokens[-1]
    return remote


def _serialize_link(link: ExchangeLink, balances: dict | None = None) -> dict:
    return {
        "id": str(link.id),
        "provider": link.provider,
        "verified_at": link.verified_at.isoformat(),
        "last_used_at": link.last_used_at.isoformat() if link.last_used_at else None,
        "scopes": list(link.scopes or []),
        "balances": balances or {},
    }


def _decimal_to_str(d) -> str:
    """Decimal → display string · stripped of trailing zeros."""
    return format(d.normalize(), "f") if isinstance(d, Decimal) else str(d)


def _balances_to_json(balances: dict) -> dict:
    out = {}
    for k, v in balances.items():
        if isinstance(v, dict):
            # Binance shape · {currency: {"free": Decimal, "locked": Decimal}}
            out[k] = {
                "free": _decimal_to_str(v.get("free", Decimal(0))),
                "locked": _decimal_to_str(v.get("locked", Decimal(0))),
            }
        else:
            # Coinbase / Noones shape · {currency: Decimal}
            out[k] = _decimal_to_str(v)
    return out


# 2026-05-09 audit fix H1 · server-side Cpay deposit-address allow-list.
# Previously the withdraw flow took the destination from
# `Wallet.deposit_address` directly · a single bad insert into that
# table (admin form bug, migration backfill, anything that bypassed
# the BIP-44 derivation) becomes a treasury exfiltration path because
# the exchange would send to whatever address sits in that row. The
# allow-list below is generated from the BIP-44 master seed at startup
# and asserted on every withdraw · if `Wallet.deposit_address` ever
# diverges from what the seed produces, the withdraw refuses with a
# clear error rather than executing.
_CPAY_DEPOSIT_ADDR_CACHE: dict[tuple[int, str], str] = {}


def _cpay_deposit_address(user, currency: str) -> str:
    """Resolve and VERIFY the Cpay deposit address for (user, currency).

    The Wallet row must exist AND its `deposit_address` must match
    the BIP-44-derived address for that user. If anything diverges,
    raise · refuse to send to a destination we can't cryptographically
    re-derive.
    """
    w = Wallet.objects.filter(user=user, currency=currency).first()
    if not w or not w.deposit_address:
        raise ValueError(
            f"No Cpay deposit address for {currency}. The wallet "
            "must be provisioned before pulling funds in."
        )

    # Re-derive the expected address from the master seed and assert
    # it matches what's in the DB. Cpay-managed addresses are
    # BIP-44 derived from `WALLET_MASTER_SEED` at the user's
    # `address_index`. If `address_index` is null the wallet was
    # NOT minted by our generation flow · refuse.
    if w.address_index is None:
        logger.error(
            "exchange.deposit_address_no_index user=%s currency=%s addr=%s",
            user.id, currency, w.deposit_address,
        )
        raise ValueError(
            "Deposit address provenance unverified · contact support."
        )

    cache_key = (user.id, currency)
    expected = _CPAY_DEPOSIT_ADDR_CACHE.get(cache_key)
    if expected is None:
        try:
            from apps.blockchain.services import generate_deposit_address
            expected = generate_deposit_address(
                str(user.id), currency, w.address_index,
            )
            _CPAY_DEPOSIT_ADDR_CACHE[cache_key] = expected
        except Exception:
            logger.exception(
                "exchange.deposit_address_derivation_failed user=%s currency=%s",
                user.id, currency,
            )
            raise ValueError(
                "Internal error verifying deposit address. "
                "Please contact support before retrying.",
            )

    if w.deposit_address != expected:
        logger.error(
            "exchange.deposit_address_mismatch user=%s currency=%s "
            "db=%s expected=%s",
            user.id, currency, w.deposit_address, expected,
        )
        raise ValueError(
            "Deposit address verification failed · contact support."
        )

    return w.deposit_address


def _audit(action: str, user, *, link=None, withdrawal=None, request=None,
           extra: dict | None = None) -> None:
    """Append-only audit log entry for exchange operations.

    2026-05-09 audit fix C3 · we had ZERO audit log on link/unlink/
    withdraw · post-incident reconstruction was impossible. Now every
    state-changing exchange action emits an `AuditLog` row keyed on
    user with the relevant ids, IP, and a short JSON evidence blob.
    """
    try:
        from apps.accounts.models import AuditLog
        details = {}
        if link is not None:
            details["link_id"] = str(link.id)
            details["provider"] = link.provider
        if withdrawal is not None:
            details["withdrawal_id"] = str(withdrawal.id)
            details["currency"] = withdrawal.currency
            details["amount"] = str(withdrawal.amount)
            details["network"] = withdrawal.network
        if extra:
            details.update(extra)
        ip = _client_ip(request) if request is not None else ""
        ua = (request.META.get("HTTP_USER_AGENT", "")[:255]
              if request is not None else "")
        AuditLog.objects.create(
            user=user,
            action=action,
            entity_type="exchange",
            entity_id=str(link.id) if link else (
                str(withdrawal.id) if withdrawal else "exchange"
            ),
            ip_address=ip or None,
            user_agent=ua,
            details=details,
        )
    except Exception:
        # Never block a user-facing action on audit-log failure ·
        # surface to logs and continue.
        logger.exception("exchange.audit_log_failed action=%s", action)


# ─────────────────────────────────────────────────────────────────
# List endpoint
# ─────────────────────────────────────────────────────────────────


class ExchangeListView(APIView):
    """GET /api/v1/exchanges/ · user's linked exchanges with balances."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ExchangeRateThrottle]

    def get(self, request):
        out = []
        for link in ExchangeLink.objects.filter(
            user=request.user, revoked_at__isnull=True
        ):
            balances = {}
            try:
                balances = _read_balances(link)
            except Exception as e:
                logger.warning(
                    "exchange.list_balance_failed user=%s provider=%s err=%s",
                    request.user.id, link.provider, str(e)[:200],
                )
                balances = {"_error": "Unable to fetch · try again shortly"}
            out.append(_serialize_link(link, _balances_to_json(balances)))
        return Response({"links": out})


def _read_balances(link: ExchangeLink) -> dict:
    """Provider-dispatch read."""
    if link.provider == ExchangeLink.PROVIDER_BINANCE:
        from apps.core.pii import decrypt_pii
        secret = decrypt_pii(link.api_secret) if link.api_secret else ""
        return binance.get_balances(link.api_key, secret)
    if link.provider == ExchangeLink.PROVIDER_COINBASE:
        at = coinbase.access_token_for(link)
        return coinbase.get_balances(at)
    if link.provider == ExchangeLink.PROVIDER_NOONES:
        at = noones.access_token_for(link)
        return noones.get_balances(at)
    return {}


# ─────────────────────────────────────────────────────────────────
# Provider metadata · what's configured + flagged for the UI
# ─────────────────────────────────────────────────────────────────


class ExchangeProvidersView(APIView):
    """GET /api/v1/exchanges/providers/ · which exchanges Cpay can
    link right now (depends on operator-side OAuth-app provisioning)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "providers": [
                {
                    "id": "binance",
                    "name": "Binance",
                    "method": "api_key",
                    "configured": True,  # always available · per-user keys
                    "egress_ip": binance.egress_ip_for_binance(),
                    "supported_currencies": list(binance.DEFAULT_NETWORKS.keys()),
                },
                {
                    "id": "coinbase",
                    "name": "Coinbase",
                    "method": "oauth",
                    "configured": coinbase.is_configured(),
                    "supported_currencies": ["USDT", "USDC", "BTC", "ETH"],
                },
                {
                    "id": "noones",
                    "name": "Noones",
                    "method": "oauth",
                    "configured": noones.is_configured(),
                    "supported_currencies": ["BTC", "USDT", "ETH"],
                },
            ],
        })


# ─────────────────────────────────────────────────────────────────
# Binance · API-key paste flow
# ─────────────────────────────────────────────────────────────────


class BinanceLinkView(APIView):
    """POST /api/v1/exchanges/binance/link/

    Body: {"api_key": "...", "api_secret": "..."}

    Verifies the keys against Binance, refuses to link if the keys
    have over-broad permissions (trading enabled), persists the link
    encrypted at rest.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ExchangeRateThrottle]

    def post(self, request):
        api_key = (request.data.get("api_key") or "").strip()
        api_secret = (request.data.get("api_secret") or "").strip()
        if not api_key or not api_secret:
            return Response(
                {"error": "api_key and api_secret are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Refuse to verify if a previous active link exists (idempotency
        # · don't bombard Binance with verification calls)
        existing = _link_for(request.user, ExchangeLink.PROVIDER_BINANCE)
        if existing:
            return Response(
                {
                    "error": "binance_already_linked",
                    "message": "Unlink the existing Binance account first.",
                },
                status=status.HTTP_409_CONFLICT,
            )

        try:
            verify = binance.verify_credentials(api_key, api_secret)
        except binance.BinanceError as e:
            return Response(
                {"error": e.code, "message": e.message},
                status=status.HTTP_400_BAD_REQUEST,
            )

        link = ExchangeLink.objects.create(
            user=request.user,
            provider=ExchangeLink.PROVIDER_BINANCE,
            api_key=api_key,
            api_secret=api_secret,  # PIIEncryptedField · auto-Fernet
            scopes=verify.get("scopes", []),
            linked_from_ip=_client_ip(request),
            linked_user_agent=request.META.get("HTTP_USER_AGENT", "")[:255],
        )
        _audit("EXCHANGE_LINKED", request.user, link=link, request=request,
               extra={"method": "api_key"})
        # 2026-05-09 audit fix L3 · do NOT echo the user's full
        # address_whitelist (PII-equivalent). Only return a count
        # and whether the deposit address for the requested currency
        # was found.
        addr_whitelist = verify.get("address_whitelist") or {}
        return Response(
            {
                "link": _serialize_link(link),
                "supported_coins": verify.get("supported_coins", []),
                "address_whitelist_count": sum(
                    len(v) for v in addr_whitelist.values()
                ),
            },
            status=status.HTTP_201_CREATED,
        )


# ─────────────────────────────────────────────────────────────────
# OAuth start / complete (Coinbase + Noones)
# ─────────────────────────────────────────────────────────────────


class CoinbaseOAuthStartView(APIView):
    """GET /api/v1/exchanges/coinbase/oauth/start/?scheme=app|web

    Returns {authorize_url, state}. Mobile opens authorize_url in an
    in-app browser, user signs in, redirects to cryptopay://oauth/
    coinbase. The deep-link handler posts code+state to /complete/.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ExchangeRateThrottle]

    def get(self, request):
        if not coinbase.is_configured():
            return Response(
                {"error": "not_configured",
                 "message": "Coinbase OAuth app not provisioned"},
                status=503,
            )
        scheme = request.query_params.get("scheme", "app")
        if scheme not in ("app", "web"):
            return Response({"error": "invalid scheme"}, status=400)
        state = coinbase.mint_state()
        _put_state(request.user.id, "coinbase", state, scheme=scheme)
        url = coinbase.build_authorize_url(state, scheme=scheme)
        return Response({"authorize_url": url, "state": state})


class CoinbaseOAuthCompleteView(APIView):
    """POST /api/v1/exchanges/coinbase/oauth/complete/

    Body: {"code": "...", "state": "...", "scheme": "app|web"}

    Verifies state, exchanges code for tokens, persists ExchangeLink.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ExchangeRateThrottle]

    def post(self, request):
        code = (request.data.get("code") or "").strip()
        state = (request.data.get("state") or "").strip()
        if not code or not state:
            return Response({"error": "code and state required"}, status=400)
        # 2026-05-09 audit fix H3 · scheme is read FROM the persisted
        # state, NOT from the client body. Prevents scheme-mismatch
        # attacks where the redirect_uri at exchange time differs
        # from the one the user authorized against.
        ok, scheme = _check_state(request.user.id, "coinbase", state)
        if not ok:
            return Response({"error": "invalid_state"}, status=400)

        if _link_for(request.user, ExchangeLink.PROVIDER_COINBASE):
            return Response(
                {"error": "coinbase_already_linked"},
                status=status.HTTP_409_CONFLICT,
            )

        try:
            tokens = coinbase.exchange_code(code, scheme=scheme)
        except coinbase.CoinbaseError as e:
            return Response(
                {"error": e.code, "message": e.message},
                status=status.HTTP_400_BAD_REQUEST,
            )

        expires_in = int(tokens.get("expires_in", 7200))
        link = ExchangeLink.objects.create(
            user=request.user,
            provider=ExchangeLink.PROVIDER_COINBASE,
            access_token=tokens["access_token"],
            refresh_token=tokens.get("refresh_token", ""),
            access_token_expires_at=timezone.now() + timedelta(seconds=expires_in - 30),
            scopes=tokens.get("scope", "").split(",") if tokens.get("scope") else [],
            linked_from_ip=_client_ip(request),
            linked_user_agent=request.META.get("HTTP_USER_AGENT", "")[:255],
        )
        _audit("EXCHANGE_LINKED", request.user, link=link, request=request,
               extra={"method": "oauth"})
        return Response(
            {"link": _serialize_link(link)},
            status=status.HTTP_201_CREATED,
        )


class NoonesOAuthStartView(APIView):
    """GET /api/v1/exchanges/noones/oauth/start/?scheme=app|web"""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ExchangeRateThrottle]

    def get(self, request):
        if not noones.is_configured():
            return Response(
                {"error": "not_configured",
                 "message": "Noones OAuth app not provisioned"},
                status=503,
            )
        scheme = request.query_params.get("scheme", "app")
        if scheme not in ("app", "web"):
            return Response({"error": "invalid scheme"}, status=400)
        state = noones.mint_state()
        _put_state(request.user.id, "noones", state, scheme=scheme)
        url = noones.build_authorize_url(state, scheme=scheme)
        return Response({"authorize_url": url, "state": state})


class NoonesOAuthCompleteView(APIView):
    """POST /api/v1/exchanges/noones/oauth/complete/"""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ExchangeRateThrottle]

    def post(self, request):
        code = (request.data.get("code") or "").strip()
        state = (request.data.get("state") or "").strip()
        if not code or not state:
            return Response({"error": "code and state required"}, status=400)
        # 2026-05-09 audit fix H3 · scheme persisted with state
        ok, scheme = _check_state(request.user.id, "noones", state)
        if not ok:
            return Response({"error": "invalid_state"}, status=400)
        if _link_for(request.user, ExchangeLink.PROVIDER_NOONES):
            return Response(
                {"error": "noones_already_linked"},
                status=status.HTTP_409_CONFLICT,
            )
        try:
            tokens = noones.exchange_code(code, scheme=scheme)
        except noones.NoonesError as e:
            return Response(
                {"error": e.code, "message": e.message},
                status=400,
            )
        expires_in = int(tokens.get("expires_in", 3600))
        scope_str = tokens.get("scope", "")
        link = ExchangeLink.objects.create(
            user=request.user,
            provider=ExchangeLink.PROVIDER_NOONES,
            access_token=tokens["access_token"],
            refresh_token=tokens.get("refresh_token", ""),
            access_token_expires_at=timezone.now() + timedelta(seconds=expires_in - 30),
            scopes=scope_str.split(" ") if scope_str else [],
            linked_from_ip=_client_ip(request),
            linked_user_agent=request.META.get("HTTP_USER_AGENT", "")[:255],
        )
        _audit("EXCHANGE_LINKED", request.user, link=link, request=request,
               extra={"method": "oauth"})
        return Response(
            {"link": _serialize_link(link)},
            status=status.HTTP_201_CREATED,
        )


# ─────────────────────────────────────────────────────────────────
# Unlink
# ─────────────────────────────────────────────────────────────────


class ExchangeUnlinkView(APIView):
    """DELETE /api/v1/exchanges/<provider>/

    Marks the link revoked, wipes credentials, and best-effort revokes
    the upstream OAuth token (Coinbase / Noones).
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ExchangeRateThrottle]

    def delete(self, request, provider: str):
        provider = (provider or "").lower()
        link = _link_for(request.user, provider)
        if not link:
            return Response({"error": "not_linked"}, status=404)

        # Best-effort upstream revoke for OAuth providers.
        try:
            if provider == ExchangeLink.PROVIDER_COINBASE and link.refresh_token:
                coinbase.revoke(link.refresh_token)
            elif provider == ExchangeLink.PROVIDER_NOONES and link.refresh_token:
                noones.revoke(link.refresh_token)
        except Exception as e:
            logger.info(
                "exchange.upstream_revoke_failed provider=%s err=%s",
                provider, str(e)[:120],
            )

        link.revoked_at = timezone.now()
        link.refresh_token = ""
        link.access_token = ""
        link.api_secret = ""
        link.save(update_fields=[
            "revoked_at", "refresh_token", "access_token", "api_secret",
        ])
        _audit("EXCHANGE_UNLINKED", request.user, link=link, request=request)
        return Response({"unlinked": True}, status=200)


# ─────────────────────────────────────────────────────────────────
# Withdraw / pull initiation
# ─────────────────────────────────────────────────────────────────


class ExchangeWithdrawInitiateView(APIView):
    """POST /api/v1/exchanges/<provider>/withdraw/

    Body:
        {
            "currency": "USDT",
            "amount": "100.0",
            "network": "TRX"   (optional · defaults to provider's default)
        }

    Pulls the requested amount from the user's linked exchange to
    Cpay's per-user deposit address on the chosen network. The
    blockchain confirmer credits the wallet asynchronously.

    Returns 202 Accepted with the ExchangeWithdrawal record · the
    mobile client polls /withdrawals/<id>/ for the on-chain hash + status.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ExchangeRateThrottle]

    def post(self, request, provider: str):
        provider = (provider or "").lower()
        link = _link_for(request.user, provider)
        if not link:
            return Response({"error": "not_linked"}, status=400)

        currency = (request.data.get("currency") or "").upper().strip()
        if not currency:
            return Response({"error": "currency required"}, status=400)
        try:
            amount = Decimal(str(request.data.get("amount", "0")))
        except (InvalidOperation, TypeError):
            return Response({"error": "invalid amount"}, status=400)
        if amount <= 0:
            return Response({"error": "amount must be > 0"}, status=400)

        # 2026-05-09 audit fix C1 · request_id MUST come from the
        # client. The previous code minted `uuid4()` server-side per
        # call, which defeated upstream-exchange idempotency: a
        # network-retried client request produced a NEW server uuid
        # → exchange saw two distinct withdraw orders → DOUBLE-PULL.
        # Now we accept it from the body and dedup on (link, request_id).
        request_id = (request.data.get("request_id") or "").strip()
        if not request_id:
            return Response(
                {"error": "request_id required (UUID, client-supplied for idempotency)"},
                status=400,
            )
        # Validate UUID shape so we don't store garbage in the DB.
        try:
            uuid.UUID(request_id)
        except ValueError:
            return Response({"error": "request_id must be a UUID"}, status=400)

        # Idempotency check · if a withdrawal with this (link, request_id)
        # already exists, return it instead of creating a duplicate.
        existing = ExchangeWithdrawal.objects.filter(
            link=link, request_id=request_id,
        ).first()
        if existing:
            logger.info(
                "exchange.withdraw_idempotent_replay user=%s wd=%s",
                request.user.id, existing.id,
            )
            return Response(
                _serialize_withdrawal(existing),
                status=status.HTTP_202_ACCEPTED,
            )

        network = (request.data.get("network") or "").upper().strip()
        if provider == ExchangeLink.PROVIDER_BINANCE and not network:
            network = binance.DEFAULT_NETWORKS.get(currency, currency)

        try:
            destination = _cpay_deposit_address(request.user, currency)
        except ValueError as e:
            return Response({"error": str(e)}, status=400)

        # 2026-05-09 audit fix C2 · enforce platform limits + hard_pause
        # on exchange withdrawals · they were exempt before, opening
        # a bypass for daily/hourly KES caps. Convert the crypto
        # amount to KES via the live rate engine before checking. If
        # the rate fetch fails we fail-CLOSED (refuse) rather than
        # let a withdrawal sneak through unmetered.
        from apps.payments.platform_limits import enforce_outgoing, PlatformLimitExceeded
        try:
            from apps.rates.services import RateService
            kes_quote = RateService.get_crypto_kes_rate(currency)
            kes_per_unit = Decimal(str(kes_quote.get("rate") or kes_quote.get("raw_rate") or "0"))
            kes_equivalent = (amount * kes_per_unit).quantize(Decimal("0.01"))
        except Exception as _rate_err:
            logger.warning(
                "exchange.rate_lookup_failed user=%s currency=%s err=%s",
                request.user.id, currency, str(_rate_err)[:200],
            )
            return Response(
                {"error": "rate_unavailable",
                 "message": "Cannot price withdrawal · try again."},
                status=503,
            )

        try:
            enforce_outgoing(kes_equivalent)
        except PlatformLimitExceeded as _enf:
            return Response(
                {"error": "platform_limit", "message": str(_enf)},
                status=429,
            )

        # Mint the withdrawal row · idempotency check above already
        # ensured we don't dup. Use atomic create to guard against
        # the race where two concurrent posts get past the .first()
        # check but only one wins the unique-constraint insert.
        from django.db import IntegrityError, transaction
        try:
            with transaction.atomic():
                wd = ExchangeWithdrawal.objects.create(
                    user=request.user,
                    link=link,
                    request_id=request_id,
                    currency=currency,
                    network=network,
                    amount=amount,
                    destination_address=destination,
                )
        except IntegrityError:
            # Another concurrent request won the race · fetch and return.
            wd = ExchangeWithdrawal.objects.get(
                link=link, request_id=request_id,
            )
            return Response(
                _serialize_withdrawal(wd),
                status=status.HTTP_202_ACCEPTED,
            )

        _audit("EXCHANGE_WITHDRAW_INITIATED", request.user,
               link=link, withdrawal=wd, request=request)

        try:
            if provider == ExchangeLink.PROVIDER_BINANCE:
                from apps.core.pii import decrypt_pii
                secret = decrypt_pii(link.api_secret) if link.api_secret else ""
                resp = binance.withdraw(
                    api_key=link.api_key,
                    secret=secret,
                    coin=currency,
                    network=network,
                    amount=amount,
                    destination_address=destination,
                    withdraw_order_id=request_id,
                )
                wd.exchange_tx_id = str(resp.get("id", ""))
                wd.status = ExchangeWithdrawal.STATUS_PENDING

            elif provider == ExchangeLink.PROVIDER_COINBASE:
                at = coinbase.access_token_for(link)
                # Find the source wallet · for Coinbase, balance is split
                # across per-currency accounts. Pick the first one that
                # holds enough.
                accounts = coinbase.get_accounts(at)
                src = next(
                    (a for a in accounts
                     if a["currency"] == currency and a["amount"] >= amount),
                    None,
                )
                if not src:
                    raise coinbase.CoinbaseError(
                        "insufficient_balance",
                        f"Not enough {currency} on Coinbase",
                    )
                resp = coinbase.send_to_external(
                    access_token=at,
                    account_id=src["id"],
                    destination_address=destination,
                    amount=amount,
                    currency=currency,
                    idempotency_key=request_id,
                )
                wd.exchange_tx_id = str(resp.get("id", ""))
                wd.status = coinbase.map_coinbase_status(resp.get("status"))

            elif provider == ExchangeLink.PROVIDER_NOONES:
                at = noones.access_token_for(link)
                resp = noones.send_to_external(
                    access_token=at,
                    currency=currency,
                    amount=amount,
                    destination_address=destination,
                    request_id=request_id,
                )
                wd.exchange_tx_id = str(resp.get("id", ""))
                wd.status = noones.map_noones_status(resp.get("status"))

            else:
                wd.status = ExchangeWithdrawal.STATUS_FAILED
                wd.error_code = "unknown_provider"
                wd.error_message = provider
                wd.save()
                return Response({"error": "unknown_provider"}, status=400)

        except Exception as e:
            wd.status = ExchangeWithdrawal.STATUS_FAILED
            wd.error_code = getattr(e, "code", type(e).__name__)
            wd.error_message = getattr(e, "message", str(e))[:500]
            wd.save()
            logger.warning(
                "exchange.withdraw_failed user=%s provider=%s err=%s",
                request.user.id, provider, wd.error_message[:200],
            )
            return Response(
                {"error": wd.error_code, "message": wd.error_message},
                status=400,
            )

        link.last_used_at = timezone.now()
        link.save(update_fields=["last_used_at"])
        wd.save(update_fields=["exchange_tx_id", "status"])
        return Response(
            _serialize_withdrawal(wd),
            status=status.HTTP_202_ACCEPTED,
        )


def _serialize_withdrawal(wd: ExchangeWithdrawal) -> dict:
    return {
        "id": str(wd.id),
        "provider": wd.link.provider,
        "currency": wd.currency,
        "network": wd.network,
        "amount": _decimal_to_str(wd.amount),
        "destination_address": wd.destination_address,
        "exchange_tx_id": wd.exchange_tx_id,
        "on_chain_tx": wd.on_chain_tx,
        "status": wd.status,
        "error_code": wd.error_code,
        "error_message": wd.error_message,
        "created_at": wd.created_at.isoformat(),
        "completed_at": wd.completed_at.isoformat() if wd.completed_at else None,
    }


class ExchangeWithdrawalListView(APIView):
    """GET /api/v1/exchanges/withdrawals/"""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ExchangeRateThrottle]

    def get(self, request):
        out = [
            _serialize_withdrawal(w)
            for w in ExchangeWithdrawal.objects
            .filter(user=request.user)
            .select_related("link")
            .order_by("-created_at")[:50]
        ]
        return Response({"withdrawals": out})


class ExchangeWithdrawalStatusView(APIView):
    """GET /api/v1/exchanges/withdrawals/<uuid:withdrawal_id>/

    Refreshes the status from the upstream exchange and returns the
    latest record. Cheap to call · short-circuits if the withdrawal
    is already in a terminal state.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ExchangeRateThrottle]

    def get(self, request, withdrawal_id):
        wd = get_object_or_404(
            ExchangeWithdrawal.objects.select_related("link"),
            id=withdrawal_id, user=request.user,
        )
        if wd.is_terminal:
            return Response(_serialize_withdrawal(wd))

        try:
            self._refresh(wd)
        except Exception as e:
            logger.info(
                "exchange.withdrawal_refresh_failed wd=%s err=%s",
                wd.id, str(e)[:200],
            )

        return Response(_serialize_withdrawal(wd))

    def _refresh(self, wd: ExchangeWithdrawal) -> None:
        provider = wd.link.provider
        if provider == ExchangeLink.PROVIDER_BINANCE:
            from apps.core.pii import decrypt_pii
            secret = decrypt_pii(wd.link.api_secret) if wd.link.api_secret else ""
            history = binance.get_withdraw_history(
                wd.link.api_key, secret,
                withdraw_order_id=wd.request_id, limit=1,
            )
            if not history:
                return
            row = history[0]
            wd.exchange_tx_id = str(row.get("id", wd.exchange_tx_id))
            wd.on_chain_tx = row.get("txId", wd.on_chain_tx) or wd.on_chain_tx
            wd.status = binance.map_binance_status(row.get("status", 0))

        elif provider == ExchangeLink.PROVIDER_COINBASE:
            if not wd.exchange_tx_id:
                return
            at = coinbase.access_token_for(wd.link)
            accounts = coinbase.get_accounts(at)
            src = next(
                (a for a in accounts if a["currency"] == wd.currency), None,
            )
            if not src:
                return
            tx = coinbase.get_transaction(at, src["id"], wd.exchange_tx_id)
            wd.status = coinbase.map_coinbase_status(tx.get("status"))
            net = tx.get("network") or {}
            wd.on_chain_tx = net.get("hash", wd.on_chain_tx) or wd.on_chain_tx

        elif provider == ExchangeLink.PROVIDER_NOONES:
            if not wd.exchange_tx_id:
                return
            at = noones.access_token_for(wd.link)
            tx = noones.get_transaction(at, wd.exchange_tx_id)
            wd.status = noones.map_noones_status(tx.get("status"))
            wd.on_chain_tx = tx.get("txhash", wd.on_chain_tx) or wd.on_chain_tx

        if wd.is_terminal and not wd.completed_at:
            wd.completed_at = timezone.now()
        wd.save(update_fields=[
            "exchange_tx_id", "on_chain_tx", "status", "completed_at",
        ])
