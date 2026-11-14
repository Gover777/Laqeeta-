import importlib.util
import os
from pathlib import Path
from urllib.parse import urlsplit

import dj_database_url
from core.email_domains import normalize_domain, sender_matches_domain

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
DEBUG = os.environ.get("DJANGO_DEBUG", "false").lower() in {"1", "true", "yes"}

_allowed_hosts_env = os.environ.get("DJANGO_ALLOWED_HOSTS")
ALLOWED_HOSTS = [h.strip() for h in _allowed_hosts_env.split(",") if h.strip()] if _allowed_hosts_env else (["*"] if DEBUG else ["localhost", "127.0.0.1"])
_csrf_origins_env = os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "")
CSRF_TRUSTED_ORIGINS = [o.strip() for o in _csrf_origins_env.split(",") if o.strip()]
if DEBUG and not CSRF_TRUSTED_ORIGINS:
    CSRF_TRUSTED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8000", "http://127.0.0.1:8000", "https://*.run.app", "https://*.google.com"]
SITE_URL = os.environ.get("SITE_URL", "http://localhost:8000" if DEBUG else "").rstrip("/")
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", SITE_URL)
REQUIRE_EDGE_PROXY = os.environ.get("REQUIRE_EDGE_PROXY", "false" if DEBUG else "true").lower() in {"1", "true", "yes"}
EDGE_PROXY_SECRET = os.environ.get("EDGE_PROXY_SECRET", "")
if REQUIRE_EDGE_PROXY and len(EDGE_PROXY_SECRET) < 32:
    raise RuntimeError("EDGE_PROXY_SECRET must be at least 32 characters when REQUIRE_EDGE_PROXY is enabled.")
PUBLIC_AUTH_ENABLED = os.environ.get("PUBLIC_AUTH_ENABLED", "true" if DEBUG else "false").lower() in {"1", "true", "yes"}
RESEND_DOMAIN_VERIFIED = os.environ.get("RESEND_DOMAIN_VERIFIED", "false").lower() in {"1", "true", "yes"}
RESEND_SENDING_DOMAIN = normalize_domain(os.environ.get("RESEND_SENDING_DOMAIN", ""))

INSTALLED_APPS = [
    "django.contrib.admin", "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.sessions", "django.contrib.messages", "django.contrib.staticfiles",
    "core.apps.CoreConfig",
]
MIDDLEWARE = [
    "core.proxy.EdgeProxyMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "core.security_headers.SecurityHeadersMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "core.security_headers.AdminRateLimitMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "core.auth_gate.PublicAuthGateMiddleware",
]
if not DEBUG:
    MIDDLEWARE.append("django.middleware.clickjacking.XFrameOptionsMiddleware")
ROOT_URLCONF = "config.urls"
TEMPLATES = [{"BACKEND": "django.template.backends.django.DjangoTemplates", "DIRS": [BASE_DIR / "templates"], "APP_DIRS": True, "OPTIONS": {"context_processors": ["django.template.context_processors.request", "django.contrib.auth.context_processors.auth", "django.contrib.messages.context_processors.messages", "core.context_processors.features"]}}]
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

_db_url = os.environ.get("DATABASE_URL")
if _db_url:
    DATABASES = {"default": dj_database_url.parse(_db_url, conn_max_age=60, conn_health_checks=True, ssl_require=not DEBUG)}
else:
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}

AUTH_USER_MODEL = "core.User"
AUTHENTICATION_BACKENDS = ["core.auth.EmailBackend"]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
_DEFAULT_HASHERS = [
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.ScryptPasswordHasher",
]
if importlib.util.find_spec("argon2") is not None:
    PASSWORD_HASHERS = ["django.contrib.auth.hashers.Argon2PasswordHasher", *_DEFAULT_HASHERS]
else:
    PASSWORD_HASHERS = _DEFAULT_HASHERS
PASSWORD_RESET_TIMEOUT = 1800  # 30 minutes expiration for password reset & verification tokens
LANGUAGE_CODE = "ar"
TIME_ZONE = os.environ.get("DJANGO_TIME_ZONE", "Asia/Aden")
USE_I18N = True
USE_TZ = True
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]
_staticfiles_backend = "django.contrib.staticfiles.storage.StaticFilesStorage" if DEBUG else "whitenoise.storage.CompressedManifestStaticFilesStorage"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": _staticfiles_backend},
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

