"""Pydantic models for chat and MCP configuration."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str
    content: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None


class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    messages: List[ChatMessage]
    system_prompt: Optional[str] = None
    enabled_tools: Optional[List[str]] = None
    function_call_mode: Optional[str] = Field(
        default=None, description="auto|required|none"
    )


class ToolEvent(BaseModel):
    service: Optional[str] = None
    name: str
    args: Dict[str, Any]
    status: str
    result: Optional[Any] = None
    error: Optional[str] = None


class MCPServiceConfig(BaseModel):
    id: Optional[str] = None
    name: str
    sse_url: str
    method: str = "GET"
    enabled: bool = True


class ToolSummary(BaseModel):
    name: str
    service: str
    desc: Optional[str] = None
    schema: Optional[Dict[str, Any]] = None
