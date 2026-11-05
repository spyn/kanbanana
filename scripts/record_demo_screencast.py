from __future__ import annotations

import asyncio
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

import uvicorn
import websockets

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR / "backend"))

from app.main import create_app  # noqa: E402


def seed_active_agent_logs(agent_configs_dir: Path) -> None:
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    agy_logs = agent_configs_dir / "antigravity" / "brain" / "conv-demo" / ".system_generated" / "logs"
    agy_logs.mkdir(parents=True, exist_ok=True)
    (agent_configs_dir / "antigravity" / "mcp_config.json").write_text(
        json.dumps({"mcpServers": {"kanbanana": {"url": "http://localhost:8765/mcp"}}}, indent=2),
        encoding="utf-8",
    )
    lines = []
    for i in range(12):
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - (11 - i) * 55))
        lines.append(
            json.dumps(
                {
                    "step_index": i + 1,
                    "type": "PLANNER_RESPONSE",
                    "status": "DONE",
                    "created_at": ts,
                    "usage": {"total_tokens": 1800 + i * 650},
                    "tool_calls": [{"name": "edit_file" if i % 2 == 0 else "inspect_review_ticket"}],
                    "content": "```rust\npub fn launch_q8_allreduce(stream: hipStream_t) -> Result<(), HipError> {\n    // fused wave32 ring kernel\n    Ok(())\n}\n```",
                }
            )
        )
    (agy_logs / "transcript.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")

    kimi_dir = agent_configs_dir / "kimi"
    kimi_dir.mkdir(parents=True, exist_ok=True)
    (kimi_dir / "mcp.json").write_text(
        json.dumps({"mcpServers": {"kanbanana": {"url": "http://localhost:8765/mcp"}}}, indent=2),
        encoding="utf-8",
    )
    (kimi_dir / "sessions.jsonl").write_text(
        json.dumps(
            {
                "role": "assistant",
                "timestamp": now_iso,
                "usage": {"total_tokens": 4200},
                "content": "Running 6-round ab benchmark on xeres for R3 contiguous RPC tensor transfer.",
            }
        )
        + "\n",
        encoding="utf-8",
    )


async def capture_screencast(out_dir: Path, frames_dir: Path) -> None:
    frame_idx = 0

    async def send_cdp(ws, method: str, params: dict | None = None, msg_id: int = 1) -> dict:
        payload = {"id": msg_id, "method": method, "params": params or {}}
        await ws.send(json.dumps(payload))
        while True:
            raw = await ws.recv()
            data = json.loads(raw)
            if data.get("id") == msg_id:
                return data

    async def snap(ws, repeat: int = 1, msg_base: int = 100) -> None:
        nonlocal frame_idx
        res = await send_cdp(ws, "Page.captureScreenshot", {"format": "png"}, msg_id=msg_base + frame_idx)
        b64 = res.get("result", {}).get("data", "")
        if b64:
            img_bytes = base64.b64decode(b64)
            for _ in range(repeat):
                frame_path = frames_dir / f"frame_{frame_idx:04d}.png"
                frame_path.write_bytes(img_bytes)
                frame_idx += 1

    # Find websocket debugger URL for page target
    targets = json.loads(urllib.request.urlopen("http://127.0.0.1:9233/json").read().decode("utf-8"))
    page_target = next(t for t in targets if t.get("type") == "page")
    ws_url = page_target["webSocketDebuggerUrl"]

    async with websockets.connect(ws_url, max_size=50 * 1024 * 1024) as ws:
        await send_cdp(ws, "Page.enable", {}, 1)
        await send_cdp(ws, "Runtime.enable", {}, 2)
        await send_cdp(
            ws,
            "Emulation.setDeviceMetricsOverride",
            {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False},
            3,
        )
        await send_cdp(ws, "Page.navigate", {"url": "http://127.0.0.1:8769/"}, 4)
        await asyncio.sleep(1.8)

        # Scene 1: Kanban Board Overview (hold ~1.2s at 10fps = 12 frames)
        await snap(ws, repeat=10)

        # Scene 2: Click Claim on first Todo ticket (e.g. R3) to open the A2A Assignment Modal
        await send_cdp(
            ws,
            "Runtime.evaluate",
            {
                "expression": """
                (() => {
                  const btns = Array.from(document.querySelectorAll('button'));
                  const claimBtn = btns.find(b => b.textContent && b.textContent.trim() === 'Claim');
                  if (claimBtn) claimBtn.click();
                })()
                """
            },
            10,
        )
        await asyncio.sleep(0.6)
        await snap(ws, repeat=12)
        shutil.copyfile(frames_dir / f"frame_{frame_idx - 1:04d}.png", out_dir / "a2a-claim-modal.png")

        # Scene 3: Click "Claim & Dispatch via A2A" to trigger the "SEND IT!" animation & move card to In Progress!
        await send_cdp(
            ws,
            "Runtime.evaluate",
            {
                "expression": """
                (() => {
                  const btns = Array.from(document.querySelectorAll('button'));
                  const submitBtn = btns.find(b => b.textContent && b.textContent.includes('Claim & Dispatch via A2A'));
                  if (submitBtn) submitBtn.click();
                })()
                """
            },
            11,
        )
        # Capture rapid frames during the 0.9s "SEND IT!" launch + 1.1s landing animation
        for i in range(20):
            await asyncio.sleep(0.11)
            await snap(ws, repeat=1)
            if i == 6:
                # Save static screenshot of SEND IT! launch on the board
                shutil.copyfile(frames_dir / f"frame_{frame_idx - 1:04d}.png", out_dir / "board-send-it.png")

        await snap(ws, repeat=8)

        # Scene 4: Switch to "Agents & Live Activity" tab (Fighter avatars + A2A Agent Cards)
        await send_cdp(
            ws,
            "Runtime.evaluate",
            {
                "expression": """
                (() => {
                  const btns = Array.from(document.querySelectorAll('button'));
                  const agBtn = btns.find(b => b.textContent && b.textContent.includes('Agents & Live Activity'));
                  if (agBtn) agBtn.click();
                })()
                """
            },
            12,
        )
        await asyncio.sleep(0.5)
        for i in range(14):
            await asyncio.sleep(0.12)
            await snap(ws, repeat=1)
            if i == 5:
                shutil.copyfile(frames_dir / f"frame_{frame_idx - 1:04d}.png", out_dir / "agents-a2a-fighters.png")

        # Scroll down slightly on Agents tab to show the A2A Agent Card (`/.well-known/agent.json`) clearly
        await send_cdp(
            ws,
            "Runtime.evaluate",
            {"expression": "window.scrollTo({ top: 260, behavior: 'smooth' })"},
            13,
        )
        await asyncio.sleep(0.5)
        await snap(ws, repeat=10)

        # Scene 5: Switch to Triage & Grill tab
        await send_cdp(
            ws,
            "Runtime.evaluate",
            {
                "expression": """
                (() => {
                  window.scrollTo({ top: 0 });
                  const btns = Array.from(document.querySelectorAll('button'));
                  const trBtn = btns.find(b => b.textContent && b.textContent.includes('Triage & Grill'));
                  if (trBtn) trBtn.click();
                })()
                """
            },
            14,
        )
        await asyncio.sleep(0.5)
        await snap(ws, repeat=10)

        # Scene 6: Switch to Agent Message Board (#gbs channel)
        await send_cdp(
            ws,
            "Runtime.evaluate",
            {
                "expression": """
                (() => {
                  const btns = Array.from(document.querySelectorAll('button'));
                  const msgBtn = btns.find(b => b.textContent && b.textContent.includes('Agent Message Board'));
                  if (msgBtn) msgBtn.click();
                })()
                """
            },
            15,
        )
        await asyncio.sleep(0.4)
        await send_cdp(
            ws,
            "Runtime.evaluate",
            {
                "expression": """
                (() => {
                  const btns = Array.from(document.querySelectorAll('button'));
                  const gbsBtn = btns.find(b => b.textContent && b.textContent.includes('#gbs'));
                  if (gbsBtn) gbsBtn.click();
                })()
                """
            },
            16,
        )
        await asyncio.sleep(0.4)
        await snap(ws, repeat=10)


