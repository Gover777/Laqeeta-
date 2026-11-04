import re
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from urllib.parse import urlencode
from unittest import skipUnless
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.core import mail
from django.db import connection, connections
from django.test import Client, RequestFactory, TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from .models import (
    AbuseReport,
    AuditEvent,
    Category,
    Conversation,
    Message,
    RateLimitCounter,
    Report,
    ReportPrivateDetails,
)
from .rate_limits import increment_rate_limit
from .tokens import verification_token

User = get_user_model()
PASSWORD = "Honest-Pineapple-73!"


class ThemeToggleTests(TestCase):
    def test_theme_toggle_persists_in_session_and_renders_without_javascript(self):
        response = self.client.post(reverse("theme_toggle"), {"next": reverse("search")})
        self.assertRedirects(response, reverse("search"), fetch_redirect_response=False)
        self.assertEqual(self.client.session["site_theme"], "dark")

        page = self.client.get(reverse("home"))
        self.assertContains(page, 'data-theme="dark"')
        self.assertContains(page, "الوضع النهاري")
        self.assertNotContains(page, "<script")

        response = self.client.post(reverse("theme_toggle"), {"next": "//attacker.example/path"})
        self.assertRedirects(response, reverse("home"), fetch_redirect_response=False)
        self.assertEqual(self.client.session["site_theme"], "light")

    def test_theme_toggle_accepts_only_post(self):
        self.assertEqual(self.client.get(reverse("theme_toggle")).status_code, 405)


class LaqeetaTestCase(TestCase):
    def setUp(self):
        self.cat = Category.objects.get(slug="other")
        self.owner = User.objects.create_user(username="owner@example.test", email="owner@example.test", password=PASSWORD, is_verified=True, display_name="ناشر")
        self.other = User.objects.create_user(username="other@example.test", email="other@example.test", password=PASSWORD, is_verified=True)
        self.staff = User.objects.create_user(username="staff@example.test", email="staff@example.test", password=PASSWORD, is_verified=True, is_staff=True)
        self.report = Report.objects.create(owner=self.owner, kind="found", title="محفظة بنية", public_description="محفظة بنية عُثر عليها قرب السوق القديم.", category=self.cat, governorate="حضرموت", city="المكلا", event_date=timezone.localdate(), status="published", published_at=timezone.now())
        ReportPrivateDetails.objects.create(report=self.report, verification_notes="علامة سرية: خيط أزرق داخل الجيب")

    def login_as(self, user):
        self.client.force_login(user)


