from django.core.management.base import BaseCommand
from django.utils import timezone
from core.models import User, Category, Report, ReportPrivateDetails, Conversation, Message, UserRating

class Command(BaseCommand):
    help = "Seed demo accounts and sample reports for demonstration and evaluation."

    def handle(self, *args, **options):
        # 1. Admin user
        admin_user, created = User.objects.get_or_create(
            email="admin@laqeeta.local",
            defaults={"username": "admin@laqeeta.local", "display_name": "مدير المنصة", "is_staff": True, "is_superuser": True, "is_verified": True}
        )
        if created:
            admin_user.set_password("AdminLaqeeta2026!")
            admin_user.save()
            self.stdout.write(self.style.SUCCESS("Created admin user: admin@laqeeta.local / AdminLaqeeta2026!"))

        # 2. Regular demo user
        demo_user, created = User.objects.get_or_create(
            email="user@laqeeta.local",
            defaults={"username": "user@laqeeta.local", "display_name": "أحمد السعيد", "is_staff": False, "is_verified": True}
        )
        if created:
            demo_user.set_password("UserLaqeeta2026!")
            demo_user.save()
            self.stdout.write(self.style.SUCCESS("Created demo user: user@laqeeta.local / UserLaqeeta2026!"))

        # 3. Seed all categories
        CATEGORIES_LIST = [
            ("شيف مال (أموال ونقود)", "money-cash", 1),
            ("ذهب ومجوهرات وحلي", "gold-jewelry", 2),
            ("محافظ وحقائب", "wallets-bags", 3),
            ("إلكترونيات وهواتف", "electronics", 4),
            ("وثائق وبطاقات رسمية", "documents", 5),
            ("مفاتيح وأقفال", "keys", 6),
            ("أوراق", "checks-financial", 7),
            ("ساعات ومقتنيات شخصية", "watches-personal", 8),
            ("مركبات ودراجات", "vehicles", 9),
            ("أدوية ومستلزمات طبية", "medical", 10),
            ("ملابس وإكسسوارات", "clothing", 11),
            ("حيوانات ومواشي", "animals", 12),
            ("حقائب وأمتعة سفر", "luggage", 13),
            ("أدوات ومعدات مهنية", "tools", 14),
            ("أخرى", "other", 99),
        ]
        for name, slug, order in CATEGORIES_LIST:
            Category.objects.get_or_create(slug=slug, defaults={"name_ar": name, "sort_order": order})

        # 4. Sample reports if none exist
        if Report.objects.count() == 0:
            cat_money = Category.objects.filter(slug="money-cash").first() or Category.objects.first()
            cat_keys = Category.objects.filter(slug="keys").first() or Category.objects.first()
            cat_wallets = Category.objects.filter(slug="wallets-bags").first() or Category.objects.first()
            cat_electronics = Category.objects.filter(slug="electronics").first() or Category.objects.first()

            now = timezone.now()
            today = timezone.localdate()

            # Sample 0: Found Cash (شيف مال) in Mukalla, Hadramout
            r0 = Report.objects.create(
                owner=admin_user,
                kind=Report.Kind.FOUND,
                title="مبلغ مالي (شيف مال) داخل مظروف ورقي أبيض",
                public_description="عُثر على مظروف يحتوي على مبلغ مالي (شيف مال) نقدي بالقرب من الشارع العام بحي الشرج. على صاحبه ذكر المبلغ بدقة والفئات الورقية ولون المظروف للتحقق قبل التسليم.",
                category=cat_money,
                governorate="حضرموت",
                city="المكلا - حي الشرج",
                event_date=today,
                status=Report.Status.PUBLISHED,
                published_at=now,
            )
            ReportPrivateDetails.objects.create(
                report=r0,
                verification_notes="المبلغ 75000 ريال يمني بفئات ألف ريال قديمة والمظروف مختوم من محل صرافة."
            )

            # Sample 1: Lost Keys
            r1 = Report.objects.create(
                owner=demo_user,
                kind=Report.Kind.LOST,
                title="مفاتيح سيارة تويوتا مع ميدالية جلدية",
                public_description="فقدت حزمة مفاتيح تحتوي على مفتاح سيارة تويوتا وميدالية جلدية بنية بالقرب من مواقف المركز التجاري.",
                category=cat_keys,
                governorate="حضرموت",
                city="سيئون",
                event_date=today,
                status=Report.Status.PUBLISHED,
                published_at=now,
            )
            ReportPrivateDetails.objects.create(
                report=r1,
                verification_notes="يوجد شريط لاصق أزرق صغير على حلقة المفاتيح ومفتاح صغير إضافي لصندوق البريد."
            )

            # Sample 2: Found Wallet
            r2 = Report.objects.create(
                owner=admin_user,
                kind=Report.Kind.FOUND,
                title="محفظة رجالية بنية داكنة",
                public_description="عُثر على محفظة رجالية جلدية في حديقة عامة، تحتوي على بعض البطاقات الشخصية باسم أول يبدأ بحرف الميم.",
                category=cat_wallets,
                governorate="حضرموت",
                city="سيئون - حي السحيل",
                event_date=today,
                status=Report.Status.PUBLISHED,
                published_at=now,
            )
            ReportPrivateDetails.objects.create(
                report=r2,
                verification_notes="الاسم الكامل على البطاقة الشخصية ورقم تسلسلي لبطاقة نادي رياضي بداخلها."
            )

            # Sample 3: Lost Phone
            r3 = Report.objects.create(
                owner=demo_user,
                kind=Report.Kind.LOST,
                title="هاتف ذكي أسود بغطاء حماية شفاف",
                public_description="فقدت هاتفًا ذكيًا لونه أسود بغطاء سيليكون شفاف على طاولة مقهى في كورنيش خورمكسر.",
                category=cat_electronics,
                governorate="عدن",
                city="خورمكسر - الكورنيش",
                event_date=today,
                status=Report.Status.PUBLISHED,
                published_at=now,
            )
            ReportPrivateDetails.objects.create(
                report=r3,
                verification_notes="صورة خلفية الشاشة هي منظر طبيعي لجبال، وشق دقيق في زاوية الغطاء السفلية."
            )

            # Sample 4: Successfully Closed and Resolved Report with Mutual Ratings
            r4 = Report.objects.create(
                owner=demo_user,
                kind=Report.Kind.FOUND,
                title="ساعة يد كلاسيكية فضية",
                public_description="عُثر على ساعة يد فضية كلاسيكية في قاعة المؤتمرات، سُلّمت لصاحبها بعد مطابقة النقش الخاص.",
                category=cat_electronics,
                governorate="حضرموت",
                city="المكلا - حي السلام",
                event_date=today,
                status=Report.Status.CLOSED,
                published_at=now,
                closed_at=now,
            )
            ReportPrivateDetails.objects.create(
                report=r4,
                verification_notes="نقش دقيق على الغطاء الخلفي يحتوي على حرفين وتاريخ 2021."
            )
            conv = Conversation.objects.create(
                report=r4,
                claimant=admin_user,
                owner=demo_user
            )
            Message.objects.create(
                conversation=conv,
                sender=admin_user,
                body="السلام عليكم، أعتقد أن هذه الساعة تخصني، عليها نقش خاص بالخلف."
            )
            Message.objects.create(
                conversation=conv,
                sender=demo_user,
                body="وعليكم السلام، نعم تطابق النقش تمامًا. نلتقي عند بهو الجامعة للتسليم."
            )
            self.stdout.write(self.style.SUCCESS("Seeded sample published reports and conversation without fake ratings."))
