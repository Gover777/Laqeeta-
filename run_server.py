#!/usr/bin/env python3
import os
import sys
import subprocess

# Set default development environment variables
os.environ.setdefault("DJANGO_DEBUG", "true")
os.environ.setdefault("REQUIRE_EDGE_PROXY", "false")
os.environ.setdefault("PUBLIC_AUTH_ENABLED", "true")
os.environ.setdefault("DJANGO_SECRET_KEY", "django-insecure-laqeeta-platform-development-key-32-chars-minimum")

base_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.join(base_dir, "laqeeta", "backend")

# Support check flag for build step
if "--check" in sys.argv:
    res = subprocess.call([sys.executable, "manage.py", "check"], cwd=backend_dir)
    sys.exit(res)

# Parse port from command line arguments (e.g. passed by npm or supervisor)
port = "3000"
args = sys.argv[1:]
for i, arg in enumerate(args):
    if arg in ("--port", "-p") and i + 1 < len(args):
        port = args[i + 1]
    elif arg.startswith("--port="):
        port = arg.split("=", 1)[1]

print(f"[Laqeeta] Starting Django backend on 0.0.0.0:{port}...")

# Run database migrations
subprocess.run([sys.executable, "manage.py", "migrate", "--noinput"], cwd=backend_dir)

# Run Django development server
sys.exit(subprocess.call([sys.executable, "manage.py", "runserver", f"0.0.0.0:{port}"], cwd=backend_dir))