@override_settings(PUBLIC_AUTH_ENABLED=True)
class AccountFlowTests(TestCase):
    def test_signup_verification_and_login(self):
        r = self.client.post(reverse("signup"), {"display_name": "مستخدم جديد", "email": "New@Example.test", "password1": PASSWORD, "password2": PASSWORD})
        self.assertRedirects(r, reverse("verification_sent"))
        u = User.objects.get(email="new@example.test")
        self.assertFalse(u.is_verified)
        self.assertFalse(u.check_password("bad"))
        self.assertEqual(len(mail.outbox), 1)
        uid = urlsafe_base64_encode(force_bytes(u.pk))
        token = verification_token.make_token(u)
        self.assertEqual(self.client.post(reverse("login"), {"username": u.email, "password": PASSWORD}).status_code, 200)
        verified = self.client.get(reverse("verify_email", kwargs={"uidb64": uid, "token": token}))
        self.assertRedirects(verified, reverse("login"))
        u.refresh_from_db()
        self.assertTrue(u.is_verified)
        self.assertEqual(self.client.post(reverse("login"), {"username": u.email, "password": PASSWORD}).status_code, 302)

    def test_invalid_verification_token_does_not_verify(self):
        u = User.objects.create_user(username="u@example.test", email="u@example.test", password=PASSWORD, is_verified=False)
        r = self.client.get(reverse("verify_email", kwargs={"uidb64": urlsafe_base64_encode(force_bytes(u.pk)), "token": "bad"}))
        self.assertEqual(r.status_code, 400)
        u.refresh_from_db()
        self.assertFalse(u.is_verified)

    def test_password_reset_is_generic_and_sets_new_password(self):
        u = User.objects.create_user(username="reset@example.test", email="reset@example.test", password=PASSWORD, is_verified=True)
        r = self.client.post(reverse("password_reset"), {"email": u.email})
        self.assertRedirects(r, reverse("password_reset_done"))
        self.assertEqual(len(mail.outbox), 1)
        link = re.search(r"/accounts/password/reset/[^\s]+", mail.outbox[0].body).group(0).rstrip(".,")
        r = self.client.get(link, follow=True)
        self.assertEqual(r.status_code, 200)
        uid, token = link.strip("/").split("/")[-2:]
        confirm_path = r.redirect_chain[-1][0]
        r = self.client.post(confirm_path, {"new_password1": "Different-Harbor-93!", "new_password2": "Different-Harbor-93!"})
        self.assertEqual(r.status_code, 302)
        u.refresh_from_db()
        self.assertTrue(u.check_password("Different-Harbor-93!"))

    def test_password_reset_mail_failure_is_generic_and_logs_no_provider_details(self):
        with patch("core.views.PasswordResetForm.save", side_effect=RuntimeError("smtp secret and token must not leak")):
            with self.assertLogs("core.views", level="WARNING") as captured:
                response = self.client.post(reverse("password_reset"), {"email": "private@example.test"})
        self.assertRedirects(response, reverse("password_reset_done"))
        done = self.client.get(reverse("password_reset_done"))
        self.assertContains(done, "عند توفر خدمة البريد")
        self.assertNotContains(done, "private@example.test")
        self.assertEqual(captured.output, ["WARNING:core.views:password_reset_email_delivery_failed"])

    def test_resend_verification_generic_response(self):
        user = User.objects.create_user(username="pending@example.test", email="pending@example.test", password=PASSWORD, is_verified=False)
        response = self.client.post(reverse("resend_verification"), {"email": user.email})
        self.assertRedirects(response, reverse("verification_sent"))
        self.assertEqual(len(mail.outbox), 1)
        response = self.client.post(reverse("resend_verification"), {"email": "nobody@example.test"})
        self.assertRedirects(response, reverse("verification_sent"))
        self.assertEqual(len(mail.outbox), 1)

    def test_csrf_required_on_login_post(self):
        client = Client(enforce_csrf_checks=True)
        r = client.post(reverse("login"), {"username": "x@example.test", "password": PASSWORD})
        self.assertEqual(r.status_code, 403)

    def test_login_redirect_rejects_external_protocol_relative_and_malformed_targets(self):
        user = User.objects.create_user(username="safe@example.test", email="safe@example.test", password=PASSWORD, is_verified=True)
        for target in ("https://attacker.example/", "//attacker.example/path", r"\\attacker.example\path"):
            with self.subTest(target=target):
                client = Client()
                response = client.post(reverse("login") + "?" + urlencode({"next": target}), {"username": user.email, "password": PASSWORD})
                self.assertRedirects(response, reverse("dashboard"), fetch_redirect_response=False)

    def test_login_redirect_allows_local_path(self):
        user = User.objects.create_user(username="local@example.test", email="local@example.test", password=PASSWORD, is_verified=True)
        response = self.client.post(reverse("login") + "?" + urlencode({"next": "/search/?q=wallet"}), {"username": user.email, "password": PASSWORD})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/search/?q=wallet")

    def test_created_superuser_can_be_explicitly_verified_and_log_in(self):
        from django.core.management import call_command
        admin = User.objects.create_superuser(username="admin@example.test", email="admin@example.test", password=PASSWORD)
        self.assertFalse(admin.is_verified)
        call_command("verify_admin_user", email=admin.email, verbosity=0)
        admin.refresh_from_db()
        self.assertTrue(admin.is_superuser)
        self.assertTrue(admin.is_verified)
        response = self.client.post(reverse("login"), {"username": admin.email, "password": PASSWORD})
        self.assertRedirects(response, reverse("dashboard"), fetch_redirect_response=False)


