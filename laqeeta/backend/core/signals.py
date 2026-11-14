import logging
from django.conf import settings
from django.contrib.auth.signals import user_login_failed, user_logged_in
from django.core.signing import salted_hmac
from django.dispatch import receiver
from .rate_limits import increment_rate_limit

security_logger = logging.getLogger("core.security")


def _hmac_tag(value: str) -> str:
    return salted_hmac(
        "core.security_log",
        value or "empty",
        secret=settings.SECRET_KEY,
        algorithm="sha256",
    ).hexdigest()[:12]


@receiver(user_login_failed)
def log_failed_login(sender, credentials, request, **kwargs):
    ip_tag = _hmac_tag(request.META.get("REMOTE_ADDR", "unknown")) if request else "none"
    user_tag = _hmac_tag(str((credentials or {}).get("username", "")).strip().lower())
    path = getattr(request, "path", "-") if request else "-"
    count = 1
    if request is not None:
        try:
            count = increment_rate_limit(request, "login_failed_monitor", 900)
        except Exception:
            count = 1
    if count >= 5:
        security_logger.warning(
            "SUSPICIOUS_ACTIVITY_REPEATED_FAILED_LOGINS path=%s ip_hash=%s user_hash=%s count=%s",
            path,
            ip_tag,
            user_tag,
            count,
        )
    else:
        security_logger.info(
            "AUTH_LOGIN_FAILED path=%s ip_hash=%s user_hash=%s count=%s",
            path,
            ip_tag,
            user_tag,
            count,
        )


@receiver(user_logged_in)
def log_admin_login_success(sender, request, user, **kwargs):
    if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
        ip_tag = _hmac_tag(request.META.get("REMOTE_ADDR", "unknown")) if request else "none"
        security_logger.info(
            "PRIVILEGED_LOGIN_SUCCESS user_id=%s ip_hash=%s",
            getattr(user, "pk", "unknown"),
            ip_tag,
        )
