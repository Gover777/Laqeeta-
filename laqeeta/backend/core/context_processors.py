from django.conf import settings


def features(request):
    site_theme = request.session.get("site_theme", "light")
    if site_theme not in {"light", "dark"}:
        site_theme = "light"
    return {
        "public_auth_enabled": settings.PUBLIC_AUTH_ENABLED,
        "site_theme": site_theme,
    }