EMAIL_BACKEND = os.environ.get("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend" if DEBUG else "core.backends.resend.ResendEmailBackend")
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
EMAIL_TIMEOUT = 10

SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 604800  # 7 days
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SECURE_REFERRER_POLICY = "same-origin"
SECURE_SSL_REDIRECT = not DEBUG and os.environ.get("SECURE_SSL_REDIRECT", "true").lower() not in {"0", "false", "no"}
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = int(os.environ.get("SECURE_HSTS_SECONDS", "0" if DEBUG else "31536000"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_HSTS_PRELOAD = False

# Uploads are deliberately disabled until a reviewed, private, persistent storage backend exists.
PHOTO_UPLOADS_ENABLED = os.environ.get("PHOTO_UPLOADS_ENABLED", "false").lower() in {"1", "true", "yes"}
DATA_UPLOAD_MAX_MEMORY_SIZE = 6 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
MEDIA_ROOT = Path(os.environ.get("PRIVATE_MEDIA_ROOT") or str(BASE_DIR / "private_media"))
MEDIA_URL = "/private-media/"

LOGIN_URL = "login"
LOGIN_REDIRECT_URL = "dashboard"
LOGOUT_REDIRECT_URL = "home"


def _is_https_origin(value):
    try:
        parsed = urlsplit(value)
        return (
            parsed.scheme == "https"
            and bool(parsed.hostname)
            and parsed.username is None
            and parsed.password is None
            and parsed.path in {"", "/"}
            and not parsed.query
            and not parsed.fragment
            and (parsed.port is None or 1 <= parsed.port <= 65535)
        )
    except ValueError:
        return False


if not DEBUG:
    if not SECRET_KEY or len(SECRET_KEY) < 50:
        raise RuntimeError("Set DJANGO_SECRET_KEY to a newly generated secret of at least 50 characters in production.")
    if not REQUIRE_EDGE_PROXY:
        raise RuntimeError("Production requires the trusted edge proxy; REQUIRE_EDGE_PROXY must remain true.")
    if not _allowed_hosts_env or not ALLOWED_HOSTS or "*" in ALLOWED_HOSTS:
        raise RuntimeError("Production requires explicit DJANGO_ALLOWED_HOSTS values; wildcard hosts are forbidden.")
    if not _db_url or DATABASES["default"]["ENGINE"] != "django.db.backends.postgresql":
        raise RuntimeError("Production requires DATABASE_URL using PostgreSQL.")
    if not SITE_URL or not _is_https_origin(SITE_URL):
        raise RuntimeError("Production SITE_URL must be an HTTPS origin with no credentials, path, query, or fragment.")
    if not PUBLIC_BASE_URL or not _is_https_origin(PUBLIC_BASE_URL):
        raise RuntimeError("Production PUBLIC_BASE_URL must be an HTTPS origin with no credentials, path, query, or fragment.")
    if not _csrf_origins_env or not CSRF_TRUSTED_ORIGINS or not all(_is_https_origin(origin) for origin in CSRF_TRUSTED_ORIGINS):
        raise RuntimeError("Production requires explicit HTTPS-only DJANGO_CSRF_TRUSTED_ORIGINS containing origins only.")
    if PUBLIC_AUTH_ENABLED:
        if not RESEND_DOMAIN_VERIFIED:
            raise RuntimeError("PUBLIC_AUTH_ENABLED requires an explicitly verified Resend sending domain.")
        if not RESEND_API_KEY or not DEFAULT_FROM_EMAIL or EMAIL_BACKEND != "core.backends.resend.ResendEmailBackend":
            raise RuntimeError("Public authentication requires the Resend HTTPS backend, API key, and verified-domain sender.")
        if not sender_matches_domain(DEFAULT_FROM_EMAIL, RESEND_SENDING_DOMAIN):
            raise RuntimeError("DEFAULT_FROM_EMAIL must use the explicitly verified RESEND_SENDING_DOMAIN.")
    if PHOTO_UPLOADS_ENABLED:
        raise RuntimeError("PHOTO_UPLOADS_ENABLED must remain false in production until private persistent media storage is configured.")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "security": {
            "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "security",
        },
    },
    "loggers": {
        "core.security": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
    },
}
