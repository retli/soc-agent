"""Config endpoints: model + MCP metadata."""

from fastapi import APIRouter

from server.config import get_settings
from server.services.mcp_adapter import get_mcp_adapter

router = APIRouter()
mcp_adapter = get_mcp_adapter()


@router.get("")
async def get_config():
    settings = get_settings()
    tools = await mcp_adapter.list_tools()
    return {
        "model": settings.model,
        "services": mcp_adapter.list_services(),
        "tools": tools,
    }
