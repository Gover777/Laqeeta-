from datetime import datetime, timedelta, timezone as datetime_timezone

from django.conf import settings
from django.core.signing import salted_hmac
from django.db import DEFAULT_DB_ALIAS, transaction
from django.utils import timezone

from .models import RateLimitCounter


def increment_rate_limit(request, action, seconds, *, using=DEFAULT_DB_ALIAS):
    """Atomically increment a PostgreSQL-backed fixed-window counter.

    The database contains only a keyed digest, window timestamps, and a count.
    Raw IP addresses and email addresses are never persisted or logged here.
    """
    if seconds <= 0:
        raise ValueError("Rate-limit window duration must be positive.")

    if request.user.is_authenticated:
        actor = f"user:{request.user.pk}"
    else:
        actor = f"ip:{request.META.get('REMOTE_ADDR', 'unknown')}"
    hashed_key = salted_hmac(
        "core.rate_limit",
        f"{action}:{actor}",
        secret=settings.SECRET_KEY,
        algorithm="sha256",
    ).hexdigest()

    now = timezone.now()
    window_epoch = int(now.timestamp()) // seconds * seconds
    window_start = datetime.fromtimestamp(window_epoch, tz=datetime_timezone.utc)
    expires_at = window_start + timedelta(seconds=seconds)

    with transaction.atomic(using=using):
        counter, created = RateLimitCounter.objects.using(using).get_or_create(
            hashed_key=hashed_key,
            window_start=window_start,
            defaults={"count": 1, "expires_at": expires_at},
        )
        if created:
            return 1

        # PostgreSQL serializes concurrent increments on this row. The unique
        # constraint plus get_or_create handles simultaneous first requests.
        counter = RateLimitCounter.objects.using(using).select_for_update().get(pk=counter.pk)
        counter.count += 1
        counter.save(using=using, update_fields=["count"])
        return counter.count
