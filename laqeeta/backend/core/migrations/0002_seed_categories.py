from django.db import migrations

CATEGORIES = [
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
def seed(apps, schema_editor):
    Category = apps.get_model("core", "Category")
    for name, slug, order in CATEGORIES:
        Category.objects.get_or_create(slug=slug, defaults={"name_ar":name,"sort_order":order})
def unseed(apps, schema_editor):
    apps.get_model("core", "Category").objects.filter(slug__in=[x[1] for x in CATEGORIES]).delete()
class Migration(migrations.Migration):
    dependencies = [("core", "0001_initial")]
    operations = [migrations.RunPython(seed, unseed)]
