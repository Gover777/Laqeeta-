from django.conf import settings
from django.shortcuts import render


class PublicAuthGateMiddleware:
    """Keep public account flows unavailable until transactional email is verified."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if (
            not settings.PUBLIC_AUTH_ENABLED
            and request.path.startswith("/accounts/")
            and request.path != "/accounts/logout/"
        ):
            return render(request, "registration/auth_unavailable.html", status=503)
        return self.get_response(request)
