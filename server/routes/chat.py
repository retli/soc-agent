"""Chat endpoints with SSE streaming and MCP tool execution."""

import asyncio
import json
import uuid
from typing import Dict, List

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import Tool

from server.graph.callbacks import SSEQueue, StreamingCallbackHandler
from server.models import ChatRequest, ToolSummary
from server.services.llm import build_llm
from server.services.mcp_adapter import get_mcp_adapter

router = APIRouter()

# In-memory session streams (single-node test scope)
session_streams: Dict[str, SSEQueue] = {}
session_tasks: Dict[str, asyncio.Task] = {}

mcp_adapter = get_mcp_adapter()


def _build_langchain_tools(summaries: List[ToolSummary]) -> List[Tool]:
    tools: List[Tool] = []
    for t in summaries:
        tool_name = f"{t.service}__{t.name}"

        async def _run_tool(**kwargs):
            return await mcp_adapter.call_tool(tool_name, kwargs)

        tools.append(
            Tool(
                name=tool_name,
                description=t.desc or f"MCP tool from {t.service}",
                coroutine=_run_tool,
            )
        )
    return tools


def _to_lc_messages(req: ChatRequest) -> List[BaseMessage]:
    messages: List[BaseMessage] = []
    if req.system_prompt:
        messages.append(SystemMessage(content=req.system_prompt))
    for m in req.messages:
        if m.role == "user":
            messages.append(HumanMessage(content=m.content or ""))
        elif m.role == "assistant":
            messages.append(AIMessage(content=m.content or "", tool_calls=m.tool_calls))
        elif m.role == "tool":
            # tool_call_id not provided in schema; best-effort mapping
            messages.append(ToolMessage(content=m.content or "", name="tool"))
    return messages


async def _run_chat(session_id: str, req: ChatRequest, sse: SSEQueue) -> None:
    try:
        base_messages = _to_lc_messages(req)

        # 1) 拉取 MCP 工具并构造 LangChain 工具
        summaries = await mcp_adapter.list_tools()
        lc_tools = _build_langchain_tools(summaries) if summaries else []

        # 2) 决策+执行工具（非流式），然后最终流式回答
        if lc_tools:
            decision_llm = build_llm(streaming=False).bind_tools(lc_tools)
            ai_msg = await decision_llm.ainvoke(base_messages)

            tool_calls = getattr(ai_msg, "tool_calls", None) or []
            if tool_calls:
                # 广播工具调用计划
                await sse.put("assistant", {"tool_calls": tool_calls})
                tool_results = []
                for tc in tool_calls:
                    name = tc.get("name") or tc.get("function", {}).get("name") or ""
                    args_raw = tc.get("args") or tc.get("function", {}).get("arguments")
                    try:
                        args = args_raw if isinstance(args_raw, dict) else json.loads(args_raw or "{}")
                    except json.JSONDecodeError:
                        args = {}

                    await sse.put("tool", {"name": name, "status": "calling", "args": args})
                    try:
                        result = await mcp_adapter.call_tool(name, args)
                        await sse.put(
                            "tool",
                            {
                                "name": name,
                                "status": "result",
                                "result": result,
                            },
                        )
                        tool_results.append(
                            ToolMessage(
                                content=json.dumps(result, ensure_ascii=False),
                                name=name,
                                tool_call_id=tc.get("id", ""),
                            )
                        )
                    except Exception as exc:  # noqa: BLE001
                        await sse.put(
                            "tool",
                            {"name": name, "status": "error", "error": str(exc)},
                        )

                messages = base_messages + [ai_msg] + tool_results
                stream_llm = build_llm(streaming=True)
                cb = StreamingCallbackHandler(sse)
                final = await stream_llm.ainvoke(messages, config={"callbacks": [cb]})
                await sse.put("final", {"content": final.content or ""})
                return

        # 3) 无工具或无 tool_calls：直接流式回答
        stream_llm = build_llm(streaming=True)
        cb = StreamingCallbackHandler(sse)
        final = await stream_llm.ainvoke(base_messages, config={"callbacks": [cb]})
        await sse.put("final", {"content": final.content or ""})
    except Exception as exc:  # noqa: BLE001
        await sse.put("error", {"message": str(exc)})
    finally:
        session_streams.pop(session_id, None)
        session_tasks.pop(session_id, None)


@router.post("")
async def start_chat(req: ChatRequest) -> Dict[str, str]:
    session_id = req.session_id or str(uuid.uuid4())
    if session_id in session_tasks:
        raise HTTPException(status_code=400, detail="session already running")
    sse = SSEQueue()
    session_streams[session_id] = sse
    task = asyncio.create_task(_run_chat(session_id, req, sse))
    session_tasks[session_id] = task
    return {"session_id": session_id}


@router.get("/stream/{session_id}")
async def stream(session_id: str):
    sse = session_streams.get(session_id)
    if not sse:
        raise HTTPException(status_code=404, detail="session not found or finished")
    return StreamingResponse(sse.stream(), media_type="text/event-stream")
