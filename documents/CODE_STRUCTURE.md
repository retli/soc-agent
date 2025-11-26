# 📦 Chrome Extension 代码结构说明

> 最后更新：2025-11-04

## 🎯 项目概述

AI SOC Chat Chrome扩展，支持OpenAI标准API、Function Calling、MCP服务集成和流式响应。

---

## 📂 目录结构

```
chrome_ext/
├── 📄 核心文件
│   ├── manifest.json          # Chrome扩展配置
│   ├── background.js          # 后台服务
│   ├── content.js             # 内容脚本（注入侧边栏）
│   ├── sidebar.html           # 侧边栏UI
│   ├── sidebar.js             # 侧边栏核心逻辑 ⭐
│   ├── sidebar.css            # 侧边栏样式
│   ├── options.html           # 设置页面UI
│   └── options.js             # 设置页面逻辑
│
├── 📁 src/
│   ├── config/                # 配置模块
│   │   ├── defaults.js        # 默认配置值
│   │   └── constants.js       # 常量定义
│   │
│   ├── services/              # 服务层
│   │   ├── ai-api.js          # AI API服务 ⭐
│   │   └── mcp-client.js      # MCP客户端
│   │
│   └── utils/                 # 工具函数
│       ├── storage.js         # Chrome Storage封装
│       ├── logger.js          # 日志工具
│       ├── text-formatter.js  # 文本格式化（Markdown）
│       ├── tool-parser.js     # 工具意图解析
│       └── function-call-adapter.js  # Function Calling适配器 ⭐
│
├── 📁 icons/                  # 扩展图标
├── 📁 test/                   # 测试脚本
└── 📄 文档
    ├── README.md              # 用户文档
    ├── DOCUMENTATION.md       # 详细文档
    └── CODE_STRUCTURE.md      # 本文件
```

---

## 🔧 核心模块详解

### 1️⃣ **sidebar.js** - 主应用逻辑 (1630行)

**模块分区：**

| 分区 | 名称 | 功能 | 关键方法 |
|------|------|------|---------|
| 1 | 初始化与配置 | 加载配置、初始化服务 | `init()`, `loadConfig()` |
| 2 | 会话管理 | 创建/切换对话 | `createNewConversation()`, `switchConversation()` |
| 3 | 消息渲染 | UI渲染、Markdown | `renderMessages()`, `appendMessage()` |
| 4 | 消息发送 | 双模式发送 | `sendMessage()`, `sendMessageWithFunctionCalling()` |
| 5 | 消息编辑 | 编辑历史消息 | `handleEditMessage()` |
| 6 | 流式响应 | SSE流解析 | `handleStreamResponse()` |
| 7 | 工具调用 | 工具执行与格式化 | `appendToolExecutionPrompt()`, `handleFunctionCalls()` |
| 8 | MCP集成 | 服务聚合 | `refreshMCPTools()`, `prepareFunctions()` |
| 9 | UI辅助 | 滚动、错误提示 | `scrollToBottom()`, `showError()` |

**关键流程：**

```javascript
// 消息发送流程
sendMessage() 
  → [Function Calling模式] sendMessageWithFunctionCalling()
      → prepareFunctions()           // 聚合MCP工具
      → aiService.sendMessage()      // 发送请求
      → handleStreamResponse()       // 处理流式响应
      → handleFunctionCalls()        // 处理工具调用
  
  → [Legacy模式] sendMessageLegacy()
      → getMCPContext()              // 获取工具上下文
      → aiService.sendMessage()
      → handleStreamResponse()
      → ToolParser.detectToolIntent() // 文本解析
```

---

### 2️⃣ **ai-api.js** - AI API服务 (359行)

**核心职责：**
- OpenAI标准格式API通信
- SSE流式响应解析
- Function Calling支持

**关键方法：**

