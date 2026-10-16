FROM python:3.12-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install dependencies
COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev

# Copy source
COPY . .

EXPOSE 8001

# Render (and most PaaS) injects $PORT — bind to it instead of hardcoded 8001.
# Falls back to 8001 for local docker-compose runs.
CMD ["sh", "-c", "uv run uvicorn main:app --host 0.0.0.0 --port ${PORT:-8001}"]
