# 重构方案（LangChain + 后端化，保留 MCP，移除 RAG）

> 目标：保持现有 Chrome 扩展 UI/设置页，保留 MCP 服务器配置入口；将 LLM/工具编排迁移到阿里云单机后端（FastAPI + LangChain/LangGraph），复用 OpenAI 兼容模型与 MCP 工具，不重复造轮子。RAG 暂不纳入。

## 1. 整体架构
- 前端：MV3 侧边栏 + 设置页，保留「添加 MCP 服务器」入口。对话/工具事件改由后端 SSE 提供；可选“本地直连 MCP”作为调试兜底。
- 后端：FastAPI + LangChain/LangGraph（ReAct）统一编排 LLM 与 MCP 工具；提供 `/chat` + `/stream` + MCP 管理接口。
- 模型：公司网关（OpenAI 兼容，流式 + tool_calls），鉴权 header：`apikey` + `Authorization`。
- 流式：后端 SSE（或 WebSocket）推 token/tool/final/error，前端消费。
- 状态：初期内存/SQLite，后续可换 Redis（session 记忆）。

## 2. 后端目录模板（建议）
```
app/
  main.py              # FastAPI 入口，路由注册
  config.py            # 环境/鉴权配置（API_KEY、AUTHORIZATION、MODEL_NAME 等）
  models/              # Pydantic 请求/响应
  services/
    llm.py             # 自定义 ChatOpenAI 封装（headers: apikey + Authorization）
    mcp_adapter.py     # MCP 客户端：tools/list & tools/call，缓存工具
  graph/
    builder.py         # LangGraph ReAct 图（plan/act/observe），注册 MCP 工具
    callbacks.py       # AsyncIteratorCallbackHandler/事件队列 → SSE
  routes/
    chat.py            # POST /chat，GET /stream/{session_id}
    mcp.py             # GET/POST /mcp/services，刷新工具
    config.py          # GET /config（模型名、服务、工具列表）
```

## 3. API 契约（草案）
- `GET /config`
  - resp: `{model, services:[{id,name,enabled}], tools:[{name:"svc__tool", service:"svc", desc, schema}]}`
- `POST /mcp/services`
  - req: `{id?, name, sse_url, method:"GET|POST", enabled:true/false}`
  - resp: `{ok:true, service:{...}}`
- `POST /chat`
  - req: `{session_id?, messages:[{role,content,tool_calls?}], system_prompt?, enabled_tools?, function_call_mode?}`
  - resp: `{session_id}`
- `GET /stream/{session_id}` (SSE)
  - `event: token` data `{content}`
  - `event: tool` data `{service,name,args,status:"calling"|"result"|"error",result?}`
  - `event: final` data `{content,tool_calls?}`
  - `event: error` data `{message}`

## 4. LangChain / LangGraph 实现要点
- ReAct/Agent：优先用 LangGraph 官方模板（plan/act/observe）或 `create_react_agent`。
  - 文档：https://python.langchain.com/docs/concepts/agent
  - LangGraph 概念：https://python.langchain.com/docs/langgraph/
  - ReAct 示例：https://python.langchain.com/docs/concepts/agent#react
- 模型封装：基于 `ChatOpenAI` 或自定义 `BaseChatModel`，传入自定义 headers。
  - OpenAI 兼容客户端：https://python.langchain.com/docs/integrations/chat/openai
- 工具注册：使用 `@tool` / `StructuredTool.from_function`。
  - 工具文档：https://python.langchain.com/docs/concepts/tools
- 流式回调：`AsyncIteratorCallbackHandler` / LangGraph 事件流，写入异步队列供 SSE。
  - 流式回调示例：https://python.langchain.com/docs/expression_language/how_to/streaming

## 5. MCP 适配策略（后端）
- 复用现有 MCP 协议（SSE + JSON-RPC）。
- `tools/list`：拉取后缓存；转换为 LangChain Tool，命名 `service__tool`，schema 直映。
- `tools/call`：执行时转发到对应 MCP 服务，处理超时/错误，将结果推送为 `tool` 事件。
- 启用过滤：根据服务/工具启用状态组装给 LLM 的 tools 列表。
- 前端保留“测试 MCP 连接/刷新工具”入口，调用后端代理；可选“本地直连 MCP”开关作调试兜底。

## 6. 前端改造要点
- `ai-api.js`：改为调用后端 `/chat` + `/stream`；复用现有 SSE 解析（事件名对齐上面）。
- MCP 设置页：入口保留，提交改调 `/mcp/services`；工具展示用 `/config` 返回的数据。
- 工具事件：来源于 SSE 的 `tool` 事件；主流程不再前端直接执行工具（可保留“本地直连 MCP”开关）。
- `function-call-adapter`：主要逻辑下沉后端；前端仅展示工具事件/结果。
- `storage.js`：保留 UI 配置/草稿；会话与工具状态后端存储。

## 7. 迁移阶段计划
1) 后端 P0：FastAPI + LangGraph ReAct 原型 + Echo 工具，SSE 推 token/tool/final。
2) 接公司模型：自定义 ChatOpenAI headers（apikey + Authorization），验证流式 + tool_calls。
3) MCPAdapter：接入 1 个 MCP 服务，跑通 tools/list & tools/call，注册为 LangChain Tool。
4) 前端切换后端接口；保留 MCP 配置入口；SSE 渲染 token/tool。
5) 多 MCP 聚合、启用过滤、健康检查；错误/超时/重试；可选“本地直连 MCP”模式。
6) 部署：ECS + Docker + Nginx/SSL，鉴权（前端 Bearer → 后端校验）、速率限制、日志/超时熔断/重连。

## 8. 风险与对策
- MV3 生命周期：SSE 连接放在 iframe/内容脚本，不放 Service Worker。
- MCP 稳定性：需要超时、重试、缓存失效策略；结果长度截断（前后端皆可）。
- 无 RAG：回答依赖模型上下文与 MCP 工具结果，需控制 prompt 与工具输出长度。
- 函数计算/WebSocket 兼容性：当前以 ECS 为主；若改函数计算，需确认 SSE/WebSocket 支持。

## 9. 环境与部署建议
- Python ≥ 3.10；锁定 `langchain-core`, `langchain-community`, `langgraph`, `fastapi`, `uvicorn`.
- Dockerfile + Nginx 反代/SSL；env 注入 API_KEY/Authorization/BASE_URL/MODEL_NAME。
- 观察指标：请求耗时、SSE 断开率、MCP 调用成功率、超时率。

## 10. 下一步可交付
- 后端骨架代码（目录如上）+ ChatOpenAI 自定义封装示例。
- 前端接口对接示例（`/chat` + `/stream`）与事件解析映射。
- MCPAdapter 示例（tools/list 转 Tool，tools/call 代理）。
