# Railway deploys this service from the repository ROOT. The service has no
# "Root Directory" set, and Railway cannot set one via config-as-code or the CLI
# (only the dashboard / GraphQL API — see railwayapp/cli#839). Without this file,
# Railway's GitHub build scans the repo root, finds no app, and fails — which is
# why every push-to-main deploy failed. This Dockerfile builds the FastAPI
# backend that lives in sellary-backend/ so pushes to main deploy correctly.
#
# Note: `railway up` run from sellary-backend/ still uses sellary-backend/
# railway.json (Railpack) and is unaffected by this file. Deploy settings
# (preDeploy migration, start command, healthcheck) live in the root railway.toml.
FROM python:3.13-slim

ENV PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# All deps ship as manylinux wheels (psycopg2-binary, bcrypt, uvloop, …), so no
# system build toolchain is required.
COPY sellary-backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY sellary-backend/ ./

# Railway injects $PORT. preDeployCommand/startCommand in railway.toml take
# precedence; this CMD is a sane fallback.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
