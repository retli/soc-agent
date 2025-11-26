// Application constants
export const STORAGE_KEYS = {
  AI_CONFIG: 'aiConfig',
  DIFY_CONFIG: 'difyConfig', // Legacy key for migration
  MCP_SERVICES: 'mcpServices',
  MCP_TOOLS_CACHE: 'mcpToolsCache', // 缓存的MCP工具列表
  MCP_TOOLS_ENABLED: 'mcpToolsEnabled', // 工具的启用状态 { 'serviceId:toolName': boolean }
  MCP_TOOLS_AUTO_EXECUTE: 'mcpToolsAutoExecute', // 工具的自动执行状态 { 'serviceId:toolName': boolean }
  CONVERSATIONS: 'conversations',
  DEV_MODE: 'devMode'
};

export const MESSAGE_ACTIONS = {
  TOGGLE_SIDEBAR: 'toggleSidebar',
  GET_SIDEBAR_STATE: 'getSidebarState'
};

export const MCP_METHODS = {
  INITIALIZE: 'initialize',
  TOOLS_LIST: 'tools/list',
  TOOLS_CALL: 'tools/call',
  NOTIFICATIONS_INITIALIZED: 'notifications/initialized'
};

export const MCP_EVENTS = {
  ENDPOINT: 'endpoint'
};


export const MESSAGE_ROLES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
  TOOL: 'tool'
};

export const UI_ELEMENTS = {
  SIDEBAR_ID: 'dify-chat-sidebar',
  LOADING_MESSAGE_ID: 'loadingMessage',
  RELOAD_NOTICE_ID: 'reloadNotice'
};

export const TIMEOUTS = {
  ERROR_MESSAGE: 5000,
  RELOAD_NOTICE: 3000,
  SUCCESS_MESSAGE: 3000
};
