from django.db import migrations

def create_cache_table(apps, schema_editor):
    from django.core.management import call_command
    call_command("createcachetable", "laqeeta_cache", database=schema_editor.connection.alias)

class Migration(migrations.Migration):
    dependencies = [("core", "0002_seed_categories")]
    operations = [migrations.RunPython(create_cache_table, migrations.RunPython.noop)]
