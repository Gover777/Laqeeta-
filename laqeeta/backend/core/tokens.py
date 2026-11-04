from django.contrib.auth.tokens import PasswordResetTokenGenerator

class VerificationTokenGenerator(PasswordResetTokenGenerator):
    def _make_hash_value(self, user, timestamp):
        return f"{user.pk}{user.password}{timestamp}{user.is_verified}"

verification_token = VerificationTokenGenerator()