class ReportFlowTests(LaqeetaTestCase):
    def valid_data(self, **extra):
        data = {"kind": "lost", "title": "هاتف أسود", "category": self.cat.pk, "public_description": "هاتف أسود فقد قرب موقف الحافلات.", "governorate": "حضرموت", "city": "المكلا", "event_date": timezone.localdate().isoformat(), "verification_notes": "شاشة بها خدش غير ظاهر"}
        data.update(extra)
        return data

    def test_create_pending_private_notes_not_public_then_staff_publish(self):
        self.login_as(self.other)
        r = self.client.post(reverse("report_create"), self.valid_data())
        self.assertRedirects(r, reverse("dashboard"))
        report = Report.objects.get(owner=self.other)
        self.assertEqual(report.status, "pending")
        self.assertEqual(report.private_details.verification_notes, "شاشة بها خدش غير ظاهر")
        self.assertNotContains(self.client.get(reverse("search")), "هاتف أسود")
        self.client.logout()
        self.login_as(self.staff)
        r = self.client.post(reverse("moderation_action", kwargs={"pk": report.pk}), {"action": "publish", "reason": "مراجعة مكتملة"})
        self.assertEqual(r.status_code, 302)
        report.refresh_from_db()
        self.assertEqual(report.status, "published")
        self.assertTrue(AuditEvent.objects.filter(object_id=str(report.pk)).exists())
        response = self.client.get(reverse("report_detail", kwargs={"pk": report.pk}))
        self.assertContains(response, "هاتف أسود")
        self.assertNotContains(response, "شاشة بها خدش غير ظاهر")
        self.assertNotContains(response, "@")

    def test_edit_resubmits_and_close_hides_report(self):
        self.login_as(self.owner)
        data = self.valid_data(title="محفظة معدلة")
        r = self.client.post(reverse("report_edit", kwargs={"pk": self.report.pk}), data)
        self.assertEqual(r.status_code, 302)
        self.report.refresh_from_db()
        self.assertEqual(self.report.status, "pending")
        self.assertIsNone(self.report.published_at)
        r = self.client.post(reverse("report_close", kwargs={"pk": self.report.pk}))
        self.assertEqual(r.status_code, 302)
        self.report.refresh_from_db()
        self.assertEqual(self.report.status, "closed")
        self.assertEqual(self.client.get(reverse("report_detail", kwargs={"pk": self.report.pk})).status_code, 404)

    def test_idor_other_owner_cannot_edit_close_or_see_private_report(self):
        self.login_as(self.other)
        self.assertEqual(self.client.get(reverse("report_edit", kwargs={"pk": self.report.pk})).status_code, 404)
        self.assertEqual(self.client.post(reverse("report_close", kwargs={"pk": self.report.pk})).status_code, 404)
        private = Report.objects.create(owner=self.owner, kind="lost", title="خاص", public_description="هذا وصف خاص لا يظهر للعامة", category=self.cat, governorate="حضرموت", city="المكلا", event_date=timezone.localdate(), status="pending")
        self.assertEqual(self.client.get(reverse("report_detail", kwargs={"pk": private.pk})).status_code, 404)

    def test_public_search_filters_never_return_pending_or_paused(self):
        pending = Report.objects.create(owner=self.owner, kind="lost", title="محفظة بحث سرية", public_description="وصف محفظة مخفي للمراجعة", category=self.cat, governorate="حضرموت", city="المكلا", event_date=timezone.localdate(), status="pending")
        response = self.client.get(reverse("search"), {"q": "محفظة"})
        self.assertContains(response, self.report.title)
        self.assertNotContains(response, pending.title)
        self.report.status = "paused"
        self.report.save()
        self.assertNotContains(self.client.get(reverse("search"), {"q": "محفظة"}), self.report.title)

    def test_non_staff_cannot_moderate_or_change_status(self):
        self.login_as(self.other)
        self.assertEqual(self.client.get(reverse("moderation_queue")).status_code, 403)
        pending = Report.objects.create(owner=self.owner, kind="lost", title="pending", public_description="وصف كاف لاختبار البلاغ", category=self.cat, governorate="حضرموت", city="المكلا", event_date=timezone.localdate(), status="pending")
        self.assertEqual(self.client.post(reverse("moderation_action", kwargs={"pk": pending.pk}), {"action": "publish"}).status_code, 403)

    def test_future_date_rejected(self):
        self.login_as(self.other)
        data = self.valid_data(event_date=(timezone.localdate() + timedelta(days=1)).isoformat())
        response = self.client.post(reverse("report_create"), data)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(Report.objects.filter(owner=self.other).exists())

    def test_upload_is_disabled_by_default_and_not_saved(self):
        from io import BytesIO
        from PIL import Image
        from django.core.files.uploadedfile import SimpleUploadedFile
        image = BytesIO()
        Image.new("RGB", (8, 8), "white").save(image, format="PNG")
        self.login_as(self.other)
        data = self.valid_data()
        data["photo"] = SimpleUploadedFile("safe.png", image.getvalue(), content_type="image/png")
        response = self.client.post(reverse("report_create"), data)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(Report.objects.filter(owner=self.other).exists())


