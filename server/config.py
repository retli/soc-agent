"""Configuration and environment loading."""

from functools import lru_cache
from typing import Optional

from pydantic import BaseSettings, Field, HttpUrl


class Settings(BaseSettings):
    api_base: HttpUrl = Field(..., env="API_BASE")
    api_key: str = Field(..., env="API_KEY")
    authorization: Optional[str] = Field(None, env="AUTHORIZATION")
    model: str = Field(..., env="MODEL_NAME")

    # Server
    host: str = Field("0.0.0.0", env="HOST")
    port: int = Field(8000, env="PORT")

    # Timeouts
    request_timeout_ms: int = Field(60000, env="REQUEST_TIMEOUT_MS")
    stream_timeout_ms: int = Field(60000, env="STREAM_TIMEOUT_MS")

    # MCP
    mcp_timeout_ms: int = Field(45000, env="MCP_TIMEOUT_MS")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
