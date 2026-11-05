from __future__ import annotations

import asyncio
from typing import Any, Optional
from fastapi import WebSocket


class EventHub:
    def __init__(self, max_clients: int = 64, send_timeout_sec: float = 2.5) -> None:
        self._clients: list[WebSocket] = []
        self._max_clients = max_clients
        self._send_timeout_sec = send_timeout_sec

    async def connect(self, ws: WebSocket, subprotocol: Optional[str] = None) -> bool:
        if len(self._clients) >= self._max_clients:
            # Evict oldest connection so new operator sessions are never locked out by leaked tabs
            oldest = self._clients.pop(0)
            try:
                await oldest.close(code=1000, reason="Replaced by newer session")
            except Exception:
                pass
        await ws.accept(subprotocol=subprotocol)
        if ws not in self._clients:
            self._clients.append(ws)
        return True

    def disconnect(self, ws: WebSocket) -> None:
        try:
            self._clients.remove(ws)
        except ValueError:
            pass

    async def _send_one(self, ws: WebSocket, msg: dict[str, Any]) -> Optional[WebSocket]:
        try:
            await asyncio.wait_for(ws.send_json(msg), timeout=self._send_timeout_sec)
            return None
        except Exception:
            return ws

    async def broadcast(self, event_type: str, payload: dict[str, Any] | None = None) -> None:
        if not self._clients:
            return
        data = payload or {}
        msg = {"event": event_type, "payload": data, "data": data}
        snapshot = list(self._clients)
        results = await asyncio.gather(*(self._send_one(ws, msg) for ws in snapshot))
        for dead_ws in results:
            if dead_ws is not None:
                self.disconnect(dead_ws)

    def notify_sync(self, event_type: str, payload: dict[str, Any] | None = None) -> None:
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.broadcast(event_type, payload))
        except RuntimeError:
            pass


event_hub = EventHub()