class ContactSafetyTests(LaqeetaTestCase):
    def test_private_contact_messages_only_visible_to_participants(self):
        self.login_as(self.other)
        r = self.client.post(reverse("contact_start", kwargs={"pk": self.report.pk}), {"first_message": "هل يمكن التواصل للتحقق من هذه المحفظة؟"})
        self.assertEqual(r.status_code, 302)
        thread = Conversation.objects.get(report=self.report, claimant=self.other)
        self.assertEqual(thread.messages.count(), 1)
        self.assertNotContains(self.client.get(reverse("report_detail", kwargs={"pk": self.report.pk})), "هل يمكن التواصل")
        outsider = Client()
        outsider.force_login(self.staff)
        self.assertEqual(outsider.get(reverse("conversation", kwargs={"pk": thread.pk})).status_code, 403)
        r = self.client.post(reverse("message_send", kwargs={"pk": thread.pk}), {"body": "سأذكر علامة التحقق في المحادثة."})
        self.assertEqual(r.status_code, 302)
        self.client.logout()
        self.client.force_login(self.owner)
        self.assertContains(self.client.get(reverse("conversation", kwargs={"pk": thread.pk})), "سأذكر علامة التحقق")

    def test_block_disables_messages(self):
        self.login_as(self.other)
        self.client.post(reverse("contact_start", kwargs={"pk": self.report.pk}), {"first_message": "أرغب في بدء تواصل آمن حول الغرض."})
        thread = Conversation.objects.get(report=self.report, claimant=self.other)
        self.client.post(reverse("block_user", kwargs={"pk": thread.pk}), {"confirm": "on"})
        self.assertEqual(self.client.post(reverse("message_send", kwargs={"pk": thread.pk}), {"body": "تجربة رسالة بعد الحظر"}).status_code, 403)

    def test_abuse_report_available_and_private(self):
        self.login_as(self.other)
        r = self.client.post(reverse("abuse_report", kwargs={"pk": self.report.pk}), {"reason": "personal", "description": "تفاصيل تحتاج مراجعة"})
        self.assertEqual(r.status_code, 302)
        abuse = AbuseReport.objects.get()
        self.assertEqual(abuse.reporter, self.other)
        self.assertNotContains(self.client.get(reverse("report_detail", kwargs={"pk": self.report.pk})), "تفاصيل تحتاج مراجعة")

    @override_settings(REQUIRE_EDGE_PROXY=True, EDGE_PROXY_SECRET="proxy-test-key")
    def test_edge_proxy_secret_and_health_exception(self):
        c = Client()
        self.assertEqual(c.get(reverse("search")).status_code, 403)
        self.assertEqual(c.get(reverse("health")).status_code, 200)
        response = c.get(reverse("search"), HTTP_X_LAQEETA_PROXY_KEY="proxy-test-key", HTTP_X_LAQEETA_CLIENT_IP="203.0.113.10")
        self.assertEqual(response.status_code, 200)

    @override_settings(PUBLIC_AUTH_ENABLED=True)
    def test_login_attempts_are_rate_limited(self):
        RateLimitCounter.objects.all().delete()
        client = Client()
        for _ in range(10):
            response = client.post(reverse("login"), {"username": "none@example.test", "password": "wrong"})
            self.assertEqual(response.status_code, 200)
        self.assertEqual(client.post(reverse("login"), {"username": "none@example.test", "password": "wrong"}).status_code, 429)

    def test_new_pages_render_cleanly_without_javascript(self):
        for path_name in ["lost_reports", "found_reports", "how_it_works", "safety_guide", "privacy_policy", "terms_of_service"]:
            response = self.client.get(reverse(path_name))
            self.assertEqual(response.status_code, 200)
            self.assertNotContains(response, "<script")

    def test_inbox_and_settings_access(self):
        self.assertRedirects(self.client.get(reverse("inbox_list")), f"{reverse('login')}?next={reverse('inbox_list')}")
        self.assertRedirects(self.client.get(reverse("account_settings")), f"{reverse('login')}?next={reverse('account_settings')}")

        self.client.force_login(self.owner)
        inbox_resp = self.client.get(reverse("inbox_list"))
        self.assertEqual(inbox_resp.status_code, 200)
        self.assertNotContains(inbox_resp, "<script")

        settings_resp = self.client.get(reverse("account_settings"))
        self.assertEqual(settings_resp.status_code, 200)
        self.assertNotContains(settings_resp, "<script")

        # Test updating display name
        update_resp = self.client.post(reverse("account_settings"), {"display_name": "اسم محدث"})
        self.assertRedirects(update_resp, reverse("account_settings"))
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.display_name, "اسم محدث")

    def test_user_rating_system_and_profiles(self):
        # Create a conversation between other (claimant) and owner for self.report
        thread = Conversation.objects.create(report=self.report, claimant=self.other, owner=self.owner)
        Message.objects.create(conversation=thread, sender=self.other, body="مرحبًا، وجدت غرضك وسأتواصل معك للتسليم.")

        # 1. Cannot rate before report is closed
        self.client.force_login(self.other)
        pre_close = self.client.get(reverse("submit_rating", kwargs={"report_pk": self.report.pk, "user_pk": self.owner.pk}))
        self.assertRedirects(pre_close, reverse("report_detail", kwargs={"pk": self.report.pk}))

        # 2. Close report
        self.report.status = Report.Status.CLOSED
        self.report.closed_at = timezone.now()
        self.report.save()

        # 3. Rating page is now accessible and renders cleanly without JS
        rate_page = self.client.get(reverse("submit_rating", kwargs={"report_pk": self.report.pk, "user_pk": self.owner.pk}))
        self.assertEqual(rate_page.status_code, 200)
        self.assertNotContains(rate_page, "<script")

        # 4. Submit rating (5 stars)
        post_resp = self.client.post(
            reverse("submit_rating", kwargs={"report_pk": self.report.pk, "user_pk": self.owner.pk}),
            {"score": 5, "comment": "تعامل راق وأمين وسريع في التجاوب"}
        )
        self.assertRedirects(post_resp, reverse("user_profile", kwargs={"pk": self.owner.pk}))

        # 5. Verify average rating and count on User
        self.assertEqual(self.owner.average_rating(), 5.0)
        self.assertEqual(self.owner.ratings_count(), 1)

        # 6. Profile page renders average rating and reviews without JS
        profile_resp = self.client.get(reverse("user_profile", kwargs={"pk": self.owner.pk}))
        self.assertEqual(profile_resp.status_code, 200)
        self.assertContains(profile_resp, "5.0")
        self.assertContains(profile_resp, "تعامل راق وأمين")
        self.assertNotContains(profile_resp, "<script")

        # 7. Cannot rate twice
        dup_resp = self.client.post(
            reverse("submit_rating", kwargs={"report_pk": self.report.pk, "user_pk": self.owner.pk}),
            {"score": 4, "comment": "محاولة تقييم ثانية"}
        )
        self.assertRedirects(dup_resp, reverse("user_profile", kwargs={"pk": self.owner.pk}))
        self.assertEqual(self.owner.ratings_count(), 1)

        # 8. Owner rates claimant
        self.client.force_login(self.owner)
        owner_rate_resp = self.client.post(
            reverse("submit_rating", kwargs={"report_pk": self.report.pk, "user_pk": self.other.pk}),
            {"score": 4, "comment": "شخص محترم تم تسليم الغرض له بسلاسة"}
        )
        self.assertRedirects(owner_rate_resp, reverse("user_profile", kwargs={"pk": self.other.pk}))
        self.assertEqual(self.other.average_rating(), 4.0)
        self.assertEqual(self.other.ratings_count(), 1)



