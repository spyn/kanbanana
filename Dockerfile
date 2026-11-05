# Stage 1: Build React + Vite Frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /build/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Python FastAPI + FastMCP Runtime (with Git for worktrees)
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/* \
    && git config --system --add safe.directory "*"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    KANBANANA_DB_PATH=/app/backend/data/kanbanana.db \
    KANBANANA_CONFIGS_DIR=/app/configs/projects \
    KANBANANA_DEFAULT_PROJECT=default \
    KANBANANA_AGENT_CONFIGS_DIR=/agent-configs \
    KANBANANA_STRICT_CONFIG_ROOT=1 \
    KANBANANA_WORKSPACE_DIR=/workspaces/project \
    KANBANANA_WORKTREES_DIR=/workspaces/worktrees

# Install backend dependencies strictly from committed uv.lock
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Copy backend source, project configs, scripts, and built frontend
COPY backend/ /app/backend/
COPY configs/ /app/configs/
COPY scripts/ /app/scripts/
COPY --from=frontend-builder /build/frontend/dist /app/frontend/dist

RUN mkdir -p /app/backend/data /app/configs /agent-configs /workspaces/project /workspaces/worktrees \
    && useradd -m -u 10001 appuser \
    && chown -R appuser:appuser /app /agent-configs /workspaces

USER appuser

EXPOSE 8765

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/health')" || exit 1

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8765"]
