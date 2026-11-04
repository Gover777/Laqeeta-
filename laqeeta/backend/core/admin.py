from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import User, Category, Report, ReportPrivateDetails, ReportImage, Conversation, Message, AbuseReport, AuditEvent, UserRating

@admin.register(User)
class LaqeetaUserAdmin(UserAdmin):
    list_display = ("email","display_name","is_verified","is_staff","is_active")
    search_fields = ("email","display_name")
    fieldsets = UserAdmin.fieldsets + (("لقيتة", {"fields":("display_name","is_verified")}),)
    add_fieldsets = UserAdmin.add_fieldsets + (("لقيتة", {"fields":("email","display_name")}),)

@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name_ar","slug","is_active","sort_order")
    list_editable = ("is_active","sort_order")

@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    list_display=("title","kind","owner","status","governorate","city","created_at")
    list_filter=("status","kind","category","governorate")
    search_fields=("title","public_description","owner__email")
    readonly_fields=("id","owner","status","created_at","updated_at","published_at","closed_at")
    actions=("publish_reports","reject_reports")
    @admin.action(description="نشر البلاغات المحددة")
    def publish_reports(self, request, queryset):
        from django.utils import timezone
        for report in queryset.filter(status__in=[Report.Status.PENDING,Report.Status.PAUSED]):
            report.status=Report.Status.PUBLISHED; report.published_at=timezone.now(); report.save()
            AuditEvent.objects.create(actor=request.user,action="report_publish",object_type="Report",object_id=str(report.pk),reason="قرار عبر Django Admin")
    @admin.action(description="رفض البلاغات المحددة")
    def reject_reports(self, request, queryset):
        for report in queryset.filter(status=Report.Status.PENDING):
            report.status=Report.Status.REJECTED; report.save()
            AuditEvent.objects.create(actor=request.user,action="report_reject",object_type="Report",object_id=str(report.pk),reason="قرار عبر Django Admin")

@admin.register(ReportPrivateDetails)
class PrivateDetailsAdmin(admin.ModelAdmin):
    list_display=("report","updated_at")
    search_fields=("report__title",)
    def has_module_permission(self, request): return request.user.is_superuser
    def has_view_permission(self, request, obj=None): return request.user.is_superuser
    def has_change_permission(self, request, obj=None): return request.user.is_superuser

admin.site.register(ReportImage)
admin.site.register(Conversation)
admin.site.register(Message)
admin.site.register(AbuseReport)
admin.site.register(AuditEvent)

@admin.register(UserRating)
class UserRatingAdmin(admin.ModelAdmin):
    list_display = ("rater", "rated_user", "score", "report", "created_at")
    list_filter = ("score", "created_at")
    search_fields = ("rater__email", "rated_user__email", "report__title")

