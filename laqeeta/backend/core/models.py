import uuid
from django.contrib.auth.models import AbstractUser
from django.core.validators import FileExtensionValidator, MinValueValidator, MaxValueValidator
from django.db import models
from django.utils import timezone

class User(AbstractUser):
    email = models.EmailField(unique=True)
    is_verified = models.BooleanField(default=False)
    display_name = models.CharField(max_length=80, blank=True)
    REQUIRED_FIELDS = ["email"]

    def save(self, *args, **kwargs):
        if self.email:
            self.email = self.email.strip().lower()
        super().save(*args, **kwargs)

    def average_rating(self):
        val = self.ratings_received.aggregate(models.Avg("score"))["score__avg"]
        return round(val, 1) if val is not None else None

    def ratings_count(self):
        return self.ratings_received.count()

    def __str__(self):
        return self.email

class Category(models.Model):
    name_ar = models.CharField(max_length=60, unique=True)
    slug = models.SlugField(unique=True)
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    class Meta:
        ordering = ["sort_order", "name_ar"]
    def __str__(self): return self.name_ar

class Report(models.Model):
    class Kind(models.TextChoices):
        LOST = "lost", "مفقود"
        FOUND = "found", "موجود"
    class Status(models.TextChoices):
        DRAFT = "draft", "مسودة"
        PENDING = "pending", "قيد المراجعة"
        PUBLISHED = "published", "منشور"
        PAUSED = "paused", "موقوف مؤقتًا"
        CLOSED = "closed", "مغلق"
        REJECTED = "rejected", "مرفوض"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey("core.User", on_delete=models.CASCADE, related_name="reports")
    kind = models.CharField(max_length=8, choices=Kind.choices)
    title = models.CharField(max_length=100)
    public_description = models.TextField(max_length=1200)
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="reports")
    governorate = models.CharField(max_length=80)
    city = models.CharField(max_length=80)
    event_date = models.DateField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True)
    moderation_note = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    published_at = models.DateTimeField(null=True, blank=True, db_index=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    class Meta:
        ordering = ["-published_at", "-created_at"]
        indexes = [models.Index(fields=["status", "kind", "published_at"]), models.Index(fields=["category", "status", "published_at"]), models.Index(fields=["governorate", "city", "status"])]

    def get_ratable_users_for(self, user):
        """Returns list of users that `user` can rate for this closed report, whom they haven't rated yet."""
        if self.status != self.Status.CLOSED or not getattr(user, "is_authenticated", False):
            return []
        candidates = set()
        if self.owner_id == user.pk:
            for conv in self.conversations.all():
                candidates.add(conv.claimant)
        else:
            if self.conversations.filter(claimant=user).exists():
                candidates.add(self.owner)
        already_rated_ids = set(self.ratings.filter(rater=user).values_list("rated_user_id", flat=True))
        return [u for u in candidates if u.pk not in already_rated_ids]

    def __str__(self): return self.title

# Alias for compatibility with user requirements naming
LostFoundReport = Report

class ReportPrivateDetails(models.Model):
    report = models.OneToOneField(Report, on_delete=models.CASCADE, related_name="private_details")
    verification_notes = models.TextField(max_length=1500, blank=True)
    contact_preferences = models.CharField(max_length=120, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

class ReportImage(models.Model):
    class Review(models.TextChoices):
        PENDING = "pending", "قيد المراجعة"
        APPROVED = "approved", "مقبول"
        REJECTED = "rejected", "مرفوض"
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report = models.ForeignKey(Report, on_delete=models.CASCADE, related_name="images")
    file = models.ImageField(upload_to="report-images/%Y/%m/", validators=[FileExtensionValidator(["jpg", "jpeg", "png", "webp"])])
    review_status = models.CharField(max_length=10, choices=Review.choices, default=Review.PENDING)
    size_bytes = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

class Conversation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report = models.ForeignKey(Report, on_delete=models.CASCADE, related_name="conversations")
    claimant = models.ForeignKey("core.User", on_delete=models.CASCADE, related_name="initiated_conversations")
    owner = models.ForeignKey("core.User", on_delete=models.CASCADE, related_name="received_conversations")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    class Meta:
        constraints = [models.UniqueConstraint(fields=["report", "claimant"], name="uniq_claimant_report_thread")]
        ordering = ["-updated_at"]

class Message(models.Model):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey("core.User", on_delete=models.CASCADE, related_name="sent_messages")
    body = models.TextField(max_length=1500)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta: ordering = ["created_at"]

class UserBlock(models.Model):
    blocker = models.ForeignKey("core.User", on_delete=models.CASCADE, related_name="blocks_made")
    blocked = models.ForeignKey("core.User", on_delete=models.CASCADE, related_name="blocks_received")
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        constraints = [models.UniqueConstraint(fields=["blocker", "blocked"], name="uniq_user_block")]

class AbuseReport(models.Model):
    class Reason(models.TextChoices):
        FALSE = "false", "بلاغ كاذب أو مضلل"
        PERSONAL = "personal", "بيانات شخصية"
        DANGEROUS = "dangerous", "محتوى خطر"
        HARASSMENT = "harassment", "إساءة أو تحرش"
        OTHER = "other", "سبب آخر"
    report = models.ForeignKey(Report, on_delete=models.CASCADE, related_name="abuse_reports")
    reporter = models.ForeignKey("core.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="abuse_reports")
    reason = models.CharField(max_length=12, choices=Reason.choices)
    description = models.CharField(max_length=500, blank=True)
    is_resolved = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

class AuditEvent(models.Model):
    actor = models.ForeignKey("core.User", on_delete=models.SET_NULL, null=True, related_name="audit_events")
    action = models.CharField(max_length=40)
    object_type = models.CharField(max_length=40)
    object_id = models.CharField(max_length=64)
    reason = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta: ordering = ["-created_at"]

class RateLimitCounter(models.Model):
    # hashed_key is an HMAC digest of the action and actor identity; never store raw IP/email.
    hashed_key = models.CharField(max_length=64)
    window_start = models.DateTimeField()
    expires_at = models.DateTimeField(db_index=True)
    count = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["hashed_key", "window_start"], name="uniq_rate_limit_window")]


class UserRating(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report = models.ForeignKey(Report, on_delete=models.CASCADE, related_name="ratings")
    rater = models.ForeignKey("core.User", on_delete=models.CASCADE, related_name="ratings_given")
    rated_user = models.ForeignKey("core.User", on_delete=models.CASCADE, related_name="ratings_received")
    score = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)],
        help_text="تقييم من 1 إلى 5 نجوم"
    )
    comment = models.TextField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["report", "rater", "rated_user"], name="uniq_report_rater_rated")
        ]

    def clean(self):
        from django.core.exceptions import ValidationError
        if self.rater_id and self.rated_user_id and self.rater_id == self.rated_user_id:
            raise ValidationError("لا يمكن للمستخدم تقييم نفسه.")
        if hasattr(self, "report") and self.report and self.report.status != Report.Status.CLOSED:
            raise ValidationError("لا يمكن تقييم المستخدم إلا بعد إغلاق البلاغ بنجاح.")

    def __str__(self):
        return f"تقييم {self.score} من {self.rater} إلى {self.rated_user}"

