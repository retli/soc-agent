"""
FastAPI entrypoint for LangChain/LangGraph backend.

Exposes:
- POST /chat    : start a chat session/turn
- GET /stream/* : SSE stream for tokens/tool events
- GET /config   : model + MCP services/tools metadata
- POST /mcp/services : manage MCP services
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from server.routes import chat as chat_routes
from server.routes import mcp as mcp_routes
from server.routes import config as config_routes


def create_app() -> FastAPI:
    app = FastAPI(title="soc-agent-backend", version="0.1.0")

    # Allow extension pages and local dev
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(chat_routes.router, prefix="/chat", tags=["chat"])
    app.include_router(mcp_routes.router, prefix="/mcp", tags=["mcp"])
    app.include_router(config_routes.router, prefix="/config", tags=["config"])

    return app


app = create_app()


@app.get("/health")
async def health() -> dict:
    return {"ok": True}
