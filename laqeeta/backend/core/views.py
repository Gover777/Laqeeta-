import io
import logging
import os
from functools import wraps
from pathlib import Path
from urllib.parse import urljoin, urlparse
from django.conf import settings
from django.contrib import messages
from django.contrib.auth import login, logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import PasswordResetForm, SetPasswordForm
from django.contrib.auth.views import PasswordResetConfirmView
from django.core.files.base import ContentFile
from django.core.mail import send_mail
from django.core.paginator import Paginator
from django.core.signing import BadSignature
from django.http import HttpResponse, HttpResponseForbidden, HttpResponseNotFound
from django.shortcuts import get_object_or_404, redirect, render
from django.template.loader import render_to_string
from django.urls import reverse
from django.utils.encoding import force_bytes, force_str
from django.utils import timezone
from django.utils.http import url_has_allowed_host_and_scheme, urlsafe_base64_encode, urlsafe_base64_decode
from django.views.decorators.http import require_POST
from PIL import Image, ImageOps, UnidentifiedImageError
from .forms import SignupForm, EmailLoginForm, ReportForm, ContactForm, MessageForm, AbuseForm, BlockForm, ResendVerificationForm, AccountSettingsForm, RatingForm
from .models import User, Report, ReportPrivateDetails, Category, Conversation, Message, UserBlock, AuditEvent, UserRating
from .rate_limits import increment_rate_limit
from .tokens import verification_token

logger = logging.getLogger(__name__)

@require_POST
def theme_toggle(request):
    current_theme = request.session.get("site_theme", "light")
    request.session["site_theme"] = "dark" if current_theme != "dark" else "light"
    next_url = request.POST.get("next") or reverse("home")
    if not url_has_allowed_host_and_scheme(next_url, allowed_hosts={request.get_host()}, require_https=request.is_secure()):
        next_url = reverse("home")
    return redirect(next_url)


def rate_limit(request, action, limit, seconds):
    if request.method != "POST":
        return None
    count = increment_rate_limit(request, action, seconds)
    if count > limit:
        return HttpResponse("تم تجاوز حد الطلبات مؤقتًا. حاول لاحقًا.", status=429, content_type="text/plain; charset=utf-8")
    return None

def limited(action, limit, seconds):
    def deco(fn):
        @wraps(fn)
        def wrapped(request, *args, **kwargs):
            response = rate_limit(request, action, limit, seconds)
            return response or fn(request, *args, **kwargs)
        return wrapped
    return deco

def _send_verification(user, request):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = verification_token.make_token(user)
    path = reverse("verify_email", kwargs={"uidb64":uid,"token":token})
    url = urljoin(settings.SITE_URL.rstrip("/") + "/", path.lstrip("/"))
    send_mail("تحقق من بريدك — لقيتة", f"لإكمال إنشاء حسابك، افتح الرابط التالي:\n\n{url}\n\nإذا لم تطلب إنشاء الحساب فتجاهل الرسالة.", settings.DEFAULT_FROM_EMAIL or "no-reply@localhost", [user.email], fail_silently=False)


def home(request):
    recent = Report.objects.filter(status=Report.Status.PUBLISHED).select_related("category").order_by("-published_at")[:6]
    return render(request, "core/home.html", {"recent":recent, "categories":Category.objects.filter(is_active=True)[:8]})


def search(request):
    qs = Report.objects.filter(status=Report.Status.PUBLISHED).select_related("category")
    q = request.GET.get("q", "").strip()[:100]
    kind = request.GET.get("kind", "")
    cat = request.GET.get("category", "")
    governorate = request.GET.get("governorate", "").strip()[:80]
    city = request.GET.get("city", "").strip()[:80]
    if q:
        from django.db.models import Q
        qs = qs.filter(Q(title__icontains=q) | Q(public_description__icontains=q))
    if kind in Report.Kind.values: qs = qs.filter(kind=kind)
    if cat: qs = qs.filter(category__slug=cat)
    if governorate: qs = qs.filter(governorate__icontains=governorate)
    if city: qs = qs.filter(city__icontains=city)
    results = Paginator(qs.distinct().order_by("-published_at"), 12).get_page(request.GET.get("page"))
    return render(request, "core/search.html", {"results":results,"categories":Category.objects.filter(is_active=True),"filters":{"q":q,"kind":kind,"category":cat,"governorate":governorate,"city":city}})


