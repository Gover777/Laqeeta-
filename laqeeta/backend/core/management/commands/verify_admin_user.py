from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Mark an existing staff superuser as verified so email-based admin login can be used."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)

    def handle(self, *args, **options):
        User = get_user_model()
        try:
            user = User.objects.get(email__iexact=options["email"].strip())
        except User.DoesNotExist as exc:
            raise CommandError("No account exists for that email.") from exc
        if not user.is_staff or not user.is_superuser:
            raise CommandError("The account must already be both staff and superuser.")
        if not user.is_verified:
            user.is_verified = True
            user.save(update_fields=["is_verified"])
        self.stdout.write(self.style.SUCCESS("Verified the designated staff superuser."))
