import json
import uuid
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.mail.backends.base import BaseEmailBackend
from core.email_domains import sender_matches_domain


API_URL = "https://api.resend.com/emails"


class EmailDeliveryError(OSError):
    """A provider failure with no recipient, content, key, or response details."""


class ResendEmailBackend(BaseEmailBackend):
    def __init__(self, fail_silently=False, **kwargs):
        super().__init__(fail_silently=fail_silently)
        self.api_key = settings.RESEND_API_KEY
        if not self.api_key:
            raise ImproperlyConfigured("RESEND_API_KEY is required for the Resend email backend.")
        if not settings.RESEND_DOMAIN_VERIFIED or not sender_matches_domain(
            settings.DEFAULT_FROM_EMAIL, settings.RESEND_SENDING_DOMAIN
        ):
            raise ImproperlyConfigured("A verified Resend sending domain and matching sender are required.")

    @staticmethod
    def _payload(message):
        if message.attachments:
            raise EmailDeliveryError("Attachments are not supported by the transactional email backend.")

        sender = message.from_email or settings.DEFAULT_FROM_EMAIL
        if not settings.RESEND_DOMAIN_VERIFIED or not sender_matches_domain(
            sender, settings.RESEND_SENDING_DOMAIN
        ):
            raise EmailDeliveryError("The sender does not match the verified sending domain.")
        payload = {
            "from": sender,
            "to": list(message.to or []),
            "subject": message.subject,
        }
        if message.cc:
            payload["cc"] = list(message.cc)
        if message.bcc:
            payload["bcc"] = list(message.bcc)
        if message.reply_to:
            payload["reply_to"] = list(message.reply_to)

        if message.content_subtype == "html":
            payload["html"] = message.body
        else:
            payload["text"] = message.body

        for alternative in getattr(message, "alternatives", ()):
            content = getattr(alternative, "content", alternative[0] if isinstance(alternative, tuple) else None)
            mimetype = getattr(alternative, "mimetype", alternative[1] if isinstance(alternative, tuple) else None)
            if mimetype == "text/html":
                payload["html"] = content
            elif mimetype == "text/plain" and "text" not in payload:
                payload["text"] = content

        return payload

    def _send(self, message):
        recipients = message.recipients()
        if not recipients:
            return False

        request = Request(
            API_URL,
            data=json.dumps(self._payload(message), ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Idempotency-Key": f"laqeeta-{uuid.uuid4().hex}",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=settings.EMAIL_TIMEOUT) as response:
                if response.status != 200:
                    raise EmailDeliveryError("Resend returned an unsuccessful response.")
                result = json.loads(response.read(8192).decode("utf-8"))
                if not isinstance(result, dict) or not isinstance(result.get("id"), str):
                    raise EmailDeliveryError("Resend returned an invalid response.")
        except (HTTPException, HTTPError, URLError, TimeoutError, OSError, UnicodeDecodeError, json.JSONDecodeError):
            if self.fail_silently:
                return False
            raise EmailDeliveryError("Transactional email delivery failed.") from None
        return True

    def send_messages(self, email_messages):
        sent = 0
        for message in email_messages:
            if self._send(message):
                sent += 1
        return sent