def main() -> None:
    out_dir = ROOT_DIR / "docs" / "assets"
    out_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        tmp_path = Path(tmp)
        agent_configs = tmp_path / "agent-configs"
        worktrees_dir = tmp_path / "worktrees"
        seed_active_agent_logs(agent_configs)

        os.environ["KANBANANA_AGENT_CONFIGS_DIR"] = str(agent_configs)
        os.environ["KANBANANA_WORKTREES_DIR"] = str(worktrees_dir)

        app = create_app(db_path=tmp_path / "demo.db", auto_seed=True)
        config = uvicorn.Config(app, host="127.0.0.1", port=8769, log_level="warning")
        server = uvicorn.Server(config)
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()

        # Wait for server to be ready
        for _ in range(30):
            try:
                urllib.request.urlopen("http://127.0.0.1:8769/health", timeout=1)
                break
            except Exception:
                time.sleep(0.2)

        edge_bin = shutil.which("msedge") or "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
        edge_profile = tmp_path / "edge-profile"
        edge_proc = subprocess.Popen(
            [
                edge_bin,
                "--headless=new",
                "--disable-gpu",
                "--no-first-run",
                "--no-default-browser-check",
                f"--user-data-dir={edge_profile}",
                "--remote-debugging-port=9233",
                "--window-size=1440,900",
                "http://127.0.0.1:8769/",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        try:
            for _ in range(30):
                try:
                    urllib.request.urlopen("http://127.0.0.1:9233/json", timeout=1)
                    break
                except Exception:
                    time.sleep(0.2)

            frames_dir = tmp_path / "frames"
            frames_dir.mkdir(parents=True, exist_ok=True)
            asyncio.run(capture_screencast(out_dir, frames_dir))

            ffmpeg_bin = shutil.which("ffmpeg") or r"C:\Users\matti\AppData\Local\Microsoft\WinGet\Links\ffmpeg.EXE"
            gif_path = out_dir / "kanbanana-demo.gif"
            mp4_path = out_dir / "kanbanana-demo.mp4"

            # Encode high-quality palette GIF (10 fps)
            subprocess.run(
                [
                    ffmpeg_bin,
                    "-y",
                    "-framerate",
                    "10",
                    "-i",
                    str(frames_dir / "frame_%04d.png"),
                    "-vf",
                    "fps=10,scale=1200:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer",
                    str(gif_path),
                ],
                check=True,
                capture_output=True,
            )

            # Encode MP4 video screencast
            subprocess.run(
                [
                    ffmpeg_bin,
                    "-y",
                    "-framerate",
                    "10",
                    "-i",
                    str(frames_dir / "frame_%04d.png"),
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    "-vf",
                    "scale=1440:900",
                    str(mp4_path),
                ],
                check=True,
                capture_output=True,
            )
            print(f"Created {gif_path} ({gif_path.stat().st_size} bytes) and {mp4_path} ({mp4_path.stat().st_size} bytes)")
        finally:
            edge_proc.terminate()
            server.should_exit = True


if __name__ == "__main__":
    main()