class RateLimitStorageTests(TestCase):
    def test_counter_stores_only_hmac_digest_and_expires_with_fixed_window(self):
        factory = RequestFactory()
        request = factory.post("/login/")
        request.user = AnonymousUser()
        request.META["REMOTE_ADDR"] = "203.0.113.77"
        base = timezone.now()
        with patch("core.rate_limits.timezone.now", return_value=base):
            self.assertEqual(increment_rate_limit(request, "test", 60), 1)
            self.assertEqual(increment_rate_limit(request, "test", 60), 2)
        counter = RateLimitCounter.objects.get()
        self.assertNotIn("203.0.113.77", counter.hashed_key)
        self.assertEqual(len(counter.hashed_key), 64)
        self.assertEqual(counter.expires_at - counter.window_start, timedelta(seconds=60))
        with patch("core.rate_limits.timezone.now", return_value=base + timedelta(seconds=60)):
            self.assertEqual(increment_rate_limit(request, "test", 60), 1)
        self.assertEqual(RateLimitCounter.objects.count(), 2)

    def test_cleanup_command_deletes_only_expired_counters(self):
        from django.core.management import call_command
        now = timezone.now()
        RateLimitCounter.objects.create(hashed_key="a" * 64, window_start=now - timedelta(minutes=3), expires_at=now - timedelta(minutes=2), count=1)
        RateLimitCounter.objects.create(hashed_key="b" * 64, window_start=now, expires_at=now + timedelta(minutes=1), count=2)
        call_command("cleanup_rate_limits", batch_size=1, verbosity=0)
        self.assertEqual(list(RateLimitCounter.objects.values_list("hashed_key", flat=True)), ["b" * 64])


class ConcurrentRateLimitTests(TransactionTestCase):
    reset_sequences = True

    @skipUnless(connection.vendor == "postgresql", "row-lock concurrency regression requires PostgreSQL")
    def test_parallel_increments_are_not_lost(self):
        factory = RequestFactory()
        workers = 12
        barrier = Barrier(workers)

        def increment(_):
            connections.close_all()
            try:
                request = factory.post("/limited/")
                request.user = AnonymousUser()
                request.META["REMOTE_ADDR"] = "198.51.100.24"
                barrier.wait(timeout=10)
                return increment_rate_limit(request, "parallel", 300)
            finally:
                connections.close_all()

        try:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                counts = list(pool.map(increment, range(workers)))
        finally:
            connections.close_all()
        self.assertEqual(sorted(counts), list(range(1, workers + 1)))
        self.assertEqual(RateLimitCounter.objects.get().count, workers)