```javascript
// 1. 发送请求
async sendMessage(messages, options)
  → 构建OpenAI格式请求体
  → {model, messages, temperature, stream, tools}
  → POST到API
  → 返回流式/非流式响应

// 2. 处理SSE流
async handleStreamResponse(response)
  → 按行分割: buffer.split('\n')
  → 去掉前缀: line.substring(6)  // "data: "
  → 解析JSON: JSON.parse(line)
  → 累积tool_calls: toolCallsMap[index]
  → yield content块

// 3. 构建消息
buildMessages(query, history, systemPrompt)
  → [系统提示, ...历史消息, 当前查询]
  → 可选包含工具结果
```

**API格式：**

```json
// 请求
{
  "model": "qwen3-235b-a22b",
  "messages": [
    {"role": "user", "content": "你好"}
  ],
  "temperature": 0.7,
  "stream": true,
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "...",
        "parameters": {...}
      }
    }
  ]
}

// SSE流式响应
data: {"choices":[{"delta":{"content":"你好"}}]}

data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{"}}]}}]}

data: [DONE]
```

---

### 3️⃣ **function-call-adapter.js** - Function Calling适配器 (199行)

**核心职责：**
- MCP工具格式 ↔ OpenAI Function格式转换
- 工具聚合与过滤

**关键方法：**

```javascript
// 1. 聚合多服务工具
static aggregateToolsFromServices(services, enabledMap)
  → 遍历所有MCP服务
  → 转换为Function格式
  → 应用启用状态过滤
  → 返回统一格式数组

// 2. 格式转换
static convertToolToFunction(mcpTool, serviceId)
  → {
      type: "function",
      function: {
        name: `${serviceId}__${toolName}`,
        description: "...",
        parameters: {...}
      }
    }

// 3. 提取工具调用
static extractToolCalls(response)
  → 解析tool_calls
  → 解析JSON参数
  → 返回规范化格式
```

---

### 4️⃣ **storage.js** - 存储管理 (150行)

**存储项：**

| Key | 内容 | 格式 |
|-----|------|------|
| `ai_config` | AI配置 | `{apiKey, apiUrl, model, ...}` |
| `mcp_services` | MCP服务列表 | `[{id, name, url, enabled}]` |
| `conversations` | 对话历史 | `[{id, title, messages: [...]}]` |
| `mcp_tools_cache` | 工具缓存 | `{serviceId: [tools]}` |
| `mcp_tools_enabled` | 工具启用状态 | `{"serviceId__toolName": true}` |
| `dev_mode` | 开发模式 | `{enabled, logLevel}` |

---

## 🔄 核心流程图

### 消息发送流程

```
用户输入
  ↓
检查配置
  ↓
添加用户消息到UI
  ↓
判断模式
  ├─ Function Calling模式
  │   ├─ 聚合MCP工具 → prepareFunctions()
  │   ├─ 构建messages + tools参数
  │   ├─ 发送API请求
  │   ├─ 解析SSE流式响应
  │   │   ├─ 按行分割
  │   │   ├─ 去除"data: "前缀
  │   │   ├─ 解析JSON
  │   │   ├─ yield content
  │   │   └─ 累积tool_calls
  │   ├─ 保存助手消息
  │   └─ 处理tool_calls
  │       ├─ 解析参数
  │       ├─ 显示工具提示
  │       └─ 执行工具
  │
  └─ Legacy模式
      ├─ 获取MCP上下文
      ├─ 构建system prompt
      ├─ 发送API请求
      ├─ 解析流式响应
      ├─ 保存助手消息
      └─ 文本解析工具意图
```

### Function Calling流程

```
AI返回tool_calls
  ↓
FunctionCallAdapter.extractToolCalls()
  ↓
显示工具执行提示
  ↓
用户确认/编辑参数
  ↓
executeToolFromIntent()
  ↓
路由到对应MCP服务
  ↓
MCPClient.callTool()
  ↓
获取结果
  ↓
formatAndDisplayToolResult()
  ↓
AI格式化结果
  ↓
显示友好回复
```

---

## 🎨 UI组件

### 侧边栏布局

```
┌──────────────────────────┐
│  🤖 AI助手         ⚙️ 新建 │ ← header
├──────────────────────────┤
│  📋 对话列表              │ ← dropdown
├──────────────────────────┤
│                          │
│  👤 用户消息              │
│  🤖 AI回复                │ ← messages
│     🔧 [工具调用提示]     │
│                          │
├──────────────────────────┤
│  [输入框]          [发送] │ ← input-section
└──────────────────────────┘
```

