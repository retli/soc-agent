"""LangGraph builder with a simple Echo tool placeholder."""

from typing import Any, Dict

from langchain_core.tools import tool
from langgraph.graph import StateGraph, END

from server.services.llm import build_llm


def _build_echo_tool():
    @tool
    def echo_tool(message: str) -> str:
        return f"echo: {message}"

    return echo_tool


def build_graph():
    llm = build_llm(streaming=True)
    echo = _build_echo_tool()

    # Minimal graph: model -> end
    workflow = StateGraph(dict)

    def call_model(state: Dict[str, Any]):
        # In real impl, use LLM with tools; here just echo user content
        last = state["messages"][-1]
        content = last.get("content") if isinstance(last, dict) else last
        return {"messages": state["messages"] + [{"role": "assistant", "content": f"echo: {content}"}]}

    workflow.add_node("model", call_model)
    workflow.set_entry_point("model")
    workflow.add_edge("model", END)

    graph = workflow.compile()
    return graph, {"echo": echo}
