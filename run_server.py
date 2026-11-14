#!/usr/bin/env python3
"""Local development runner ONLY. Production deployments must use gunicorn via render.yaml."""
import os
import sys
import subprocess

# Refuse to launch dev runserver inside production environments
if os.environ.get("RENDER") or os.environ.get("DJANGO_ENV") == "production" or os.environ.get("DJANGO_DEBUG", "").lower() in {"0", "false", "no"}:
    sys.stderr.write("[Laqeeta] Refusing to start Django development runserver in production mode. Use gunicorn instead.\n")
    sys.exit(1)

# Set local-only development environment defaults (never used in production)
os.environ.setdefault("DJANGO_DEBUG", "true")
os.environ.setdefault("REQUIRE_EDGE_PROXY", "false")
os.environ.setdefault("PUBLIC_AUTH_ENABLED", "true")
os.environ.setdefault("DJANGO_SECRET_KEY", "dev-only-local-ephemeral-key-do-not-use-in-production-32chars")

base_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.join(base_dir, "laqeeta", "backend")

# Support check flag for build step
if "--check" in sys.argv:
    res = subprocess.call([sys.executable, "manage.py", "check"], cwd=backend_dir)
    sys.exit(res)

# Parse port from command line arguments
port = "3000"
args = sys.argv[1:]
for i, arg in enumerate(args):
    if arg in ("--port", "-p") and i + 1 < len(args):
        port = args[i + 1]
    elif arg.startswith("--port="):
        port = arg.split("=", 1)[1]

print(f"[Laqeeta] Starting LOCAL DEV Django server on 127.0.0.1:{port}...")

# Run database migrations
subprocess.run([sys.executable, "manage.py", "migrate", "--noinput"], cwd=backend_dir)

# Run Django development server bound to localhost in local dev
sys.exit(subprocess.call([sys.executable, "manage.py", "runserver", f"127.0.0.1:{port}"], cwd=backend_dir))