### Options页面布局

```
┌─────────────────────────────┐
│  AI API 配置                 │
│  ├─ API地址                  │
│  ├─ API Key                  │
│  ├─ 模型名称                 │
│  └─ [测试连接]               │
├─────────────────────────────┤
│  MCP 服务配置                │
│  ├─ 服务列表                 │
│  ├─ [+ 添加服务]             │
│  ├─ Function Calling开关     │
│  └─ 工具结果上下文开关        │
├─────────────────────────────┤
│  数据管理                    │
│  └─ [🗑️ 清空对话历史]        │
├─────────────────────────────┤
│  开发者选项                  │
│  ├─ 开发模式开关             │
│  └─ 日志级别                 │
└─────────────────────────────┘
```

---

## 🔐 数据流

### 配置加载流程

```
Chrome Extension启动
  ↓
sidebar.js init()
  ↓
StorageManager.getAIConfig()
  ↓
StorageManager.getMCPServices()
  ↓
StorageManager.getConversations()
  ↓
StorageManager.getMCPToolsCache()
  ↓
初始化AIAPIService
  ↓
渲染UI
```

### 对话保存流程

```
消息发送/接收
  ↓
conversation.messages.push({...})
  ↓
this.saveConversations()
  ↓
StorageManager.saveConversations([...])
  ↓
chrome.storage.local.set({...})
```

---

## 🐛 常见问题与修复

### 1. 流式响应最后一条消息丢失

**问题：** `handleStreamResponse` 添加消息到数组但未保存
**修复：** 添加 `this.saveConversations()` 调用

### 2. SSE流式解析失败

**问题：** 未处理 "data: " 前缀
**修复：** 按行分割，去除前缀后解析JSON

### 3. tool_calls参数不完整

**问题：** 未累积增量参数
**修复：** 使用 `toolCallsMap[index]` 逐字符累积

---

## 📝 开发规范

### 代码风格

```javascript
// 1. 使用ES6+ 语法
import { Module } from './path.js';
class MyClass { }
async/await

// 2. 日志规范
logger.info('[Module] Action description');
logger.debug('[Module] Detail:', data);
logger.error('[Module] Error:', error);

// 3. 注释规范
/**
 * 方法说明
 * @param {Type} name - 参数说明
 * @returns {Type} 返回值说明
 */

// 4. 错误处理
try {
  // 操作
} catch (error) {
  logger.error('[Module] Error:', error);
  this.showError('用户友好的错误信息');
}
```

### 模块分区

每个大文件都应该有清晰的分区注释：

```javascript
// ==================== N. 模块名称 ====================
```

---

## 🚀 扩展建议

### 1. 添加新功能

```javascript
// 1. 在对应模块分区添加方法
// 2. 在文件头部注释中更新功能清单
// 3. 添加日志记录
// 4. 更新本文档
```

### 2. 添加新的MCP服务

```javascript
// Options页面 → MCP服务配置 → 添加服务
// 刷新工具列表
// 启用/禁用工具
```

### 3. 调试技巧

```javascript
// 1. 开启开发模式
// 2. 设置日志级别为 Debug
// 3. 查看Console日志
// 4. 使用 window.aiChat 访问实例
```

---

## 📊 性能优化

### 已实现

- ✅ 工具缓存机制
- ✅ 历史消息数量限制
- ✅ 工具结果长度截断
- ✅ 增量流式渲染

### 待优化

- [ ] 虚拟滚动（大量消息）
- [ ] Web Worker处理大量数据
- [ ] IndexedDB替代chrome.storage

---

## 🔗 相关文档

- [README.md](./README.md) - 用户使用说明
- [DOCUMENTATION.md](./DOCUMENTATION.md) - 详细技术文档
- [OpenAI API Docs](https://platform.openai.com/docs/api-reference)
- [Chrome Extension Docs](https://developer.chrome.com/docs/extensions/)

---

**维护者：** AI SOC Chat Extension Team  
**最后更新：** 2025-11-04  
**版本：** 2.0.0
