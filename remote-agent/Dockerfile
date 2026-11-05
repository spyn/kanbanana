# ==============================================================================
# Kanbanana — Remote A2A CLI Bridge Dockerfile
# Lightweight sidecar/container for remote machines or GPU workers
# Wraps Kimi Code, Claude Code, Antigravity, MiniMax, Grok, Codex, or OpenCode
# into an A2A Protocol (v0.2.1) HTTP & JSON-RPC 2.0 server (`/.well-known/agent.json`).
# ==============================================================================
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system --add safe.directory "*"

WORKDIR /app

COPY a2a_cli_bridge.py /app/a2a_cli_bridge.py

RUN mkdir -p /agent-config /workspaces/project /workspaces/worktrees \
    && useradd -m -u 10001 appuser \
    && chown -R appuser:appuser /app /agent-config /workspaces

USER appuser

ENV PYTHONUNBUFFERED=1
ENV A2A_HOST=0.0.0.0
ENV A2A_PORT=8081
ENV A2A_AGENT_PROVIDER=kimi
ENV A2A_CONFIG_DIR=/agent-config
ENV A2A_WORKSPACE_DIR=/workspaces/project
ENV A2A_WORKTREES_DIR=/workspaces/worktrees
ENV KANBANANA_URL=http://host.docker.internal:8765
ENV KANBANANA_PROJECT_SLUG=default

EXPOSE 8081

HEALTHCHECK --interval=20s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${A2A_PORT}/.well-known/agent.json || exit 1

CMD ["python3", "/app/a2a_cli_bridge.py"]
