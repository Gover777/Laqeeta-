import json
from http.client import BadStatusLine
from io import BytesIO
from urllib.error import HTTPError
from unittest.mock import MagicMock, patch

from django.core.exceptions import ImproperlyConfigured
from django.core.mail import EmailMultiAlternatives
from django.test import Client, SimpleTestCase, TestCase, override_settings
from django.urls import reverse

from .backends.resend import EmailDeliveryError, ResendEmailBackend
from .models import User


class ResendEmailBackendTests(SimpleTestCase):
    @override_settings(RESEND_API_KEY="re_test_only", DEFAULT_FROM_EMAIL="لقيتة <no-reply@example.test>", RESEND_DOMAIN_VERIFIED=True, RESEND_SENDING_DOMAIN="example.test")
    def test_posts_text_and_html_over_https_without_logging_message_content(self):
        response = MagicMock()
        response.status = 200
        response.read.return_value = b'{"id":"email-test-id"}'
        response.__enter__.return_value = response
        message = EmailMultiAlternatives(
            "تحقق من بريدك",
            "افتح رابط التحقق",
            to=["recipient@example.test"],
        )
        message.attach_alternative("<p>افتح رابط التحقق</p>", "text/html")

        with patch("core.backends.resend.urlopen", return_value=response) as send:
            backend = ResendEmailBackend()
            self.assertEqual(backend.send_messages([message]), 1)

        request = send.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.resend.com/emails")
        self.assertEqual(request.get_header("Authorization"), "Bearer re_test_only")
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["to"], ["recipient@example.test"])
        self.assertEqual(payload["from"], "لقيتة <no-reply@example.test>")
        self.assertEqual(payload["text"], "افتح رابط التحقق")
        self.assertEqual(payload["html"], "<p>افتح رابط التحقق</p>")
        self.assertTrue(request.get_header("Idempotency-key").startswith("laqeeta-"))

    @override_settings(RESEND_API_KEY="", DEFAULT_FROM_EMAIL="no-reply@example.test", RESEND_DOMAIN_VERIFIED=True, RESEND_SENDING_DOMAIN="example.test")
    def test_backend_refuses_to_send_without_api_key(self):
        with self.assertRaises(ImproperlyConfigured):
            ResendEmailBackend()

    @override_settings(RESEND_API_KEY="re_test_only", DEFAULT_FROM_EMAIL="no-reply@example.test", RESEND_DOMAIN_VERIFIED=True, RESEND_SENDING_DOMAIN="example.test")
    def test_provider_failure_is_sanitized_and_fail_silently_is_honored(self):
        error = HTTPError(
            "https://api.resend.com/emails",
            403,
            "Forbidden",
            {},
            BytesIO(b"sensitive provider body"),
        )
        message = EmailMultiAlternatives(
            "subject", "private verification link", to=["private@example.test"]
        )
        with patch("core.backends.resend.urlopen", side_effect=error):
            with self.assertRaises(EmailDeliveryError) as caught:
                ResendEmailBackend().send_messages([message])
        self.assertNotIn("private@example.test", str(caught.exception))
        self.assertNotIn("verification link", str(caught.exception))
        self.assertNotIn("sensitive provider body", str(caught.exception))
        with patch("core.backends.resend.urlopen", side_effect=error):
            self.assertEqual(ResendEmailBackend(fail_silently=True).send_messages([message]), 0)

    @override_settings(RESEND_API_KEY="re_test_only", DEFAULT_FROM_EMAIL="no-reply@example.test", RESEND_DOMAIN_VERIFIED=True, RESEND_SENDING_DOMAIN="example.test")
    def test_nonstandard_http_failure_is_sanitized_and_mismatched_sender_is_rejected(self):
        message = EmailMultiAlternatives("subject", "private link", to=["private@example.test"])
        with patch("core.backends.resend.urlopen", side_effect=BadStatusLine("secret response details")):
            with self.assertRaises(EmailDeliveryError) as caught:
                ResendEmailBackend().send_messages([message])
        self.assertNotIn("secret response details", str(caught.exception))

        with patch("core.backends.resend.urlopen", side_effect=BadStatusLine("secret response details")):
            self.assertEqual(ResendEmailBackend(fail_silently=True).send_messages([message]), 0)

        message.from_email = "attacker@other.test"
        with patch("core.backends.resend.urlopen") as send:
            with self.assertRaises(EmailDeliveryError):
                ResendEmailBackend().send_messages([message])
        send.assert_not_called()


@override_settings(PUBLIC_AUTH_ENABLED=False, REQUIRE_EDGE_PROXY=False)
class PublicAuthGateTests(TestCase):
    def test_signup_login_and_password_recovery_are_closed_without_creating_accounts(self):
        response = self.client.post(
            reverse("signup"),
            {
                "display_name": "زائر",
                "email": "visitor@example.test",
                "password1": "Long-Random-Password-77!",
                "password2": "Long-Random-Password-77!",
            },
        )
        self.assertEqual(response.status_code, 503)
        self.assertContains(response, "رسائل البريد", status_code=503)
        self.assertFalse(User.objects.filter(email="visitor@example.test").exists())
        self.assertEqual(self.client.get(reverse("login")).status_code, 503)
        self.assertEqual(self.client.post(reverse("password_reset"), {"email": "visitor@example.test"}).status_code, 503)
        self.assertEqual(self.client.get(reverse("resend_verification")).status_code, 503)
        self.assertEqual(self.client.get(reverse("verification_sent")).status_code, 503)
        self.assertEqual(self.client.get(reverse("verify_email", kwargs={"uidb64": "MQ", "token": "fake-token"})).status_code, 503)
        self.assertEqual(self.client.get(reverse("password_reset_done")).status_code, 503)
        self.assertEqual(self.client.get(reverse("password_reset_confirm", kwargs={"uidb64": "MQ", "token": "set-password"})).status_code, 503)
        self.assertEqual(self.client.get(reverse("password_reset_complete")).status_code, 503)

    def test_home_does_not_offer_account_or_report_actions(self):
        response = self.client.get(reverse("home"))
        self.assertContains(response, "التصفح والبحث")
        self.assertNotContains(response, "إنشاء حساب")
        self.assertNotContains(response, "أبلغ عن مفقود")
