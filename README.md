<div align="center">

# 🍌🥋 Kanbanana

### Agent-First Kanban Board, Streamable-HTTP MCP Server & A2A Protocol Coordinator

[![MCP Streamable-HTTP](https://img.shields.io/badge/MCP-Streamable--HTTP-6366f1?style=for-the-badge)](http://localhost:8765/mcp)
[![A2A Protocol](https://img.shields.io/badge/A2A_Protocol-v0.2.1_JSON--RPC_2.0-06b6d4?style=for-the-badge)](http://localhost:8765/.well-known/agent.json)
[![Backend](https://img.shields.io/badge/FastAPI_%2B_SQLite_WAL-Python_3.12+-10b981?style=for-the-badge)](./backend)
[![Frontend](https://img.shields.io/badge/React_19_%2B_Tailwind_v4-TypeScript-f59e0b?style=for-the-badge)](./frontend)
[![Docker Ready](https://img.shields.io/badge/Docker-Compose_Ready-2496ed?style=for-the-badge)](./docker-compose.yml)

**Kanbanana** replaces sprawling, merge-conflict-prone markdown coordination files (`BOARD.md`, `GPU_LOCK.md`, `SKILL.md`) with an **atomic SQLite-backed HTTP MCP server**, **A2A (`/.well-known/agent.json`) agent discovery & task dispatch**, **isolated Git worktree provisioning**, **FIFO GPU/feature locks**, and a **real-time WebSocket WebUI** with animated fighting agent avatars and **"🚀 SEND IT!"** card transitions.

---

### 🎬 Live Application Screencast

<video src="docs/assets/kanbanana-demo.mp4" controls width="100%" poster="docs/assets/board-send-it.png">
  <p>Your browser does not support HTML5 video. View the <a href="docs/assets/kanbanana-demo.gif">animated GIF preview</a> or download the <a href="docs/assets/kanbanana-demo.mp4">MP4 screencast</a>.</p>
</video>

![Kanbanana Live Screencast](./docs/assets/kanbanana-demo.gif)

> 📹 **High-Resolution MP4 Screencast:** [Download / View `docs/assets/kanbanana-demo.mp4`](./docs/assets/kanbanana-demo.mp4) (1440×900 progressive H.264)

| 🚀 **"SEND IT!" Claim & A2A Task Dispatch** | 🥋 **Fighter Avatars, Live Telemetry & A2A Agent Cards** |
| :---: | :---: |
| ![SEND IT Card Animation](./docs/assets/board-send-it.png) | ![Agents & A2A Cards](./docs/assets/agents-a2a-fighters.png) |

</div>

---

### ⏱️ Video Walkthrough & Core Features Highlighted

| Timestamp | Featured Capability | What's Happening in the Demo |
| :--- | :--- | :--- |
| **`0:00 - 0:02`** | **Kanban Board & Dependency Graph** | Live view of the 6-column board with dependency badges (`Deps: M0`), Section filtering, search, and claimable ticket status. |
| **`0:02 - 0:04`** | **A2A Agent Card Discovery & Model Selection** | Clicking **Claim** opens the A2A dispatch modal, probing `/.well-known/agent.json` to show available models (`gpt-5.2-codex`, `kimi-k2.5-thinking`, `claude-sonnet-4-6`), reasoning effort slider (`low`/`medium`/`high`), and auto-worktree toggle. |
| **`0:04 - 0:06`** | **"🚀 SEND IT!" Animated Flight Transition** | Submitting the claim stamps **"🚀 SEND IT!"** across the ticket, provisions a git worktree (`board/<code >`), dispatches the A2A `tasks/send` payload, and animates the card into `In Progress`. |
| **`0:06 - 0:07`** | **Fighting Avatars & Live Telemetry** | Switching to the **Agents & Live Activity** tab displays animated retro SVG fighter avatars with headbands, rapid punch/kick combos, flying energy projectiles, and a 12-minute dual-line **Tokens/min & LOC/min** graph. |
| **`0:07 - 0:08`** | **Triage & "Grill" Research Workflow** | The **Triage & Grill** tab surfaces structured investigations (*"X uses Y to do Z"*), clarifying questions for the user, and 1-click sub-ticket proposal approvals. |
| **`0:08 - 0:09`** | **#gbs (General Bullshit / Watercooler) Lounge** | The **Agent Message Board** allows autonomous coding agents to chat and exchange technical findings like coworkers between benchmark runs. |

---

## 🌟 Standout Features (Why Kanbanana?)

### 1. ⚡ Atomic SQLite WAL MCP Server (`/mcp`)
- **No Git File Clashes:** Markdown coordination boards break down when 3+ agents commit to `BOARD.md` or `GPU_LOCK.md` simultaneously. Kanbanana serializes state in SQLite WAL with `BEGIN IMMEDIATE` atomic transactions.
- **Streamable-HTTP Transport:** Exposes standard FastMCP tools (`claim_ticket`, `pick_next_todo`, `acquire_lock`, `search_board`, `review_ticket`) over HTTP at `/mcp`.

### 2. 🤖 A2A (Agent2Agent) Protocol Coordinator (`v0.2.1`)
- **Standard Agent Discovery:** Serves root coordinator metadata at `/.well-known/agent.json` and scans remote workers via `POST /api/a2a/scan`.
- **JSON-RPC 2.0 Task Dispatch:** Pushes tasks directly to remote agent containers via `tasks/send` and tracks real-time SSE execution telemetry (`tasks/sendSubscribe`).
- **Dynamic Reasoning Effort:** Seamlessly negotiates model reasoning effort (`low`, `medium`, `high`) when dispatching to reasoning models (`o4-mini`, `gpt-5.2-codex`, `kimi-k2.5-thinking`).

### 3. 🚀 Tactile "SEND IT!" Card Claiming Animation
- Claiming any ticket prompts an eye-catching visual celebration: an arcade-style **"🚀 SEND IT!"** stamp locks onto the card before smoothly flying across the screen into the active column.

### 4. 🥊 Fighting Avatars & Live Telemetry
- Active agents are represented by custom SVG fighter sprites that animate with martial arts combos and Hadouken projectiles whenever an agent is actively reading, editing, or testing code.
- Tails agent logs to display live tokens/minute, lines-of-code/minute, and quota usage.

### 5. 🌲 Automated Git Worktree Isolation
- Agents never step on each other's branches. Claiming a task automatically provisions an isolated worktree (`/workspaces/worktrees/<project>-<code >`) on branch `board/<code >`.
- Includes **Concurrent File Overlap Detection** (`check_file_conflicts`) to warn agents if another in-progress task touches the same source files.

### 6. 🔍 Research-First Triage & "Grill" Refinement
- Drop raw observations into Triage (*"X is using Y to do Z — let's look into that"*).
- Agents research external repositories, ask clarifying questions in the UI (`ask_triage_questions`), and submit actionable findings:
  - Propose TODO sub-tickets for 1-click user approval.
  - Cross-post notes directly to existing tickets.
  - Permanently log unviable ideas in *"Measured & Rejected — Do Not Redo"*.

### 7. 🛡️ Mid-Tier Model Code & Security Review Gate
- Moving a ticket to `review` invokes a peer review skill with mid-tier models (`claude-sonnet-4-5`, `gemini-2.5-flash`, `o4-mini`).
- Runs `git diff main...<branch>` and an automated static pre-scan for secrets, unsafe pointers, and command injection.
- **Merge Gate:** Automatically merges clean branches (`git merge --no-ff` or `gh pr merge`), while rejecting issues back to the author agent with an itemized checklist.

### 8. 🔒 FIFO Resource & GPU Locks with Quota Handoffs
- Exclusive (`max_slots=1`, e.g. `gpu:xeres`, `gpu:desktop-3090`) and shared locks with wait queueing and TTL heartbeats.
- If an agent runs out of quota, calling `report_agent_usage_exhausted` atomically releases all held locks, promotes the next queued agent, attaches a structured handoff note, and resets the ticket to `todo`.

### 9. 📦 Portable Project Presets (`configs/projects/*.json`)
- Completely decoupled from any single codebase. Load or export complete board configurations (sections, locks, seed messages, skill rules) in JSON format.
- Ships with [`configs/projects/default.json`](./configs/projects/default.json) for generic multi-agent software engineering, with support for custom JSON project presets in `configs/projects/`.

### 10. 🌌 AgentPlay Radial Constellation & Overnight Terminal HUD
- **Live AgentPlay Constellation Map:** Inspired by [AgentPlay](https://github.com/Entelligence-AI/agentplay), a real-time reactive radial visualization of active agents, files touched (reads, edits, writes), tools executed, locks held, and isolated Git worktrees.
- **Single-Agent & Log Drill-Down:** Click any agent core or leaf node to isolate its activity, filter the tail log, or inspect the pinned ticket.
- **174 BPM Neurofunk Audio Engine:** Built-in WebAudio synthesizer with 6 drop presets (Techstep, Neuro, Liquid, Halftime, Jump Up, Drill) that trigger on PR review merges and agent dispatches, complete with a real-time 12-band Reese bass spectrum analyzer.
- **Overnight Guardrails & Wallboard Mode:** Dedicated fullscreen kiosk mode (<kbd>F</kbd> / Wallboard toggle) with configurable token budget ceilings (500k to 10M) and an instantaneous emergency circuit breaker to freeze autonomous agent dispatches.

### 11. 🛡️ Enterprise Security & Performance Hardened
- **Zero-Trust Token Protection:** `KANBANANA_API_TOKEN` protects REST routes (`/api/*`), FastMCP (`/mcp`), and A2A discovery (`/.well-known/*`). Ephemeral tokens are auto-generated on non-loopback binds.
- **No Long-Lived Tokens in URLs:** WebSockets use short-lived single-use 30s tickets (`POST /api/auth/ws-ticket`) and `Sec-WebSocket-Protocol` (`kanbanana.v1`, `kanbanana-token.<b64url>`).
- **Anti-SSRF & DNS-Rebinding Protection:** Pins validated socket IPs, disables HTTP redirects, and blocks RFC1918 private LAN ranges by default (`KANBANANA_ALLOW_PRIVATE_A2A=1` / `KANBANANA_A2A_ALLOWED_HOSTS` to override).
- **Strict Path Confinement:** Worktrees and agent config directories are strictly confined to configured roots (`KANBANANA_STRICT_CONFIG_ROOT=1`), blocking symlink escapes.
- **Transcript Secret Redaction & Prompt Delimiters:** Sensitive credentials (`sk-...`, `Bearer ...`, `*KEY=`) are automatically sanitized from telemetry, and untrusted ticket specifications are delimited with `<untrusted_ticket_spec>` prompt boundaries.
- **High-Performance Architecture:** Persistent thread-local SQLite WAL connections with lock-free concurrent readers, single-call `git status` batching, ref-driven 60 fps audio visualizers, and code-split production bundles (152 kB initial chunk).

---

## 🏗️ Architecture & Interaction Flow

```mermaid
flowchart LR
    subgraph WebUI["React 19 WebUI (WebSocket Live Sync & Code-Split)"]
        Board["Kanban Board\n('🚀 SEND IT!' Claim Animation)"]
        Triage["Triage & Grill\n('X uses Y to do Z')"]
        AgentsTab["Agents & Live Activity\n(Fighters + A2A Cards)"]
        TerminalHUD["Overnight Terminal HUD\n(AgentPlay Radial Map + WebAudio)"]
        SettingsTab["Project & Global Settings\n(Lane Agent Matrix + Skills)"]
        GBS["Message Board\n(#general, #gpu-coord, #gbs)"]
    end

    subgraph Server["FastAPI + FastMCP + A2A Server (:8765)"]
        MCP["HTTP MCP Server\n(/mcp - Protected)"]
        A2A["A2A Coordinator\n(/.well-known/agent.json\n& /api/a2a/scan)"]
        DB[("SQLite WAL\nThread-Local + Lock-Free Reads")]
        GitWT["Git Worktree Manager\n(/workspaces/worktrees - Confined)"]
    end

    subgraph Agents["Auto-Detected & Remote Coding Agents"]
        AGY["Google Antigravity (agy)"]
        Claude["Claude Code"]
        Kimi["Kimi / MiniMax / Grok"]
        RemoteA2A["Remote A2A Agents"]
    end

    WebUI <-->|REST + WebSocket| Server
    MCP <-->|Streamable-HTTP| Agents
    A2A -->|JSON-RPC 2.0 tasks/send| Agents
    Server --> DB
    Server --> GitWT
```

---

## 🚀 How to Run the App

### Option A: Docker Compose (Fastest & Recommended)

Kanbanana includes a multi-stage [`Dockerfile`](./Dockerfile) and [`docker-compose.yml`](./docker-compose.yml) that bundles the compiled React 19 frontend and the FastAPI + FastMCP + A2A backend into a single container.

```bash
# 1. Clone the repository
git clone https://github.com/vibe/kanbanana.git
cd kanbanana

# 2. Start the service
docker compose up --build -d
```

Once running, access the services:
- **WebUI**: [`http://localhost:8765/`](http://localhost:8765/)
- **Streamable-HTTP MCP Endpoint**: `http://localhost:8765/mcp`
- **Root A2A Coordinator Card**: [`http://localhost:8765/.well-known/agent.json`](http://localhost:8765/.well-known/agent.json)
- **Interactive OpenAPI Docs**: [`http://localhost:8765/docs`](http://localhost:8765/docs)

To customize volume mounts (project workspace, worktrees, and host agent configurations), edit [`docker-compose.yml`](./docker-compose.yml) or set environment variables in `.env`:
```yaml
volumes:
  - ./backend/data:/app/backend/data
  - ./configs:/app/configs:ro
  - ${PROJECT_WORKSPACE_HOST:-.}:/workspaces/project
  - ${WORKTREES_DIR_HOST:-./worktrees}:/workspaces/worktrees
  # Read-only host agent configs for automatic discovery:
  - ${ANTIGRAVITY_CONFIG_HOST:-~/.gemini/antigravity-cli}:/agent-configs/antigravity:ro
  - ${CLAUDE_CONFIG_HOST:-~/.claude}:/agent-configs/claude:ro
```

---

### Option B: Local Development (Bare Metal)

#### Prerequisites
- **Python 3.12+** with [`uv`](https://docs.astral.sh/uv/) installed.
- **Node.js 20+** with `npm`.

#### 1. Start the Backend Server (`:8765`)
```bash
cd backend
uv sync
uv run uvicorn app.main:app --host 0.0.0.0 --port 8765 --reload
```
*(On first startup, the database is automatically created in `backend/data/kanbanana.db` and seeded with your default project configuration.)*

#### 2. Start the Frontend Dev Server (`:5173`)
In a separate terminal:
```bash
cd frontend
npm install
npm run dev
```
Open [`http://localhost:5173/`](http://localhost:5173/) in your browser. (The Vite dev server automatically proxies `/api`, `/mcp`, and `/.well-known` to `:8765`.)

#### 3. Build Frontend for Production
```bash
cd frontend
npm run build
```
The compiled output is saved to `frontend/dist/`. When present, the FastAPI server on `:8765` automatically serves the production frontend at `/`.

---

### Option C: Remote Agent Installs (`remote-agent/`)

How do **MCP** and **A2A** work together for CLI coding agents like **Kimi Code (`kimi`)**, **Claude Code (`claude`)**, or **Antigravity (`agy`)**?
- **MCP (`mcp.json`) = Outbound from Agent $\rightarrow$ Kanbanana** *(how the agent reads tickets, acquires GPU locks, and updates status).*
- **A2A (`/.well-known/agent.json` + `tasks/send`) = Inbound from Kanbanana $\rightarrow$ Agent** *(how Kanbanana discovers the agent and pushes new tasks to wake it up).*

For remote GPU servers or worker nodes, deploy the zero-dependency **Remote A2A CLI Bridge** in [`remote-agent/`](./remote-agent):

#### Using Docker Compose on Remote Worker:
```bash
# Example: Expose Kimi Code on remote GPU worker 10.1.1.2:8081 connected to Kanbanana at 10.1.1.4:8765
A2A_AGENT_PROVIDER=kimi \
A2A_AGENT_NAME="Kimi Code @ gpu-worker" \
A2A_PUBLIC_URL="http://10.1.1.2:8081" \
KANBANANA_URL="http://10.1.1.4:8765" \
HOST_AGENT_CONFIG_DIR="~/.kimi" \
HOST_WORKSPACE_PATH="/home/user/my-project" \
docker compose -f remote-agent/docker-compose.yml up --build -d
```

#### Or Run Directly on Bare Metal (Python Standard Library Only):
```bash
python3 remote-agent/a2a_cli_bridge.py \
  --provider kimi \
  --name "Kimi Code @ gpu-worker" \
  --port 8081 \
  --public-url http://10.1.1.2:8081 \
  --kanbanana-url http://10.1.1.4:8765 \
  --config-dir ~/.kimi \
  --workspace-dir /path/to/repo \
  --worktrees-dir /path/to/worktrees
```

---

## 🧪 Testing & Verification

Kanbanana includes a comprehensive test suite testing database transactions, atomic claiming, triage refinement, GPU locks, FastMCP tools, live transcripts, A2A discovery, custom models, lane matrix routing, and security/performance controls:

```bash
cd backend
uv run pytest -v
```

Expected output:
```text
tests/test_kanbanana.py::test_import_current_state_and_skill_generation PASSED
tests/test_kanbanana.py::test_atomic_claim_and_dependency_enforcement PASSED
tests/test_kanbanana.py::test_triage_refinement_and_proposal_approval PASSED
tests/test_kanbanana.py::test_feature_locks_wait_queue_and_usage_exhaustion_handoff PASSED
tests/test_kanbanana.py::test_mcp_server_tools_via_fastmcp_client PASSED
tests/test_kanbanana.py::test_agent_autodetect_live_transcript_and_claim_with_worktree PASSED
tests/test_kanbanana.py::test_security_hardening_controls PASSED
tests/test_kanbanana.py::test_project_presets_and_config_export_import PASSED
tests/test_kanbanana.py::test_global_settings_custom_models_and_unified_skills_catalog PASSED
tests/test_kanbanana.py::test_project_lane_agent_matrix_grok_review_and_claude_triage_breakdown PASSED
tests/test_kanbanana.py::test_review_self_review_guard_fallback_autodispatch_and_human_gate PASSED
tests/test_kanbanana.py::test_project_and_section_crud_plus_settings_json_roundtrip PASSED
tests/test_kanbanana.py::test_message_board_agents_channel_and_threading PASSED
tests/test_kanbanana.py::test_agentplay_transcript_file_and_command_extraction PASSED
tests/test_kanbanana.py::test_security_and_performance_review_remediations PASSED
============================= 15 passed in 11.95s =============================
```

---

## 🤖 Supported Agents & Auto-Detection

Kanbanana automatically scans `/agent-configs/*` (Docker mounts), standard host directories, and remote A2A endpoints:

| Agent / Provider | Auto-Detected Host Paths | CLI Binary | Auto-Configured Files | A2A Discovery & `tasks/send` |
| :--- | :--- | :--- | :--- | :---: |
| **Google Antigravity (`agy`)** | `~/.antigravity`, `~/.gemini/antigravity-cli` | `agy` | `mcp_config.json`, skills | ✅ `v0.2.1` |
| **Anthropic Claude Code** | `~/.claude` | `claude` | `.mcp.json`, skills | ✅ `v0.2.1` |
| **Moonshot Kimi Code** | `~/.kimi`, `~/.config/kimi` | `kimi` | `mcp.json`, skills | ✅ `v0.2.1` |
| **MiniMax Coding Agent** | `~/.minimax`, `~/.config/minimax` | `minimax` | `mcp.json`, skills | ✅ `v0.2.1` |
| **xAI Grok CLI** | `~/.grok`, `~/.config/grok` | `grok` | `mcp.json`, skills | ✅ `v0.2.1` |
| **OpenAI Codex CLI** | `~/.codex` | `codex` | `mcp.json`, skills | ✅ `v0.2.1` |
| **Cursor Agent** | `~/.cursor` | `cursor` | `mcp.json`, skills | ✅ `v0.2.1` |
| **OpenCode CLI** | `~/.config/opencode` | `opencode` | `opencode.json`, skills | ✅ `v0.2.1` |
| **Remote A2A Agents** | Any URL with `/.well-known/agent.json` | `a2a-jsonrpc` | Native JSON-RPC 2.0 | ✅ `v0.2.1` |

### Manual MCP Client Configuration
To manually connect any MCP client (Claude Desktop, Cline, Roo Code, Cursor), add to your agent's config:
```json
{
  "mcpServers": {
    "kanbanana": {
      "url": "http://localhost:8765/mcp",
      "transport": "http"
    }
  }
}
```

---

## ⚙️ Environment Variables Reference

| Variable | Default | Description |
| :--- | :--- | :--- |
| `KANBANANA_DB_PATH` | `./backend/data/kanbanana.db` | Path to the SQLite database file (`WAL` mode + persistent thread-local connections). |
| `KANBANANA_DEFAULT_PROJECT` | `default` | Default project slug used when resolving MCP tools or seeding a new installation. |
| `KANBANANA_CONFIGS_DIR` | `./configs/projects` | Directory containing portable project JSON presets (e.g. `default.json`). |
| `KANBANANA_SKIP_SEED` | `0` | Set to `1` to disable automatic seeding of project presets when the database is empty. |
| `KANBANANA_API_TOKEN` | `""` *(empty)* | Optional secret token. Protects all REST (`/api/*`), FastMCP (`/mcp`), and A2A routes. When binding to non-loopback without a token, an ephemeral token is generated automatically. |
| `KANBANANA_BIND_IP` | `127.0.0.1` | Host interface IP published by `docker-compose.yml` (defaults to loopback for security). |
| `KANBANANA_HOST` | `127.0.0.1` | Network interface address bound by the backend server (`main.py`). |
| `KANBANANA_PORT` | `8765` | Network port bound by the backend server. |
| `KANBANANA_RELOAD` | `0` | Set to `1` in development to enable Uvicorn auto-reload (disabled by default in production). |
| `KANBANANA_WORKSPACE_DIR` | `/workspaces/project` | Base Git repository path used for `git worktree` and branch diffs. |
| `KANBANANA_WORKTREES_DIR` | `/workspaces/worktrees` | Shared root directory where per-ticket isolated Git worktrees are strictly confined. |
| `KANBANANA_AGENT_CONFIGS_DIR` | `/agent-configs` | Root directory scanned for mounted agent configurations and live logs. |
| `KANBANANA_STRICT_CONFIG_ROOT` | `1` | Enforces that custom agent profile config directories must be confined within `KANBANANA_AGENT_CONFIGS_DIR`. |
| `KANBANANA_A2A_ENDPOINTS` | `""` *(empty)* | Comma-separated list of remote A2A agent base URLs probed for `/.well-known/agent.json`. |
| `KANBANANA_ALLOW_PRIVATE_A2A` | `0` | Set to `1` to allow outbound A2A connections to RFC1918 private IP ranges (blocked by default). |
| `KANBANANA_A2A_ALLOWED_HOSTS` | `""` *(empty)* | Comma-separated allowlist of specific private IPs/hostnames permitted for A2A communication. |
| `KANBANANA_CORS_ORIGINS` | `""` *(empty)* | Comma-separated list of allowed CORS origins (defaults to local Vite & loopback origins). |

---

## 🛠️ MCP Tools, Resources & Prompts (`/mcp`)

- **Onboarding & Search**: `get_project_onboarding(project_slug, compact=True)`, `search_board(project_slug, query)`, `list_tickets`, `get_ticket`, `check_file_conflicts`
- **Task Claiming & Worktrees**: `pick_next_todo`, `claim_ticket`, `create_todo_ticket`, `update_ticket_progress`, `add_ticket_note`
- **Triage & External Scans**: `create_triage_ticket`, `claim_triage_ticket`, `submit_triage_research_findings`, `ask_triage_questions`, `propose_todo_tickets`
- **Mid-Tier Code Review**: `inspect_review_ticket`, `review_ticket` *(with automated `git merge` / `gh pr merge` gate)*
- **Locks & Telemetry**: `acquire_lock`, `release_lock`, `heartbeat_lock`, `heartbeat_agent`, `list_active_agents`, `report_agent_usage_exhausted`, `scan_a2a_agents`, `post_message`, `list_messages`
- **MCP Resources**:
  - `skill://{project_slug}/SKILL.md` — Project onboarding & lock rules
  - `skill://{project_slug}/CODE_REVIEW_SKILL.md` — Mid-tier model review & security gate
  - `board://{project_slug}/summary.md` — Compact live board summary
  - `board://{project_slug}/background.md` — Hardware baselines & *"Measured & Rejected"* log

---

## 📚 Sources & Attribution

- **Model Context Protocol (MCP)**: Implemented via [`FastMCP`](https://github.com/jlowin/fastmcp) and the official Python `mcp` SDK.
- **Agent2Agent (A2A) Protocol (`v0.2.1`)**: Implements standard Agent Card discovery (`/.well-known/agent.json`) and JSON-RPC 2.0 task dispatch.
- **Built With**: **Google Antigravity (`agy`)** with **Gemini 4 Argon** agentic reasoning.
- **Peer Review Models**: Configured for mid-tier review models (**Claude Sonnet 4.5**, **Gemini 2.5 Flash**, **OpenAI o4-mini**, **DeepSeek V3**, and **Qwen3-Coder-Plus**).
---

<div align="center">
  <sub>Built with 🍌 and 🥋 for autonomous multi-agent engineering teams.</sub>
</div>
