"""Streaming callback utilities for SSE."""

import asyncio
import json
from typing import Any, AsyncIterator, Dict

from langchain_core.callbacks import AsyncCallbackHandler


class SSEQueue:
    def __init__(self) -> None:
        self.queue: asyncio.Queue = asyncio.Queue()

    async def put(self, event: str, data: Dict[str, Any]) -> None:
        await self.queue.put((event, data))

    async def stream(self) -> AsyncIterator[str]:
        while True:
            event, data = await self.queue.get()
            payload = json.dumps(data, ensure_ascii=False)
            yield f"event: {event}\ndata: {payload}\n\n"
            if event in {"final", "error"}:
                break


class StreamingCallbackHandler(AsyncCallbackHandler):
    def __init__(self, sse: SSEQueue) -> None:
        self.sse = sse

    async def on_llm_new_token(self, token: str, **kwargs: Any) -> None:
        await self.sse.put("token", {"content": token})

    async def on_llm_error(self, error: Exception, **kwargs: Any) -> None:
        await self.sse.put("error", {"message": str(error)})
