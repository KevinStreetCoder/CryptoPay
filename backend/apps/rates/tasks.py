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

    # Check scheduled routine alerts
    _check_scheduled_alerts()


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
        now = timezone.now()
        active_alerts = RateAlert.objects.filter(is_active=True).select_related("user")

        deactivate_ids = []
        update_alerts = []
        notifications = []

        for alert in active_alerts:
            # Check if alert has expired
            if alert.expires_at and now > alert.expires_at:
                deactivate_ids.append(alert.id)
                continue

            current_rate = current_kes_rates.get(alert.currency)
            if current_rate is None:
                continue

            should_trigger = False
            if alert.direction == "above" and current_rate >= alert.target_rate:
                should_trigger = True
            elif alert.direction == "below" and current_rate <= alert.target_rate:
                should_trigger = True

            if not should_trigger:
                continue

            # Check cooldown — don't re-trigger too frequently
            cooldown = alert.cooldown_minutes or 60
            if alert.last_triggered_at:
                elapsed = (now - alert.last_triggered_at).total_seconds() / 60
                if elapsed < cooldown:
                    continue

            # This alert should fire
            update_alerts.append(alert)
            notifications.append({
                "user": alert.user,
                "currency": alert.currency,
                "direction": alert.direction,
                "target_rate": alert.target_rate,
                "current_rate": current_rate,
            })

        # Update triggered alerts (recurring — keep active, just update counters)
        for alert in update_alerts:
            alert.triggered_at = now
            alert.last_triggered_at = now
            alert.trigger_count = (alert.trigger_count or 0) + 1
            alert.save(update_fields=["triggered_at", "last_triggered_at", "trigger_count"])

        # Deactivate expired alerts
        if deactivate_ids:
            RateAlert.objects.filter(id__in=deactivate_ids).update(is_active=False)

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

    # Email notification (themed HTML template)
    try:
        from django.core.mail import send_mail
        from django.template.loader import render_to_string
        from django.conf import settings as django_settings

        if user.email:
            html_content = render_to_string("email/rate_alert.html", {
                "full_name": user.full_name or user.phone,
                "currency": currency,
                "direction": direction,
                "target_rate": f"{target_rate:,.2f}",
                "current_rate": f"{current_rate:,.2f}",
            })
            send_mail(
                f"CPay Rate Alert — {currency}/KES",
                message,
                django_settings.DEFAULT_FROM_EMAIL,
                [user.email],
                html_message=html_content,
                fail_silently=True,
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


def _check_scheduled_alerts():
    """Check scheduled routine alerts (daily/weekly/monthly rate summaries)."""
    try:
        from .models import RateAlert
        import pytz

        now = timezone.now()
        eat = pytz.timezone("Africa/Nairobi")
        now_eat = now.astimezone(eat)
        current_hour = now_eat.hour
        current_weekday = now_eat.weekday()  # 0=Mon..6=Sun
        current_day = now_eat.day

        usd_kes = cache.get("rate:forex:usd:kes")
        if not usd_kes:
            return

        # Build current rates
        current_kes_rates = {}
        for currency in SUPPORTED_CURRENCIES:
            usd_rate = cache.get(f"rate:crypto:{currency}:usd")
            if usd_rate:
                current_kes_rates[currency] = Decimal(str(usd_rate)) * Decimal(str(usd_kes))

        if not current_kes_rates:
            return

        scheduled_alerts = RateAlert.objects.filter(
            is_active=True,
            schedule_type__in=["daily", "weekly", "monthly"],
        ).select_related("user")

        for alert in scheduled_alerts:
            if alert.schedule_hour is None:
                continue

            # Check if it's the right hour
            if current_hour != alert.schedule_hour:
                continue

            # Check if already sent this period
            if alert.last_scheduled_at:
                hours_since = (now - alert.last_scheduled_at).total_seconds() / 3600
                if alert.schedule_type == "daily" and hours_since < 20:
                    continue
                elif alert.schedule_type == "weekly" and hours_since < 144:  # ~6 days
                    continue
                elif alert.schedule_type == "monthly" and hours_since < 600:  # ~25 days
                    continue

            # Check day for weekly/monthly
            if alert.schedule_type == "weekly" and alert.schedule_day is not None:
                if current_weekday != alert.schedule_day:
                    continue
            elif alert.schedule_type == "monthly" and alert.schedule_day is not None:
                if current_day != alert.schedule_day:
                    continue

            # Check expiry
            if alert.expires_at and now > alert.expires_at:
                alert.is_active = False
                alert.save(update_fields=["is_active"])
                continue

            # Send rate summary
            current_rate = current_kes_rates.get(alert.currency)
            if current_rate is None:
                continue

            _send_rate_alert_notification({
                "user": alert.user,
                "currency": alert.currency,
                "direction": alert.direction,
                "target_rate": alert.target_rate,
                "current_rate": current_rate,
            })

            alert.last_scheduled_at = now
            alert.trigger_count = (alert.trigger_count or 0) + 1
            alert.save(update_fields=["last_scheduled_at", "trigger_count"])

        logger.debug(f"Checked {scheduled_alerts.count()} scheduled alerts")

    except Exception as e:
        logger.warning(f"Failed to check scheduled alerts: {e}")
