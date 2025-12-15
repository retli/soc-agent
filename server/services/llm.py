"""LLM factory wrapping the company OpenAI-compatible endpoint."""

from typing import Optional

from langchain_openai import ChatOpenAI

from server.config import get_settings


def build_llm(temperature: float = 0.7, top_p: float = 1.0, streaming: bool = True) -> ChatOpenAI:
    settings = get_settings()
    headers = {"apikey": settings.api_key}
    if settings.authorization:
        headers["Authorization"] = settings.authorization

    return ChatOpenAI(
        base_url=str(settings.api_base),
        api_key=settings.api_key,
        model=settings.model,
        temperature=temperature,
        top_p=top_p,
        streaming=streaming,
        timeout=settings.request_timeout_ms / 1000,
        max_retries=2,
        default_headers=headers,
    )
