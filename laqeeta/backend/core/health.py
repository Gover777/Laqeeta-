from django.http import JsonResponse
from django.db import connection

def health(request):
    try:
        with connection.cursor() as cursor: cursor.execute("SELECT 1")
    except Exception:
        return JsonResponse({"status":"unavailable"}, status=503)
    return JsonResponse({"status":"ok"})
