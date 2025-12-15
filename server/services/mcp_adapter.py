"""MCP adapter: list tools and call tools via HTTP (fallback) for MCP servers."""

import json
import logging
from typing import Any, Dict, List, Optional, Tuple

import httpx

from server.config import get_settings
from server.models import MCPServiceConfig, ToolSummary

logger = logging.getLogger(__name__)


class MCPAdapter:
    """Minimal MCP client that prefers simple HTTP endpoints.

    Assumptions (aligned with前端已有实现的回退模式):
    - 工具列表：GET {base}/tools 返回 {"tools":[{name,description?,inputSchema?}]}
      若配置的 sse_url 以 /sse 结尾，则 {base} = sse_url 去掉 /sse。
    - 工具调用：POST {base}/tools/call，body {"name": tool_name, "arguments": {...}}
    """

    def __init__(self) -> None:
        self.settings = get_settings()
        self.services: Dict[str, MCPServiceConfig] = {}
        self.tools_cache: Dict[str, List[ToolSummary]] = {}

    def _base_url(self, s: MCPServiceConfig) -> str:
        if s.sse_url.endswith("/sse"):
            return s.sse_url[: -len("/sse")]
        return s.sse_url.rstrip("/")

    def upsert_service(self, service: MCPServiceConfig) -> MCPServiceConfig:
        if not service.id:
            service.id = service.name.lower().replace(" ", "-")
        self.services[service.id] = service
        return service

    def list_services(self) -> List[MCPServiceConfig]:
        return list(self.services.values())

    async def _fetch_tools_for_service(
        self, client: httpx.AsyncClient, service: MCPServiceConfig
    ) -> List[ToolSummary]:
        base = self._base_url(service)
        url = f"{base}/tools"
        try:
            resp = await client.get(url, timeout=self.settings.mcp_timeout_ms / 1000)
            resp.raise_for_status()
            data = resp.json()
            raw_tools = data.get("tools") or []
            tools: List[ToolSummary] = []
            for tool in raw_tools:
                tools.append(
                    ToolSummary(
                        name=tool.get("name") or "",
                        service=service.id or service.name,
                        desc=tool.get("description"),
                        schema=tool.get("inputSchema") or tool.get("parameters"),
                    )
                )
            self.tools_cache[service.id] = tools
            return tools
        except Exception as exc:
            logger.warning("MCP list tools failed for %s: %s", service.name, exc)
            return self.tools_cache.get(service.id, []) or []

    async def list_tools(self) -> List[ToolSummary]:
        tools: List[ToolSummary] = []
        async with httpx.AsyncClient() as client:
            for service in self.services.values():
                tools.extend(await self._fetch_tools_for_service(client, service))
        return tools

    async def call_tool(self, tool_name: str, args: Dict[str, Any]) -> Any:
        service_id, name = self._split_tool_name(tool_name)
        service = self.services.get(service_id)
        if not service:
            raise ValueError(f"MCP service not found: {service_id}")

        base = self._base_url(service)
        url = f"{base}/tools/call"
        payload = {"name": name, "arguments": args}

        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(
                    url,
                    json=payload,
                    timeout=self.settings.mcp_timeout_ms / 1000,
                )
                resp.raise_for_status()
                return resp.json()
            except Exception as exc:
                logger.error("MCP call_tool failed (%s/%s): %s", service_id, name, exc)
                raise

    def _split_tool_name(self, tool_name: str) -> Tuple[str, str]:
        if "__" in tool_name:
            service_id, name = tool_name.split("__", 1)
            return service_id, name
        # fallback: no prefix
        return tool_name, tool_name


# Shared singleton for app-level usage
_adapter_singleton: Optional[MCPAdapter] = None


def get_mcp_adapter() -> MCPAdapter:
    global _adapter_singleton  # noqa: PLW0603
    if _adapter_singleton is None:
        _adapter_singleton = MCPAdapter()
    return _adapter_singleton