def report_detail(request, pk):
    report = get_object_or_404(Report.objects.select_related("category", "owner"), pk=pk, status__in=[Report.Status.PUBLISHED, Report.Status.CLOSED])
    ratable_users = report.get_ratable_users_for(request.user) if request.user.is_authenticated else []
    my_rating = report.ratings.filter(rater=request.user).first() if request.user.is_authenticated else None
    all_ratings = report.ratings.select_related("rater", "rated_user").all()
    return render(request, "core/report_detail.html", {
        "report": report,
        "contact_form": ContactForm(),
        "abuse_form": AbuseForm(),
        "ratable_users": ratable_users,
        "my_rating": my_rating,
        "all_ratings": all_ratings,
    })


@limited("signup", 4, 3600)
def signup(request):
    if request.user.is_authenticated: return redirect("dashboard")
    form = SignupForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        user = form.save()
        try: _send_verification(user, request)
        except Exception:
            # Do not expose provider internals; retain the account for resend path and tell user to retry.
            messages.error(request, "لم نتمكن من إرسال رسالة التحقق الآن. حاول تسجيل الدخول لاحقًا لطلب رسالة جديدة أو تواصل مع الدعم.")
        else: messages.success(request, "أنشأنا حسابك. افتح رسالة التحقق في بريدك قبل تسجيل الدخول.")
        return redirect("verification_sent")
    return render(request, "registration/signup.html", {"form":form})

def verification_sent(request): return render(request, "registration/verification_sent.html")

@limited("resend_verification", 5, 3600)
def resend_verification(request):
    form = ResendVerificationForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        user = User.objects.filter(email__iexact=form.cleaned_data["email"], is_verified=False, is_active=True).first()
        if user:
            try: _send_verification(user, request)
            except Exception: pass
        messages.info(request, "إذا كان البريد مرتبطًا بحساب غير موثّق، ستصل رسالة تحقق عند توفر خدمة البريد.")
        return redirect("verification_sent")
    return render(request, "registration/resend_verification.html", {"form":form})

def verify_email(request, uidb64, token):
    if increment_rate_limit(request, "verify_email", 900) > 20:
        return HttpResponse("تم تجاوز حد الطلبات مؤقتًا. حاول لاحقًا.", status=429, content_type="text/plain; charset=utf-8")
    try:
        uid = force_str(urlsafe_base64_decode(uidb64)); user = User.objects.get(pk=uid)
    except (ValueError, TypeError, OverflowError, User.DoesNotExist): user = None
    if user and verification_token.check_token(user, token):
        user.is_verified = True; user.save(update_fields=["is_verified"])
        AuditEvent.objects.create(actor=user, action="email_verified", object_type="User", object_id=str(user.pk), reason="تفعيل البريد الإلكتروني")
        messages.success(request, "تم التحقق من بريدك. يمكنك تسجيل الدخول الآن.")
        return redirect("login")
    return render(request, "registration/verification_invalid.html", status=400)

@limited("login", 10, 900)
def login_view(request):
    if request.user.is_authenticated: return redirect("dashboard")
    form = EmailLoginForm(request=request, data=request.POST or None)
    if request.method == "POST" and form.is_valid():
        login(request, form.get_user())
        next_url = request.GET.get("next", "")
        if url_has_allowed_host_and_scheme(next_url, allowed_hosts={request.get_host()}, require_https=request.is_secure()):
            return redirect(next_url)
        return redirect("dashboard")
    return render(request, "registration/login.html", {"form":form})

@login_required
@require_POST
def logout_view(request):
    logout(request); messages.info(request, "تم تسجيل خروجك."); return redirect("home")

@login_required
def dashboard(request):
    reports = Report.objects.filter(owner=request.user).select_related("category")
    pending_count = reports.filter(status=Report.Status.PENDING).count()
    published_count = reports.filter(status=Report.Status.PUBLISHED).count()
    closed_count = reports.filter(status__in=[Report.Status.CLOSED, Report.Status.REJECTED]).count()
    conversations = Conversation.objects.filter(models_Q_participant(request.user)).select_related("report","claimant","owner")[:30]
    return render(request, "core/dashboard.html", {
        "reports": reports,
        "conversations": conversations,
        "pending_count": pending_count,
        "published_count": published_count,
        "closed_count": closed_count,
    })

