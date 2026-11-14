from django import forms
from django.contrib.auth.forms import AuthenticationForm, PasswordResetForm
from django.contrib.auth.password_validation import validate_password
from django.utils import timezone
from .models import User, Report, Category, ReportPrivateDetails, AbuseReport, UserRating

class SignupForm(forms.Form):
    display_name = forms.CharField(max_length=80, min_length=2, label="الاسم المعروض")
    email = forms.EmailField(max_length=254, label="البريد الإلكتروني")
    password1 = forms.CharField(widget=forms.PasswordInput, label="كلمة المرور")
    password2 = forms.CharField(widget=forms.PasswordInput, label="تأكيد كلمة المرور")
    agree_terms = forms.BooleanField(
        required=True,
        initial=True,
        label="أوافق على شروط الاستخدام وسياسة الخصوصية",
        error_messages={"required": "يجب الموافقة على شروط الاستخدام وسياسة الخصوصية."},
    )
    def clean_display_name(self):
        value = self.cleaned_data["display_name"].strip()
        if len(value) < 2:
            raise forms.ValidationError("يجب أن يتكون الاسم المعروض من حرفين على الأقل.")
        return value
    def clean_email(self):
        email = self.cleaned_data["email"].strip().lower()
        if User.objects.filter(email__iexact=email).exists(): raise forms.ValidationError("تعذر إنشاء الحساب بهذه البيانات. تحقق من البريد أو سجّل الدخول.")
        return email
    def clean(self):
        data = super().clean()
        if data.get("password1") and data.get("password2") and data["password1"] != data["password2"]:
            self.add_error("password2", "كلمتا المرور غير متطابقتين.")
        if data.get("password1"):
            candidate = User(email=data.get("email", ""), display_name=data.get("display_name", ""))
            try: validate_password(data["password1"], candidate)
            except forms.ValidationError as exc: self.add_error("password1", exc)
        return data
    def save(self):
        return User.objects.create_user(username=self.cleaned_data["email"], email=self.cleaned_data["email"], display_name=self.cleaned_data["display_name"], password=self.cleaned_data["password1"], is_active=True, is_verified=False)

class AccountSettingsForm(forms.ModelForm):
    class Meta:
        model = User
        fields = ["display_name"]
        labels = {"display_name": "الاسم المعروض"}
    def clean_display_name(self):
        value = (self.cleaned_data.get("display_name") or "").strip()
        if len(value) < 2:
            raise forms.ValidationError("يجب أن يتكون الاسم المعروض من حرفين على الأقل.")
        return value

class EmailLoginForm(AuthenticationForm):
    username = forms.EmailField(label="البريد الإلكتروني", widget=forms.EmailInput(attrs={"autocomplete":"email"}))
    def confirm_login_allowed(self, user):
        if not user.is_verified: raise forms.ValidationError("تحقق من بريدك الإلكتروني قبل تسجيل الدخول.", code="unverified")
        super().confirm_login_allowed(user)

class ReportForm(forms.ModelForm):
    verification_notes = forms.CharField(required=False, max_length=1500, widget=forms.Textarea(attrs={"rows":4}), label="علامات تحقق سرية (لن تظهر للعامة)")
    photo = forms.ImageField(required=False, label="صورة اختيارية (لا تنشر وثائق أو وجوه أو أرقامًا حساسة)")
    class Meta:
        model = Report
        fields = ["kind", "title", "category", "public_description", "governorate", "city", "event_date"]
        labels = {"kind":"نوع البلاغ", "title":"اسم أو وصف مختصر للشيء", "category":"التصنيف", "public_description":"الوصف العام", "governorate":"المحافظة", "city":"المدينة", "event_date":"تاريخ الفقد أو العثور"}
        widgets = {"public_description":forms.Textarea(attrs={"rows":5}), "event_date":forms.DateInput(attrs={"type":"date"})}
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["category"].queryset = Category.objects.filter(is_active=True)
        if self.instance and self.instance.pk:
            self.fields["verification_notes"].initial = getattr(getattr(self.instance,"private_details",None),"verification_notes","")
    def clean_event_date(self):
        date = self.cleaned_data["event_date"]
        if date > timezone.localdate(): raise forms.ValidationError("يجب ألا يكون التاريخ في المستقبل.")
        return date
    def clean_public_description(self):
        value = self.cleaned_data["public_description"].strip()
        if len(value) < 10: raise forms.ValidationError("أضف وصفًا عامًا من 10 أحرف على الأقل، وتجنب التفاصيل التي تثبت الملكية.")
        return value

class ContactForm(forms.Form):
    first_message = forms.CharField(max_length=1500, min_length=10, widget=forms.Textarea(attrs={"rows":4}), label="رسالتك الأولى", help_text="لا تشارك رمز تحقق أو كلمة مرور أو بيانات بنكية.")

class MessageForm(forms.Form):
    body = forms.CharField(max_length=1500, min_length=1, widget=forms.Textarea(attrs={"rows":3}), label="اكتب رسالة")

class AbuseForm(forms.ModelForm):
    class Meta:
        model = AbuseReport
        fields = ["reason", "description"]
        labels = {"reason":"سبب الإبلاغ", "description":"شرح مختصر (لا تذكر بيانات شخصية)"}
        widgets = {"description":forms.Textarea(attrs={"rows":3})}

class BlockForm(forms.Form):
    confirm = forms.BooleanField(required=True, label="أؤكد حظر هذا المستخدم ومنع الرسائل المتبادلة.")


class ResendVerificationForm(forms.Form):
    email = forms.EmailField(label="البريد الإلكتروني")
    def clean_email(self): return self.cleaned_data["email"].strip().lower()


class RatingForm(forms.ModelForm):
    score = forms.TypedChoiceField(
        choices=[(5, "★★★★★ (5 من 5)"), (4, "★★★★☆ (4 من 5)"), (3, "★★★☆☆ (3 من 5)"), (2, "★★☆☆☆ (2 من 5)"), (1, "★☆☆☆☆ (1 من 5)")],
        coerce=int,
        widget=forms.RadioSelect,
        label="التقييم بالنجوم"
    )

    class Meta:
        model = UserRating
        fields = ["score", "comment"]
        labels = {
            "score": "التقييم بالنجوم",
            "comment": "تعليقك حول تجربة تسليم الغرض والتواصل (اختياري)",
        }
        widgets = {
            "comment": forms.Textarea(attrs={"rows": 3, "placeholder": "اكتب انطباعك عن مصداقية الطرف الآخر وسرعة التجاوب والتحقق..."}),
        }

