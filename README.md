<div align="center">

# 🍌🥋 Kanbanana

### Agent-First Kanban Board, Streamable-HTTP MCP Server & A2A Protocol Coordinator

[![MCP Streamable-HTTP](https://img.shields.io/badge/MCP-Streamable--HTTP-6366f1?style=for-the-badge)](http://localhost:8765/mcp)
[![A2A Protocol](https://img.shields.io/badge/A2A_Protocol-v0.2.1_JSON--RPC_2.0-06b6d4?style=for-the-badge)](http://localhost:8765/.well-known/agent.json)
[![Backend](https://img.shields.io/badge/FastAPI_%2B_SQLite_WAL-Python_3.12+-10b981?style=for-the-badge)](./backend)
[![Frontend](https://img.shields.io/badge/React_19_%2B_Tailwind_v4-TypeScript-f59e0b?style=for-the-badge)](./frontend)
[![Docker Ready](https://img.shields.io/badge/Docker-Compose_Ready-2496ed?style=for-the-badge)](./docker-compose.yml)

**Kanbanana** replaces sprawling, merge-conflict-prone markdown coordination files (`BOARD.md`, `GPU_LOCK.md`, `SKILL.md`) with an **atomic SQLite-backed HTTP MCP server**, **A2A (`/.well-known/agent.json`) agent discovery & task dispatch**, **isolated Git worktree provisioning**, **FIFO GPU/feature locks**, and a **real-time WebSocket WebUI** with live agent telemetry and **"🚀 SEND IT!"** card transitions.

---

### 🎬 Live Application Screencast

<video src="docs/assets/kanbanana-demo.mp4" controls width="100%" poster="docs/assets/board-send-it.png">
  <p>Your browser does not support HTML5 video. View the <a href="docs/assets/kanbanana-demo.gif">animated GIF preview</a> or download the <a href="docs/assets/kanbanana-demo.mp4">MP4 screencast</a>.</p>
</video>

![Kanbanana Live Screencast](./docs/assets/kanbanana-demo.gif)

> 📹 **High-Resolution MP4 Screencast:** [Download / View `docs/assets/kanbanana-demo.mp4`](./docs/assets/kanbanana-demo.mp4) (1440×900 progressive H.264)

| 🚀 **"SEND IT!" Claim & A2A Task Dispatch** | 📊 **Live Telemetry & A2A Agent Cards** |
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
| **`0:06 - 0:07`** | **Live Telemetry & Agent Activity** | Switching to the **Agents & Live Activity** tab displays real-time agent execution states, live worktree paths, quota meters, and a 12-minute dual-line **Tokens/min & LOC/min** graph. |
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

### 4. 📊 Real-Time Telemetry & Agent Roster
- Monitors active and recent agents with live execution states, assigned worktrees, and running CLI commands.
- Streams agent log tails to calculate and render rolling tokens/minute, lines-of-code/minute, and quota utilization graphs.

### 5. 🌲 Automated Git Worktree Isolation
- Agents never step on each other's branches. Claiming a task automatically provisions an isolated worktree (`/workspaces/worktrees/<project>-<code >`) on branch `board/<code >`.
- Includes **Concurrent File Overlap Detection** (`check_file_conflicts`) to warn agents if another in-progress task touches the same source files.

### 6. 🔍 Orchestrator Triage & Worker-Ready Story Breakdown
- **Asymmetric Frontier Allocation**: High-budget frontier reasoning (Opus 5.5, Grok 4.7, Gemini 3.1 Pro, GPT-5.2 Codex, Kimi K3) is reserved for *deciding what to do* in `triage` and *diagnosing hard failures* in `blocked`.
- **Anti-Over-Decomposition Guardrail**: Over-splitting tasks degrades multi-agent accuracy (dropping to ~20.1% vs 92.3% on single-task runs) while multiplying token costs ~3.4×. Kanbanana enforces a **1-ticket rule** for any change fitting in 1–2 files (< ~150 LOC), splitting only across distinct architectural layers or disjoint parallel files.
- **Worker-Ready Contract**: Orchestrators create proposals with unambiguous boundaries so mid-range models can execute without guesswork:
  - `files_md`: Exact paths to Modify/Create + 1–2 Reference files to mirror.
  - `do_md`: Exact function/class/route signatures & types, numbered step-by-step edit blueprint, and an explicit **Out-of-Scope (`Do NOT Touch`)** section.
  - `done_when_md`: Deterministic runnable test commands (`pytest`, `tsc --noEmit`, etc.) with concrete expected assertions.
- **Inverted Effort Levels**: Planners run with `high` effort for broad architectural decomposition, while bounded execution workers run with `max` effort where supported (e.g. `sonnet-5-5`), directing compute tokens into careful implementation and verification.

### 7. 🛡️ Cross-Vendor Code Review Gate (`prevent_self_review=True`)
- Moving a ticket to `review` invokes an adversarial review skill with cross-vendor models (`grok-4.7`, `claude-sonnet-5-5`, `gemini-3.8-flash`, `o4-mini`).
- **Eliminate Same-Family Blind Spots**: Kanbanana's lane matrix prevents the authoring model from reviewing its own work (`prevent_self_review=True`), catching regressions that same-family models overlook.
- **2-Strike Anti-Loop Escalation**: Writing code and tests is mid-tier work; diagnosing complex test failures is orchestrator-tier work. If a worker fails verification twice, it escalates to `blocked` for a Frontier Failure-Diagnostician instead of wasting budget in a token loop.
- **Merge Gate**: Automatically merges clean branches (`git merge --no-ff` or `gh pr merge`) when zero issues are found.

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

### 12. 🧠 SystemOne Dynamic Model & Effort Router (`TypeSafe AI System One`)
- **Dynamic Task-to-Model Routing:** Integrates with native TypeSafe AI System One endpoints (`POST /v1/systemone`, default model `jev-latest`) to intelligently size model tier and reasoning effort per task.
- **Token-Budget-Aware Choice Optimization:** Rather than prompt-hallucinated LLM router text, SystemOne ingests the ticket's file footprint (`files_md`), task scope (`do_md`), acceptance criteria (`done_when_md`), and token ceiling, returning probabilistic choice answers over candidate models and reasoning efforts.
- **Lane × Agent Matrix Toggle:** Enable the **SystemOne Dynamic Routing** switch on any rule card (e.g. `In Progress` or `Review`) to let SystemOne dynamically select the optimal agent model and effort tier. Manual reasoning/preset fields are cleanly dimmed with links to configuration.
- **Inherited Global Baseline & Project Overrides:** Configure URL, optional API key, engine model, and timeout globally or per project, with live **Test Connection** ping probes.
- **Resilient Fallback & Audit Trail:** If SystemOne is unreachable or times out, execution automatically falls back to configured tier defaults without dropping tasks. The router's choice, latency, and confidence are recorded directly in the ticket activity feed.

### 13. ⏸️ Ticket Hold & Resume Lifecycle (`is_held: bool`)
- **Pause Tasks Without Disrupting Board State:** Tickets in any lifecycle lane (`todo`, `in-progress`, `review`, `triage`, `blocked`) can be placed on hold via the WebUI, REST API (`POST /api/projects/{slug}/tickets/{code}/hold`), or FastMCP (`hold_ticket`).
- **Autonomous Dispatch & Claim Protection:** When a ticket is on hold, autonomous agent lane dispatchers, `pick_next_todo`, `claim_ticket`, `claim_ticket_with_agent`, and `get_project_onboarding` strictly skip or reject claims with HTTP 409. Agents are prevented from accidentally claiming, restarting, or token-looping on paused work.
- **Clear Visual Distinction:** Held cards on the board feature a dimmed background, dashed amber border, an amber `HOLD` badge, and a disabled quick-claim indicator. The ticket modal surfaces an amber callout banner and a 1-click **"Resume Work"** toggle (`POST .../resume` / `resume_ticket`).

### 14. 🌙 The "Let the Fleet Cook" Overnight Auto-Runner
- **Autonomous Pipeline Orchestration:** A background coordinator loop (`POST /api/autorunner/step`, `start`, `stop`) that keeps the autonomous engineering fleet making continuous forward progress overnight without human bottlenecks.
- **Autonomous Review Auto-Merge:** Automatically identifies tickets in `review` with clean, passing cross-vendor reviews (`APPROVE` verdict with 0 code issues and 0 security issues) and auto-merges them into `done`, clearing review bottlenecks autonomously.
- **Concurrency & Token Ceiling Enforcement:** Continuously claims and dispatches unblocked `todo` tasks up to a configured concurrency ceiling (e.g. 2–16 parallel agents), safely halting dispatches if total token spend crosses the session budget ceiling.
- **Header HUD Popover & Real-Time Controls:** Interactive **🌙 Auto-Runner** status pill in the top navigation bar displays active/paused state, token consumption against budget, worker concurrency, and a single-step trigger button.

### 15. 🪝 Native Gitea / Git Webhooks & Push/PR Automation
- **Direct Git Forge Integration:** Unauthenticated or HMAC secret-verified webhook endpoints (`POST /api/webhooks/gitea`, `/api/webhooks/git`) connecting Kanbanana directly to on-premises Gitea or GitHub repositories.
- **Smart Commit Parsing:** Scans commit messages for standard issue resolution keywords (`Fixes KAN-12`, `Resolves KAN-14`, `Refs KAN-15`), automatically moving in-progress tickets to `review` and pinning commit sha/author notes.
- **Pull Request Lifecycle Triggers:** Opening a PR links the branch and dispatches adversarial cross-vendor reviewers; merging a PR marks the ticket `done` and stamps merge metadata onto the ticket.
- **Configuration & 1-Click Copy:** Dedicated **Automations, Webhooks & Watchdog** project settings subtab provides a ready-to-paste Webhook URL, secret token visibility toggle, and granular event triggers.

### 16. ⏱️ Dead-Agent Auto-Recovery & Stalled Task Watchdog
- **Silent & Hung Agent Remediation:** An asynchronous background watchdog task periodically monitors active tasks for agent silence. If an in-progress ticket exceeds the configured stall threshold (e.g. 15 minutes without heartbeats or updates), the watchdog intervenes automatically.
- **FIFO Lock Auto-Release:** Automatically frees any exclusive or shared GPU/hardware locks held by the hung agent, preventing deadlock cascades across the rest of the fleet.
- **Configurable Recovery Action:** Transitions stalled tickets to `blocked` (with an automated diagnostic note) or resets them to `todo` for immediate re-dispatch by a fresh worker.
- **Agent Watercooler Alerts:** Posts an urgent recovery notification to the `#agents` message board channel so engineers and peer agents have immediate visibility into the stalled task recovery.

### 17. 🎙️ Live Interactive "Grill Me" Socratic Triage Drawer
- **Deep Alignment via Socratic Dialogue:** Clicking **"🎙️ Grill Me"** on any `triage` ticket opens an interactive slide-over chat drawer powered by the configured Frontier Orchestrator.
- **Four-Pillar Architectural Interrogation:** Systematically drills down on:
  1. *Exactness & Invariants* (numerical precision, edge cases, invariants).
  2. *Hardware Targets & Performance Budgets* (GPU requirements, latency/VRAM constraints).
  3. *Out-of-Scope Boundaries* (explicit `Do NOT Touch` lists to protect mid-tier workers).
  4. *Deterministic Verification Commands* (exact runnable CLI test assertions).
- **Suggested Quick Replies & Auto-Breakdown:** Surfaces dynamic 1-click suggested answers to speed up alignment, and allows 1-click generation of worker-ready sub-ticket proposals (`files_md`, `do_md`, `done_when_md`) that can be approved directly into the backlog.

---

## 🧠 Orchestrator–Worker Routing Matrix & Economics

Kanbanana configures defaults according to the proven **Orchestrator–Worker** pattern (inspired by Aider's architect/editor split and multi-agent routing benchmarks): spend reasoning tokens on the model that *decides what to do*, and let fast, cost-effective models handle *bounded execution*.

### Late-2026 Model Lineup & Lane Assignments

| Lane | Role | Preferred Frontier / Mid-Range Models | Effort Level | Key Responsibility & Guardrails |
| :--- | :--- | :--- | :--- | :--- |
| **`triage`** | **Frontier Orchestrator / Architect** | `claude-opus-5-5`, `grok-4.7`, `gemini-3.1-pro`, `gpt-5.2-codex`, `kimi-k3` | `high` | Architectural spikes, technical triage, knowing what **not** to build, and writing unambiguous **worker-ready specs** (`files_md`, `do_md`, `done_when_md`). |
| **`todo` / `in-progress`** | **Bounded Implementation Worker** | `kimi-k2.6`, `gemini-3.8-flash`, `claude-sonnet-5-5`, `grok-code-fast-1`, `o4-mini`, local `qwen3-coder-30b-a3b` | `max` / `high` *(inverted effort)* | Strict obedience to `files_md` and `do_md`. Runs `done_when_md` verification tests. Follows the **2-Strike Anti-Loop Escalation Rule** to avoid token burn. |
| **`review`** | **Adversarial Reviewer** | `grok-4.7`, `claude-sonnet-5-5`, `gemini-3.8-flash`, `o4-mini` | `high` | `prevent_self_review=True`. Cross-vendor family audits exactness, security, and test runs. Automated merge if 0 issues found. |
| **`blocked`** | **Frontier Failure-Diagnostician** | `claude-opus-5-5`, `grok-4.7`, `gemini-3.1-pro`, `gpt-5.2-codex` | `high` | Root-cause analysis of test failures and architectural blockers where mid-range models would otherwise loop. |

### Why It Works & Where It Breaks

- **40–60% Cost Reduction**: Pairing an Opus/Grok orchestrator with Sonnet/Flash/Kimi workers cuts token expenditure in half compared to running flagship models across every task turn.
- **Inverted Effort Levels**: Planners run at `high` effort for broad architectural decomposition; workers run at `max` effort where supported (e.g., `sonnet-5-5`), investing computation tokens in precise code generation and test execution rather than higher model base rates.
- **Ambiguous Instructions Kill Cheap Workers**: Cheap models fail when boundaries are blurry. Kanbanana requires every proposed TODO story to include exact files, exact symbol signatures, out-of-scope boundaries, and deterministic verification commands.
- **Anti-Over-Decomposition**: Over-splitting tasks degrades multi-agent accuracy (measured at ~20.1% vs 92.3% on single-task benchmarks). Kanbanana enforces a 1-ticket rule for changes under ~150 LOC / 1–2 files, splitting only across architectural layers or disjoint parallel files.

---

## 🏗️ Architecture & Interaction Flow

```mermaid
flowchart LR
    subgraph WebUI["React 19 WebUI (WebSocket Live Sync & Code-Split)"]
        Board["Kanban Board\n('🚀 SEND IT!' Claim Animation)"]
        Triage["Triage & Grill\n('X uses Y to do Z')"]
        AgentsTab["Agents & Live Activity\n(Live Telemetry + A2A Cards)"]
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
git clone ssh://gitea/spyn/kanbananna.git
cd kanbananna

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
tests/test_kanbanana.py::test_systemone_dynamic_router_and_connection_probe PASSED
tests/test_kanbanana.py::test_ticket_hold_and_resume_lifecycle PASSED
tests/test_kanbanana.py::test_gitea_webhook_push_and_pr_events PASSED
tests/test_kanbanana.py::test_dead_agent_watchdog_auto_recovery PASSED
tests/test_kanbanana.py::test_autorunner_pipeline_cycle PASSED
tests/test_kanbanana.py::test_grill_me_interview_and_proposals PASSED
============================= 21 passed in 14.88s =============================
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
- **Task Claiming & Worktrees**: `pick_next_todo`, `claim_ticket`, `hold_ticket`, `resume_ticket`, `create_todo_ticket`, `update_ticket_progress`, `add_ticket_note`
- **Triage & External Scans**: `create_triage_ticket`, `claim_triage_ticket`, `submit_triage_research_findings`, `ask_triage_questions`, `propose_todo_tickets`
- **Mid-Tier Code Review**: `inspect_review_ticket`, `review_ticket` *(with automated `git merge` / `gh pr merge` gate)*
- **Locks & Telemetry**: `acquire_lock`, `release_lock`, `heartbeat_lock`, `heartbeat_agent`, `list_active_agents`, `report_agent_usage_exhausted`, `scan_a2a_agents`, `post_message`, `list_messages`, `check_watchdog`, `trigger_autorunner_step`
- **MCP Resources**:
  - `skill://{project_slug}/SKILL.md` — Project onboarding & lock rules
  - `skill://{project_slug}/CODE_REVIEW_SKILL.md` — Mid-tier model review & security gate
  - `board://{project_slug}/summary.md` — Compact live board summary
  - `board://{project_slug}/background.md` — Hardware baselines & *"Measured & Rejected"* log

---

## 📚 Sources & Attribution

- **Model Context Protocol (MCP)**: Implemented via [`FastMCP`](https://github.com/jlowin/fastmcp) and the official Python `mcp` SDK.
- **Agent2Agent (A2A) Protocol (`v0.2.1`)**: Implements standard Agent Card discovery (`/.well-known/agent.json`) and JSON-RPC 2.0 task dispatch.
- **Built With**: **Google Antigravity (`agy`)** with **Gemini 4 Argon** agentic reasoning — bringing noble, unreactive stability to volatile multi-agent codebases.
- **Peer Review Models**: Configured for mid-tier review models (**Claude Sonnet 4.5**, **Gemini 2.5 Flash**, **OpenAI o4-mini**, **DeepSeek V3**, and **Qwen3-Coder-Plus**).

---

## 🧪 Noble Architecture Notes (All the Good Jokes Ar-gon)

Because Kanbanana was synthesized with **Google Antigravity (`agy`)** and **Gemini 4 Argon**, we are chemically and structurally obligated to note:

- **Zero Unwanted Reactions**: Much like element 18 ($Ar$), our atomic SQLite transactions are completely **inert**. When concurrent agent writes heat up, Kanbanana shields your tree like **argon gas in a precision TIG weld**.
- **Where Did the Merge Conflicts Go?**: They’re **Ar-gon**. Vanished. Completely out of the atmosphere.
- **Noble Multi-Agent Peace**: Other multi-agent orchestrators blow up under pressure; Kanbanana stays thoroughly unreactive because our valence shell of locks is **100% full**.
- **Worktree Thermal Insulation**: Just like double-pane energy-efficient windows pump **argon** between the panes to keep the cold out, Kanbanana pumps isolated Git worktrees between agents to prevent thermal runaway on `main`.
- **High-Voltage Glow**: When you feed our A2A SSE streams 120 volts of pure telemetry, the Overnight Terminal lights up with a signature **argon-violet glow** across the AgentPlay radar.
- **Heard Any Good Chemistry Jokes Lately?**: We tried to think of better ones, but sadly... **all the good ones argon**. If you don't laugh, that's fine — we expected **no reaction**.

---

<div align="center">
  <sub>Built with 🍌, 🥋, and 18 protons of noble inertness ($Ar$) for autonomous multi-agent engineering teams.</sub>
</div>