def models_Q_participant(user):
    from django.db.models import Q
    return Q(claimant=user) | Q(owner=user)

@login_required
@limited("report_create", 8, 86400)
def report_create(request):
    form = ReportForm(request.POST or None, request.FILES or None, initial={"kind":request.GET.get("kind", Report.Kind.LOST)})
    if request.method == "POST" and form.is_valid():
        image = form.cleaned_data.get("photo") if "photo" in form.cleaned_data else None
        if image and not settings.PHOTO_UPLOADS_ENABLED:
            form.add_error("photo", "رفع الصور غير متاح في هذه النسخة حتى يُجهز التخزين الخاص والمراجعة.")
        elif image:
            try:
                if image.size > 5 * 1024 * 1024: raise ValueError("يجب ألا يتجاوز حجم الصورة 5 ميغابايت.")
                img = Image.open(image); img.verify(); image.seek(0)
                img = Image.open(image); img = ImageOps.exif_transpose(img)
                if img.width > 6000 or img.height > 6000: raise ValueError("أبعاد الصورة أكبر من الحد المسموح.")
                fmt = "JPEG"
                output = io.BytesIO(); img.convert("RGB").save(output, format=fmt, optimize=True)
                image = ContentFile(output.getvalue(), name=f"{os.urandom(16).hex()}.jpg")
            except (UnidentifiedImageError, OSError, ValueError) as exc:
                form.add_error("photo", str(exc) or "تعذر التحقق من ملف الصورة.")
        if form.is_valid():
            report = form.save(commit=False); report.owner = request.user; report.status = Report.Status.PENDING; report.save()
            ReportPrivateDetails.objects.create(report=report, verification_notes=form.cleaned_data["verification_notes"])
            if image:
                from .models import ReportImage
                ReportImage.objects.create(report=report, file=image, size_bytes=image.size)
            messages.success(request, "وصل بلاغك. سيظهر بعد مراجعته إذا استوفى الإرشادات.")
            return redirect("dashboard")
    return render(request, "core/report_form.html", {"form":form,"editing":False,"photo_uploads_enabled":settings.PHOTO_UPLOADS_ENABLED})

@login_required
def report_edit(request, pk):
    report = get_object_or_404(Report, pk=pk, owner=request.user)
    if report.status in {Report.Status.CLOSED, Report.Status.REJECTED}:
        messages.error(request, "لا يمكن تعديل هذا البلاغ بعد إغلاقه أو رفضه."); return redirect("dashboard")
    form = ReportForm(request.POST or None, instance=report)
    if request.method == "POST" and form.is_valid():
        obj = form.save(commit=False); obj.status = Report.Status.PENDING; obj.published_at = None; obj.save()
        ReportPrivateDetails.objects.update_or_create(report=obj, defaults={"verification_notes":form.cleaned_data["verification_notes"]})
        messages.success(request, "حُفظ التعديل وأُعيد البلاغ للمراجعة قبل ظهوره للعامة."); return redirect("dashboard")
    return render(request, "core/report_form.html", {"form":form,"editing":True,"report":report,"photo_uploads_enabled":False})

@login_required
@require_POST
def report_close(request, pk):
    report = get_object_or_404(Report, pk=pk, owner=request.user)
    if report.status not in {Report.Status.CLOSED, Report.Status.REJECTED}:
        report.status = Report.Status.CLOSED
        report.closed_at = timezone.now()
        report.save(update_fields=["status", "closed_at", "updated_at"])
        AuditEvent.objects.create(
            actor=request.user,
            action="report_close",
            object_type="Report",
            object_id=str(report.pk),
            reason="إغلاق البلاغ بنجاح بعد استعادة الغرض"
        )
        ratable = report.get_ratable_users_for(request.user)
        if ratable:
            messages.success(request, "تم إغلاق البلاغ بنجاح! نرجو منك تقييم تعاملك مع الطرف الآخر (1 إلى 5 نجوم).")
            return redirect("submit_rating", report_pk=report.pk, user_pk=ratable[0].pk)
        messages.success(request, "تم إغلاق البلاغ بنجاح ولن يظهر في نتائج البحث النشطة.")
        return redirect("report_detail", pk=report.pk)
    return redirect("dashboard")

