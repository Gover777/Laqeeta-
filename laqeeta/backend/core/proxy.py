import hmac
import ipaddress
from django.conf import settings
from django.http import HttpResponse

class EdgeProxyMiddleware:
    """Trust edge-supplied client IP only after authenticating the shared proxy secret."""
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if settings.REQUIRE_EDGE_PROXY and request.path != "/healthz/":
            supplied = request.META.get("HTTP_X_LAQEETA_PROXY_KEY", "")
            expected = settings.EDGE_PROXY_SECRET
            if not expected or not hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8")):
                return HttpResponse("Forbidden", status=403)
            raw_ip = request.META.get("HTTP_X_LAQEETA_CLIENT_IP", "")
            try:
                address = ipaddress.ip_address(raw_ip)
            except ValueError:
                return HttpResponse("Forbidden", status=403)
            request.META["REMOTE_ADDR"] = str(address)
        return self.get_response(request)
