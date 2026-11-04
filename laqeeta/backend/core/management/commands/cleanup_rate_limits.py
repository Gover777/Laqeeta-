from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from core.models import RateLimitCounter


class Command(BaseCommand):
    help = "Delete expired database-backed rate-limit counters."

    def add_arguments(self, parser):
        parser.add_argument("--batch-size", type=int, default=1000)

    def handle(self, *args, **options):
        batch_size = options["batch_size"]
        if batch_size < 1 or batch_size > 10000:
            raise CommandError("--batch-size must be between 1 and 10000.")

        cutoff = timezone.now()
        deleted = 0
        while True:
            expired_ids = list(
                RateLimitCounter.objects.filter(expires_at__lte=cutoff)
                .order_by("pk")
                .values_list("pk", flat=True)[:batch_size]
            )
            if not expired_ids:
                break
            count, _ = RateLimitCounter.objects.filter(pk__in=expired_ids, expires_at__lte=cutoff).delete()
            deleted += count

        self.stdout.write(self.style.SUCCESS(f"Deleted {deleted} expired rate-limit counter(s)."))