@login_required
def moderation_queue(request):
    if not request.user.is_staff: return HttpResponseForbidden("غير مسموح.")
    reports = Report.objects.filter(status=Report.Status.PENDING).select_related("owner","category").order_by("created_at")
    return render(request, "core/moderation.html", {"reports":reports})

@login_required
@require_POST
def moderation_action(request, pk):
    if not request.user.is_staff: return HttpResponseForbidden("غير مسموح.")
    report = get_object_or_404(Report, pk=pk)
    action = request.POST.get("action"); note = request.POST.get("reason", "").strip()[:300]
    transitions = {"publish":Report.Status.PUBLISHED,"reject":Report.Status.REJECTED,"pause":Report.Status.PAUSED}
    if action not in transitions or report.status not in {Report.Status.PENDING, Report.Status.PAUSED}:
        return HttpResponse("انتقال الحالة غير صالح.", status=400)
    report.status = transitions[action]; report.moderation_note = note
    report.published_at = timezone.now() if action == "publish" else None
    report.save()
    AuditEvent.objects.create(actor=request.user, action=f"report_{action}", object_type="Report", object_id=str(report.pk), reason=note)
    messages.success(request, "حُفظ قرار المراجعة.")
    return redirect("moderation_queue")

@login_required
@limited("contact", 10, 86400)
def contact_start(request, pk):
    report = get_object_or_404(Report, pk=pk, status=Report.Status.PUBLISHED)
    if report.owner_id == request.user.pk: return HttpResponseForbidden("لا يمكنك التواصل مع نفسك حول بلاغك.")
    if UserBlock.objects.filter(blocker_id__in=[request.user.pk,report.owner_id], blocked_id__in=[request.user.pk,report.owner_id]).exists():
        return HttpResponseForbidden("لا يمكن بدء التواصل بسبب إعدادات الحظر.")
    form = ContactForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        thread, _ = Conversation.objects.get_or_create(report=report, claimant=request.user, defaults={"owner":report.owner})
        Message.objects.create(conversation=thread, sender=request.user, body=form.cleaned_data["first_message"])
        return redirect("conversation", pk=thread.pk)
    return render(request, "core/contact_start.html", {"form":form,"report":report})

@login_required
def conversation(request, pk):
    thread = get_object_or_404(Conversation.objects.select_related("report","claimant","owner"), pk=pk)
    if request.user.pk not in {thread.claimant_id,thread.owner_id}: return HttpResponseForbidden("غير مسموح.")
    other_user = thread.owner if request.user.pk == thread.claimant_id else thread.claimant
    existing_rating = None
    can_rate = False
    if thread.report.status == Report.Status.CLOSED:
        existing_rating = UserRating.objects.filter(report=thread.report, rater=request.user, rated_user=other_user).first()
        can_rate = (existing_rating is None)
    return render(request, "core/conversation.html", {
        "thread": thread,
        "messages_list": thread.messages.select_related("sender"),
        "form": MessageForm(),
        "other_user": other_user,
        "can_rate": can_rate,
        "existing_rating": existing_rating,
    })

@login_required
@require_POST
@limited("message_send", 25, 3600)
def message_send(request, pk):
    thread = get_object_or_404(Conversation, pk=pk)
    if request.user.pk not in {thread.claimant_id,thread.owner_id}: return HttpResponseForbidden("غير مسموح.")
    if UserBlock.objects.filter(blocker_id__in=[thread.claimant_id,thread.owner_id], blocked_id__in=[thread.claimant_id,thread.owner_id]).exists(): return HttpResponseForbidden("تم إيقاف التواصل بسبب الحظر.")
    form = MessageForm(request.POST)
    if form.is_valid():
        Message.objects.create(conversation=thread,sender=request.user,body=form.cleaned_data["body"]); thread.save(update_fields=["updated_at"])
        return redirect("conversation", pk=thread.pk)
    return render(request,"core/conversation.html",{"thread":thread,"messages_list":thread.messages.select_related("sender"),"form":form,"other_user":thread.owner if request.user.pk == thread.claimant_id else thread.claimant})

