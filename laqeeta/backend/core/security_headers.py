import logging
from django.conf import settings
from django.core.signing import salted_hmac
from django.http import HttpResponse
from .rate_limits import increment_rate_limit

security_logger = logging.getLogger("core.security")

SENSITIVE_PATH_PREFIXES = (
    "/me/",
    "/inbox/",
    "/accounts/",
    "/moderation/",
    "/admin/",
    "/reports/new/",
)


class AdminRateLimitMiddleware:
    """Apply strict brute-force rate limiting to Django Admin login POST requests."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method == "POST" and request.path.rstrip("/") == "/admin/login":
            count = increment_rate_limit(request, "admin_login", 900)
            if count > 5:
                ip_digest = salted_hmac(
                    "core.security_log",
                    request.META.get("REMOTE_ADDR", "unknown"),
                    secret=settings.SECRET_KEY,
                    algorithm="sha256",
                ).hexdigest()[:12]
                security_logger.warning(
                    "SUSPICIOUS_ACTIVITY_ADMIN_LOGIN_RATE_LIMIT ip_hash=%s count=%s",
                    ip_digest,
                    count,
                )
                return HttpResponse(
                    "تم تجاوز حد محاولات الدخول. حاول لاحقًا.",
                    status=429,
                    content_type="text/plain; charset=utf-8",
                )
        return self.get_response(request)


class SecurityHeadersMiddleware:
    """Attach defense-in-depth HTTP security headers and prevent sensitive page caching."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        if "Content-Security-Policy" not in response:
            if request.path.startswith("/admin/"):
                response["Content-Security-Policy"] = (
                    "default-src 'self'; "
                    "script-src 'self' 'unsafe-inline'; "
                    "style-src 'self' 'unsafe-inline'; "
                    "img-src 'self' data:; "
                    "font-src 'self'; "
                    "object-src 'none'; "
                    "base-uri 'self'; "
                    "form-action 'self'; "
                    "frame-ancestors 'none';"
                )
            else:
                response["Content-Security-Policy"] = (
                    "default-src 'self'; "
                    "script-src 'none'; "
                    "style-src 'self' 'unsafe-inline'; "
                    "img-src 'self' data:; "
                    "font-src 'self'; "
                    "object-src 'none'; "
                    "base-uri 'self'; "
                    "form-action 'self'; "
                    "frame-ancestors 'none';"
                )

        if "Permissions-Policy" not in response:
            response["Permissions-Policy"] = (
                "geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()"
            )

        if "Cross-Origin-Opener-Policy" not in response:
            response["Cross-Origin-Opener-Policy"] = "same-origin"

        if request.path.startswith(SENSITIVE_PATH_PREFIXES) and "Cache-Control" not in response:
            response["Cache-Control"] = "no-store, private"

        return response
