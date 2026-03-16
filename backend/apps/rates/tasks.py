"""Celery tasks for periodic rate fetching and rate alert checking."""

import logging
from decimal import Decimal

from celery import shared_task
from django.core.cache import cache
from django.utils import timezone

from .services import RateService

logger = logging.getLogger(__name__)

SUPPORTED_CURRENCIES = ["USDT", "USDC", "BTC", "ETH", "SOL"]


@shared_task
def refresh_rates():
    """Refresh all crypto/USD rates and USD/KES rate.
    Uses batch API call (1 request for all currencies) to stay within
    CoinGecko free tier (10K calls/month). Falls back to CryptoCompare."""
    try:
        RateService.refresh_all_crypto_rates()
    except Exception as e:
        logger.error(f"Failed batch rate refresh: {e}")

    try:
        RateService.get_usd_kes_rate()
    except Exception as e:
        logger.error(f"Failed to refresh USD/KES: {e}")

    # Broadcast updated rates to all WebSocket clients
    _broadcast_current_rates()

    # Check rate alerts against new rates
    _check_rate_alerts()


def _broadcast_current_rates():
    """Build rates dict from cache and broadcast via WebSocket."""
    try:
        from apps.core.broadcast import broadcast_rates

        usd_kes = cache.get("rate:forex:usd:kes")
        rates = {}

        for currency in SUPPORTED_CURRENCIES:
            usd_rate = cache.get(f"rate:crypto:{currency}:usd")
            if usd_rate:
                rates[currency] = {
                    "usd": float(usd_rate),
                    "kes": round(float(usd_rate) * float(usd_kes), 2) if usd_kes else None,
                }

        if rates:
            broadcast_rates(rates)
    except Exception as e:
        logger.warning(f"Failed to broadcast rates: {e}")


def _check_rate_alerts():
    """Check all active rate alerts against current rates and trigger notifications."""
    try:
        from .models import RateAlert

        usd_kes = cache.get("rate:forex:usd:kes")
        if not usd_kes:
            return

        usd_kes = Decimal(str(usd_kes))

        # Build current KES rates
        current_kes_rates = {}
        for currency in SUPPORTED_CURRENCIES:
            usd_rate = cache.get(f"rate:crypto:{currency}:usd")
            if usd_rate:
                current_kes_rates[currency] = Decimal(str(usd_rate)) * usd_kes

        if not current_kes_rates:
            return

        # Fetch all active alerts
        active_alerts = RateAlert.objects.filter(is_active=True).select_related("user")

        triggered_ids = []
        notifications = []

        for alert in active_alerts:
            current_rate = current_kes_rates.get(alert.currency)
            if current_rate is None:
                continue

            should_trigger = False
            if alert.direction == "above" and current_rate >= alert.target_rate:
                should_trigger = True
            elif alert.direction == "below" and current_rate <= alert.target_rate:
                should_trigger = True

            if should_trigger:
                triggered_ids.append(alert.id)
                notifications.append({
                    "user": alert.user,
                    "currency": alert.currency,
                    "direction": alert.direction,
                    "target_rate": alert.target_rate,
                    "current_rate": current_rate,
                })

        # Mark alerts as triggered
        if triggered_ids:
            RateAlert.objects.filter(id__in=triggered_ids).update(
                is_active=False,
                triggered_at=timezone.now(),
            )

        # Send notifications
        for notif in notifications:
            _send_rate_alert_notification(notif)

        if triggered_ids:
            logger.info(f"Triggered {len(triggered_ids)} rate alerts")

    except Exception as e:
        logger.warning(f"Failed to check rate alerts: {e}")


def _send_rate_alert_notification(notif):
    """Send email, SMS, and push notifications for a triggered rate alert."""
    user = notif["user"]
    currency = notif["currency"]
    direction = notif["direction"]
    target_rate = notif["target_rate"]
    current_rate = notif["current_rate"]

    direction_label = "risen above" if direction == "above" else "dropped below"
    message = (
        f"Rate Alert: {currency}/KES has {direction_label} your target of "
        f"KES {target_rate:,.2f}. Current rate: KES {current_rate:,.2f}."
    )

    # Email notification
    try:
        from apps.core.tasks import send_email_task
        from django.template.loader import render_to_string

        if user.email:
            html_content = (
                f"<h2>CryptoPay Rate Alert</h2>"
                f"<p>{message}</p>"
                f"<p>Log in to CryptoPay to take action.</p>"
            )
            send_email_task.delay(
                subject=f"CPay Rate Alert - {currency}/KES",
                html_content=html_content,
                recipient_email=user.email,
            )
    except Exception as e:
        logger.warning(f"Failed to send rate alert email to {user}: {e}")

    # SMS notification
    try:
        from apps.core.tasks import send_sms_task

        if user.phone:
            sms_msg = f"CPay: {currency}/KES has {direction_label} KES {target_rate:,.0f}. Current: KES {current_rate:,.0f}."
            send_sms_task.delay(user.phone, sms_msg)
    except Exception as e:
        logger.warning(f"Failed to send rate alert SMS to {user}: {e}")

    # Push notification
    try:
        from apps.core.tasks import send_push_task

        send_push_task.delay(
            user_id=str(user.id),
            title=f"Rate Alert: {currency}/KES",
            body=message,
            data={"type": "rate_alert", "currency": currency},
        )
    except Exception as e:
        logger.warning(f"Failed to send rate alert push to {user}: {e}")