@login_required
@require_POST
def block_user(request, pk):
    thread = get_object_or_404(Conversation, pk=pk)
    if request.user.pk not in {thread.claimant_id,thread.owner_id}: return HttpResponseForbidden("غير مسموح.")
    target_id = thread.owner_id if request.user.pk == thread.claimant_id else thread.claimant_id
    form = BlockForm(request.POST)
    if form.is_valid():
        UserBlock.objects.get_or_create(blocker=request.user, blocked_id=target_id)
        AuditEvent.objects.create(actor=request.user, action="user_block", object_type="User", object_id=str(target_id), reason="حظر مستخدم عبر المحادثة")
        messages.success(request,"تم حظر المستخدم وإيقاف الرسائل المتبادلة.")
    return redirect("dashboard")

@login_required
@limited("abuse_report", 5, 86400)
def abuse_report(request, pk):
    report = get_object_or_404(Report, pk=pk, status=Report.Status.PUBLISHED)
    form = AbuseForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        form.instance.report=report; form.instance.reporter=request.user; form.save()
        messages.success(request,"شكرًا لتنبيهنا. سنراجع البلاغ، ولا تشارك بيانات شخصية في وصف المخالفة.")
        return redirect("report_detail",pk=report.pk)
    return render(request,"core/abuse_form.html",{"form":form,"report":report})

@login_required
def private_image(request, pk):
    from .models import ReportImage
    image = get_object_or_404(ReportImage.objects.select_related("report"), pk=pk)
    if image.report.owner_id != request.user.pk and not request.user.is_staff: return HttpResponseNotFound()
    try:
        with image.file.open("rb") as f: data=f.read()
    except OSError: return HttpResponseNotFound()
    from django.http import HttpResponse
    response=HttpResponse(data, content_type="image/jpeg")
    response["Cache-Control"]="private, no-store"; response["X-Content-Type-Options"]="nosniff"
    return response

@limited("password_reset", 5, 3600)
def password_reset(request):
    form = PasswordResetForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        try:
            form.save(request=request, domain_override=(urlparse(settings.SITE_URL).netloc or request.get_host()), use_https=settings.SITE_URL.startswith("https://"), email_template_name="registration/password_reset_email.txt", subject_template_name="registration/password_reset_subject.txt", from_email=settings.DEFAULT_FROM_EMAIL or None)
        except Exception:
            # Keep provider, recipient and token details out of responses and logs.
            logger.warning("password_reset_email_delivery_failed")
        return redirect("password_reset_done")
    return render(request,"registration/password_reset_form.html",{"form":form})

class SafePasswordResetConfirmView(PasswordResetConfirmView):
    template_name = "registration/password_reset_confirm.html"
    success_url = "/accounts/password/reset/complete/"

    def dispatch(self, request, *args, **kwargs):
        limited_resp = rate_limit(request, "password_reset_confirm", 10, 900)
        if limited_resp is not None:
            return limited_resp
        return super().dispatch(request, *args, **kwargs)

    def form_valid(self, form):
        response = super().form_valid(form)
        if getattr(self, "user", None):
            AuditEvent.objects.create(
                actor=self.user,
                action="password_reset_complete",
                object_type="User",
                object_id=str(self.user.pk),
                reason="إعادة تعيين كلمة المرور",
            )
        return response


def lost_reports(request):
    qs = Report.objects.filter(status=Report.Status.PUBLISHED, kind=Report.Kind.LOST).select_related("category")
    q = request.GET.get("q", "").strip()[:100]
    cat = request.GET.get("category", "")
    governorate = request.GET.get("governorate", "").strip()[:80]
    city = request.GET.get("city", "").strip()[:80]
    if q:
        from django.db.models import Q
        qs = qs.filter(Q(title__icontains=q) | Q(public_description__icontains=q))
    if cat:
        qs = qs.filter(category__slug=cat)
    if governorate:
        qs = qs.filter(governorate__icontains=governorate)
    if city:
        qs = qs.filter(city__icontains=city)
    results = Paginator(qs.distinct().order_by("-published_at"), 12).get_page(request.GET.get("page"))
    return render(request, "core/lost_reports.html", {
        "results": results,
        "categories": Category.objects.filter(is_active=True),
        "filters": {"q": q, "category": cat, "governorate": governorate, "city": city}
    })


