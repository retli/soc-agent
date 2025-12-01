/**
 * 默认配置文件
 * Default Configuration File
 * 
 * 此文件包含应用的所有默认配置值
 * 用户可以通过设置页面修改这些值
 */

export const DEFAULT_CONFIG = {
  // AI API 配置
  api: {
    url: 'https://api.example.com/v1',  // API服务地址（示例值，需在设置中配置）
    key: '',  // API密钥（用户需要在设置页面填写）
    authorization: '',  // Authorization 认证参数（示例：ACCESSCODE XXXXX）
    model: 'gpt-4o-mini',  // 默认使用的AI模型名称（示例值，可在设置中修改）
    temperature: 0.7,  // 温度参数，控制回复的随机性（0-1，越高越随机）
    maxTokenLength: 1024,  // 最大token长度（OpenAI: max_tokens）
    topP: 1,  // 核采样参数（0-1，控制候选词的范围，OpenAI: top_p）
    stream: true  // 是否启用流式响应（打字机效果）
  },
  
  // 用户配置
  user: {
    idPrefix: 'user-'  // 用户ID前缀
  },
  
  // MCP (Model Context Protocol) 配置
  mcp: {
    timeout: 45000,  // MCP服务超时时间（毫秒），增加到45秒以应对慢速网络
    protocolVersion: '2024-01-01',  // MCP协议版本
    clientInfo: {
      name: 'chrome-extension',  // 客户端名称
      version: '1.0.0'  // 客户端版本
    }
  },
  
  // UI界面配置
  ui: {
    // 侧边栏外观配置
    sidebarWidth: 400,  // 侧边栏宽度（像素）- 可调整范围：300-800，建议：400
    animationDuration: 200,  // 动画持续时间（毫秒）- 侧边栏展开/收起动画时长
    
    // 消息样式配置
    messageFontSize: 12,  // 消息字体大小（像素）- 可调整范围：12-18，建议：14
    messageMaxWidth: 90,  // 消息卡片最大宽度（百分比）- 可调整范围：60-95，建议：85
    
    // 对话历史配置
    maxMessageHistory: 10,  // 最大消息历史记录数量 - 发送给AI的历史消息条数
    autoSaveDelay: 500,  // 自动保存延迟时间（毫秒）- 对话自动保存到本地的延迟
    
    // 流式响应配置
    streamChunkDelay: 10,  // 流式响应每个chunk的延迟时间（毫秒），用于打字机效果（0=无延迟，20=较慢）
    
    // MCP工具集成配置
    includeToolResults: true,  // 是否将MCP工具执行结果带入会话上下文（会增加Token消耗）
    maxToolResultLength: 2000,  // 工具结果最大长度（超过将截断），0表示不限制
    functionCallingMode: 'auto',  // Function Calling模式：'auto' | 'required' | 'none'
    maxToolCallsPerTurn: 5,  // 每轮对话最大工具调用次数（防止无限循环）
    
    // AI建议行动配置
    enableSuggestedActions: true,  // 是否启用AI建议行动功能（帮助扩展调查思路）
    autoSendSuggestions: false  // 点击建议后是否自动发送（false=仅填充，true=填充并发送）
  },
  
  // TheHive 集成配置
  thehive: {
    enabled: true,  // 是否启用 TheHive 集成
    apiUrl: 'http://127.0.0.1:9000',  // TheHive API URL（示例值）
    apiKey: '',  // TheHive API Key（用户需在设置中填写）
    organization: '',  // TheHive 组织名称（可选）
    autoDetect: true,  // 自动检测 TheHive 页面
    showLoadButton: true,  // 显示加载 Case 按钮
    autoLoadComments: false  // 自动加载 Comments（false=点击按钮后加载）
  }
};

// Development mode settings（开发模式配置）
export const DEV_CONFIG = {
  debug: true,  // 是否启用调试模式（显示详细日志）
  logLevel: 'debug', // 日志级别：'debug', 'info', 'warn', 'error'（debug显示最详细）
  mockApi: false,  // 是否使用模拟API（用于测试）
  apiTimeout: 60000  // API请求超时时间（毫秒）
};
