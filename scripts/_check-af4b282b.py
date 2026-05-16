"""Inspect tx af4b282b · query IntaSend for the actual state.

Runs inside cryptopay_web:
    docker exec -i cryptopay_web python manage.py shell < this_file
"""
from apps.payments.models import Transaction
from apps.mpesa.intasend_client import IntaSendClient, IntaSendError

tx = Transaction.objects.filter(id__startswith="af4b282b").first()
print(f"--- tx af4b282b ---")
print(f"status         : {tx.status}")
print(f"failure_reason : {tx.failure_reason!r}")
print(f"saga_data      : {tx.saga_data}")

tracking_id = (tx.saga_data or {}).get("mpesa_conversation_id") or ""
print(f"\ntracking_id    : {tracking_id}")

try:
    r = IntaSendClient().query_transaction(tracking_id=tracking_id)
    print(f"IntaSend says  : {r}")
except IntaSendError as e:
    print(f"IntaSend error : {e}")