def found_reports(request):
    qs = Report.objects.filter(status=Report.Status.PUBLISHED, kind=Report.Kind.FOUND).select_related("category")
    q = request.GET.get("q", "").strip()[:100]
    cat = request.GET.get("category", "")
    governorate = request.GET.get("governorate", "").strip()[:80]
    city = request.GET.get("city", "").strip()[:80]
    if q:
        from django.db.models import Q
        qs = qs.filter(Q(title__icontains=q) | Q(public_description__icontains=q))
    if cat:
        qs = qs.filter(category__slug=cat)
    if governorate:
        qs = qs.filter(governorate__icontains=governorate)
    if city:
        qs = qs.filter(city__icontains=city)
    results = Paginator(qs.distinct().order_by("-published_at"), 12).get_page(request.GET.get("page"))
    return render(request, "core/found_reports.html", {
        "results": results,
        "categories": Category.objects.filter(is_active=True),
        "filters": {"q": q, "category": cat, "governorate": governorate, "city": city}
    })


def safety_guide(request):
    return render(request, "core/safety.html")


def privacy_policy(request):
    return render(request, "core/privacy.html")


def terms_of_service(request):
    return render(request, "core/terms.html")


def how_it_works(request):
    return render(request, "core/how_it_works.html")


@login_required
def inbox_list(request):
    conversations = Conversation.objects.filter(models_Q_participant(request.user)).select_related("report", "claimant", "owner").order_by("-updated_at")
    return render(request, "core/inbox_list.html", {"conversations": conversations})


@login_required
def account_settings(request):
    form = AccountSettingsForm(request.POST or None, instance=request.user)
    if request.method == "POST" and form.is_valid():
        form.save()
        messages.success(request, "تم حفظ بيانات الحساب بنجاح.")
        return redirect("account_settings")
    return render(request, "core/account_settings.html", {"form": form})


def custom_404(request, exception=None):
    return render(request, "404.html", status=404)


def custom_500(request):
    return render(request, "500.html", status=500)


@login_required
@limited("rating", 15, 3600)
def submit_rating(request, report_pk, user_pk):
    report = get_object_or_404(Report, pk=report_pk)
    rated_user = get_object_or_404(User, pk=user_pk)

    if report.status != Report.Status.CLOSED:
        messages.error(request, "لا يمكن تقييم المستخدم إلا بعد إغلاق البلاغ بنجاح.")
        return redirect("report_detail", pk=report.pk)

    if request.user.pk == rated_user.pk:
        return HttpResponseForbidden("لا يمكنك تقييم نفسك.")

    is_owner_to_claimant = (report.owner_id == request.user.pk and report.conversations.filter(claimant=rated_user).exists())
    is_claimant_to_owner = (rated_user.pk == report.owner_id and report.conversations.filter(claimant=request.user).exists())

    if not (is_owner_to_claimant or is_claimant_to_owner):
        return HttpResponseForbidden("غير مسموح بتقييم مستخدم غير مرتبط بهذا البلاغ.")

    existing = UserRating.objects.filter(report=report, rater=request.user, rated_user=rated_user).first()
    if existing:
        messages.info(request, f"لقد قمت مسبقًا بتقييم هذا المستخدم بـ {existing.score} من 5 نجوم.")
        return redirect("user_profile", pk=rated_user.pk)

    form = RatingForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        rating = form.save(commit=False)
        rating.report = report
        rating.rater = request.user
        rating.rated_user = rated_user
        rating.save()
        AuditEvent.objects.create(
            actor=request.user,
            action="user_rate",
            object_type="UserRating",
            object_id=str(rating.pk),
            reason=f"تقييم {rating.score} نجوم للبلاغ {report.title}"
        )
        messages.success(request, f"شكرًا لك! تم تسجيل تقييمك ({rating.score} نجوم) للمستخدم {rated_user.display_name or 'عضو لقيتة'} بنجاح.")
        return redirect("user_profile", pk=rated_user.pk)

    return render(request, "core/rating_form.html", {
        "report": report,
        "rated_user": rated_user,
        "form": form,
    })


def user_profile(request, pk):
    profile_user = get_object_or_404(User, pk=pk)
    ratings = profile_user.ratings_received.select_related("rater", "report").order_by("-created_at")
    published_reports = profile_user.reports.filter(status=Report.Status.PUBLISHED).select_related("category").order_by("-published_at")[:8]
    avg_rating = profile_user.average_rating()
    ratings_cnt = profile_user.ratings_count()
    return render(request, "core/user_profile.html", {
        "profile_user": profile_user,
        "ratings": ratings,
        "published_reports": published_reports,
        "avg_rating": avg_rating,
        "ratings_cnt": ratings_cnt,
    })


