FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev curl \
    libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 libcairo2 libffi-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 2026-05-17 · N3 fix · stamp the git commit SHA into the image so
# /health/ can return it and ops can detect deploy drift between
# web/celery/beat containers. The SHA is passed in as a build arg
# from CI; falls back to "unknown" when built outside CI.
ARG GIT_SHA=unknown
RUN echo "$GIT_SHA" > /app/.git-sha

# Create non-root user and ensure writable dirs
RUN addgroup --system app && adduser --system --ingroup app app && \
    mkdir -p /app/staticfiles /app/media /app/logs && \
    chown -R app:app /app

USER app

EXPOSE 8000

CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "config.asgi:application"]
