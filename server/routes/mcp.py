"""MCP service management endpoints."""

from fastapi import APIRouter

from server.models import MCPServiceConfig
from server.services.mcp_adapter import get_mcp_adapter

router = APIRouter()
mcp_adapter = get_mcp_adapter()


@router.get("/services")
async def list_services():
    return {"services": mcp_adapter.list_services()}


@router.post("/services")
async def upsert_service(payload: MCPServiceConfig):
    svc = mcp_adapter.upsert_service(payload)
    return {"service": svc}
