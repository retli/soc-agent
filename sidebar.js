/**
 * AI SOC Chat Sidebar - Main Application Logic
 * 
 * 📦 功能模块：
 * 1. 初始化与配置 - Initialization & Configuration
 *    - 配置加载、开发模式、会话初始化
 * 
 * 2. 会话管理 - Conversation Management
 *    - 创建/切换对话、历史记录
 * 
 * 3. 消息渲染 - Message Rendering
 *    - UI渲染、Markdown格式化、工具调用记录
 * 
 * 4. 消息发送 - Message Sending
 *    - Function Calling模式、AI原生工具调用
 * 
 * 5. 消息编辑 - Message Editing
 *    - 编辑历史消息、重新发送
 * 
 * 6. 流式响应处理 - Streaming Response
 *    - SSE流解析、打字机效果、tool_calls累积
 * 
 * 7. 工具调用与执行 - Tool Calling & Execution
 *    - 工具提示、参数编辑、结果格式化、Function Calling处理
 * 
 * 8. MCP服务集成 - MCP Service Integration
 *    - 工具刷新、缓存管理、服务聚合
 * 
 * 9. UI辅助 - UI Helpers
 *    - 滚动控制、错误提示
 * 
 * 🔧 核心特性：
 * - ✅ OpenAI标准API格式支持
 * - ✅ Function Calling原生工具调用
 * - ✅ SSE流式响应解析
 * - ✅ MCP多服务聚合
 * - ✅ 对话历史持久化
 * - ✅ 工具结果上下文管理
 */

import { StorageManager } from './src/utils/storage.js';
import { MCPClient } from './src/services/mcp-client.js';
import { AIAPIService } from './src/services/ai-api.js';
import { TextFormatter } from './src/utils/text-formatter.js';
import { FunctionCallAdapter } from './src/utils/function-call-adapter.js';
import { logger } from './src/utils/logger.js';
import { MESSAGE_ROLES, TIMEOUTS, UI_ELEMENTS } from './src/config/constants.js';
import { DEFAULT_CONFIG } from './src/config/defaults.js';
import { TheHiveIntegration } from './src/services/thehive-integration.js';
import { URLMatcher } from './src/utils/url-matcher.js';

const DEFAULT_SECURITY_PROMPTS = [
  '如何隔离受感染主机并保留取证证据？',
  '有没有可行的办法同时通知资产Owner与值班团队？',
  '帮我梳理本事件需要重点监控的日志与告警指标？'
];

class AIChat {
  constructor() {
    this.conversations = [];
    this.currentConversationId = null;
    this.config = null;
    this.mcpServices = [];
    this.mcpToolsCache = {};  // 从storage加载的工具缓存
    this.toolsEnabled = {};  // 工具的启用状态
    this.toolsAutoExecute = {};  // 工具的自动执行状态
    this.cachedMCPTools = null;  // 用于AI的MCP上下文字符串
    this.aiService = null;
    this.pendingManualTools = {};  // 待执行的手动工具 { batchId: { tools: [], results: [], originalQuery: '' } }
    this.thehiveIntegration = null;  // TheHive 集成实例
    this.toolResultsCache = {};  // 🔧 工具结果缓存 { conversationId: [{ toolName, result, error, args, serviceName, timestamp, toolCallId }] }
    this.reActState = {
      active: false,
      iteration: 0,
      lastContent: '',
      noticeShown: false
    };
    
    this.init();
  }

  // ==================== 1. 初始化与配置 ====================
  
  async init() {
    try {
      // Load configuration and dev mode
      await this.loadConfig();
      await this.loadDevMode();
      await this.loadConversations();
      
      // 🔧 修复：初始化时重置建议行动面板为初始状态
      this.resetSuggestedActions();
      
      // Apply UI configuration
      this.applyUIConfig();
      
      // Initialize AI service
      this.aiService = new AIAPIService(this.config);
      
      // Initialize TheHive integration
      this.initTheHive();
      
      // Setup event listeners
      this.setupEventListeners();
      
      // 注意：TheHive 按钮现在在页面上，不需要在这里检查
      
      // Create initial conversation if none exists
      if (this.conversations.length === 0) {
        this.createNewConversation();
      } else {
        this.switchConversation(this.conversations[0].id);
      }
    } catch (error) {
      if (error.message.includes('Extension context invalidated')) {
        logger.error('[Init] Extension context invalidated');
        this.showReloadNotice();
        this.useDefaultConfig();
      } else {
        logger.error('[Init] Initialization failed:', error);
      }
    }
  }
  
  /**
   * 应用 UI 配置到页面样式
   */
  applyUIConfig() {
    const fontSize = DEFAULT_CONFIG.ui.messageFontSize || 14;
    const maxWidth = DEFAULT_CONFIG.ui.messageMaxWidth || 85;
    
    logger.debug('[UI] Applying UI config - fontSize:', fontSize, 'maxWidth:', maxWidth);
    
    // 创建样式元素
    const styleId = 'custom-ui-styles';
    let styleElement = document.getElementById(styleId);
    
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = styleId;
      document.head.appendChild(styleElement);
    }
    
    // 设置自定义样式 - 覆盖所有可能的元素
    styleElement.textContent = `
      /* 消息容器 */
      .message-content {
        font-size: ${fontSize}px !important;
      }
      
      /* 消息内的所有文本元素 */
      .message-content p,
      .message-content div,
      .message-content span,
      .message-content li,
      .message-content ul,
      .message-content ol,
      .message-content blockquote,
      .message-content h1,
      .message-content h2,
      .message-content h3,
      .message-content h4,
      .message-content h5,
      .message-content h6 {
        font-size: ${fontSize}px !important;
      }
      
      /* 代码块使用稍小的字体 */
      .message-content code,
      .message-content pre {
        font-size: ${fontSize - 1}px !important;
      }
      
      /* 工具调用记录内容 */
      .tool-record-content,
      .tool-result-content {
        font-size: ${fontSize - 2}px !important;
      }
      
      /* 消息卡片最大宽度 */
      .message {
        max-width: ${maxWidth}% !important;
      }
      
      /* 输入框 */
      #messageInput {
        font-size: ${fontSize}px !important;
      }
    `;
  }

  useDefaultConfig() {
    this.config = {
      apiKey: '',
      apiUrl: DEFAULT_CONFIG.api.url,
      model: DEFAULT_CONFIG.api.model,
      user: DEFAULT_CONFIG.user.idPrefix + Date.now()
    };
    this.conversations = [];
    this.setupEventListeners();
    this.createNewConversation();
  }
  
  async loadConfig() {
    this.config = await StorageManager.getAIConfig();
    this.mcpServices = await StorageManager.getMCPServices();
    // 加载缓存的MCP工具列表
    this.mcpToolsCache = await StorageManager.getMCPToolsCache();
    // 加载工具启用状态
    this.toolsEnabled = await StorageManager.getMCPToolsEnabled();
    // 加载工具自动执行状态
    this.toolsAutoExecute = await StorageManager.getMCPToolsAutoExecute();
    
    // 清理已删除服务的缓存
    await this.cleanupDeletedServiceCache();
  }
  
  async cleanupDeletedServiceCache() {
    const validServiceIds = new Set(this.mcpServices.map(s => s.id));
    let cleaned = false;
    
    // 查找所有缓存的服务ID
    const cachedIds = Object.keys(this.mcpToolsCache).filter(k => !k.endsWith('_time'));
    
    for (const cachedId of cachedIds) {
      if (!validServiceIds.has(cachedId)) {
        // 删除已不存在的服务缓存
        logger.info(`[MCP] Cleaning up cache for deleted service: ${cachedId}`);
        delete this.mcpToolsCache[cachedId];
        delete this.mcpToolsCache[cachedId + '_time'];
        cleaned = true;
      }
    }
    
    // 如果有清理，更新storage
    if (cleaned) {
      await StorageManager.saveMCPToolsCache(this.mcpToolsCache);
      logger.info('[MCP] Cache cleanup completed');
    }
  }

  async loadDevMode() {
    const devMode = await StorageManager.getDevMode();
    logger.setDevMode(devMode.enabled);
    logger.setLogLevel(devMode.logLevel);
  }
  
  async loadConversations() {
    this.conversations = await StorageManager.getConversations();
    this.conversations.forEach(conv => {
      if (!conv.metadata || typeof conv.metadata !== 'object') {
        conv.metadata = {};
      }
    });
    logger.info('[Init] Loaded conversations:', this.conversations.length);
    this.conversations.forEach((conv, idx) => {
      logger.debug(`[Init] Conversation ${idx}: ID=${conv.id}, Messages=${conv.messages.length}, Title=${conv.title}`);
    });
  }
  
  async saveConversations() {
    const success = await StorageManager.saveConversations(this.conversations);
    if (!success) {
      this.showReloadNotice();
    }
  }
  
  showReloadNotice() {
    if (document.getElementById(UI_ELEMENTS.RELOAD_NOTICE_ID)) return;
    
    const notice = document.createElement('div');
    notice.id = UI_ELEMENTS.RELOAD_NOTICE_ID;
    notice.style.cssText = `
      position: fixed; top: 10px; right: 10px;
      background: #fef3c7; border: 2px solid #f59e0b;
      border-radius: 8px; padding: 12px 16px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000; max-width: 300px;
      font-size: 13px; color: #92400e;
    `;
    notice.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 20px;">⚠️</span>
        <div>
          <div style="font-weight: 600; margin-bottom: 4px;">扩展已更新</div>
          <div style="font-size: 12px;">请关闭并重新打开此窗口</div>
        </div>
        <button onclick="this.parentElement.parentElement.remove()" style="
          margin-left: auto; background: none; border: none;
          font-size: 18px; cursor: pointer; color: #92400e;
        ">×</button>
      </div>
    `;
    document.body.appendChild(notice);
  }

  // ==================== 2. 会话管理 ====================
  
  setupEventListeners() {
    document.getElementById('newChatBtn').addEventListener('click', async () => {
      await this.createNewConversation();
      this.closeHistoryDropdown();
    });
    
    document.getElementById('historyBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleHistoryDropdown();
    });
    
    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('conversationDropdown');
      const historyBtn = document.getElementById('historyBtn');
      
      if (!dropdown.contains(e.target) && e.target !== historyBtn && !historyBtn.contains(e.target)) {
        this.closeHistoryDropdown();
      }
    });
    
    document.getElementById('settingsBtn').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    
    // 退出按钮 - 关闭侧边栏
    document.getElementById('exitBtn').addEventListener('click', () => {
      // 发送消息给父窗口（content.js）来关闭侧边栏
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ action: 'closeSidebar' }, '*');
      }
    });
    
    // TheHive 加载按钮（已移到页面悬浮按钮，这里不再需要）
    // document.getElementById('loadTheHiveBtn')?.addEventListener('click', () => {
    //   this.loadTheHiveCase();
    // });
    
    document.getElementById('sendBtn').addEventListener('click', () => {
      this.sendMessage();
    });
    
    document.getElementById('messageInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    
    document.getElementById('messageInput').addEventListener('input', (e) => {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
    });
    
    // 建议面板折叠/展开
    const toggleBtn = document.getElementById('toggleSuggestions');
    const suggestionsHeader = document.querySelector('.suggestions-header');
    const suggestionsContent = document.getElementById('suggestedActionsContent');
    
    if (toggleBtn && suggestionsHeader && suggestionsContent) {
      const toggleSuggestions = () => {
        const isCollapsed = suggestionsContent.classList.contains('collapsed');
        
        if (isCollapsed) {
          suggestionsContent.classList.remove('collapsed');
          toggleBtn.classList.remove('collapsed');
          toggleBtn.textContent = '︿';
        } else {
          suggestionsContent.classList.add('collapsed');
          toggleBtn.classList.add('collapsed');
          toggleBtn.textContent = '﹀';
        }
        
        logger.info('[SuggestedActions] Panel', isCollapsed ? 'expanded' : 'collapsed');
      };
      
      suggestionsHeader.addEventListener('click', toggleSuggestions);
    }
    
    // 监听页面可见性变化，当用户从其他页面返回时刷新配置
    document.addEventListener('visibilitychange', async () => {
      if (!document.hidden) {
        logger.debug('[Sidebar] Page visible, reloading config');
        await this.loadConfig();
        // 清空缓存的MCP工具，下次发送消息时会重新获取
        this.cachedMCPTools = null;
      }
    });
  }
  
  toggleHistoryDropdown() {
    document.getElementById('conversationDropdown').classList.toggle('show');
  }
  
  closeHistoryDropdown() {
    document.getElementById('conversationDropdown').classList.remove('show');
  }
  
  async createNewConversation() {
    const conversation = {
      id: 'conv-' + Date.now(),
      title: '新对话',
      messages: [],
      conversationId: null,
      createdAt: new Date().toISOString(),
      metadata: {}
    };
    
    this.conversations.unshift(conversation);
    this.saveConversations();
    
    // 🔧 初始化工具结果缓存
    this.toolResultsCache[conversation.id] = [];
    logger.info('[Cache] Initialized tool results cache for conversation:', conversation.id);
    
    this.switchConversation(conversation.id);
    this.renderConversationList();
    
    // 🔧 修复：重置建议行动面板为初始状态
    this.resetSuggestedActions();
    
    logger.info('[MCP] New conversation created, refreshing tools');
    await this.refreshMCPTools();
  }
  
  switchConversation(conversationId) {
    this.currentConversationId = conversationId;
    const conversation = this.getCurrentConversation();
    logger.info('[Switch] Switching to conversation:', conversationId);
    if (conversation) {
      logger.info('[Switch] Conversation has', conversation.messages.length, 'messages');
    } else {
      logger.warn('[Switch] Conversation not found:', conversationId);
    }
    
    // 🔧 确保工具结果缓存存在（如果不存在则初始化）
    if (!this.toolResultsCache[conversationId]) {
      this.toolResultsCache[conversationId] = [];
      logger.info('[Cache] Initialized tool results cache for switched conversation:', conversationId);
    } else {
      logger.info('[Cache] Cache exists for conversation:', conversationId, 'with', this.toolResultsCache[conversationId].length, 'results');
    }
    
    this.renderMessages();
    this.renderConversationList();
    this.closeHistoryDropdown();
    
    // 🔧 修复：切换对话时重置建议行动面板为初始状态
    this.resetSuggestedActions();
  }
  
  getCurrentConversation() {
    return this.conversations.find(c => c.id === this.currentConversationId);
  }

  ensureConversationMetadata(conversation) {
    if (!conversation) return;
    if (!conversation.metadata || typeof conversation.metadata !== 'object') {
      conversation.metadata = {};
    }
  }

  getConversationOwnerEmails(conversation) {
    if (!conversation) return [];
    this.ensureConversationMetadata(conversation);
    const emails = conversation.metadata.ownerEmails;
    return Array.isArray(emails) ? emails : [];
  }

  extractOwnerEmails(text = '') {
    if (!text) {
      return { ownerEmails: [], allEmails: [] };
    }
    const emailRegex = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
    const allEmails = [...new Set(text.match(emailRegex) || [])];
    const ownerRegex = /(?:owner|资产负责人|负责人|所有者)[^@\n]{0,40}?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi;
    const ownerMatches = [];
    let match;
    while ((match = ownerRegex.exec(text)) !== null) {
      ownerMatches.push(match[1]);
    }
    const ownerEmails = [...new Set(ownerMatches)];
    return { ownerEmails, allEmails };
  }

  detectAndStoreOwnerEmails(source) {
    let parsed;
    if (Array.isArray(source)) {
      parsed = { ownerEmails: source };
    } else {
      parsed = this.extractOwnerEmails(source);
    }
    const ownerEmails = parsed.ownerEmails || [];
    if (!ownerEmails.length) return;
    const conversation = this.getCurrentConversation();
    if (!conversation) return;
    this.ensureConversationMetadata(conversation);
    const existing = new Set((conversation.metadata.ownerEmails || []).map(email => email.toLowerCase()));
    let updated = false;
    ownerEmails.forEach(email => {
      const lower = email.toLowerCase();
      if (!existing.has(lower)) {
        existing.add(lower);
        updated = true;
      }
    });
    if (updated) {
      conversation.metadata.ownerEmails = Array.from(existing);
      conversation.metadata.ownerEmailUpdatedAt = new Date().toISOString();
      this.saveConversations();
      logger.info('[OwnerEmail] Detected owner emails:', conversation.metadata.ownerEmails);
    }
  }

  getConversationHistoryWithContext(conversation, overrideHistory = null) {
    if (!conversation) {
      return overrideHistory || [];
    }
    this.ensureConversationMetadata(conversation);
    const baseHistory = overrideHistory || (conversation.messages || []);
    const contextMessages = [];
    const thehiveComments = conversation.metadata?.thehiveComments;
    if (thehiveComments && thehiveComments.trim().length > 0) {
      contextMessages.push({
        role: MESSAGE_ROLES.SYSTEM,
        content: `[TheHive Comments]\n${thehiveComments}`
      });
    }
    return contextMessages.length > 0 ? [...contextMessages, ...baseHistory] : baseHistory;
  }

  // ==================== 3. 消息渲染 ====================
  
  renderConversationList() {
    const listEl = document.getElementById('conversationList');
    listEl.innerHTML = '';
    
    this.conversations.forEach(conv => {
      const item = document.createElement('div');
      item.className = 'conversation-item' + (conv.id === this.currentConversationId ? ' active' : '');
      item.innerHTML = `
        <div class="conversation-title">${TextFormatter.escapeHtml(conv.title)}</div>
        <div class="conversation-time">${TextFormatter.formatTime(conv.createdAt)}</div>
      `;
      item.addEventListener('click', () => this.switchConversation(conv.id));
      listEl.appendChild(item);
    });
  }
  
  renderMessages() {
    const messagesEl = document.getElementById('messages');
    const conversation = this.getCurrentConversation();
    
    if (!conversation) return;
    
    logger.debug('[Render] Rendering messages for conversation:', conversation.id);
    logger.debug('[Render] Message count:', conversation.messages.length);
    
    messagesEl.innerHTML = '';
    
    if (conversation.messages.length === 0) {
      messagesEl.innerHTML = `
        <div class="message assistant">
          <div class="message-content">你好！我是 AI 助手，有什么可以帮你的吗？</div>
        </div>
      `;
      return;
    }
    
    conversation.messages.forEach(msg => {
      if (msg.role === MESSAGE_ROLES.TOOL) {
        this.renderToolCallRecord(msg);
      } else {
        this.appendMessage(msg.role, msg.content, false);
      }
    });
    
    this.scrollToBottom();
  }
  
  appendMessage(role, content, shouldSave = true) {
    const messagesEl = document.getElementById('messages');
    
    let displayContent = content;
    if (role === MESSAGE_ROLES.ASSISTANT) {
      displayContent = TextFormatter.removeToolMarkers(content);
      
      if (!displayContent) {
        if (shouldSave) {
          const conversation = this.getCurrentConversation();
          if (conversation) {
            conversation.messages.push({ role, content, timestamp: new Date().toISOString() });
            this.saveConversations();
          }
        }
        return;
      }
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    // For assistant messages, render Markdown; for user messages, escape HTML
    const formattedContent = role === MESSAGE_ROLES.ASSISTANT 
      ? TextFormatter.markdownToHtml(displayContent)
      : TextFormatter.escapeHtml(displayContent);
    
    // 为用户消息添加编辑按钮
    const editButton = role === MESSAGE_ROLES.USER 
      ? `<button class="message-edit-btn" title="编辑并重新发送">✏️</button>`
      : '';
    
    messageDiv.innerHTML = `
      <div class="message-content">${formattedContent}</div>
      ${editButton}
    `;
    
    // 为用户消息添加编辑功能
    if (role === MESSAGE_ROLES.USER) {
      const editBtn = messageDiv.querySelector('.message-edit-btn');
      editBtn.addEventListener('click', () => {
        this.handleEditMessage(messageDiv, content);
      });
    }
    
    messagesEl.appendChild(messageDiv);
    this.scrollToBottom();
    
    if (shouldSave) {
      const conversation = this.getCurrentConversation();
      if (conversation) {
        conversation.messages.push({ role, content, timestamp: new Date().toISOString() });
        
        if (conversation.messages.length === 1 && role === MESSAGE_ROLES.USER) {
          conversation.title = TextFormatter.truncate(content);
          this.renderConversationList();
        }
        
        this.saveConversations();
        if (role === MESSAGE_ROLES.USER || role === MESSAGE_ROLES.ASSISTANT) {
          this.detectAndStoreOwnerEmails(content);
        }
      }
    }
  }
  
  renderToolCallRecord(toolMsg) {
    logger.debug('[Render] Rendering tool call record:', toolMsg);
    logger.debug('[Render] Tool result data:', toolMsg.result || toolMsg.content);
    
    const messagesEl = document.getElementById('messages');
    const recordDiv = document.createElement('div');
    const recordId = `tool-record-${toolMsg.timestamp || Date.now()}`;
    recordDiv.className = 'tool-call-record';
    recordDiv.id = recordId;
    
    // 直接在外层div上应用样式
    recordDiv.style.cssText = 'margin: 8px 0; animation: slideIn 0.3s ease-out;';
    
    logger.debug('[Render] Creating tool record with ID:', recordId);
    
    // 格式化参数显示 - 使用键值对形式而非JSON
    let argsHtml = '';
    if (Object.keys(toolMsg.args).length > 0) {
      argsHtml = '<div style="display: flex; flex-direction: column; gap: 6px;">';
      for (const [key, value] of Object.entries(toolMsg.args)) {
        const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
        argsHtml += `
          <div style="display: flex; align-items: center; gap: 6px;">
            <label style="font-size: 10px !important; font-weight: 600 !important; color: rgba(255, 255, 255, 0.9) !important; min-width: 80px; flex-shrink: 0;">${TextFormatter.escapeHtml(key)}:</label>
            <span style="font-family: 'Courier New', monospace; font-size: 10px !important; background: rgba(255, 255, 255, 0.95) !important; border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 4px; padding: 4px 8px; color: #1f2937 !important; flex: 1; word-break: break-all;">${TextFormatter.escapeHtml(valueStr)}</span>
          </div>
        `;
      }
      argsHtml += '</div>';
    } else {
      argsHtml = '<div style="font-size: 10px !important; color: rgba(255, 255, 255, 0.6) !important; font-style: italic; padding: 4px 0;">无参数</div>';
    }
    
    // 向后兼容：优先使用 result，如果不存在则使用 content（旧记录）
    const resultData = toolMsg.result || toolMsg.content;
    const resultPreview = resultData 
      ? (typeof resultData === 'string' ? resultData : JSON.stringify(resultData, null, 2))
      : '(无执行结果)';
    
    // 获取服务名称（如果存在）
    const serviceName = toolMsg.serviceName || '默认服务';
    
    // 使用与 appendToolExecutionPrompt 相同的紫色渐变样式，添加折叠按钮
    recordDiv.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important; border-radius: 8px !important; padding: 8px 10px !important; color: white !important; box-shadow: 0 2px 6px rgba(102, 126, 234, 0.2) !important;">
        <div style="display: flex !important; align-items: center !important; justify-content: space-between; margin-bottom: 6px !important;">
          <div style="display: flex !important; align-items: center !important; gap: 6px; flex: 1;">
            <span style="font-size: 14px !important;">🔧</span>
            <span style="font-size: 11px !important; font-weight: 500 !important; letter-spacing: 0.2px;"> 
              <strong style="font-family: 'Courier New', monospace !important; background: rgba(255, 255, 255, 0.2) !important; padding: 1px 4px !important; border-radius: 3px !important; font-weight: 600 !important; font-size: 10px !important; margin-left: 2px;">
                ${TextFormatter.escapeHtml(toolMsg.toolName)}
              </strong>
            </span>
            <span style="font-size: 9px !important; color: rgba(255, 255, 255, 0.8) !important; background: rgba(255, 255, 255, 0.15) !important; padding: 1px 5px !important; border-radius: 10px !important; margin-left: 6px; font-weight: 500 !important; letter-spacing: 0.2px;">
              [${TextFormatter.escapeHtml(serviceName)}]
            </span>
          </div>
          <button class="tool-record-toggle" style="background: rgba(255, 255, 255, 0.15) !important; border: none !important; color: white !important; cursor: pointer !important; padding: 2px 6px !important; border-radius: 4px !important; font-size: 10px !important; transition: all 0.2s ease; flex-shrink: 0;">
            <span style="display: inline-block; transition: transform 0.2s ease;">▼</span>
          </button>
        </div>
        <div class="tool-record-details" style="max-height: 0; overflow: hidden; opacity: 0; transition: max-height 0.3s ease, opacity 0.2s ease, margin 0.3s ease; margin: 0;">
          <div style="margin-top: 6px;">
            <div style="font-size: 9px !important; font-weight: 600 !important; color: rgba(255, 255, 255, 0.8) !important; text-transform: uppercase !important; letter-spacing: 0.5px; margin-bottom: 6px !important;">执行参数</div>
            <div style="padding: 0 0 8px 0;">
              ${argsHtml}
            </div>
          </div>
          <div>
            <div style="font-size: 9px !important; font-weight: 600 !important; color: rgba(255, 255, 255, 0.8) !important; text-transform: uppercase !important; letter-spacing: 0.5px; margin-bottom: 6px !important;">执行结果</div>
            <div style="background: rgba(255, 255, 255, 0.95) !important; border-radius: 5px !important; overflow: hidden !important; border: 1px solid rgba(255, 255, 255, 0.3) !important; border-left: 3px solid #10b981 !important;">
              <div style="padding: 4px 8px !important; font-weight: 600 !important; font-size: 9px !important; display: flex !important; align-items: center !important; gap: 4px; background-color: #d1fae5 !important; color: #065f46 !important;">✓ 执行成功</div>
              <pre style="color: #1f2937 !important; padding: 8px !important; margin: 0 !important; font-family: 'Courier New', monospace !important; font-size: 10px !important; line-height: 1.6 !important; white-space: pre-wrap !important; word-break: break-word !important; max-height: 300px !important; overflow-y: auto !important; background: #f9fafb !important; border-top: 1px solid rgba(0,0,0,0.05) !important;">${TextFormatter.escapeHtml(resultPreview)}</pre>
            </div>
          </div>
        </div>
      </div>
    `;
    
    messagesEl.appendChild(recordDiv);
    
    // 添加折叠/展开功能
    const toggleBtn = recordDiv.querySelector('.tool-record-toggle');
    const detailsDiv = recordDiv.querySelector('.tool-record-details');
    const toggleArrow = toggleBtn.querySelector('span');
    
    toggleBtn.addEventListener('click', () => {
      const isExpanded = detailsDiv.style.maxHeight && detailsDiv.style.maxHeight !== '0px';
      
      if (isExpanded) {
        // Collapse
        detailsDiv.style.maxHeight = '0';
        detailsDiv.style.opacity = '0';
        detailsDiv.style.margin = '0';
        toggleArrow.style.transform = 'rotate(0deg)';
      } else {
        // Expand
        detailsDiv.style.maxHeight = '800px';
        detailsDiv.style.opacity = '1';
        detailsDiv.style.marginTop = '6px';
        toggleArrow.style.transform = 'rotate(-180deg)';
      }
    });
  }
  
  appendToolExecutionPrompt(toolIntent, originalQuery, batchId = null, serviceId = null) {
    const messagesEl = document.getElementById('messages');
    const promptDiv = document.createElement('div');
    promptDiv.className = 'tool-execution-prompt';
    
    const { toolName, args } = toolIntent;
    const promptId = `tool-prompt-${Date.now()}`;
    promptDiv.id = promptId;
    
    // 保存批次ID和服务ID到元素属性
    if (batchId) {
      promptDiv.setAttribute('data-batch-id', batchId);
    }
    if (serviceId) {
      promptDiv.setAttribute('data-service-id', serviceId);
    }
    promptDiv.setAttribute('data-original-query', originalQuery || '');
    promptDiv.setAttribute('data-tool-name', toolName || '');
    
    // 根据工具名查找对应的MCP服务
    let serviceName = '默认服务';
    if (this.mcpServices && this.mcpServices.length > 0) {
      // 从缓存中查找拥有该工具的服务
      let targetService = null;
      for (const service of this.mcpServices) {
        if (!service.enabled) continue;
        
        if (this.mcpToolsCache[service.id]) {
          const tools = this.mcpToolsCache[service.id];
          const hasTool = tools.some(t => t.name === toolName);
          
          if (hasTool) {
            targetService = service;
            break;
          }
        }
      }
      
      // 如果找到了对应的服务，使用它；否则使用第一个启用的服务
      if (targetService) {
        serviceName = targetService.name;
      } else {
        const enabledService = this.mcpServices.find(s => s.enabled);
        if (enabledService) {
          serviceName = enabledService.name;
        }
      }
    }
    
    let argsInputsHtml = '';
    if (Object.keys(args).length > 0) {
      argsInputsHtml = '<div style="display: flex; flex-direction: column; gap: 6px;">';
      for (const [key, value] of Object.entries(args)) {
        const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
        argsInputsHtml += `
          <div style="display: flex; align-items: center; gap: 6px;">
            <label style="font-size: 10px; font-weight: 600; color: rgba(255, 255, 255, 0.9); min-width: 60px; flex-shrink: 0;">${TextFormatter.escapeHtml(key)}:</label>
            <input type="text" class="tool-arg-input" data-arg-name="${TextFormatter.escapeHtml(key)}" value="${TextFormatter.escapeHtml(valueStr)}" style="flex: 1; font-family: 'Courier New', monospace; font-size: 10px; background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 4px; padding: 4px 6px; color: #1f2937; transition: all 0.2s ease;" />
          </div>
        `;
      }
      argsInputsHtml += '</div>';
    } else {
      argsInputsHtml = '<div style="font-size: 10px; color: rgba(255, 255, 255, 0.6); font-style: italic; padding: 4px 0;">无参数</div>';
    }
    
    // 使用内联样式直接应用到元素上，不依赖外部CSS
    promptDiv.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; padding: 8px 10px; color: white; box-shadow: 0 2px 6px rgba(102, 126, 234, 0.2);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
          <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
            <span style="font-size: 14px;">🔧</span>
            <span style="font-size: 11px; font-weight: 500; letter-spacing: 0.2px;"> 
              <strong style="font-family: 'Courier New', monospace; background: rgba(255, 255, 255, 0.2); padding: 1px 4px; border-radius: 3px; font-weight: 600; font-size: 10px; margin-left: 2px;">
                ${TextFormatter.escapeHtml(toolName)}
              </strong>
            </span>
            <span style="font-size: 9px; color: rgba(255, 255, 255, 0.8); background: rgba(255, 255, 255, 0.15); padding: 1px 5px; border-radius: 10px; margin-left: 6px; font-weight: 500; letter-spacing: 0.2px;">
              [${TextFormatter.escapeHtml(serviceName)}]
            </span>
          </div>
          <button class="tool-prompt-toggle" style="background: rgba(255, 255, 255, 0.15); border: none; color: white; cursor: pointer; padding: 2px 6px; border-radius: 4px; font-size: 10px; transition: all 0.2s ease; flex-shrink: 0;">
            <span style="display: inline-block; transition: transform 0.2s ease;">▼</span>
          </button>
        </div>
        <div class="tool-prompt-details" style="max-height: 0; overflow: hidden; opacity: 0; transition: max-height 0.3s ease, opacity 0.2s ease, margin 0.3s ease; margin: 0;">
          <div style="margin-top: 6px;">
            <div style="font-size: 9px; font-weight: 600; color: rgba(255, 255, 255, 0.8); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">执行参数</div>
            ${argsInputsHtml}
          </div>
          <div class="tool-prompt-result" style="display: none;"></div>
        </div>
        <div style="display: flex; gap: 6px; margin-top: 0;">
          <button class="tool-prompt-btn tool-prompt-btn-execute" data-prompt-id="${promptId}" style="flex: 1; padding: 4px 10px; border: none; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 3px; transition: all 0.2s ease; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background-color: #10b981; color: white;">
            <span style="font-size: 11px;">▶</span> 执行
          </button>
          <button class="tool-prompt-btn tool-prompt-btn-cancel" data-prompt-id="${promptId}" style="flex: 1; padding: 4px 10px; border: none; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 3px; transition: all 0.2s ease; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background-color: rgba(255, 255, 255, 0.2); color: white; border: 1px solid rgba(255, 255, 255, 0.3);">
            <span style="font-size: 11px;">✕</span> 取消
          </button>
        </div>
      </div>
    `;
    
    messagesEl.appendChild(promptDiv);
    this.scrollToBottom();
    
    const toggleBtn = promptDiv.querySelector('.tool-prompt-toggle');
    const detailsDiv = promptDiv.querySelector('.tool-prompt-details');
    const toggleArrow = toggleBtn.querySelector('span');
    
    toggleBtn.addEventListener('click', () => {
      const isExpanded = detailsDiv.style.maxHeight && detailsDiv.style.maxHeight !== '0px';
      
      if (isExpanded) {
        // Collapse
        detailsDiv.style.maxHeight = '0';
        detailsDiv.style.opacity = '0';
        detailsDiv.style.margin = '0';
        toggleArrow.style.transform = 'rotate(0deg)';
      } else {
        // Expand
        detailsDiv.style.maxHeight = '800px';
        detailsDiv.style.opacity = '1';
        detailsDiv.style.marginBottom = '6px';
        toggleArrow.style.transform = 'rotate(-180deg)';
      }
    });
    
    const executeBtn = promptDiv.querySelector('.tool-prompt-btn-execute');
    const cancelBtn = promptDiv.querySelector('.tool-prompt-btn-cancel');
    
    executeBtn.addEventListener('click', async () => {
      await this.handleToolExecution(toolIntent, originalQuery, promptId);
    });
    
    cancelBtn.addEventListener('click', () => {
      this.handleToolCancellation(promptId);
    });
  }
  
  async handleToolExecution(toolIntent, originalQuery, promptId) {
    const promptDiv = document.getElementById(promptId);
    const executeBtn = promptDiv.querySelector('.tool-prompt-btn-execute');
    const cancelBtn = promptDiv.querySelector('.tool-prompt-btn-cancel');
    const resultDiv = promptDiv.querySelector('.tool-prompt-result');
    
    const argInputs = promptDiv.querySelectorAll('.tool-arg-input');
    const updatedArgs = {};
    argInputs.forEach(input => {
      const argName = input.getAttribute('data-arg-name');
      let value = input.value.trim();
      
      try {
        value = JSON.parse(value);
      } catch (e) {
        // Keep as string
      }
      
      updatedArgs[argName] = value;
    });
    
    const updatedToolIntent = {
      ...toolIntent,
      args: updatedArgs
    };
    
    logger.debug('[Tool] Executing with user-edited args:', updatedArgs);
    
    executeBtn.disabled = true;
    cancelBtn.disabled = true;
    argInputs.forEach(input => input.disabled = true);
    executeBtn.innerHTML = '<span class="btn-icon">⏳</span> 执行中...';
    
    try {
      logger.debug('[Tool] Starting tool execution:', updatedToolIntent);
      
      const result = await this.executeToolFromIntent(updatedToolIntent, originalQuery);
      
      // 执行完成后不自动展开，用户可以手动点击箭头查看详情
      
      resultDiv.style.display = 'block';
      resultDiv.innerHTML = `
        <div style="font-size: 9px; font-weight: 600; color: rgba(255, 255, 255, 0.8); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; margin-top: 8px;">执行结果</div>
        <div style="background: rgba(255, 255, 255, 0.95); border-radius: 5px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.3); border-left: 3px solid #10b981;">
          <div style="padding: 4px 8px; font-weight: 600; font-size: 9px; display: flex; align-items: center; gap: 4px; background-color: #d1fae5; color: #065f46;">✓ 执行成功</div>
          <pre style="color: #1f2937; padding: 8px; margin: 0; font-family: 'Courier New', monospace; font-size: 10px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; max-height: 300px; overflow-y: auto; background: #f9fafb; border-top: 1px solid rgba(0,0,0,0.05);">${TextFormatter.escapeHtml(result)}</pre>
        </div>
      `;
      
      executeBtn.innerHTML = '<span class="btn-icon">✓</span> 完成';
      executeBtn.style.backgroundColor = '#10b981';
      
      const conversation = this.getCurrentConversation();
      if (conversation) {
        // 从promptDiv获取serviceId
        const serviceId = promptDiv.getAttribute('data-service-id');
        let serviceName = '默认服务';
        
        if (serviceId && this.mcpServices) {
          const service = this.mcpServices.find(s => s.id === serviceId);
          if (service) {
            serviceName = service.name;
          }
        } else if (this.mcpServices && this.mcpServices.length > 0) {
          const enabledService = this.mcpServices.find(s => s.enabled);
          if (enabledService) {
            serviceName = enabledService.name;
          }
        }

        // 🔒 使用标准Function Calling格式保存工具结果
        const toolCallRecord = {
          role: MESSAGE_ROLES.TOOL,
          tool_call_id: updatedToolIntent.toolCallId || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,  // 关联tool_call_id
          name: updatedToolIntent.toolName,  // 工具名称
          content: typeof result === 'string' ? result : JSON.stringify(result),  // 工具结果内容
          // 保留额外信息用于UI显示
          toolName: updatedToolIntent.toolName,
          args: updatedToolIntent.args,  // 使用用户编辑后的参数
          result: result,
          serviceName: serviceName,
          timestamp: new Date().toISOString()
        };
        conversation.messages.push(toolCallRecord);
        this.saveConversations();
        
        // 🔧 将工具结果添加到缓存
        if (conversation && conversation.id) {
          this.addToolResultToCache(conversation.id, {
            toolName: updatedToolIntent.toolName,
            result: result,
            error: null,
            args: updatedToolIntent.args,
            serviceName: serviceName,
            timestamp: new Date().toISOString(),
            toolCallId: updatedToolIntent.toolCallId || toolCallRecord.tool_call_id
          });
        } else {
          logger.warn('[Tool] Cannot add to cache: conversation or conversation.id is missing');
        }
      }
      
      // 检查是否属于批量执行
      const batchId = promptDiv.getAttribute('data-batch-id');
      
      if (batchId && this.pendingManualTools[batchId]) {
        // 属于批量执行，收集结果
        logger.info('[ManualBatch] Tool completed in batch:', batchId, updatedToolIntent.toolName);
        
        const batch = this.pendingManualTools[batchId];
        batch.results.push({
          toolName: updatedToolIntent.toolName,
          args: updatedToolIntent.args,
          result: result,
          serviceName: conversation ? conversation.messages[conversation.messages.length - 1].serviceName : '默认服务'
        });
        
        // 更新进度显示
        const progressEl = document.getElementById(`batch-progress-${batchId}`);
        if (progressEl) {
          progressEl.textContent = `${batch.results.length}/${batch.totalCount}`;
        }
        
        // 检查是否所有工具都执行完了
        // 🔧 修复：检查批次是否已被取消，如果已取消则不继续处理
        if (batch.cancelled) {
          logger.info('[ManualBatch] Batch was cancelled by user, skipping comprehensive analysis');
          return;
        }
        
        if (batch.results.length === batch.totalCount) {
          logger.info('[ManualBatch] All tools in batch completed, sending for comprehensive analysis');
          
          // 🔧 修复：再次检查是否已被取消（防止竞态条件）
          if (batch.cancelled) {
            logger.info('[ManualBatch] Batch was cancelled during execution, skipping comprehensive analysis');
            return;
          }
          
          // 移除批量提示卡片（不再显示"所有工具已执行完成"）
          const batchTipCard = document.getElementById(`batch-tip-${batchId}`);
          if (batchTipCard) {
            batchTipCard.remove();
          }
          
          this.showLoading();
          try {
            await this.sendToolResultsToAI(batch.results, batch.originalQuery);
          } catch (sendError) {
            logger.error('[ManualBatch] Error sending tool results to AI:', sendError);
            this.showError('综合分析失败: ' + sendError.message);
          } finally {
            this.hideLoading();
            // 清理批次数据（无论成功或失败都要清理）
            if (this.pendingManualTools[batchId]) {
              delete this.pendingManualTools[batchId];
            }
          }
        } else {
          logger.info(`[ManualBatch] Waiting for more tools: ${batch.results.length}/${batch.totalCount}`);
        }
      } else {
        // 单独工具，立即分析
        this.showLoading();
        try {
          await this.formatAndDisplayToolResult(result, updatedToolIntent.toolName, originalQuery);
        } catch (formatError) {
          logger.error('[Tool] Error formatting tool result:', formatError);
          // 即使格式化失败，也不应该卡死，显示原始结果
          this.appendMessage(MESSAGE_ROLES.ASSISTANT, `[安全工具执行结果]\n${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}`);
          this.saveConversations();
        } finally {
          this.hideLoading();
        }
      }
      
    } catch (error) {
      logger.error('[Tool] Tool execution failed:', error);
      
      // 执行失败后不自动展开，用户可以手动点击箭头查看错误信息
      
      resultDiv.style.display = 'block';
      resultDiv.innerHTML = `
        <div style="font-size: 9px; font-weight: 600; color: rgba(255, 255, 255, 0.8); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; margin-top: 8px;">执行结果</div>
        <div style="background: rgba(255, 255, 255, 0.95); border-radius: 5px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.3); border-left: 3px solid #ef4444;">
          <div style="padding: 4px 8px; font-weight: 600; font-size: 9px; display: flex; align-items: center; gap: 4px; background-color: #fee2e2; color: #991b1b;">✗ 执行失败</div>
          <pre style="color: #1f2937; padding: 8px; margin: 0; font-family: 'Courier New', monospace; font-size: 10px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; max-height: 300px; overflow-y: auto; background: #f9fafb; border-top: 1px solid rgba(0,0,0,0.05);">${TextFormatter.escapeHtml(error.message)}</pre>
        </div>
      `;
      
      executeBtn.innerHTML = '<span class="btn-icon">✗</span> 失败';
      executeBtn.style.backgroundColor = '#ef4444';
      cancelBtn.disabled = false;
    }
  }
  
  async handleToolCancellation(promptId) {
    const promptDiv = document.getElementById(promptId);
    if (!promptDiv) {
      logger.warn('[ToolCancel] Prompt div not found:', promptId);
      return;
    }
    
    // 🔧 修复：防止重复取消
    if (promptDiv.hasAttribute('data-cancelled')) {
      logger.warn('[ToolCancel] Tool already cancelled:', promptId);
      return;
    }
    
    // 标记为已取消
    promptDiv.setAttribute('data-cancelled', 'true');
    promptDiv.style.opacity = '0.5';
    const executeBtn = promptDiv.querySelector('.tool-prompt-btn-execute');
    const cancelBtn = promptDiv.querySelector('.tool-prompt-btn-cancel');
    if (executeBtn) executeBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (executeBtn) executeBtn.innerHTML = '<span class="btn-icon">✕</span> 已取消';
    
    // 🔧 修复：用户取消工具执行后，基于已有信息给出结论
    const batchId = promptDiv.getAttribute('data-batch-id');
    const originalQuery = promptDiv.getAttribute('data-original-query') || '';
    
    logger.info('[ToolCancel] User cancelled tool execution, promptId:', promptId, 'batchId:', batchId);
    
    // 🔧 修复：添加防抖，避免快速点击导致重复处理
    if (this._cancellationProcessing) {
      logger.warn('[ToolCancel] Cancellation already processing, skipping...');
      return;
    }
    
    this._cancellationProcessing = true;
    
    try {
      // 检查是否属于批量执行
      if (batchId && this.pendingManualTools[batchId]) {
        const batch = this.pendingManualTools[batchId];
        
        // 🔧 修复：标记批次为已取消，防止其他工具执行完成后再次调用sendToolResultsToAI
        if (batch.cancelled) {
          logger.warn('[ToolCancel] Batch already cancelled:', batchId);
          return;
        }
        
        batch.cancelled = true;  // 标记批次为已取消
        
        // 标记该工具为已取消
        const toolName = promptDiv.getAttribute('data-tool-name') || 'unknown';
        logger.info('[ToolCancel] Tool cancelled in batch:', toolName);
        
        // 检查是否还有其他待执行的工具
        const remainingTools = batch.tools.filter(t => {
          // 检查是否已经有结果
          const hasResult = batch.results.some(r => r.toolName === t);
          return !hasResult;
        });
        
        logger.info('[ToolCancel] Remaining tools in batch:', remainingTools.length);
        
        // 🔧 修复：从缓存中获取所有工具结果（包括之前轮次的结果）
        const conversation = this.getCurrentConversation();
        if (!conversation) {
          logger.error('[ToolCancel] Conversation not found, cannot get tool results from cache');
          this.showError('对话不存在，无法获取工具结果');
          return;
        }
        
        let allToolResults = this.getToolResultsFromCache(conversation.id);
        
        logger.info('[ToolCancel] Total tool results from cache:', allToolResults.length, 'from batch:', batch.results.length);
        
        if (allToolResults.length > 0) {
          logger.info('[ToolCancel] User cancelled, but we have results. Generating conclusion based on existing data...');
          
          // 移除批量提示卡片
          const batchTipCard = document.getElementById(`batch-tip-${batchId}`);
          if (batchTipCard) {
            batchTipCard.remove();
          }
          
          // 🔧 修复：检查是否已经有loading状态，避免重复显示
          const isLoading = document.querySelector('.loading-indicator') !== null;
          if (!isLoading) {
            this.showLoading();
          }
          
          try {
            // 基于已有结果生成结论，明确说明用户取消了后续工具调用
            await this.sendToolResultsToAIWithCancellation(allToolResults, originalQuery, batchId);
          } catch (sendError) {
            logger.error('[ToolCancel] Error generating conclusion:', sendError);
            this.showError('生成结论失败: ' + sendError.message);
          } finally {
            if (!isLoading) {
              this.hideLoading();
            }
            // 🔧 修复：延迟清理批次数据，确保所有操作完成
            setTimeout(() => {
              if (this.pendingManualTools[batchId]) {
                delete this.pendingManualTools[batchId];
                logger.info('[ToolCancel] Batch data cleaned up:', batchId);
              }
            }, 1000);
          }
        } else {
          // 如果没有任何结果，说明用户取消了所有工具
          logger.info('[ToolCancel] User cancelled all tools, no results available');
          this.showError('已取消工具执行。如需继续分析，请重新提问。');
          
          // 🔧 修复：延迟清理批次数据
          setTimeout(() => {
            if (this.pendingManualTools[batchId]) {
              delete this.pendingManualTools[batchId];
              logger.info('[ToolCancel] Batch data cleaned up (no results):', batchId);
            }
          }, 500);
        }
      } else {
        // 单个工具取消，如果有其他已执行的工具结果，也基于已有信息给出结论
        logger.info('[ToolCancel] Single tool cancelled');
        
        // 🔧 修复：从缓存中获取所有工具结果
        const conversation = this.getCurrentConversation();
        if (conversation) {
          const toolResults = this.getToolResultsFromCache(conversation.id);
          
          if (toolResults.length > 0) {
            logger.info('[ToolCancel] Found', toolResults.length, 'tool results in cache, generating conclusion...');
            
            // 🔧 修复：检查是否已经有loading状态
            const isLoading = document.querySelector('.loading-indicator') !== null;
            if (!isLoading) {
              this.showLoading();
            }
            
            try {
              await this.sendToolResultsToAIWithCancellation(toolResults, originalQuery);
            } catch (sendError) {
              logger.error('[ToolCancel] Error generating conclusion:', sendError);
              this.showError('生成结论失败: ' + sendError.message);
            } finally {
              if (!isLoading) {
                this.hideLoading();
              }
            }
          }
        }
      }
    } finally {
      // 🔧 修复：清除处理标志
      setTimeout(() => {
        this._cancellationProcessing = false;
      }, 500);
    }
  }
  
  /**
   * Format and display tool result with AI (streaming)
   * 🔧 支持Function Calling和对话历史
   */
  async formatAndDisplayToolResult(result, toolName, originalQuery) {
    try {
      const conversation = this.getCurrentConversation();
      
      // 构建提示消息：让AI基于安全工具结果进行安全分析和回答
      // 🔒 SOC安全分析师视角：强调威胁分析、事件响应、数据准确性
      const formatPrompt = `[安全工具 ${toolName} 执行结果]\n${result}\n\n**安全分析要求：** 
1. 请基于以上安全工具执行结果，使用工具返回的实际威胁情报、日志数据或资产信息（不是占位符）来回答用户的安全问题
2. 如果结果是JSON格式，请解析并提取关键安全指标的实际值（威胁评分、置信度、时间戳、关联事件等）
3. **绝对不要**使用占位符（如[IP地址]、[威胁类型]、[资产名称]等）或模板变量，必须使用真实的安全数据
4. 如果工具返回的数据不完整或查询未找到结果，请明确说明，并建议是否需要调用其他工具补充调查
5. 基于实际数据给出专业的安全分析和响应建议`;
      
      // 🔧 使用对话历史构建消息，让AI看到完整上下文
      let systemPrompt = null;
      const options = {};
      
      // 准备Function Calling工具
      // 🔧 修复：确保functions总是数组，防止未定义错误
      const functions = await this.prepareFunctions() || [];
      if (functions.length > 0) {
        systemPrompt = this.buildSystemPromptForFunctionCalling();
        options.tools = FunctionCallAdapter.cleanFunctionsForAPI(functions);
        options.tool_choice = 'auto';  // 允许AI根据需要调用工具
        logger.debug('[Tool Format] Function Calling enabled with', functions.length, 'tools');
      }
      
      // 包含对话历史的消息
      const historyWithContext = this.getConversationHistoryWithContext(conversation);
      const messages = this.aiService.buildMessages(
        formatPrompt,
        historyWithContext,
        systemPrompt
      );
      
      logger.debug('[Tool Format] Sending', messages.length, 'messages to format result');
      
      const response = await this.aiService.sendMessage(messages, options);
      
      // 处理流式响应
      let fullContent = '';
      let toolCallsFromStream = null;
      if (response.stream) {
        // 🔧 修复：handleStreamResponse现在返回对象
        const streamResult = await this.handleStreamResponse(response);
        if (typeof streamResult === 'object' && streamResult !== null) {
          fullContent = streamResult.content || '';
          toolCallsFromStream = streamResult.tool_calls || null;
        } else {
          fullContent = streamResult || '';
        }
      } else {
        // 非流式响应
        if (response.content) {
          fullContent = response.content;
          this.appendMessage(MESSAGE_ROLES.ASSISTANT, response.content);
          this.saveConversations();
        }
      }
      
      // 🔧 修复：优先使用流式响应返回的tool_calls
      // 🔧 增强：传递递归深度，防止无限循环
      // 🔧 修复：确保toolCalls是数组，防止未定义错误
      const toolCalls = toolCallsFromStream || response.tool_calls;
      if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
        logger.info('[Tool Format] 🔁 ReAct循环：AI请求继续调用工具');
        // 🔧 修复：确保functions总是数组，防止未定义错误
        const functions = await this.prepareFunctions() || [];
        // 🔧 修复：确保异步操作完成，防止卡死
        try {
          // 🔧 修复：如果fullContent为空但有tool_calls，移除"无内容"消息，让工具调用正常进行
          if (!fullContent || fullContent.trim().length === 0) {
            logger.info('[Tool Format] Removing empty content message, proceeding with tool calls');
            const messagesEl = document.getElementById('messages');
            const lastMessage = messagesEl.lastElementChild;
            if (lastMessage && lastMessage.classList.contains('assistant')) {
              const contentDiv = lastMessage.querySelector('.message-content');
              if (contentDiv && (contentDiv.textContent.includes('无内容') || contentDiv.textContent.includes('未收到内容') || contentDiv.textContent.includes('流式响应完成'))) {
                lastMessage.remove();
                logger.info('[Tool Format] Removed empty content message');
              }
            }
          }
          await this.handleFunctionCalls(toolCalls, functions, originalQuery, 1);  // 从深度1开始
        } catch (toolCallError) {
          logger.error('[Tool Format] Error in additional tool calls:', toolCallError);
          // 即使工具调用失败，也不应该卡死，继续显示当前结果
        }
      } else {
        logger.debug('[Tool Format] ✅ AI已完成分析，没有请求更多工具调用');
        this.tryCompleteReActRun(fullContent || response.content || '');
        // 🔧 修复：确保UI已更新，滚动到底部
        this.scrollToBottom();
      }
      
      // 🔧 修复：确保最终UI状态正确
      this.scrollToBottom();
      logger.debug('[Tool Format] ✅ Tool result formatting completed');
      
      // 🔧 修复：强制UI更新，确保消息已显示（防止卡死）
      await new Promise(resolve => setTimeout(resolve, 100));
      this.scrollToBottom();
    } catch (error) {
      logger.error('[Tool] AI formatting failed, displaying raw result:', error);
      // 🔒 SOC安全场景：显示原始安全工具结果
      this.appendMessage(MESSAGE_ROLES.ASSISTANT, `[安全工具执行结果]\n${result}\n\n*注：AI格式化失败，显示原始工具结果*`);
      this.saveConversations();
    }
  }
  
  /**
   * Format tool result with AI (non-streaming, for backward compatibility)
   */
  // async formatToolResultWithAI(result, toolName, originalQuery) {
  //   try {
  //     const formatPrompt = `用户询问：${originalQuery}\n\n我执行了工具 ${toolName}，得到以下结果：\n\n${result}\n\n请用自然、友好的语言总结这个结果，并回答用户的问题。`;
      
  //     // 工具结果格式化使用非流式响应
  //     const response = await this.aiService.sendMessage([
  //       { role: MESSAGE_ROLES.USER, content: formatPrompt }
  //     ], { stream: false });
      
  //     return response.content || result;
  //   } catch (error) {
  //     logger.error('[Tool] AI formatting failed, returning raw result:', error);
  //     return `工具执行结果：\n${result}`;
  //   }
  // }
  
  showLoading() {
    const messagesEl = document.getElementById('messages');
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message assistant';
    loadingDiv.id = UI_ELEMENTS.LOADING_MESSAGE_ID;
    loadingDiv.innerHTML = `
      <div class="message-content">
        <div class="loading">
          <div class="loading-dot"></div>
          <div class="loading-dot"></div>
          <div class="loading-dot"></div>
        </div>
      </div>
    `;
    messagesEl.appendChild(loadingDiv);
    this.scrollToBottom();
  }
  
  hideLoading() {
    const loadingEl = document.getElementById(UI_ELEMENTS.LOADING_MESSAGE_ID);
    if (loadingEl) loadingEl.remove();
  }
  
  showError(message) {
    const messagesEl = document.getElementById('messages');
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    messagesEl.appendChild(errorDiv);
    this.scrollToBottom();
    
    setTimeout(() => errorDiv.remove(), TIMEOUTS.ERROR_MESSAGE);
  }

  // ==================== 4. 消息发送 ====================
  
  async sendMessage() {
    const input = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const message = input.value.trim();
    
    if (!message) return;
    
    if (!this.config.apiKey || !this.config.apiUrl) {
      this.showError('请先在设置中配置 AI API');
      return;
    }
    
    input.disabled = true;
    sendBtn.disabled = true;
    
    // 注意：不在这里添加用户消息，而是在 buildMessages 中统一处理
    // 避免重复添加到发送给API的消息列表中
    this.appendMessage(MESSAGE_ROLES.USER, message);
    input.value = '';
    input.style.height = 'auto';
    
    this.showLoading();
    
    try {
      // 使用Function Calling模式
      await this.sendMessageWithFunctionCalling(message);
    } catch (error) {
      this.hideLoading();
      this.showError('发送失败: ' + error.message);
      logger.error('[Send] Error:', error);
    } finally {
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }
  
  /**
   * 使用Function Calling发送消息（新模式）
   */
  async sendMessageWithFunctionCalling(message) {
    this.startReActRun();
    if (this.shouldUseToolDirectoryFlow()) {
      const handled = await this.sendMessageWithToolDirectoryFlow(message);
      if (handled) {
        return;
      }
      logger.info('[ToolPlanning] Directory flow unavailable, falling back to legacy Function Calling');
    }
    await this.sendMessageWithFunctionCallingLegacy(message);
  }

  /**
   * 目录式工具规划流程
   */
  async sendMessageWithToolDirectoryFlow(message) {
    const conversation = this.getCurrentConversation();
    
    if (!this.mcpServices || this.mcpServices.length === 0) {
      return false;
    }
    
    if (!this.mcpToolsCache || Object.keys(this.mcpToolsCache).length === 0) {
      await this.refreshMCPTools();
    }
    
    const summary = this.buildToolDirectorySummary();
    if (!summary || !summary.text) {
      return false;
    }
    
    try {
      const systemPrompt = this.buildToolPlanningPrompt(summary.text);
      const historyWithContext = this.getConversationHistoryWithContext(conversation);
      const planningMessages = this.aiService.buildMessages(
        message,
        historyWithContext,
        systemPrompt
      );
      
      const planningOptions = {
        stream: false
      };
      
      const planningResponse = await this.aiService.sendMessage(planningMessages, planningOptions);
      const planningContent = planningResponse?.content || '';
      const planningResult = this.parseToolPlanningResponse(planningContent);
      
      if (!planningResult || planningResult.needTool === false || !planningResult.tools) {
        // 视为最终回答
        const displayContent = planningContent || '(AI 没有返回内容)';
        this.appendMessage(MESSAGE_ROLES.ASSISTANT, displayContent);
        this.saveConversations();
        this.hideLoading();
        this.tryCompleteReActRun(displayContent);
        
        const suggestionContent = this.getReActFinalContent(displayContent);
        if (suggestionContent && this.config.enableSuggestedActions !== false && !this.isReActRunning()) {
          await this.generateSuggestedActions(suggestionContent, message);
        }
        return true;
      }
      
      // 构建模拟 tool_calls 并交给现有逻辑处理
      const syntheticToolCalls = this.buildSyntheticToolCalls(planningResult.tools);
      const functionDefinitions = this.buildFunctionDefinitionsForTools(
        planningResult.tools.map(tool => tool.name)
      );
      
      if (!syntheticToolCalls.length || !functionDefinitions.length) {
        logger.warn('[ToolPlanning] Failed to build synthetic tool calls, fallback to legacy flow');
        return false;
      }
      
      // 展示工具计划
      const planMessage = this.formatToolPlanningMessage(planningResult);
      if (planMessage) {
        this.appendMessage(MESSAGE_ROLES.ASSISTANT, planMessage);
        this.saveConversations();
      }
      
      await this.handleFunctionCalls(syntheticToolCalls, functionDefinitions, message, 0);
      this.hideLoading();
      return true;
    } catch (error) {
      logger.error('[ToolPlanning] Error during planning flow:', error);
      return false;
    }
  }

  /**
   * 兼容：原有的Function Calling流程
   */
  async sendMessageWithFunctionCallingLegacy(message) {
    const conversation = this.getCurrentConversation();
    
    // 调试：输出对话信息
    logger.info('[Send] Current conversation ID:', this.currentConversationId);
    logger.info('[Send] Conversation exists:', !!conversation);
    if (conversation) {
      logger.info('[Send] History message count:', conversation.messages.length);
      logger.debug('[Send] History messages:', conversation.messages);
    }
    
    // 1. 准备Function列表
    // 🔧 修复：确保functions总是数组，防止未定义错误
    const functions = await this.prepareFunctions() || [];
    logger.info('[Send] Prepared', functions.length, 'functions for AI');
    
    // 2. 构建消息
    let systemPrompt = null;
    if (functions.length > 0) {
      systemPrompt = this.buildSystemPromptForFunctionCalling();
    }
    
    const historyWithContext = this.getConversationHistoryWithContext(conversation);
    const messages = this.aiService.buildMessages(
      message,
      historyWithContext,
      systemPrompt
    );
    
    logger.info('[Send] Total messages to send (including history):', messages.length);
    
    // 3. 发送请求（包含functions）
    const options = {};
    
    // 只在有工具时才添加tools参数
    if (functions.length > 0) {
      options.tools = FunctionCallAdapter.cleanFunctionsForAPI(functions);
      options.tool_choice = DEFAULT_CONFIG.ui.functionCallingMode;
    }
    
    const response = await this.aiService.sendMessage(messages, options);
    
    // 🔧 修复：不要在这里立即隐藏loading，因为后面可能还有工具调用
    // loading状态应该在工具调用完成后才隐藏
    
    // 4. 处理响应
    let fullContent = '';
    let toolCallsFromStream = null;
    
    if (response.stream) {
      // 🔧 修复：handleStreamResponse现在返回对象，包含content和tool_calls
      const streamResult = await this.handleStreamResponse(response);
      if (typeof streamResult === 'object' && streamResult !== null) {
        fullContent = streamResult.content || '';
        toolCallsFromStream = streamResult.tool_calls || null;
      } else {
        // 向后兼容：如果返回的是字符串
        fullContent = streamResult || '';
      }
    } else if (response.content) {
      fullContent = response.content;
      this.appendMessage(MESSAGE_ROLES.ASSISTANT, response.content);
      this.saveConversations();
    }
    
    // 5. 检查Function Calling
    // 🔧 修复：优先使用流式响应返回的tool_calls，否则使用response.tool_calls
    // 🔧 增强：传递递归深度，防止无限循环
    // 🔧 修复：确保toolCalls是数组，防止未定义错误
    const toolCalls = toolCallsFromStream || response.tool_calls;
    if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
      logger.info('[Send] Function calls detected:', toolCalls.length);
      // 🔧 修复：如果有工具调用，保持loading状态，直到工具执行完成
      // handleFunctionCalls内部会处理loading状态
      await this.handleFunctionCalls(toolCalls, functions, message, 0);  // 初始调用深度为0
      // 🔧 修复：工具调用完成后隐藏loading
      this.hideLoading();
    } else {
      // 🔧 修复：没有工具调用时，隐藏loading
      this.hideLoading();
      this.tryCompleteReActRun(fullContent || response.content || '');
      // 🔒 强制检查：如果AI在文本中写了"Acting"但没有实际调用工具，必须强制调用
      if (fullContent && functions.length > 0) {
        const reactData = TextFormatter.parseReActFormat(fullContent);
        if (reactData && reactData.acting) {
          // 检查Acting文本中是否提到了工具
          const actingText = reactData.acting.toLowerCase();
          const toolKeywords = ['工具', 'tool', '使用', '调用', '执行'];
          const hasToolMention = toolKeywords.some(keyword => actingText.includes(keyword));
          
          if (hasToolMention) {
            logger.error('[Send] 🔒 安全检查：AI在文本中写了Acting但没有使用Function Calling机制调用工具');
            logger.error('[Send] Acting内容:', reactData.acting);
            
            // 从文本中提取工具名称
            // 🔧 修复：确保functions是数组，防止未定义错误
            const extractedToolNames = this.extractToolNamesFromActingText(reactData.acting, functions || []);
            
            if (extractedToolNames.length > 0) {
              logger.info('[Send] 🔒 强制调用工具:', extractedToolNames);
              
              // 移除当前响应（因为工具调用失败）
              const messagesEl = document.getElementById('messages');
              const lastMessage = messagesEl.lastElementChild;
              if (lastMessage && lastMessage.classList.contains('assistant')) {
                lastMessage.remove();
              }
              
              // 显示错误消息
              const errorDiv = document.createElement('div');
              errorDiv.className = 'error-message';
              errorDiv.style.cssText = `
                background: #fee2e2;
                border-left: 4px solid #ef4444;
                border-radius: 8px;
                padding: 12px 16px;
                margin: 8px 0;
                color: #991b1b;
                font-size: 13px;
                box-shadow: 0 2px 4px rgba(239, 68, 68, 0.1);
              `;
              errorDiv.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                  <span style="font-size: 18px;">🔒</span>
                  <strong style="font-weight: 600;">安全工具调用检查失败</strong>
                </div>
                <div style="margin-top: 4px; line-height: 1.5;">
                  AI在文本中提到了工具调用，但没有使用Function Calling机制实际调用工具。系统已自动检测并强制调用工具。
                  <br><br>
                  <strong>检测到的工具：</strong> ${extractedToolNames.map(t => `<code>${TextFormatter.escapeHtml(t)}</code>`).join(', ')}
                  <br><br>
                  正在强制调用工具...
                </div>
              `;
              messagesEl.appendChild(errorDiv);
              this.scrollToBottom();
              
              // 强制调用工具
              await this.forceCallToolsFromActingText(extractedToolNames, reactData.acting, functions, message);
              
              return; // 停止后续处理
            } else {
              // 无法提取工具名称，强制AI重新生成
              logger.error('[Send] 🔒 无法从Acting文本中提取工具名称，强制AI重新生成');
              
              // 移除当前响应
              const messagesEl = document.getElementById('messages');
              const lastMessage = messagesEl.lastElementChild;
              if (lastMessage && lastMessage.classList.contains('assistant')) {
                lastMessage.remove();
              }
              
              // 显示错误并强制重新生成
              const errorDiv = document.createElement('div');
              errorDiv.className = 'error-message';
              errorDiv.style.cssText = `
                background: #fee2e2;
                border-left: 4px solid #ef4444;
                border-radius: 8px;
                padding: 12px 16px;
                margin: 8px 0;
                color: #991b1b;
                font-size: 13px;
                box-shadow: 0 2px 4px rgba(239, 68, 68, 0.1);
              `;
              errorDiv.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                  <span style="font-size: 18px;">🔒</span>
                  <strong style="font-weight: 600;">安全工具调用检查失败</strong>
                </div>
                <div style="margin-top: 4px; line-height: 1.5;">
                  AI在文本中提到了工具调用，但没有使用Function Calling机制实际调用工具。系统无法从文本中提取工具名称，正在强制AI重新生成响应并要求使用Function Calling机制。
                </div>
              `;
              messagesEl.appendChild(errorDiv);
              this.scrollToBottom();
              
              // 强制AI重新生成，明确要求使用Function Calling
              await this.forceRegenerateWithFunctionCalling(message, reactData.acting, functions);
              
              return; // 停止后续处理
            }
          }
        }
      }
    }
    
    // 6. 生成建议行动（如果配置开启）
    // 🔧 修复：只在最终结果出现后才生成建议行动（没有tool_calls，流式响应完全结束）
    // 如果还有tool_calls，说明AI还在调用工具，此时不应该生成建议行动
    // 注意：toolCalls已经在第1419行声明，这里直接使用
    const hasToolCalls = toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0;
    
    logger.debug('[SuggestedActions] Config check:', {
      fullContent: !!fullContent,
      enableSuggestedActions: this.config.enableSuggestedActions,
      hasToolCalls: hasToolCalls,
      willGenerate: fullContent && !hasToolCalls && this.config.enableSuggestedActions !== false && !this.isReActRunning()
    });
    
    // 🔧 修复：只有在没有tool_calls时才生成建议行动（确保是最终结果）
    const suggestionContent = this.getReActFinalContent(fullContent);
    if (suggestionContent && !hasToolCalls && this.config.enableSuggestedActions !== false && !this.isReActRunning()) {
      await this.generateSuggestedActions(suggestionContent, message);
    } else if (hasToolCalls) {
      logger.debug('[SuggestedActions] Skipping generation - tool calls detected, will generate after tool execution');
    }
  }
  
  // ==================== 5. 建议行动生成 ====================
  
  /**
   * 生成建议的下一步行动
   * 增强：关联MCP工具列表，让AI基于可用工具生成建议
   */
  async generateSuggestedActions(aiResponse, userQuery) {
    try {
      logger.info('[SuggestedActions] Starting generation...');
      logger.info('[SuggestedActions] User query:', userQuery);
      logger.info('[SuggestedActions] AI response length:', aiResponse?.length);
      
      // 收集丰富的上下文信息
      const context = this.buildSuggestionContext(aiResponse, userQuery);
      logger.info('[SuggestedActions] Context collected:', {
        hasToolResults: !!context.toolResults,
        hasEntities: !!context.entities,
        responseLength: context.response.length
      });
      
      // 🔧 获取可用的MCP工具列表
      let availableToolsText = '';
      try {
        const functions = await this.prepareFunctions();
        if (functions && functions.length > 0) {
          // 格式化工具列表为可读文本
          const toolsList = functions.map((func, index) => {
            const toolName = func.function?.name || func.name || '未知工具';
            const toolDesc = func.function?.description || func.description || '无描述';
            const params = func.function?.parameters || func.parameters || {};
            const paramNames = Object.keys(params.properties || {}).join(', ') || '无参数';
            return `${index + 1}. ${toolName}: ${toolDesc} (参数: ${paramNames})`;
          }).join('\n');
          
          availableToolsText = `## 可用工具列表（可选参考）
以下是当前可用的MCP工具，你可以**根据具体情况**在建议中引用这些工具：

${toolsList}

**重要提示：** 
- **工具使用是可选的**，不是必须的。只有当工具确实有助于解决问题时才推荐使用工具。
- 如果建议使用工具，应该明确指定要使用的工具名称，格式如："使用 [工具名称] 执行 [操作描述]"
- 如果不需要工具就能给出有效建议，可以直接给出建议，无需强制使用工具。
- 请基于具体情况判断是否需要使用工具，不要为了使用工具而使用工具。
`;
          
          logger.info('[SuggestedActions] Available tools:', functions.length);
        } else {
          logger.info('[SuggestedActions] No MCP tools available');
        }
      } catch (error) {
        logger.warn('[SuggestedActions] Failed to get MCP tools:', error);
        // 继续执行，即使获取工具失败
      }
      
      let ownerEmailSection = '';
      if (context.ownerEmails && context.ownerEmails.length > 0) {
        ownerEmailSection = `## Owner邮箱
检测到资产Owner邮箱：${context.ownerEmails.join(', ')}
- 至少包含一条使用 open_compose_window 草拟邮件的建议，说明邮件目的、收件人及需要同步的要点
- 如果需要沟通，请在建议中直接写明“使用 open_compose_window 通知 ${context.ownerEmails[0]} ……”

`;
      }

      // 构建针对事件响应的智能prompt
      const suggestPrompt = `你是一位资深的SOC安全分析师，擅长事件响应和威胁调查。

## 当前情况
用户问题：${context.query}
AI分析：${context.response}

${context.toolResults ? `## 已执行工具
${context.toolResults}

` : ''}${context.entities ? `## 关键实体
${context.entities}

` : ''}${availableToolsText}${ownerEmailSection}

## 你的任务
请分析当前的安全事件类型（如：恶意IP分析、恶意软件感染、可疑登录、漏洞利用、数据泄露、内部威胁等），然后提供2-3条最有价值的后续行动建议。

## 事件响应指导原则
- 威胁分析类：优先确认威胁级别 → 评估影响范围 → 实施防护措施
- 恶意软件类：立即隔离 → 样本分析 → 清除和恢复 → 加固防护
- 入侵事件类：应急响应 → 取证保全 → 追踪溯源 → 修复加固
- 漏洞相关类：评估影响 → 查找补丁 → 临时缓解 → 修复验证
- 可疑行为类：确认真伪 → 分析意图 → 关联分析 → 持续监控

## 建议要求
1. 简短精准（10-20字）
2. 可直接执行
3. **工具使用是可选的**：只有当工具确实有助于解决问题时才推荐使用工具。如果不需要工具就能给出有效建议，可以直接给出建议。
4. 如果建议使用工具，可以明确指定工具名称（格式：使用 [工具名称] 执行 [操作]）
5. 符合事件响应流程（检测→分析→遏制→根除→恢复→总结）
6. 按紧急程度排序
7. 如果是高危情况，第一条必须是紧急处置动作

## 输出格式（纯JSON，不要markdown代码块）
{
  "incident_type": "事件类型（1句话）",
  "suggestions": [
    {
      "action": "具体行动（10-20字，如使用工具请明确工具名称）",
      "priority": "high",
      "reason": "执行理由（简短说明）",
      "tool_name": "建议使用的工具名称（可选，如果建议使用工具）"
    },
    {
      "action": "具体行动",
      "priority": "medium",
      "reason": "执行理由",
      "tool_name": "工具名称（可选）"
    }
  ]
}`;

      logger.info('[SuggestedActions] Calling AI API with enhanced context...');
      
      // 调用AI API生成建议（禁用流式响应以简化处理）
      const response = await this.aiService.sendMessage([
        { role: MESSAGE_ROLES.USER, content: suggestPrompt }
      ], {
        temperature: 0.7,
        max_tokens: 500,  // 增加token以支持结构化输出
        stream: false  // 强制使用非流式响应
      });
      
      logger.info('[SuggestedActions] AI response received:', {
        isStream: !!response.stream,
        hasContent: !!response.content,
        contentLength: response.content?.length,
        contentPreview: response.content?.substring(0, 100)
      });
      
      // 处理响应内容
      let responseContent = '';
      if (response.stream) {
        logger.warn('[SuggestedActions] API returned stream despite stream=false, reading stream...');
        // 如果API强制返回流式，手动读取
        for await (const chunk of response.readStream()) {
          responseContent += chunk;
        }
        logger.info('[SuggestedActions] Stream read complete, length:', responseContent.length);
      } else if (response.content) {
        responseContent = response.content;
      } else {
        logger.warn('[SuggestedActions] No response from AI');
        return;
      }
      
      // 解析结构化建议
      const result = this.parseSuggestionResponse(responseContent);
      
      if (result.suggestions && result.suggestions.length > 0) {
        logger.info('[SuggestedActions] Incident type:', result.incident_type);
        logger.info('[SuggestedActions] Generated', result.suggestions.length, 'suggestions');
        this.displaySuggestedActions(result.suggestions, result.incident_type);
      } else {
        logger.warn('[SuggestedActions] No valid suggestions generated');
      }
      
    } catch (error) {
      logger.error('[SuggestedActions] Error generating suggestions:', error);
      logger.error('[SuggestedActions] Stack:', error.stack);
    }
  }
  
  /**
   * 构建建议生成的上下文信息
   */
  buildSuggestionContext(aiResponse, userQuery) {
    const context = {
      query: userQuery,
      response: aiResponse.substring(0, 1000)  // 增加到1000字以获取更多上下文
    };
    
    // 1. 获取最近的工具执行结果
    const conversation = this.getCurrentConversation();
    if (conversation && conversation.messages) {
      const recentMessages = conversation.messages.slice(-8);  // 最近8条消息
      
      // 提取工具执行结果
      const toolMessages = recentMessages
        .filter(m => m.role === 'tool' || m.tool_name)
        .map(m => {
          const toolName = m.tool_name || 'unknown_tool';
          const result = m.content ? m.content.substring(0, 300) : '';
          return `[${toolName}]: ${result}`;
        });
      
      if (toolMessages.length > 0) {
        context.toolResults = toolMessages.join('\n');
      }
    }
    
    // 2. 提取关键安全实体
    const entities = [];
    const text = userQuery + ' ' + aiResponse;
    
    // IP地址
    const ips = text.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g);
    if (ips) {
      entities.push(`IP: ${[...new Set(ips)].slice(0, 3).join(', ')}`);
    }
    
    // 域名
    const domains = text.match(/\b[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,6}\b/gi);
    if (domains) {
      const uniqueDomains = [...new Set(domains.map(d => d.toLowerCase()))].slice(0, 2);
      entities.push(`域名: ${uniqueDomains.join(', ')}`);
    }
    
    // CVE编号
    const cves = text.match(/CVE-\d{4}-\d{4,}/gi);
    if (cves) {
      entities.push(`漏洞编号: ${[...new Set(cves)].join(', ')}`);
    }
    
    // 文件哈希
    const hashes = text.match(/\b[a-f0-9]{32,64}\b/gi);
    if (hashes) {
      entities.push(`文件哈希: ${hashes[0].substring(0, 16)}...`);
    }
    
    if (entities.length > 0) {
      context.entities = entities.join('\n');
    }

    // Owner 邮箱/通用邮箱
    const emailInfo = this.extractOwnerEmails(text);
    if (emailInfo.allEmails && emailInfo.allEmails.length > 0) {
      context.emails = emailInfo.allEmails.slice(0, 5);
    }
    if (emailInfo.ownerEmails && emailInfo.ownerEmails.length > 0) {
      context.ownerEmails = emailInfo.ownerEmails;
      this.detectAndStoreOwnerEmails(emailInfo.ownerEmails);
    }
    
    return context;
  }
  
  /**
   * 解析AI返回的结构化建议
   */
  parseSuggestionResponse(content) {
    try {
      logger.info('[SuggestedActions] Parsing response...');
      
      // 尝试提取JSON（可能被markdown代码块包裹）
      let jsonText = content.trim();
      
      // 🔧 修复：移除markdown代码块
      const codeBlockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
      } else {
        // 🔧 修复：尝试直接匹配完整的JSON对象，确保匹配到完整的JSON结构
        // 匹配从 { 开始到 } 结束的完整JSON对象
        const jsonMatch = content.match(/\{[\s\S]*"suggestions"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/);
        if (jsonMatch) {
          jsonText = jsonMatch[0].trim();
        } else {
          // 🔧 修复：如果匹配失败，尝试找到第一个完整的JSON对象
          let braceCount = 0;
          let startIdx = content.indexOf('{');
          if (startIdx !== -1) {
            let endIdx = startIdx;
            for (let i = startIdx; i < content.length; i++) {
              if (content[i] === '{') braceCount++;
              if (content[i] === '}') braceCount--;
              if (braceCount === 0) {
                endIdx = i;
                break;
              }
            }
            if (endIdx > startIdx) {
              jsonText = content.substring(startIdx, endIdx + 1).trim();
            }
          }
        }
      }
      
      // 🔧 修复：清理jsonText，移除可能的JSON字符串片段
      // 如果jsonText包含不完整的JSON结构，尝试修复
      if (jsonText.includes('"suggestions"') && !jsonText.match(/^\s*\{[\s\S]*\}\s*$/)) {
        // 尝试找到完整的JSON对象
        const fullJsonMatch = jsonText.match(/\{[\s\S]*\}/);
        if (fullJsonMatch) {
          jsonText = fullJsonMatch[0];
        }
      }
      
      const result = JSON.parse(jsonText);
      
      // 标准化建议格式
      if (result.suggestions) {
        // 🔧 修复：过滤掉无效的建议项（JSON字符串片段等）
        result.suggestions = result.suggestions.filter(s => {
          // 排除JSON字符串片段
          if (typeof s === 'string') {
            return !s.includes('"suggestions"') && 
                   !s.includes('"action"') && 
                   !s.includes('"priority"') &&
                   !s.match(/^[\s]*[\[\{]/) && // 排除以 [ 或 { 开头的字符串
                   s.trim().length > 0;
          }
          return s !== null && s !== undefined;
        });
        
        result.suggestions = result.suggestions.map(s => {
          // 🔧 修复：如果是字符串，先检查是否是JSON字符串片段
          if (typeof s === 'string') {
            // 排除JSON字符串片段
            if (s.includes('"suggestions"') || 
                s.includes('"action"') || 
                s.match(/^[\s]*[\[\{]/)) {
              logger.warn('[SuggestedActions] Skipping JSON string fragment:', s.substring(0, 50));
              return null; // 标记为无效，后续过滤
            }
            return {
              action: s,
              priority: 'medium',
              reason: '',
              tool_name: ''
            };
          }
          // 🔧 修复：确保action字段始终是字符串，避免显示原始对象
          // 标准化字段名
          let actionText = '';
          if (typeof s === 'object' && s !== null) {
            // 优先使用action字段，然后是text字段
            actionText = s.action || s.text || '';
            // 🔧 关键修复：如果action和text都不存在，尝试从对象中提取字符串
            // 但排除不应该提取的字段：priority, reason, tool_name, toolName, incident_type 等
            if (!actionText) {
              const excludedKeys = ['priority', 'reason', 'tool_name', 'toolName', 'incident_type', 'id', '_id', 'type', 'status'];
              // 尝试查找第一个字符串类型的值，但排除不应该提取的字段
              for (const key in s) {
                const value = s[key];
                if (!excludedKeys.includes(key) && 
                    typeof value === 'string' && 
                    value.trim().length > 0 &&
                    value.trim().length >= 5 && // 至少5个字符，避免单个单词
                    value.trim().length < 200 && // 限制长度，避免提取过长的文本
                    !value.match(/^(high|medium|low|true|false|\d+)$/i)) { // 排除单个单词（优先级、布尔值、数字）
                  actionText = value;
                  break;
                }
              }
            }
            // 如果还是找不到，使用默认文本
            if (!actionText) {
              logger.warn('[SuggestedActions] Could not extract action text from suggestion:', s);
              actionText = '建议行动'; // 默认文本
            }
          } else if (typeof s === 'string') {
            actionText = s;
          } else {
            // 其他类型，转换为字符串
            actionText = String(s);
          }
          
          return {
            action: actionText,
            priority: s.priority || 'medium',
            reason: s.reason || '',
            tool_name: s.tool_name || s.toolName || ''  // 支持工具名称
          };
        })
        .filter(s => s !== null); // 🔧 修复：过滤掉无效的建议项
        
        // 按优先级排序
        const priorityWeight = { high: 3, medium: 2, low: 1 };
        result.suggestions.sort((a, b) => 
          (priorityWeight[b.priority] || 2) - (priorityWeight[a.priority] || 2)
        );
      }
      
      logger.info('[SuggestedActions] Parsed successfully:', {
        incident_type: result.incident_type,
        count: result.suggestions?.length
      });
      
      return result;
      
    } catch (error) {
      logger.warn('[SuggestedActions] JSON parse failed, trying fallback...', error);
      
      // 🔧 修复：Fallback逻辑，避免提取到JSON字符串片段
      // 按行分割，但排除JSON相关的行
      const lines = content.split('\n')
        .filter(line => {
          const trimmed = line.trim();
          // 排除JSON相关的行：包含 { } [ ] "suggestions" "action" 等JSON关键字
          return trimmed && 
                 !trimmed.includes('{') && 
                 !trimmed.includes('}') && 
                 !trimmed.includes('[') && 
                 !trimmed.includes(']') &&
                 !trimmed.includes('"suggestions"') &&
                 !trimmed.includes('"action"') &&
                 !trimmed.includes('"priority"') &&
                 !trimmed.includes('"reason"') &&
                 !trimmed.match(/^[\s]*["\']/); // 排除以引号开头的行（可能是JSON字符串）
        })
        .map(line => line.replace(/^[\d\-\*\.\s]+/, '').trim())
        .filter(s => s.length > 5 && s.length < 60)
        .slice(0, 3);
      
      return {
        incident_type: '安全事件调查',
        suggestions: lines.map(action => ({
          action,
          priority: 'medium',
          reason: ''
        }))
      };
    }
  }
  
  /**
   * 显示建议行动UI（固定在输入框上方）
   */
  /**
   * 重置建议行动面板为初始状态
   * 🔧 修复：在新对话创建或窗口重新打开时调用
   */
  resetSuggestedActions() {
    const panel = document.getElementById('suggestedActionsPanel');
    const content = document.getElementById('suggestedActionsContent');
    
    if (panel && content) {
      // 隐藏面板
      panel.style.display = 'none';
      // 清空内容
      content.innerHTML = '';
      logger.info('[SuggestedActions] Panel reset to initial state');
    }
  }
  
  displaySuggestedActions(suggestions, incidentType) {
    logger.info('[SuggestedActions] displaySuggestedActions called with:', suggestions);
    
    const panel = document.getElementById('suggestedActionsPanel');
    const content = document.getElementById('suggestedActionsContent');
    
    if (!panel || !content) {
      logger.error('[SuggestedActions] Panel elements not found!');
      return;
    }
    
    // 清空旧内容
    content.innerHTML = '';
    
    // 如果有事件类型，显示在顶部
    if (incidentType) {
      const typeLabel = document.createElement('div');
      typeLabel.className = 'incident-type-label';
      typeLabel.style.cssText = `
        font-size: 11px;
        color: #6b7280;
        padding: 4px 8px;
        margin-bottom: 8px;
        background: rgba(255, 255, 255, 0.6);
        border-radius: 4px;
        border-left: 3px solid #3b82f6;
      `;
      typeLabel.textContent = `📋 ${incidentType}`;
      content.appendChild(typeLabel);
    }
    
    // 优先级图标映射
    const priorityIcons = {
      high: '🔥',
      medium: '⚡',
      low: '💡'
    };
    
    // 创建建议项
    suggestions.forEach((suggestion, index) => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      
      // 🔧 修复：确保action始终是字符串，避免显示原始对象
      let action = '';
      if (typeof suggestion === 'string') {
        action = suggestion;
      } else if (typeof suggestion === 'object' && suggestion !== null) {
        action = suggestion.action || suggestion.text || '';
        // 🔧 关键修复：如果action和text都不存在，尝试从对象中提取字符串
        // 但排除不应该提取的字段：priority, reason, tool_name, toolName 等
        if (!action) {
          const excludedKeys = ['priority', 'reason', 'tool_name', 'toolName', 'incident_type', 'id', '_id', 'type', 'status'];
          for (const key in suggestion) {
            const value = suggestion[key];
            if (!excludedKeys.includes(key) && 
                typeof value === 'string' && 
                value.trim().length > 0 &&
                value.trim().length >= 5 && // 至少5个字符，避免单个单词
                value.trim().length < 200 && // 限制长度，避免提取过长的文本
                !value.match(/^(high|medium|low|true|false|\d+)$/i)) { // 排除单个单词（优先级、布尔值、数字）
              action = value;
              break;
            }
          }
        }
        // 如果还是找不到，使用默认文本
        if (!action) {
          logger.warn('[SuggestedActions] Could not extract action from suggestion:', suggestion);
          action = '建议行动';
        }
      } else {
        action = String(suggestion);
      }
      
      const priority = (suggestion && typeof suggestion === 'object') ? (suggestion.priority || 'medium') : 'medium';
      const reason = (suggestion && typeof suggestion === 'object') ? (suggestion.reason || '') : '';
      const toolName = (suggestion && typeof suggestion === 'object') ? (suggestion.tool_name || suggestion.toolName || '') : '';
      const icon = priorityIcons[priority] || '💡';
      
      item.setAttribute('data-suggestion', action);
      if (toolName) {
        item.setAttribute('data-tool-name', toolName);
      }
      
      // 如果有工具名称，显示工具标识
      const toolBadge = toolName 
        ? `<span style="
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 10px;
            margin-left: 6px;
            font-weight: 500;
            font-family: 'Courier New', monospace;
          ">🔧 ${TextFormatter.escapeHtml(toolName)}</span>`
        : '';
      
      item.innerHTML = `
        <span class="suggestion-number">${icon} ${index + 1}</span>
        <span class="suggestion-text">${TextFormatter.escapeHtml(action)}${toolBadge}</span>
        ${reason ? `<span class="suggestion-reason" title="${TextFormatter.escapeHtml(reason)}">ℹ️</span>` : ''}
        <span class="suggestion-arrow">→</span>
      `;
      
      // 点击事件
      item.addEventListener('click', () => {
        this.handleSuggestionClick(action);
      });
      
      content.appendChild(item);
    });
    
    // 显示面板
    panel.style.display = 'block';
    
    logger.info('[SuggestedActions] Panel displayed with', suggestions.length, 'suggestions');
  }
  
  /**
   * 处理建议点击
   */
  handleSuggestionClick(suggestion) {
    logger.info('[SuggestedActions] Suggestion clicked:', suggestion);
    
    // 填充到输入框（使用正确的ID：messageInput）
    const input = document.getElementById('messageInput');
    
    if (!input) {
      logger.error('[SuggestedActions] Input element not found!');
      return;
    }
    
    logger.info('[SuggestedActions] Filling input with suggestion');
    input.value = suggestion;
    
    // 自动调整高度
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
    
    // 聚焦输入框
    input.focus();
    
    logger.info('[SuggestedActions] Input filled, value:', input.value);
    
    // 自动发送（如果配置开启）
    if (this.config.autoSendSuggestions) {
      logger.info('[SuggestedActions] Auto-sending suggestion');
      setTimeout(() => {
        this.handleSend();
      }, 100); // 短暂延迟确保UI更新
    }
  }
  
  /**
   * 测试方法：直接显示建议（用于调试）
   */
  testShowSuggestions() {
    logger.info('[SuggestedActions] TEST: Showing test suggestions');
    const testSuggestions = [
      '查询该IP的历史告警记录',
      '检查相关资产的网络流量',
      '分析同时段其他可疑活动',
      '验证该IP是否在黑名单中'
    ];
    this.displaySuggestedActions(testSuggestions);
  }
  
  // ==================== 6. 消息编辑 ====================

  /**
   * Handle message editing
   */
  handleEditMessage(messageDiv, originalContent) {
    const contentDiv = messageDiv.querySelector('.message-content');
    const editBtn = messageDiv.querySelector('.message-edit-btn');
    
    // 隐藏编辑按钮
    editBtn.style.display = 'none';
    
    // 创建编辑界面
    const editContainer = document.createElement('div');
    editContainer.className = 'message-edit-container';
    editContainer.innerHTML = `
      <textarea class="message-edit-textarea" rows="3">${TextFormatter.escapeHtml(originalContent)}</textarea>
      <div class="message-edit-actions">
        <button class="message-edit-save">💾 重新发送</button>
        <button class="message-edit-cancel">✕ 取消</button>
      </div>
    `;
    
    // 替换内容区域
    contentDiv.style.display = 'none';
    messageDiv.insertBefore(editContainer, contentDiv.nextSibling);
    
    const textarea = editContainer.querySelector('.message-edit-textarea');
    const saveBtn = editContainer.querySelector('.message-edit-save');
    const cancelBtn = editContainer.querySelector('.message-edit-cancel');
    
    // 自动聚焦并选中文本
    textarea.focus();
    textarea.select();
    
    // 自动调整textarea高度
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    });
    
    // 保存按钮
    saveBtn.addEventListener('click', () => {
      const newContent = textarea.value.trim();
      if (newContent && newContent !== originalContent) {
        this.resendEditedMessage(messageDiv, newContent);
      } else {
        // 取消编辑
        this.cancelEditMessage(messageDiv, contentDiv, editContainer, editBtn);
      }
    });
    
    // 取消按钮
    cancelBtn.addEventListener('click', () => {
      this.cancelEditMessage(messageDiv, contentDiv, editContainer, editBtn);
    });
    
    // 支持 Ctrl+Enter 保存
    textarea.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        saveBtn.click();
      } else if (e.key === 'Escape') {
        cancelBtn.click();
      }
    });
  }

  /**
   * Cancel message editing
   */
  cancelEditMessage(messageDiv, contentDiv, editContainer, editBtn) {
    editContainer.remove();
    contentDiv.style.display = 'block';
    editBtn.style.display = 'block';
  }

  /**
   * Resend edited message
   */
  async resendEditedMessage(messageDiv, newContent) {
    logger.info('[Edit] Resending edited message:', newContent);
    
    const messagesEl = document.getElementById('messages');
    const allMessages = Array.from(messagesEl.querySelectorAll('.message, .tool-call-record, .tool-execution-prompt'));
    
    // 找到当前消息的索引
    const currentIndex = allMessages.indexOf(messageDiv);
    
    // 删除当前消息之后的所有消息（包括AI回复和工具调用）
    for (let i = allMessages.length - 1; i > currentIndex; i--) {
      allMessages[i].remove();
    }
    
    // 删除当前消息
    messageDiv.remove();
    
    // 更新会话历史：删除当前消息及之后的消息
    const conversation = this.getCurrentConversation();
    if (conversation) {
      // 🔧 修复：正确计算消息位置，包括TOOL消息
      // 方法：直接使用DOM元素来确定消息在历史中的位置
      
      // 计算当前编辑消息之前有多少USER消息（包括当前这条）
      const userMessagesBefore = allMessages.slice(0, currentIndex + 1)
        .filter(el => el.classList.contains('message') && el.classList.contains('user'))
        .length;
      
      logger.debug('[Edit] User messages before current:', userMessagesBefore);
      logger.debug('[Edit] Total messages in history:', conversation.messages.length);
      
      // 在历史中找到对应位置
      let userCount = 0;
      let cutIndex = -1;
      
      for (let i = 0; i < conversation.messages.length; i++) {
        const msg = conversation.messages[i];
        if (msg.role === MESSAGE_ROLES.USER) {
          userCount++;
          if (userCount === userMessagesBefore) {
            cutIndex = i;
            break;
          }
        }
      }
      
      // 保留cutIndex之前的所有消息（不包括cutIndex）
      if (cutIndex >= 0) {
        conversation.messages = conversation.messages.slice(0, cutIndex);
        logger.info('[Edit] Removed messages from index', cutIndex, 'onwards');
      } else {
        logger.warn('[Edit] Could not find cut index, clearing all messages');
        conversation.messages = [];
      }
      
      this.saveConversations();
    }
    
    // 显示用户消息并自动保存到历史（appendMessage会自动处理）
    this.appendMessage(MESSAGE_ROLES.USER, newContent);
    
    this.showLoading();
    
    try {
      // 使用Function Calling模式重新发送
      logger.info('[Edit] Resending with Function Calling mode');
      await this.sendMessageWithFunctionCalling(newContent);
    } catch (error) {
      this.hideLoading();
      this.showError('发送失败: ' + error.message);
      logger.error('[Edit] Error resending:', error);
    }
  }

  // ==================== 6. 流式响应处理 ====================

  /**
   * Handle streaming response with typing effect
   * 优化：减少ReAct格式卡片的闪烁，使用防抖更新策略
   */
  async handleStreamResponse(response) {
    const messagesEl = document.getElementById('messages');
    
    // 🔧 修复：如果response已经包含消息DOM引用，使用它；否则创建新的
    let messageDiv = response.messageDiv || null;
    let contentDiv = response.contentDiv || null;
    
    if (!messageDiv || !contentDiv) {
      // 创建新的消息DOM
      messageDiv = document.createElement('div');
      messageDiv.className = 'message assistant';
      
      messageDiv.innerHTML = `
        <div class="message-content"><span style="color: #667eea;">●</span></div>
      `;
      
      messagesEl.appendChild(messageDiv);
      contentDiv = messageDiv.querySelector('.message-content');
      this.scrollToBottom();
    } else {
      // 使用已存在的消息DOM，初始化内容（如果为空）
      if (contentDiv && (!contentDiv.textContent || contentDiv.textContent.trim() === '' || contentDiv.textContent === '●')) {
        contentDiv.innerHTML = '<span style="color: #667eea;">●</span>';
      }
    }
    let fullContent = '';
    let chunkCount = 0;
    let lastRenderTime = 0;
    let renderTimer = null;
    let lastRenderedLength = 0;
    let lastRenderedContent = ''; // 初始化变量，避免未定义错误
    let pendingContent = ''; // 待渲染的内容
    const RENDER_DEBOUNCE_MS = 150; // 防抖延迟：150ms，减少闪烁（特别是观察模块）
    
    // 优化的渲染函数：简化逻辑，减少闪烁
    const debouncedRender = (content) => {
      // 更新待渲染内容
      pendingContent = content;
      
      // 清除之前的定时器
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = null;
      }
      
      // 如果内容没有变化，跳过渲染
      if (content === lastRenderedContent) {
        return;
      }
      
      // 设置新的定时器
      renderTimer = setTimeout(() => {
        // 使用最新的待渲染内容
        const contentToRender = pendingContent;
        
        // 如果内容已经渲染过，跳过
        if (contentToRender === lastRenderedContent) {
          return;
        }
        
        const now = Date.now();
        
        // 简单的防抖：如果距离上次渲染时间太短，延迟渲染
        if (now - lastRenderTime < RENDER_DEBOUNCE_MS && lastRenderTime > 0) {
          // 重新调度
          renderTimer = setTimeout(() => {
            const previousHtml = contentDiv.innerHTML;
            const newHtml = TextFormatter.markdownToHtml(pendingContent, previousHtml);
            if (newHtml && newHtml.trim().length > 0 && pendingContent !== lastRenderedContent) {
              contentDiv.innerHTML = newHtml;
              lastRenderedLength = pendingContent.length;
              lastRenderedContent = pendingContent;
              lastRenderTime = Date.now();
              this.scrollToBottom();
            }
          }, RENDER_DEBOUNCE_MS - (now - lastRenderTime));
          return;
        }
        
        // 执行渲染（使用增量更新，避免已完成组件刷新）
        const previousHtml = contentDiv.innerHTML;
        const newHtml = TextFormatter.markdownToHtml(contentToRender, previousHtml);
        if (newHtml && newHtml.trim().length > 0) {
          contentDiv.innerHTML = newHtml;
          lastRenderedLength = contentToRender.length;
          lastRenderedContent = contentToRender;
          lastRenderTime = now;
          this.scrollToBottom();
        }
      }, RENDER_DEBOUNCE_MS);
    };
    
    try {
      logger.info('[Stream] Starting stream rendering');
      
      // 读取流式数据
      let hasReceivedContent = false;
      for await (const chunk of response.readStream()) {
        chunkCount++;
        fullContent += chunk;
        hasReceivedContent = true;
        
        logger.debug(`[Stream] Chunk ${chunkCount}:`, chunk.substring(0, 100));
        logger.debug(`[Stream] Full content length:`, fullContent.length);
        
        // 使用防抖渲染，减少闪烁
        debouncedRender(fullContent);
        
        // 添加小延迟，让打字机效果更明显（延迟时间可在配置文件中调整）
        if (DEFAULT_CONFIG.ui.streamChunkDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, DEFAULT_CONFIG.ui.streamChunkDelay));
        }
      }
      
      // 🔧 修复：记录是否收到了内容
      if (!hasReceivedContent && chunkCount === 0) {
        logger.warn('[Stream] ⚠️ No chunks received from stream! This may indicate a problem with the API response.');
      } else if (!hasReceivedContent && chunkCount > 0) {
        logger.warn('[Stream] ⚠️ Stream completed but no content chunks were received (only tool_calls or empty chunks)');
      }
      
      // 确保最后一次渲染完成
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = null;
      }
      
      // 等待一小段时间，确保所有待处理的渲染完成
      await new Promise(resolve => setTimeout(resolve, RENDER_DEBOUNCE_MS + 10));
      
      // 最终渲染，确保完整内容显示
      const finalHtml = TextFormatter.markdownToHtml(fullContent);
      // 确保HTML结构完整，避免CSS丢失
      if (finalHtml && finalHtml.trim().length > 0) {
        contentDiv.innerHTML = finalHtml;
        lastRenderedContent = fullContent;
        lastRenderedLength = fullContent.length;
      } else if (fullContent && fullContent.trim().length > 0) {
        // 🔧 修复：如果markdown转换失败，直接显示原始内容
        logger.warn('[Stream] Markdown conversion failed, displaying raw content');
        contentDiv.innerHTML = TextFormatter.escapeHtml(fullContent).replace(/\n/g, '<br>');
        lastRenderedContent = fullContent;
        lastRenderedLength = fullContent.length;
      } else {
        // 🔧 修复：如果内容为空，检查是否有tool_calls
        const toolCalls = response.tool_calls || null;
        if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
          // 如果有tool_calls但没有content，说明AI只调用了工具，这是正常的
          logger.info('[Stream] Content is empty but tool_calls detected:', toolCalls.length);
          logger.info('[Stream] This is normal: AI only called tools without generating text');
          // 不显示"无内容"，而是显示工具调用提示
          contentDiv.innerHTML = '<span style="color: #667eea; font-weight: 500;">🔧 AI正在调用工具进行分析...</span>';
        } else {
          // 既没有content也没有tool_calls，可能是异常情况
          logger.warn('[Stream] ⚠️ Content is empty and no tool_calls detected after stream completion');
          logger.warn('[Stream] Chunk count:', chunkCount, 'Full content length:', fullContent.length);
          logger.warn('[Stream] Full content (first 200 chars):', fullContent.substring(0, 200));
          logger.warn('[Stream] Response object:', {
            stream: response.stream,
            tool_calls: response.tool_calls,
            hasReadStream: typeof response.readStream === 'function'
          });
          // 显示提示但不阻塞，继续后续处理
          contentDiv.innerHTML = '<span style="color: #6b7280; font-style: italic;">（流式响应完成，但未收到内容。请检查控制台日志以获取详细信息。）</span>';
        }
      }
      
      // 🔧 修复：强制UI更新，确保消息已显示
      this.scrollToBottom();
      await new Promise(resolve => setTimeout(resolve, 50));
      this.scrollToBottom();
      
      logger.info(`[Stream] Stream completed. Total chunks: ${chunkCount}, Total length: ${fullContent.length}`);
      
      // 🔧 修复：从response对象获取tool_calls（流结束后已设置）
      const toolCalls = response.tool_calls || null;
      if (toolCalls) {
        logger.info('[Stream] Tool calls detected after stream:', toolCalls.length);
      }
      
      // 保存到会话历史
      // 🔧 修复：如果只有tool_calls没有content，仍然需要保存assistant消息（即使content为空）
      const conversation = this.getCurrentConversation();
      if (conversation) {
        // 如果有tool_calls但没有content，保存一个占位消息，以便后续处理
        const messageContent = fullContent || (toolCalls && toolCalls.length > 0 ? '[工具调用中...]' : '');
        
        // 🔧 修复：保存assistant消息时，必须包含tool_calls（如果存在）
        const assistantMessage = {
          role: MESSAGE_ROLES.ASSISTANT,
          content: messageContent,
          timestamp: new Date().toISOString()
        };
        
        // 🔧 关键修复：如果存在tool_calls，必须保存到assistant消息中
        // 这样后续buildMessages时才能正确关联tool结果
        if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
          assistantMessage.tool_calls = toolCalls;
          logger.info('[Stream] ✅ Saving assistant message with tool_calls:', toolCalls.length);
        }
        
        conversation.messages.push(assistantMessage);
        
        // 🔧 重要：持久化保存到storage
        this.saveConversations();
        this.detectAndStoreOwnerEmails(messageContent);
        logger.info('[Stream] Assistant message saved to history, content length:', messageContent.length, 'tool_calls:', toolCalls?.length || 0);
      }
      
      // 🔧 修复：返回包含tool_calls的对象，而不是只返回字符串
      return {
        content: fullContent || '',  // 确保总是返回字符串
        tool_calls: toolCalls
      };
    } catch (error) {
      logger.error('[Stream] Error reading stream:', error);
      
      // 清理定时器
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = null;
      }
      
      // 显示错误信息
      const errorMessage = error.message || String(error);
      contentDiv.innerHTML = '<span style="color: #ef4444;">流式响应出错: ' + TextFormatter.escapeHtml(errorMessage) + '</span>';
      
      // 如果已经有部分内容，尝试保存
      if (fullContent && fullContent.trim().length > 0) {
        const conversation = this.getCurrentConversation();
        if (conversation) {
          conversation.messages.push({
            role: MESSAGE_ROLES.ASSISTANT,
            content: fullContent,
            timestamp: new Date().toISOString()
          });
          this.saveConversations();
        }
      }
      
      // 🔧 修复：错误时也返回对象格式，保持一致性，避免调用方出错
      return {
        content: fullContent || '',
        tool_calls: null
      };
    }
  }
  
  // ==================== 7. MCP服务集成 ====================
  
  async refreshMCPTools(forceRefresh = false) {
    if (this.mcpServices.length === 0) {
      this.cachedMCPTools = null;
      return;
    }
    
    // 重新加载工具启用状态（确保使用最新配置）
    this.toolsEnabled = await StorageManager.getMCPToolsEnabled();
    logger.debug('[MCP] Reloaded tools enabled status');
    
    // 尝试使用缓存（除非强制刷新）
    if (!forceRefresh && this.mcpToolsCache) {
      const contexts = [];
      let cacheHit = 0;
      
      for (const service of this.mcpServices) {
        if (!service.enabled) continue;
        
        // 检查该服务是否有缓存
        if (this.mcpToolsCache[service.id]) {
          const tools = this.mcpToolsCache[service.id];
          const cacheTime = new Date(this.mcpToolsCache[service.id + '_time']).toLocaleTimeString('zh-CN');
          
          // 过滤出启用的工具
          const enabledTools = tools.filter(t => {
            const toolKey = `${service.id}:${t.name}`;
            return this.toolsEnabled[toolKey] !== false; // 默认启用
          });
          
          if (enabledTools.length > 0) {
            contexts.push({
              service: service.name,
              data: {
                service: service.name,
                serviceUrl: service.url,
                available_tools: enabledTools.map(t => ({
                  name: t.name,
                  description: t.description || '',
                  inputSchema: t.inputSchema || {}
                }))
              }
            });
            logger.info(`[MCP] Using cached tools for ${service.name} (${cacheTime}): ${enabledTools.length}/${tools.length} enabled`);
            cacheHit++;
          } else {
            logger.info(`[MCP] All tools disabled for ${service.name}`);
          }
        }
      }
      
      if (cacheHit > 0) {
        this.cachedMCPTools = contexts.length > 0 ? JSON.stringify(contexts) : null;
        logger.info(`[MCP] Loaded ${cacheHit} services from cache`);
        return;
      }
    }
    
    // 如果没有缓存或强制刷新，重新获取
    logger.info('[MCP] Fetching tools list from services...');
    const contexts = [];
    
    for (const service of this.mcpServices) {
      if (!service.enabled) continue;
      
      try {
        const mcpClient = new MCPClient(service.url);
        const tools = await mcpClient.getTools();
        
        if (tools) {
          // 过滤出启用的工具
          const enabledTools = tools.filter(t => {
            const toolKey = `${service.id}:${t.name}`;
            return this.toolsEnabled[toolKey] !== false; // 默认启用
          });
          
          if (enabledTools.length > 0) {
            contexts.push({
              service: service.name,
              data: {
                service: service.name,
                serviceUrl: service.url,
                available_tools: enabledTools.map(t => ({
                  name: t.name,
                  description: t.description || '',
                  inputSchema: t.inputSchema || {}
                }))
              }
            });
            logger.info(`[MCP] Got ${tools.length} tools from ${service.name}, ${enabledTools.length} enabled`);
          } else {
            logger.info(`[MCP] All tools disabled for ${service.name}`);
          }
        }
      } catch (error) {
        logger.error(`[MCP] Failed to get tools from ${service.name}:`, error);
      }
    }
    
    this.cachedMCPTools = contexts.length > 0 ? JSON.stringify(contexts) : null;
    logger.info('[MCP] Tools cache updated');
  }
  
  async executeToolFromIntent(intent, originalQuery) {
    const { toolName, args } = intent;
    
    logger.info('[Tool] Executing tool:', toolName, 'Args:', args);
    logger.debug('[Tool] Available services:', this.mcpServices.map(s => ({name: s.name, enabled: s.enabled, id: s.id})));
    logger.debug('[Tool] Cache keys:', Object.keys(this.mcpToolsCache).filter(k => !k.endsWith('_time')));
    
    if (this.mcpServices.length === 0) {
      throw new Error('未找到可用的 MCP 服务');
    }
    
    // 从缓存中查找拥有该工具的服务
    let targetService = null;
    for (const service of this.mcpServices) {
      if (!service.enabled) continue;
      
      logger.debug(`[Tool] Checking service: ${service.name} (${service.id})`);
      
      if (this.mcpToolsCache[service.id]) {
        const tools = this.mcpToolsCache[service.id];
        logger.debug(`[Tool] Service ${service.name} has tools:`, tools.map(t => t.name));
        
        // 尝试精确匹配和部分匹配
        let hasTool = tools.some(t => t.name === toolName);
        if (!hasTool) {
          // 尝试去掉前缀匹配（如 OneTIP-MCP-xxx -> xxx）
          const simplifiedToolName = toolName.replace(/^[^-]+-[^-]+-/, '');
          hasTool = tools.some(t => t.name === simplifiedToolName || simplifiedToolName === t.name);
          logger.debug(`[Tool] Trying simplified name: ${simplifiedToolName}, found: ${hasTool}`);
        }
        
        if (hasTool) {
          targetService = service;
          logger.info('[Tool] Found tool in service:', service.name, service.url);
          break;
        }
      } else {
        logger.debug(`[Tool] No cache for service ${service.name}`);
      }
    }
    
    // 如果在缓存中找不到，尝试第一个启用的服务（兜底）
    if (!targetService) {
      targetService = this.mcpServices.find(s => s.enabled);
      logger.warn('[Tool] Tool not found in cache, using first enabled service:', targetService?.name);
    }
    
    if (!targetService) {
      throw new Error('没有启用的 MCP 服务');
    }
    
    logger.info('[Tool] ========== 执行 MCP 工具 ==========');
    logger.info('[Tool] 服务名称:', targetService.name);
    logger.info('[Tool] 服务 URL:', targetService.url);
    logger.info('[Tool] 工具名称:', toolName);
    logger.info('[Tool] 原始参数:', JSON.stringify(args, null, 2));
    
    // 🔧 修复：验证和规范化工具参数
    let validatedArgs;
    try {
      validatedArgs = this.validateAndNormalizeToolArgs(toolName, args, targetService.id);
      logger.info('[Tool] 验证后的参数:', JSON.stringify(validatedArgs, null, 2));
    } catch (validationError) {
      logger.error('[Tool] 参数验证失败:', validationError);
      throw new Error(`工具参数验证失败：${validationError.message}。工具名称：${toolName}，原始参数：${JSON.stringify(args)}`);
    }
    
    const mcpClient = new MCPClient(targetService.url);
    const result = await mcpClient.callTool(toolName, validatedArgs);
    
    logger.info('[Tool] ========== 工具执行完成 ==========');
    logger.info('[Tool] 返回结果类型:', typeof result);
    logger.debug('[Tool] 返回结果:', JSON.stringify(result, null, 2));
    
    const formatted = TextFormatter.formatToolResult(result);
    logger.debug('[Tool] 格式化后的结果:', formatted.substring(0, 200) + (formatted.length > 200 ? '...' : ''));
    
    return formatted;
  }
  
  /**
   * 准备Function Calling所需的函数列表
   */
  async prepareFunctions() {
    // 确保工具缓存是最新的
    if (!this.mcpToolsCache || Object.keys(this.mcpToolsCache).length === 0) {
      await this.refreshMCPTools();
    }
    
    // 构建服务映射
    const mcpServicesMap = {};
    for (const service of this.mcpServices) {
      if (!service.enabled) continue;
      
      const tools = this.mcpToolsCache[service.id];
      if (tools && Array.isArray(tools)) {
        mcpServicesMap[service.id] = {
          name: service.name,
          url: service.url,
          enabled: service.enabled,
          tools: tools
        };
      }
    }
    
    // 聚合所有Function
    const functions = FunctionCallAdapter.aggregateToolsFromServices(
      mcpServicesMap,
      this.toolsEnabled
    );
    
    return functions;
  }

  /**
   * 判断是否启用目录式工具规划流程
   */
  shouldUseToolDirectoryFlow() {
    if (!this.mcpServices || this.mcpServices.length === 0) {
      return false;
    }
    return this.mcpServices.some(service => service.enabled);
  }

  /**
   * 汇总当前启用的工具，生成目录文本
   */
  buildToolDirectorySummary() {
    if (!this.mcpServices || !this.mcpToolsCache) {
      return null;
    }
    
    const lines = [];
    let totalTools = 0;
    
    for (const service of this.mcpServices) {
      if (!service.enabled) continue;
      const tools = this.mcpToolsCache[service.id];
      if (!tools || tools.length === 0) continue;
      
      const enabledTools = tools.filter(tool => {
        const toolKey = `${service.id}:${tool.name}`;
        return this.toolsEnabled[toolKey] !== false;
      });
      
      if (enabledTools.length === 0) continue;
      
      lines.push(`## Service: ${service.name}`);
      enabledTools.forEach(tool => {
        totalTools += 1;
        const formatted = this.formatSkillStyleEntry(tool);
        if (formatted) {
          lines.push(formatted);
        }
      });
      lines.push('');
    }
    
    if (totalTools === 0) {
      return null;
    }
    
    return {
      text: lines.join('\n').trim(),
      count: totalTools
    };
  }

  /**
   * 将单个工具转换为 Skills 风格的条目
   */
  formatSkillStyleEntry(tool) {
    if (!tool || !tool.name) return '';
    
    const desc = (tool.description || '无描述').replace(/\s+/g, ' ').trim();
    const truncatedDesc = desc.length > 240 ? `${desc.slice(0, 240)}...` : desc;
    
    const props = tool.inputSchema?.properties || {};
    const required = tool.inputSchema?.required || [];
    const inputs = Object.entries(props).slice(0, 5).map(([key, schema]) => {
      const type = schema?.type || 'string';
      const isRequired = required.includes(key) ? 'required' : 'optional';
      const schemaDesc = (schema?.description || '').trim();
      const preview = schemaDesc
        ? `${schemaDesc.length > 80 ? `${schemaDesc.slice(0, 80)}...` : schemaDesc}`
        : '';
      return `  - ${key} (${type}, ${isRequired})${preview ? ` – ${preview}` : ''}`;
    });
    const inputsSection = inputs.length > 0
      ? inputs.join('\n')
      : '  - 无参数\n';
    
    let outputHint = '';
    if (tool.outputSchema?.description) {
      const text = tool.outputSchema.description.trim();
      outputHint = text.length > 120 ? `${text.slice(0, 120)}...` : text;
    } else if (desc) {
      // 简单提取“返回/输出”关键词
      const match = desc.match(/返回.*?[。.;]/);
      outputHint = match ? match[0].replace(/[。.;]/g, '') : '';
    }
    
    return [
      `### Skill: ${tool.name}`,
      `- **Capability:** ${truncatedDesc}`,
      `- **Inputs:**\n${inputsSection}`,
      outputHint ? `- **Output:** ${outputHint}` : '',
      ''
    ].filter(Boolean).join('\n');
  }

  /**
   * 构建两阶段工具规划提示词
   */
  buildToolPlanningPrompt(toolDirectoryText) {
    const directorySection = toolDirectoryText
      ? `## 可用工具目录\n${toolDirectoryText}\n`
      : '## 可用工具目录\n当前没有可用工具。若无需工具，请直接回答。\n';
    
    return `你是一位资深的SOC安全分析师，负责事件响应与威胁调查。上方的“可用工具目录”与 Claude Skills 类似——每个 Skill 表示一项能力，只有在需要时才会被真正加载。

${directorySection}

## Skills 使用协议（两阶段）
1. 先分析用户问题，若无需技能即可完成，请直接给出专业结论。
2. 如需使用目录中的技能，请勿虚构结果，先输出一个JSON对象（不包含额外文本），格式如下：
{
  "need_tool": true,
  "tools": [
    {
      "name": "技能名称（来自目录）",
      "args": { "参数名": "参数值", ... },
      "reason": "为什么需要该技能"
    }
  ],
  "explain_to_user": "面向用户的简短说明，可选"
}
3. args 必须与目录描述匹配。若无需任何技能，请返回 {"need_tool": false} 或直接回答。
4. 若需要多个技能，可在 tools 数组中列出多个条目，按执行顺序排列。
5. 暂时不要调用 Function Calling。等我们加载对应技能后，你会再次获得使用Function Calling的机会。

在收到技能的真实执行结果后，你会再次获得回答机会，届时请基于真实数据给出结论。`;
  }

  /**
   * 解析AI输出的工具规划结果
   */
  parseToolPlanningResponse(content = '') {
    if (!content) return null;
    
    const trimmed = content.trim();
    let jsonText = trimmed;
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
    }
    
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (error) {
      logger.debug('[ToolPlanning] Failed to parse planning JSON:', error.message);
      return null;
    }
    
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    
    const needToolRaw = parsed.need_tool ?? parsed.needTool ?? parsed.use_tool ?? parsed.useTool;
    const needTool = needToolRaw === true || needToolRaw === 'true' || (Array.isArray(parsed.tools) && parsed.tools.length > 0);
    if (!needTool) {
      return { needTool: false };
    }
    
    let tools = [];
    if (Array.isArray(parsed.tools)) {
      tools = parsed.tools;
    } else if (parsed.tool_name || parsed.toolName) {
      tools = [{
        name: parsed.tool_name || parsed.toolName,
        args: parsed.args || parsed.arguments || {},
        reason: parsed.reason || ''
      }];
    }
    
    const normalizedTools = tools
      .map(tool => {
        const name = tool?.name || tool?.tool_name || tool?.toolName;
        if (!name) return null;
        return {
          name,
          args: tool.args || tool.arguments || {},
          reason: tool.reason || tool.purpose || ''
        };
      })
      .filter(Boolean);
    
    if (normalizedTools.length === 0) {
      return null;
    }
    
    return {
      needTool: true,
      tools: normalizedTools,
      explain: parsed.explain_to_user || parsed.explain || ''
    };
  }

  /**
   * 根据工具规划构建模拟的tool_calls
   */
  buildSyntheticToolCalls(plannedTools = []) {
    return plannedTools.map((tool, index) => ({
      id: `planner_call_${Date.now()}_${index}`,
      type: 'function',
      function: {
        name: tool.name,
        arguments: JSON.stringify(tool.args || {})
      }
    }));
  }

  /**
   * 构建指定工具的Function定义列表
   */
  buildFunctionDefinitionsForTools(toolNames = []) {
    if (!toolNames || toolNames.length === 0) {
      return [];
    }
    const uniqueNames = Array.from(new Set(toolNames));
    const definitions = [];
    
    for (const service of this.mcpServices || []) {
      if (!service.enabled) continue;
      const tools = this.mcpToolsCache?.[service.id];
      if (!tools || tools.length === 0) continue;
      const matchedTools = tools.filter(tool => uniqueNames.includes(tool.name));
      if (matchedTools.length === 0) continue;
      const fnDefs = FunctionCallAdapter.mcpToolsToFunctions(matchedTools, service.id, service.name);
      definitions.push(...fnDefs);
    }
    
    return definitions;
  }

  /**
   * 将工具规划结果转换为可读消息
   */
  formatToolPlanningMessage(plan) {
    if (!plan || !plan.tools || plan.tools.length === 0) {
      return '';
    }
    
    let message = '🧠 AI 计划激活以下 Skills 以继续分析：\n';
    plan.tools.forEach((tool, index) => {
      const argsPreview = Object.entries(tool.args || {})
        .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
        .join(', ');
      message += `${index + 1}. ${tool.name}${argsPreview ? `（参数：${argsPreview}）` : ''}`;
      if (tool.reason) {
        message += ` - ${tool.reason}`;
      }
      message += '\n';
    });
    
    if (plan.explain) {
      message += `\n说明：${plan.explain}`;
    }
    
    return message.trim();
  }
  
  /**
   * 构建Function Calling的System Prompt（ReAct模式）
   */
  buildSystemPromptForFunctionCalling() {
    // 🔒 SOC安全应急响应场景的系统提示词，使用ReAct模式支持循环推理
    const criticalTools = [
      {
        name: 'findowner-mcp-query_asset_info',
        description: '用于查询内网IP对应的资产Owner信息，处理内网IP事件时必须优先调用'
      }
    ];
    
    const criticalToolsGuidance = `
### 🌐 内网资产查询优先级
- 当用户的问题涉及内网IP、终端或资产归属时，请**优先调用**工具 **findowner-mcp-query_asset_info**，除非已明确说明无需查询。
- 在Reasoning中解释为什么需要资产Owner信息，并在Acting中第一步调用该工具，等结果返回后再决定是否调用其他工具。
- 如果调用失败或返回结果为空，需要在Observation中说明原因，并考虑是否重试或提示用户补充信息。
`;
    const conversation = typeof this.getCurrentConversation === 'function' ? this.getCurrentConversation() : null;
    const ownerEmails = this.getConversationOwnerEmails(conversation);
    const ownerGuidance = ownerEmails.length > 0 ? `
### 📧 Owner邮箱通知优先级
- 检测到资产Owner邮箱：${ownerEmails.join(', ')}
- 如需通知或同步，请优先调用工具 **open_compose_window** 草拟邮件（暂不发送），明确邮件目的、需要同步的信息以及收件人。
- 写明要通知的具体邮箱，并保持邮件内容完整、可直接发送。
` : '';
    
    return `你是一位资深的SOC（安全运营中心）安全分析师，专门负责安全事件响应、威胁调查和应急处理。你使用ReAct（Reasoning-Acting）模式进行安全分析和事件响应。

## ReAct模式核心逻辑

ReAct是一个循环迭代的过程，包含以下步骤：

### 1. 推理 (Reasoning)
基于当前安全事件或威胁情报，分析事件类型、威胁级别、影响范围，思考需要采取什么调查或响应行动。用简洁专业的语言说明你的推理过程。

**安全分析要点：**
- 识别事件类型（恶意IP、恶意软件、可疑登录、漏洞利用、数据泄露、内部威胁等）
- 评估威胁级别（高危/中危/低危）
- 分析影响范围（受影响资产、数据、系统）
- 确定调查方向（威胁情报、日志分析、网络流量、端点检测等）

格式：**Reasoning:** [你的安全分析推理过程]

### 2. 行动 (Acting)
**⚠️ 关键要求：如果你需要调用工具，必须使用Function Calling机制（通过tool_calls字段），而不能只在文本中写"Acting: 使用xxx工具"。**

**正确的工具调用方式：**
- 当你需要调用工具时，必须使用Function Calling机制，系统会自动识别并执行
- 在文本的Acting部分，你可以写简洁的文字说明，但实际的工具调用必须通过Function Calling完成
- 如果你只在文本中写"Acting: 使用xxx工具"而没有使用Function Calling，工具将不会被执行

**格式：** **Acting:** 
- 行动1: 使用 [工具名称1] 和 [工具名称2] 执行 [安全调查/响应操作说明]
- 行动2: 使用 [工具名称] 执行 [安全调查/响应操作说明]

**安全工具使用场景：**
- 威胁情报查询：查询IP/域名/文件哈希的威胁情报
- 日志分析：查询安全日志、访问日志、审计日志
- 资产信息：查询资产归属、配置信息、漏洞信息
- 事件响应：执行隔离、阻断、取证等响应操作
- 关联分析：关联多个数据源进行综合分析

**注意：** 
- 在Acting文本中只写简洁的文字说明和工具名称，不要写详细的参数信息
- 但实际的工具调用必须通过Function Calling机制完成（系统会自动处理）
- 如果一个问题需要多个工具协同调查，可以在Function Calling中同时选择多个工具，系统会综合执行结果

如果不需要调用工具，可以跳过此部分。

${criticalToolsGuidance}${ownerGuidance}

### 3. 观察 (Observation)
当安全工具执行完成后，分析工具返回的威胁情报、日志数据或资产信息。

格式：**Observation:** [对工具结果的安全分析]

**安全分析要求：** 
- 必须分析工具返回的实际数据，提取关键安全指标（威胁评分、置信度、历史记录、关联事件等）
- 如果工具返回了JSON格式的数据，请解析并列出关键安全字段的实际值（如IP地址、威胁类型、时间戳、置信度等）
- 如果工具返回了对象，请提取其中的具体安全属性值
- **绝对不要**使用占位符（如[IP地址]、[威胁类型]、[资产名称]等），必须使用工具返回的真实数据
- 如果数据不完整或查询未找到结果，明确说明缺少哪些关键信息，并判断是否需要调用其他工具补充调查

### 4. 循环判断（ReAct核心）
**🔁 关键：** 基于观察结果，判断是否需要继续推理和行动：

**⚠️ 重要：何时停止调用工具**
- **如果观察结果已经足够回答问题**：**必须立即停止调用工具**，进入第5步（Response），给出最终答案
- **以下情况视为"足够信息"，必须停止调用工具：**
  - 已经查询到了用户问题的核心信息（例如：IP的Owner信息、威胁情报、资产信息等）
  - 工具返回了有效的、非空的数据（不是null、空数组、空对象或"未找到"）
  - 已经执行了2个或更多成功的工具查询
  - 用户的问题比较简单，已有结果足以回答

**何时继续调用工具：**
- **只有在以下情况才继续调用工具：**
  - 工具返回了明确的"未找到"或"查询失败"结果
  - 工具返回的数据明显不完整（例如：只有部分字段，缺少关键信息）
  - 用户的问题非常复杂，需要多个数据源交叉验证
  - **明确需要**其他类型的信息（例如：已有威胁情报，但还需要日志数据）

**⚠️ 关键原则：**
- **不要**在已经得到足够信息时继续调用工具
- **不要**为了"完整性"而调用不必要的工具
- **不要**重复调用相同类型的工具（如威胁情报、风险评估等）
- **必须**基于实际需要决定是否继续调用工具

**如果观察结果不完整、查询未找到结果、或需要更多信息：**
  - **必须重新开始第1步（Reasoning）**，基于新的观察结果继续推理
  - 在Reasoning中明确说明：基于之前的观察，还需要什么信息，**为什么需要这些信息**
  - 然后再次使用Function Calling调用其他工具获取信息
  - 重复这个过程，直到获得足够信息

**这是ReAct循环的核心**：Reasoning → Acting → Observation → Reasoning → Acting → Observation → ... → Response

### 5. 响应 (Response)
基于所有推理和观察，给出最终的回答。

格式：**Response:** [你的最终回答]

## 安全事件响应循环示例

**第一轮：**
Reasoning: 检测到可疑IP 192.168.1.100，需要查询该IP的威胁情报和资产信息，评估威胁级别。
Acting: 使用 ip_threat_lookup 工具查询IP威胁情报（注意：这里必须通过Function Calling实际调用工具）
Observation: 工具返回了IP的基本威胁信息（威胁评分：7/10，恶意标签：C2服务器），但缺少该IP关联的资产信息和历史事件记录。（注意：只有在Function Calling返回结果后才能写Observation）

**第二轮（循环）：**
Reasoning: 基于第一轮的观察，该IP威胁评分较高，需要进一步查询关联资产和历史事件，以评估影响范围和确定响应措施。
Acting: 使用 asset_query 和 event_history 工具查询关联资产和历史事件（注意：这里必须通过Function Calling实际调用工具）
Observation: 工具返回了关联资产信息（3台服务器受影响）和历史事件（过去7天有5次异常连接），现在信息完整，可以给出响应建议。（注意：只有在Function Calling返回结果后才能写Observation）

**最终：**
Response: 综合威胁情报、资产信息和历史事件，给出完整的安全分析和响应建议。

## 重要指示（SOC安全分析师工作规范）

1. **🔁 必须实现ReAct循环逻辑（事件响应核心）**：
   - 如果观察结果不完整、查询未找到结果、或需要更多威胁情报来评估安全事件，**必须基于观察结果继续推理和行动**
   - 在Reasoning中明确说明：基于之前的观察，还需要什么关键安全信息（威胁情报、资产信息、日志数据、历史事件等）
   - 然后使用Function Calling调用其他安全工具获取信息
   - 重复这个过程，直到获得足够信息进行安全评估或确定无法获取更多信息
   - **这是ReAct模式的核心：循环推理直到安全事件分析完成**

2. **⚠️ 工具调用规则（最关键）**：
   - 当需要获取威胁情报、查询日志、分析资产、执行响应操作时，**必须使用Function Calling机制调用工具**
   - **绝对不要**只在文本中写"Acting: 使用xxx工具"而不实际调用Function Calling
   - 如果你只在文本中描述工具调用而没有使用Function Calling，工具将不会被执行，你也不应该编造威胁情报或安全数据
   - 只有在真正通过Function Calling调用工具并获得结果后，才能在Observation中分析安全数据
   - 如果没有调用工具，不要在Observation中编造或模拟威胁情报、IP信息、资产数据等

3. **安全数据使用规则（关键）**：
   - 工具调用完成后，工具会返回实际的威胁情报、日志数据或资产信息
   - **你必须使用工具返回的实际安全数据**，而不是使用占位符（如[IP地址]、[威胁类型]、[资产名称]、[威胁评分]等）
   - 如果工具返回了JSON格式的数据，请解析JSON并提取实际的安全指标值
   - 如果工具返回了对象或数组，请提取其中的具体安全字段值（威胁评分、置信度、时间戳、关联事件等）
   - **绝对不要**在Response中使用占位符或模板变量，必须使用工具返回的真实安全数据
   - 如果工具返回的数据不完整或查询未找到结果，在Observation中说明缺少哪些关键信息，然后继续推理是否需要调用其他工具补充调查

4. **多工具协同调查**：
   - 安全事件分析通常需要多个工具协同工作（威胁情报+资产信息+日志分析）
   - 如果一个问题需要多个工具协同调查，可以在一次调用中同时选择多个工具
   - 系统会执行所有选中的工具并综合结果，然后交给你进行安全分析和判断

5. **安全工具选择策略**：
   - 仔细阅读每个工具的描述，选择最合适的安全工具
   - 优先使用威胁情报工具查询已知威胁
   - 优先使用日志分析工具查询安全事件
   - 优先使用资产查询工具了解受影响范围
   - 如果多个工具都可能有用，可以同时选择它们，让系统综合结果

6. **安全分析原则**：
   - 优先使用工具获取真实威胁情报，而不是猜测或假设
   - 基于实际数据进行分析，避免主观判断
   - 对于简单问题，可以简化格式，但必须包含Reasoning和Response
   - 在Acting部分，**只写简洁的文字说明和工具名称**，不要写详细的参数信息

请严格按照ReAct格式组织你的回复，实现循环推理直到任务完成。`;
  }

  startReActRun() {
    this.reActState = {
      active: true,
      iteration: 0,
      lastContent: '',
      noticeShown: false
    };
    logger.debug('[ReAct] Run started');
  }

  recordReActIteration() {
    if (!this.reActState) {
      this.reActState = { active: false, iteration: 0 };
    }
    if (!this.reActState.active) {
      this.startReActRun();
    }
    this.reActState.iteration = (this.reActState.iteration || 0) + 1;
    logger.debug('[ReAct] Iteration progress:', this.reActState.iteration);
  }

  isReActRunning() {
    return !!this.reActState?.active;
  }

  showReActCompletionNotice() {
    try {
      const messagesEl = document.getElementById('messages');
      if (!messagesEl) return;
      const noticeDiv = document.createElement('div');
      noticeDiv.className = 'react-complete-notice';
      noticeDiv.innerHTML = `
        <div class="react-complete-card">
          <div class="react-complete-header">
            <span class="react-complete-icon">✅</span>
            <div>
              <div class="react-complete-title">ReAct 推理循环已结束</div>
              <div class="react-complete-subtitle">基于当前信息生成最终响应</div>
            </div>
          </div>
        </div>
      `;
      messagesEl.appendChild(noticeDiv);
      this.scrollToBottom();
    } catch (error) {
      logger.warn('[ReAct] Failed to show completion notice:', error);
    }
  }

  getReActFinalContent(preferredContent = '') {
    if (preferredContent && preferredContent.trim().length > 0) {
      return preferredContent;
    }
    const lastContent = this.reActState?.lastContent;
    if (lastContent && lastContent.trim().length > 0) {
      return lastContent;
    }
    return preferredContent;
  }

  tryCompleteReActRun(fullContent = '') {
    if (!this.isReActRunning()) {
      return false;
    }
    const hasPlainText = fullContent && fullContent.trim().length > 0;
    const reactData = TextFormatter.parseReActFormat(fullContent);
    const hasResponseBlock = reactData && reactData.response && reactData.response.trim().length > 0;
    if (hasResponseBlock || (!reactData && hasPlainText)) {
      logger.debug('[ReAct] Run completed after iterations:', this.reActState.iteration || 0);
      this.reActState.active = false;
      this.reActState.iteration = 0;
      this.reActState.lastContent = fullContent || '';
      if (!this.reActState.noticeShown) {
        this.showReActCompletionNotice();
        this.reActState.noticeShown = true;
      }
      return true;
    }
    return false;
  }
  
  /**
   * 处理Function Calling响应中的工具调用
   * 🔧 增强：添加循环调用检测和超时保护
   */
  async handleFunctionCalls(toolCalls, functions, originalQuery, recursionDepth = 0) {
    try {
      // 🔧 防止无限循环：限制递归深度
      const MAX_RECURSION_DEPTH = DEFAULT_CONFIG.ui.maxToolCallsPerTurn || 5;
      if (recursionDepth >= MAX_RECURSION_DEPTH) {
        logger.error('[FunctionCall] ⚠️ 达到最大递归深度，停止工具调用:', recursionDepth);
        this.showError(`工具调用已达到最大深度限制（${MAX_RECURSION_DEPTH}），可能存在循环调用。请检查工具配置或重新提问。`);
        return;
      }
      
      logger.info('[FunctionCall] ========== 开始处理工具调用 ==========');
      
      // 🔧 修复：确保toolCalls是数组，防止未定义错误
      if (!toolCalls || !Array.isArray(toolCalls) || toolCalls.length === 0) {
        logger.warn('[FunctionCall] ⚠️ 无效的工具调用数据:', toolCalls);
        return;
      }
      
      logger.info('[FunctionCall] 工具调用数量:', toolCalls.length);
      logger.info('[FunctionCall] 递归深度:', recursionDepth);
      logger.info('[FunctionCall] 原始查询:', originalQuery);
      logger.debug('[FunctionCall] 原始 toolCalls 数据:', JSON.stringify(toolCalls, null, 2));
      
      const parsedCalls = FunctionCallAdapter.extractToolCalls({ tool_calls: toolCalls });
      
      logger.info('[FunctionCall] 解析后的工具调用数量:', parsedCalls.length);
      logger.debug('[FunctionCall] 解析后的 toolCalls:', JSON.stringify(parsedCalls, null, 2));
      
      if (!parsedCalls || parsedCalls.length === 0) {
        logger.warn('[FunctionCall] ⚠️ 没有有效的工具调用被提取');
        return;
      }
      
      this.recordReActIteration();
      
      // 限制最大调用次数
      const maxCalls = DEFAULT_CONFIG.ui.maxToolCallsPerTurn;
      const calls = parsedCalls.slice(0, maxCalls);
      
      if (parsedCalls.length > maxCalls) {
        logger.warn(`[FunctionCall] Truncated ${parsedCalls.length} calls to ${maxCalls}`);
      }
      
      // 分离自动执行和手动确认的工具
      const autoExecuteTools = [];
      const manualConfirmTools = [];
      
      for (const call of calls) {
        // 🔧 修复：确保call.function存在，防止未定义错误
        if (!call.function || !call.function.name) {
          logger.warn('[FunctionCall] Invalid tool call, missing function or name:', call);
          continue;
        }
        
        // 🔧 修复：确保call.id存在，如果没有则生成一个
        const toolCallId = call.id || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const toolIntent = {
          toolName: call.function.name,
          args: call.function.arguments || {},
          toolCallId: toolCallId  // 🔒 保存tool_call_id用于关联结果
        };
        
        // 查找工具所属的服务ID
        const serviceId = this.findServiceIdByTool(toolIntent.toolName);
        if (!serviceId) {
          logger.warn('[FunctionCall] Cannot find service for tool:', toolIntent.toolName);
          this.appendToolExecutionPrompt(toolIntent, originalQuery);
          continue;
        }
        
        // 检查是否配置了自动执行
        const toolKey = `${serviceId}:${toolIntent.toolName}`;
        const isAutoExecute = this.toolsAutoExecute[toolKey] === true;
        
        if (isAutoExecute) {
          autoExecuteTools.push({ toolIntent, serviceId, toolCallId: toolCallId });
        } else {
          manualConfirmTools.push({ toolIntent, serviceId, toolCallId: toolCallId });
        }
      }
      
      // 创建统一的批次ID（如果有自动或手动工具）
      if (autoExecuteTools.length > 0 || manualConfirmTools.length > 0) {
        const batchId = `unified-batch-${Date.now()}`;
        const totalCount = autoExecuteTools.length + manualConfirmTools.length;
        
        // 创建统一批次追踪
        this.pendingManualTools[batchId] = {
          tools: [
            ...autoExecuteTools.map(t => t.toolIntent.toolName),
            ...manualConfirmTools.map(t => t.toolIntent.toolName)
          ],
          results: [],
          originalQuery: originalQuery,
          totalCount: totalCount,
          autoCount: autoExecuteTools.length,
          manualCount: manualConfirmTools.length,
          recursionDepth: recursionDepth  // 🔧 记录递归深度
        };
        
        logger.info('[FunctionCall] Created unified batch:', batchId, 
          'auto:', autoExecuteTools.length, 'manual:', manualConfirmTools.length);
        
        // 如果有多个工具（自动+手动），显示批量提示卡片
        // if (totalCount > 1) {
        //   const messagesEl = document.getElementById('messages');
        //   const batchTipCard = document.createElement('div');
        //   batchTipCard.id = `batch-tip-${batchId}`;
        //   batchTipCard.className = 'batch-tip-card';
          
        //   let tipText = `需要执行 ${totalCount} 个工具`;
        //   if (autoExecuteTools.length > 0 && manualConfirmTools.length > 0) {
        //     tipText = `${autoExecuteTools.length} 个自动执行，${manualConfirmTools.length} 个需要确认`;
        //   }
          
        //   batchTipCard.innerHTML = `
        //     <div style="background: #f59e0b; border-radius: 8px; padding: 10px; color: white; margin-bottom: 8px; box-shadow: 0 2px 4px rgba(245, 158, 11, 0.2);">
        //       <div style="display: flex; align-items: center; gap: 8px;">
        //         <span style="font-size: 16px;">📋</span>
        //         <div style="flex: 1;">
        //           <div style="font-size: 12px; font-weight: 600;">${tipText}</div>
        //           <div style="font-size: 10px; opacity: 0.9; margin-top: 2px;">执行完所有工具后将进行综合分析</div>
        //         </div>
        //         <div id="batch-progress-${batchId}" style="background: rgba(255,255,255,0.3); padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">
        //           0/${totalCount}
        //         </div>
        //       </div>
        //     </div>
        //   `;
        //   messagesEl.appendChild(batchTipCard);
        //   this.scrollToBottom();
        // }
        
        // 执行自动工具
        if (autoExecuteTools.length > 0) {
          logger.info('[FunctionCall] Auto-executing', autoExecuteTools.length, 'tools');
          await this.batchAutoExecuteTools(autoExecuteTools, originalQuery, batchId);
        }
        
        // 显示手动工具卡片
        for (const tool of manualConfirmTools) {
          // 🔧 修复：确保解构的变量都有值，防止未定义错误
          const { toolIntent, serviceId, toolCallId } = tool || {};
          if (!toolIntent || !toolIntent.toolName) {
            logger.warn('[FunctionCall] Invalid manual tool:', tool);
            continue;
          }
          logger.info('[FunctionCall] Manual confirm required:', toolIntent.toolName);
          this.appendToolExecutionPrompt(toolIntent, originalQuery, batchId, serviceId);
        }
      }
    } catch (error) {
      logger.error('[FunctionCall] Error handling function calls:', error);
      this.showError('工具调用处理失败: ' + error.message);
    }
  }
  
  /**
   * 查找工具所属的服务ID
   */
  findServiceIdByTool(toolName) {
    for (const service of this.mcpServices) {
      if (!service.enabled) continue;
      
      const tools = this.mcpToolsCache[service.id];
      if (tools && tools.some(t => t.name === toolName)) {
        return service.id;
      }
    }
    return null;
  }
  
  /**
   * 验证和规范化工具参数
   * 🔧 新增：确保参数符合工具schema要求
   */
  validateAndNormalizeToolArgs(toolName, args, serviceId) {
    // 确保args是对象
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      logger.warn('[ToolValidation] Invalid args type, using empty object:', typeof args);
      return {};
    }
    
    // 从缓存中获取工具定义
    const tools = this.mcpToolsCache[serviceId];
    if (!tools || !Array.isArray(tools)) {
      logger.warn('[ToolValidation] No tools cache for service:', serviceId);
      return args; // 如果找不到工具定义，直接返回原参数
    }
    
    // 查找工具定义
    const toolDef = tools.find(t => t.name === toolName);
    if (!toolDef || !toolDef.inputSchema) {
      logger.warn('[ToolValidation] Tool definition not found or missing inputSchema:', toolName);
      return args; // 如果找不到工具定义，直接返回原参数
    }
    
    const schema = toolDef.inputSchema;
    const properties = schema.properties || {};
    const required = schema.required || [];
    const validatedArgs = {};
    
    logger.debug('[ToolValidation] Validating args against schema:', {
      toolName,
      schemaProperties: Object.keys(properties),
      required,
      providedArgs: Object.keys(args)
    });
    
    // 验证必需参数
    for (const paramName of required) {
      if (!(paramName in args) || args[paramName] === null || args[paramName] === undefined) {
        logger.error(`[ToolValidation] Missing required parameter: ${paramName}`);
        throw new Error(`工具参数错误：缺少必需参数 "${paramName}"`);
      }
    }
    
    // 验证和规范化每个参数
    for (const [paramName, paramValue] of Object.entries(args)) {
      // 如果参数不在schema中，记录警告但保留（允许额外参数）
      if (!(paramName in properties)) {
        logger.warn(`[ToolValidation] Unknown parameter "${paramName}" not in schema, keeping it`);
        validatedArgs[paramName] = paramValue;
        continue;
      }
      
      const paramSchema = properties[paramName];
      const paramType = paramSchema.type;
      
      // 类型转换和验证
      try {
        let normalizedValue = paramValue;
        
        // 类型转换
        if (paramType === 'string' && typeof paramValue !== 'string') {
          normalizedValue = String(paramValue);
          logger.debug(`[ToolValidation] Converted ${paramName} to string:`, normalizedValue);
        } else if (paramType === 'number' || paramType === 'integer') {
          if (typeof paramValue === 'string') {
            const num = paramType === 'integer' ? parseInt(paramValue, 10) : parseFloat(paramValue);
            if (!isNaN(num)) {
              normalizedValue = num;
              logger.debug(`[ToolValidation] Converted ${paramName} to ${paramType}:`, normalizedValue);
            } else {
              logger.warn(`[ToolValidation] Cannot convert ${paramName} to ${paramType}, keeping original`);
            }
          } else if (typeof paramValue !== 'number') {
            logger.warn(`[ToolValidation] Parameter ${paramName} should be ${paramType}, got ${typeof paramValue}`);
          }
        } else if (paramType === 'boolean' && typeof paramValue !== 'boolean') {
          if (typeof paramValue === 'string') {
            normalizedValue = paramValue.toLowerCase() === 'true' || paramValue === '1';
            logger.debug(`[ToolValidation] Converted ${paramName} to boolean:`, normalizedValue);
          } else {
            normalizedValue = Boolean(paramValue);
            logger.debug(`[ToolValidation] Converted ${paramName} to boolean:`, normalizedValue);
          }
        } else if (paramType === 'array' && !Array.isArray(paramValue)) {
          logger.warn(`[ToolValidation] Parameter ${paramName} should be array, got ${typeof paramValue}`);
          // 尝试转换
          if (typeof paramValue === 'string') {
            try {
              normalizedValue = JSON.parse(paramValue);
              if (Array.isArray(normalizedValue)) {
                logger.debug(`[ToolValidation] Parsed ${paramName} as array from JSON string`);
              } else {
                normalizedValue = [paramValue];
                logger.debug(`[ToolValidation] Wrapped ${paramName} in array`);
              }
            } catch {
              normalizedValue = [paramValue];
              logger.debug(`[ToolValidation] Wrapped ${paramName} in array (fallback)`);
            }
          } else {
            normalizedValue = [paramValue];
            logger.debug(`[ToolValidation] Wrapped ${paramName} in array`);
          }
        } else if (paramType === 'object' && typeof paramValue !== 'object') {
          if (typeof paramValue === 'string') {
            try {
              normalizedValue = JSON.parse(paramValue);
              logger.debug(`[ToolValidation] Parsed ${paramName} as object from JSON string`);
            } catch {
              logger.warn(`[ToolValidation] Cannot parse ${paramName} as JSON object`);
              normalizedValue = paramValue; // 保持原值
            }
          } else {
            logger.warn(`[ToolValidation] Parameter ${paramName} should be object, got ${typeof paramValue}`);
          }
        }
        
        // 验证枚举值
        if (paramSchema.enum && Array.isArray(paramSchema.enum)) {
          if (!paramSchema.enum.includes(normalizedValue)) {
            logger.error(`[ToolValidation] Invalid enum value for ${paramName}: ${normalizedValue}, allowed: ${paramSchema.enum.join(', ')}`);
            throw new Error(`工具参数错误：参数 "${paramName}" 的值 "${normalizedValue}" 不在允许的枚举值中。允许的值：${paramSchema.enum.join(', ')}`);
          }
        }
        
        // 验证字符串格式（如email, uri等）
        if (paramType === 'string' && paramSchema.format) {
          // 简单的格式验证
          if (paramSchema.format === 'email' && !normalizedValue.includes('@')) {
            logger.warn(`[ToolValidation] Parameter ${paramName} may not be a valid email: ${normalizedValue}`);
          } else if (paramSchema.format === 'uri' && !normalizedValue.startsWith('http')) {
            logger.warn(`[ToolValidation] Parameter ${paramName} may not be a valid URI: ${normalizedValue}`);
          }
        }
        
        validatedArgs[paramName] = normalizedValue;
      } catch (error) {
        logger.error(`[ToolValidation] Error validating parameter ${paramName}:`, error);
        // 如果是必需参数验证失败，抛出错误；否则使用原值
        if (required.includes(paramName)) {
          throw error;
        }
        validatedArgs[paramName] = paramValue;
      }
    }
    
    logger.info('[ToolValidation] Validation completed:', {
      originalArgs: Object.keys(args).length,
      validatedArgs: Object.keys(validatedArgs).length
    });
    
    return validatedArgs;
  }
  
  /**
   * 🔒 从Acting文本中提取工具名称
   */
  extractToolNamesFromActingText(actingText, functions) {
    // 🔧 修复：确保functions是数组，防止未定义错误
    if (!functions || !Array.isArray(functions)) {
      logger.warn('[ForceCall] Invalid functions array:', functions);
      return [];
    }
    
    // 🔧 修复：确保actingText是字符串
    if (!actingText || typeof actingText !== 'string') {
      logger.warn('[ForceCall] Invalid actingText:', actingText);
      return [];
    }
    
    const extractedNames = [];
    const availableToolNames = functions.map(f => f.function?.name || f.name).filter(Boolean);
    
    logger.debug('[ForceCall] Available tools:', availableToolNames);
    logger.debug('[ForceCall] Acting text:', actingText);
    
    // 方法1: 尝试匹配工具名称（精确匹配）
    for (const toolName of availableToolNames) {
      // 检查工具名称是否出现在文本中（不区分大小写）
      const regex = new RegExp(`\\b${toolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(actingText)) {
        extractedNames.push(toolName);
        logger.debug('[ForceCall] Found tool name:', toolName);
      }
    }
    
    // 方法2: 如果没找到，尝试从文本中提取（使用formatActionText的逻辑）
    if (extractedNames.length === 0) {
      // 匹配 "使用 xxx 工具" 或 "调用 xxx" 等格式
      const toolCallPattern = /(?:使用|调用|执行)?\s*(?:工具[：:])?\s*([a-zA-Z0-9_-]+)/gi;
      let match;
      while ((match = toolCallPattern.exec(actingText)) !== null) {
        const potentialToolName = match[1].trim();
        // 检查是否是有效的工具名称
        if (availableToolNames.includes(potentialToolName)) {
          if (!extractedNames.includes(potentialToolName)) {
            extractedNames.push(potentialToolName);
            logger.debug('[ForceCall] Extracted tool name:', potentialToolName);
          }
        }
      }
    }
    
    logger.info('[ForceCall] Extracted tool names:', extractedNames);
    return extractedNames;
  }
  
  /**
   * 🔒 强制调用从Acting文本中提取的工具
   */
  async forceCallToolsFromActingText(toolNames, actingText, functions, originalQuery) {
    try {
      // 🔧 修复：确保参数有效，防止未定义错误
      if (!toolNames || !Array.isArray(toolNames) || toolNames.length === 0) {
        logger.error('[ForceCall] 🔒 无效的工具名称列表:', toolNames);
        return;
      }
      
      if (!functions || !Array.isArray(functions)) {
        logger.error('[ForceCall] 🔒 无效的函数列表:', functions);
        return;
      }
      
      logger.info('[ForceCall] 🔒 强制调用工具:', toolNames);
      
      // 构建模拟的tool_calls格式
      const mockToolCalls = [];
      
      for (const toolName of toolNames) {
        // 🔧 修复：确保functions是数组，防止未定义错误
        if (!functions || !Array.isArray(functions)) {
          logger.warn('[ForceCall] Invalid functions array:', functions);
          continue;
        }
        
        // 查找工具定义以获取参数结构
        const toolDef = functions.find(f => (f.function?.name || f.name) === toolName);
        
        if (!toolDef) {
          logger.warn('[ForceCall] Tool definition not found:', toolName);
          continue;
        }
        
        // 尝试从Acting文本中提取参数（简单实现）
        const args = this.extractToolArgsFromActingText(actingText, toolName, toolDef);
        
        mockToolCalls.push({
          id: `force_call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'function',
          function: {
            name: toolName,
            arguments: JSON.stringify(args)
          }
        });
      }
      
      if (mockToolCalls && Array.isArray(mockToolCalls) && mockToolCalls.length > 0) {
        logger.info('[ForceCall] 🔒 构建的模拟tool_calls:', mockToolCalls.length);
        // 使用handleFunctionCalls处理这些工具调用
        // 🔧 增强：传递递归深度，防止无限循环
        await this.handleFunctionCalls(mockToolCalls, functions, originalQuery, 0);  // 强制调用从深度0开始
      } else {
        logger.error('[ForceCall] 🔒 无法构建tool_calls，强制重新生成');
        await this.forceRegenerateWithFunctionCalling(originalQuery, actingText, functions);
      }
    } catch (error) {
      logger.error('[ForceCall] 🔒 强制调用工具失败:', error);
      await this.forceRegenerateWithFunctionCalling(originalQuery, actingText, functions);
    }
  }
  
  /**
   * 🔒 从Acting文本中提取工具参数（简单实现）
   */
  extractToolArgsFromActingText(actingText, toolName, toolDef) {
    const args = {};
    const parameters = toolDef.function?.parameters || {};
    const properties = parameters.properties || {};
    
    // 简单实现：尝试从文本中提取参数值
    // 这里可以根据实际需求改进
    for (const [paramName, paramSchema] of Object.entries(properties)) {
      // 尝试匹配 "paramName: value" 或 "paramName=value" 格式
      const patterns = [
        new RegExp(`${paramName}[：:=]\\s*([^\\s,，\\n]+)`, 'i'),
        new RegExp(`"${paramName}"[：:]\\s*"([^"]+)"`, 'i')
      ];
      
      for (const pattern of patterns) {
        const match = actingText.match(pattern);
        if (match && match[1]) {
          args[paramName] = match[1].trim();
          break;
        }
      }
    }
    
    logger.debug('[ForceCall] Extracted args for', toolName, ':', args);
    return args;
  }
  
  /**
   * 🔒 强制AI重新生成并要求使用Function Calling
   */
  async forceRegenerateWithFunctionCalling(originalQuery, actingText, functions) {
    try {
      logger.info('[ForceCall] 🔒 强制AI重新生成并要求使用Function Calling');
      
      const conversation = this.getCurrentConversation();
      
      // 构建强制提示
      const forcePrompt = `[系统安全检查失败]

你刚才在文本中写了"Acting: ${actingText}"，但没有使用Function Calling机制实际调用工具。

**重要要求：**
1. 你必须使用Function Calling机制（通过tool_calls字段）来调用工具
2. 不能只在文本中写"Acting: 使用xxx工具"而不实际调用工具
3. 如果你需要调用工具，必须在Function Calling中选择工具并调用
4. 只有在真正调用工具并获得结果后，才能在Observation中分析结果
5. 如果没有调用工具，不要在Observation中编造或模拟工具结果

**原始用户问题：** ${originalQuery}

请重新回答，并确保如果需要调用工具，必须使用Function Calling机制。`;

      // 准备Function Calling工具
      let systemPrompt = this.buildSystemPromptForFunctionCalling();
      const options = {};
      if (functions.length > 0) {
        options.tools = FunctionCallAdapter.cleanFunctionsForAPI(functions);
        options.tool_choice = 'auto'; // 强制使用工具
      }
      
      // 构建消息（不包含刚才失败的响应，避免无限循环）
      const filteredMessages = conversation ? conversation.messages.filter(m => {
        // 移除包含相同actingText的assistant消息
        if (m.role === MESSAGE_ROLES.ASSISTANT && m.content) {
          const reactData = TextFormatter.parseReActFormat(m.content);
          if (reactData && reactData.acting && reactData.acting.includes(actingText)) {
            return false; // 移除失败的响应
          }
        }
        return true;
      }) : [];
      
      const historyWithContext = this.getConversationHistoryWithContext(conversation, filteredMessages);
      const messages = this.aiService.buildMessages(
        forcePrompt,
        historyWithContext,
        systemPrompt
      );
      
      logger.debug('[ForceCall] Sending force regenerate request');
      
      this.showLoading();
      const response = await this.aiService.sendMessage(messages, options);
      this.hideLoading();
      
      // 处理响应
      let fullContent = '';
      let toolCallsFromStream = null;
      if (response.stream) {
        // 🔧 修复：handleStreamResponse现在返回对象
        const streamResult = await this.handleStreamResponse(response);
        if (typeof streamResult === 'object' && streamResult !== null) {
          fullContent = streamResult.content || '';
          toolCallsFromStream = streamResult.tool_calls || null;
        } else {
          fullContent = streamResult || '';
        }
      } else if (response.content) {
        fullContent = response.content;
        this.appendMessage(MESSAGE_ROLES.ASSISTANT, response.content);
        this.saveConversations();
      }
      
      // 检查Function Calling
      // 🔧 修复：优先使用流式响应返回的tool_calls
      // 🔧 增强：传递递归深度，防止无限循环
      // 🔧 修复：确保toolCalls是数组，防止未定义错误
      const toolCalls = toolCallsFromStream || response.tool_calls;
      if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
        logger.info('[ForceCall] ✅ Function calls detected after force regenerate');
        await this.handleFunctionCalls(toolCalls, functions, originalQuery, 1);  // 强制重新生成后从深度1开始
      } else {
        // 如果还是没有tool_calls，再次检查（但只检查一次，避免无限循环）
        this.tryCompleteReActRun(fullContent || response.content || '');
        if (fullContent) {
          const reactData = TextFormatter.parseReActFormat(fullContent);
          if (reactData && reactData.acting) {
            const actingTextLower = reactData.acting.toLowerCase();
            const toolKeywords = ['工具', 'tool', '使用', '调用', '执行'];
            const hasToolMention = toolKeywords.some(keyword => actingTextLower.includes(keyword));
            
            if (hasToolMention) {
              logger.error('[ForceCall] 🔒 再次检查失败：AI仍然没有使用Function Calling');
              const errorMsg = '安全工具调用检查失败：AI仍然没有使用Function Calling机制调用工具。这可能是工具配置问题，请检查工具配置或联系管理员。';
              this.showError(errorMsg);
              
              // 显示详细的错误信息
              const errorDiv = document.createElement('div');
              errorDiv.className = 'error-message';
              errorDiv.style.cssText = `
                background: #fee2e2;
                border-left: 4px solid #ef4444;
                border-radius: 8px;
                padding: 12px 16px;
                margin: 8px 0;
                color: #991b1b;
                font-size: 13px;
                box-shadow: 0 2px 4px rgba(239, 68, 68, 0.1);
              `;
              errorDiv.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                  <span style="font-size: 18px;">🔒</span>
                  <strong style="font-weight: 600;">安全工具调用检查失败（最终）</strong>
                </div>
                <div style="margin-top: 4px; line-height: 1.5;">
                  AI在强制重新生成后仍然没有使用Function Calling机制调用工具。
                  <br><br>
                  <strong>可能的原因：</strong>
                  <ul style="margin: 4px 0; padding-left: 20px;">
                    <li>工具配置不正确</li>
                    <li>AI模型不支持Function Calling</li>
                    <li>工具列表为空或工具未启用</li>
                  </ul>
                  <br>
                  请检查工具配置或联系管理员。
                </div>
              `;
              
              const messagesEl = document.getElementById('messages');
              const lastMessage = messagesEl.lastElementChild;
              if (lastMessage && lastMessage.classList.contains('assistant')) {
                lastMessage.appendChild(errorDiv);
              } else {
                messagesEl.appendChild(errorDiv);
              }
              this.scrollToBottom();
            }
          }
        }
      }
      
      // 生成建议行动（只有在有tool_calls或没有Acting时才生成）
      if (fullContent && response.tool_calls) {
        // 工具调用后会在handleFunctionCalls中处理，这里不需要生成建议
      } else if (this.config.enableSuggestedActions !== false && !this.isReActRunning()) {
        const suggestionContent = this.getReActFinalContent(fullContent);
        if (suggestionContent) {
          await this.generateSuggestedActions(suggestionContent, originalQuery);
        }
      }
    } catch (error) {
      logger.error('[ForceCall] 🔒 强制重新生成失败:', error);
      this.showError('强制重新生成失败: ' + error.message);
    }
  }
  
  /**
   * 批量自动执行工具并汇总结果
   */
  async batchAutoExecuteTools(toolsToExecute, originalQuery, batchId = null) {
    const messagesEl = document.getElementById('messages');
    const toolResults = [];
    
    // 串行执行每个工具，使用和手动工具相同的UI
    for (let i = 0; i < toolsToExecute.length; i++) {
      // 🔧 修复：确保解构的变量都有默认值，防止未定义错误
      const { toolIntent, serviceId, toolCallId } = toolsToExecute[i] || {};
      
      // 🔧 修复：验证必要字段存在
      if (!toolIntent || !toolIntent.toolName) {
        logger.error(`[BatchExecute] Invalid tool at index ${i}:`, toolsToExecute[i]);
        continue;
      }
      
      try {
        logger.info(`[BatchExecute] Executing ${i + 1}/${toolsToExecute.length}:`, toolIntent.toolName);
        
        // 创建和手动工具相同的UI卡片
        const promptId = `auto-tool-prompt-${Date.now()}-${i}`;
        const promptDiv = document.createElement('div');
        promptDiv.className = 'tool-execution-prompt auto-executing';
        promptDiv.id = promptId;
        
        // 获取服务名称
        let serviceName = '默认服务';
        if (serviceId && this.mcpServices) {
          const service = this.mcpServices.find(s => s.id === serviceId);
          if (service) {
            serviceName = service.name;
          }
        }
        
        // 构建参数显示
        const { toolName, args } = toolIntent;
        let argsInputsHtml = '';
        if (Object.keys(args).length > 0) {
          argsInputsHtml = '<div style="display: flex; flex-direction: column; gap: 6px;">';
          for (const [key, value] of Object.entries(args)) {
            const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
            argsInputsHtml += `
              <div style="display: flex; align-items: center; gap: 6px;">
                <label style="font-size: 10px; font-weight: 600; color: rgba(255, 255, 255, 0.9); min-width: 60px; flex-shrink: 0;">${TextFormatter.escapeHtml(key)}:</label>
                <input type="text" class="tool-arg-input" data-arg-name="${TextFormatter.escapeHtml(key)}" value="${TextFormatter.escapeHtml(valueStr)}" disabled style="flex: 1; font-family: 'Courier New', monospace; font-size: 10px; background: rgba(255, 255, 255, 0.7); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 4px; padding: 4px 6px; color: #1f2937; cursor: not-allowed;" />
              </div>
            `;
          }
          argsInputsHtml += '</div>';
        } else {
          argsInputsHtml = '<div style="font-size: 10px; color: rgba(255, 255, 255, 0.6); font-style: italic; padding: 4px 0;">无参数</div>';
        }
        
        promptDiv.innerHTML = `
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; padding: 8px 10px; color: white; box-shadow: 0 2px 6px rgba(102, 126, 234, 0.2);">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
                <span style="font-size: 14px;">⚡</span>
                <span style="font-size: 11px; font-weight: 500; letter-spacing: 0.2px;">自动执行: 
                  <strong style="font-family: 'Courier New', monospace; background: rgba(255, 255, 255, 0.2); padding: 1px 4px; border-radius: 3px; font-weight: 600; font-size: 10px; margin-left: 2px;">
                    ${TextFormatter.escapeHtml(toolName)}
                  </strong>
                </span>
                <span style="font-size: 9px; color: rgba(255, 255, 255, 0.8); background: rgba(255, 255, 255, 0.15); padding: 1px 5px; border-radius: 10px; margin-left: 6px; font-weight: 500; letter-spacing: 0.2px;">
                  [${TextFormatter.escapeHtml(serviceName)}]
                </span>
              </div>
              <button class="tool-prompt-toggle" style="background: rgba(255, 255, 255, 0.15); border: none; color: white; cursor: pointer; padding: 2px 6px; border-radius: 4px; font-size: 10px; transition: all 0.2s ease; flex-shrink: 0;">
                <span style="display: inline-block; transition: transform 0.2s ease;">▼</span>
              </button>
            </div>
            <div class="tool-prompt-details" style="max-height: 0; overflow: hidden; opacity: 0; transition: max-height 0.3s ease, opacity 0.2s ease, margin 0.3s ease; margin: 0;">
              <div>
                <div style="font-size: 9px; font-weight: 600; color: rgba(255, 255, 255, 0.8); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">执行参数</div>
                ${argsInputsHtml}
              </div>
              <div class="tool-prompt-result" style="display: none;"></div>
              <div class="auto-execute-status" style="margin-top: 8px; padding: 6px 8px; background: rgba(255, 255, 255, 0.1); border-radius: 4px; font-size: 10px; display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 12px;">⏳</span>
                <span>执行中...</span>
              </div>
            </div>
          </div>
        `;
        
        messagesEl.appendChild(promptDiv);
        this.scrollToBottom();
        
        // 添加折叠功能
        const toggleBtn = promptDiv.querySelector('.tool-prompt-toggle');
        const detailsDiv = promptDiv.querySelector('.tool-prompt-details');
        const toggleArrow = toggleBtn.querySelector('span');
        
        toggleBtn.addEventListener('click', () => {
          const isExpanded = detailsDiv.style.maxHeight && detailsDiv.style.maxHeight !== '0px';
          
          if (isExpanded) {
            detailsDiv.style.maxHeight = '0';
            detailsDiv.style.opacity = '0';
            detailsDiv.style.margin = '0';
            toggleArrow.style.transform = 'rotate(0deg)';
          } else {
            detailsDiv.style.maxHeight = '800px';
            detailsDiv.style.opacity = '1';
            detailsDiv.style.marginTop = '6px';
            toggleArrow.style.transform = 'rotate(-180deg)';
          }
        });
        
        // 执行工具
        const result = await this.executeToolFromIntent(toolIntent, originalQuery);
        
        // 执行完成后不自动展开，用户可以手动点击箭头查看详情
        
        // 更新状态为成功并显示结果
        const statusDiv = promptDiv.querySelector('.auto-execute-status');
        if (statusDiv) {
          statusDiv.innerHTML = `
            <span style="font-size: 12px;">✓</span>
            <span>执行成功</span>
          `;
          statusDiv.style.background = 'rgba(16, 185, 129, 0.2)';
          statusDiv.style.borderLeft = '3px solid #10b981';
        }
        
        // 显示执行结果
        const resultDiv = promptDiv.querySelector('.tool-prompt-result');
        if (resultDiv) {
          resultDiv.style.display = 'block';
          resultDiv.innerHTML = `
            <div style="font-size: 9px; font-weight: 600; color: rgba(255, 255, 255, 0.8); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; margin-top: 8px;">执行结果</div>
            <div style="background: rgba(255, 255, 255, 0.95); border-radius: 5px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.3); border-left: 3px solid #10b981;">
              <div style="padding: 4px 8px; font-weight: 600; font-size: 9px; display: flex; align-items: center; gap: 4px; background-color: #d1fae5; color: #065f46;">✓ 执行成功</div>
              <pre style="color: #1f2937; padding: 8px; margin: 0; font-family: 'Courier New', monospace; font-size: 10px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; max-height: 300px; overflow-y: auto; background: #f9fafb; border-top: 1px solid rgba(0,0,0,0.05);">${TextFormatter.escapeHtml(JSON.stringify(result, null, 2))}</pre>
            </div>
          `;
        }
        
        // 收集结果
        toolResults.push({
          toolName: toolIntent.toolName,
          args: toolIntent.args,
          result: result,
          serviceName: serviceName
        });
        
        // 保存到对话历史（使用标准Function Calling格式）
        const conversation = this.getCurrentConversation();
        if (conversation) {
          // 🔒 使用标准Function Calling格式保存工具结果
          const toolCallId_final = toolCallId || toolIntent.toolCallId || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          conversation.messages.push({
            role: MESSAGE_ROLES.TOOL,
            tool_call_id: toolCallId_final,  // 关联tool_call_id
            name: toolIntent.toolName,  // 工具名称
            content: typeof result === 'string' ? result : JSON.stringify(result),  // 工具结果内容
            // 保留额外信息用于UI显示
            toolName: toolIntent.toolName,
            args: toolIntent.args,
            result: result,  // 保存原始结果对象（用于UI显示）
            serviceName: serviceName,
            timestamp: Date.now()
          });
          
          // 🔧 将工具结果添加到缓存
          if (conversation && conversation.id) {
            this.addToolResultToCache(conversation.id, {
              toolName: toolIntent.toolName,
              result: result,
              error: null,
              args: toolIntent.args,
              serviceName: serviceName,
              timestamp: new Date().toISOString(),
              toolCallId: toolCallId_final
            });
          } else {
            logger.warn('[BatchExecute] Cannot add to cache: conversation or conversation.id is missing');
          }
        }
        
      } catch (error) {
        logger.error(`[BatchExecute] Error executing ${toolIntent.toolName}:`, error);
        
        // 执行失败后不自动展开，用户可以手动点击箭头查看错误信息
        
        // 更新为失败状态
        const statusDiv = promptDiv.querySelector('.auto-execute-status');
        if (statusDiv) {
          statusDiv.innerHTML = `
            <span style="font-size: 12px;">✕</span>
            <span>执行失败: ${TextFormatter.escapeHtml(error.message)}</span>
          `;
          statusDiv.style.background = 'rgba(239, 68, 68, 0.2)';
          statusDiv.style.borderLeft = '3px solid #ef4444';
        }
        
        toolResults.push({
          toolName: toolIntent.toolName,
          args: toolIntent.args,
          error: error.message
        });
        
        // 🔧 将失败的工具结果也添加到缓存
        const conversation = this.getCurrentConversation();
        if (conversation) {
          this.addToolResultToCache(conversation.id, {
            toolName: toolIntent.toolName,
            result: null,
            error: error.message,
            args: toolIntent.args,
            serviceName: serviceName || '未知服务',
            timestamp: new Date().toISOString(),
            toolCallId: toolIntent.toolCallId || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
          });
        }
      }
    }
    
    // 保存对话历史
    this.saveConversations();
    
    // 如果有统一批次ID，将结果添加到批次中
    if (batchId && this.pendingManualTools[batchId]) {
      const batch = this.pendingManualTools[batchId];
      batch.results.push(...toolResults);
      
      // 更新统一批次的进度
      const progressEl = document.getElementById(`batch-progress-${batchId}`);
      if (progressEl) {
        progressEl.textContent = `${batch.results.length}/${batch.totalCount}`;
      }
      
      logger.info(`[BatchExecute] Added ${toolResults.length} auto results to unified batch. Progress: ${batch.results.length}/${batch.totalCount}`);
      
      // 检查是否所有工具（包括手动工具）都完成了
      // 🔧 修复：检查批次是否已被取消，如果已取消则不继续处理
      if (batch.cancelled) {
        logger.info('[BatchExecute] Batch was cancelled by user, skipping comprehensive analysis');
        return;
      }
      
      if (batch.results.length === batch.totalCount) {
        logger.info('[BatchExecute] All tools in unified batch completed, sending for comprehensive analysis');
        
        // 🔧 修复：再次检查是否已被取消（防止竞态条件）
        if (batch.cancelled) {
          logger.info('[BatchExecute] Batch was cancelled during execution, skipping comprehensive analysis');
          return;
        }
        
        // 移除批量提示卡片（不再显示"所有工具已执行完成"）
        const batchTipCard = document.getElementById(`batch-tip-${batchId}`);
        if (batchTipCard) {
          batchTipCard.remove();
        }
        
        this.showLoading();
        try {
          await this.sendToolResultsToAI(batch.results, batch.originalQuery);
        } catch (sendError) {
          logger.error('[BatchExecute] Error sending tool results to AI:', sendError);
          this.showError('综合分析失败: ' + sendError.message);
        } finally {
          this.hideLoading();
          // 清理批次数据（无论成功或失败都要清理）
          if (this.pendingManualTools[batchId]) {
            delete this.pendingManualTools[batchId];
          }
        }
      }
    } else {
      // 没有统一批次ID，独立执行（向后兼容）
      logger.info('[BatchExecute] No unified batch, sending results to AI directly');
      try {
        await this.sendToolResultsToAI(toolResults, originalQuery);
      } catch (sendError) {
        logger.error('[BatchExecute] Error sending tool results to AI:', sendError);
        this.showError('综合分析失败: ' + sendError.message);
      }
    }
  }
  
  /**
   * 检查工具结果是否已经足够回答用户问题
   * 🔧 修复：防止AI在已经得到足够信息时继续调用工具
   */
  checkIfToolResultsAreSufficient(toolResults, originalQuery) {
    if (!toolResults || toolResults.length === 0) {
      return false;
    }
    
    const queryLower = (originalQuery || '').toLowerCase();
    
    // 检查是否查询Owner信息
    if (queryLower.includes('owner') || queryLower.includes('所有者') || queryLower.includes('归属')) {
      // 检查是否有工具返回了Owner信息
      const hasOwnerInfo = toolResults.some(tr => {
        if (tr.error) return false;
        const resultStr = JSON.stringify(tr.result || '').toLowerCase();
        return resultStr.includes('owner') || 
               resultStr.includes('所有者') || 
               resultStr.includes('归属') ||
               resultStr.includes('organization') ||
               resultStr.includes('组织') ||
               resultStr.includes('company') ||
               resultStr.includes('公司');
      });
      
      if (hasOwnerInfo) {
        logger.info('[ToolCheck] ✅ Owner information found in tool results');
        return true;
      }
    }
    
    // 检查是否查询IP信息
    if (queryLower.includes('ip') && (queryLower.includes('信息') || queryLower.includes('info') || queryLower.includes('查询'))) {
      // 检查是否有工具返回了IP相关信息
      const hasIpInfo = toolResults.some(tr => {
        if (tr.error) return false;
        const resultStr = JSON.stringify(tr.result || '');
        // 如果结果不是空对象或空数组，认为有信息
        return resultStr && resultStr.length > 10 && 
               !resultStr.includes('null') && 
               !resultStr.includes('[]') &&
               !resultStr.includes('{}') &&
               !resultStr.includes('not found') &&
               !resultStr.includes('未找到');
      });
      
      if (hasIpInfo) {
        logger.info('[ToolCheck] ✅ IP information found in tool results');
        return true;
      }
    }
    
    // 检查是否有成功的工具结果且结果包含实际数据
    const hasSuccessfulResults = toolResults.some(tr => {
      if (tr.error) return false;
      const resultStr = JSON.stringify(tr.result || '');
      // 检查结果是否包含实际数据（不是空值、空数组、空对象或错误信息）
      return resultStr && 
             resultStr.length > 10 && 
             !resultStr.includes('null') && 
             !resultStr.includes('[]') &&
             !resultStr.includes('{}') &&
             !resultStr.includes('not found') &&
             !resultStr.includes('未找到') &&
             !resultStr.includes('error') &&
             !resultStr.includes('错误');
    });
    
    if (hasSuccessfulResults) {
      // 如果用户问题比较简单（少于50字符），认为已有结果足够
      if (queryLower.length < 50) {
        logger.info('[ToolCheck] ✅ Successful tool results found and query is simple');
        return true;
      }
      
      // 如果已经有多个成功的工具结果，也认为足够
      const successfulCount = toolResults.filter(tr => !tr.error && tr.result).length;
      if (successfulCount >= 2) {
        logger.info('[ToolCheck] ✅ Multiple successful tool results found');
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * 将工具结果发送给AI进行综合分析（用户取消工具执行后的版本）
   * 🔧 修复：明确说明用户取消了后续工具调用，基于已有信息给出结论
   */
  async sendToolResultsToAIWithCancellation(toolResults, originalQuery, batchId = null) {
    try {
      const conversation = this.getCurrentConversation();
      
      // 构建综合分析提示（明确说明用户取消了后续工具调用）
      let comprehensivePrompt = `[工具执行结果（用户已取消后续工具调用）]\n\n`;
      comprehensivePrompt += `用户取消了部分工具的执行，请基于以下已执行的工具结果，给出分析结论：\n\n`;
      comprehensivePrompt += `共执行了 ${toolResults.length} 个工具，结果如下：\n\n`;
      
      toolResults.forEach((tr, index) => {
        comprehensivePrompt += `## ${index + 1}. ${tr.toolName}\n`;
        if (tr.error) {
          comprehensivePrompt += `❌ 执行失败: ${tr.error}\n\n`;
        } else {
          comprehensivePrompt += `✓ 执行成功\n`;
          comprehensivePrompt += `结果:\n${JSON.stringify(tr.result, null, 2)}\n\n`;
        }
      });
      
      comprehensivePrompt += `\n**重要说明：**\n`;
      comprehensivePrompt += `1. 用户已明确取消后续工具调用，请基于以上已有的工具结果给出分析结论\n`;
      comprehensivePrompt += `2. **不要**再请求调用其他工具，直接基于已有信息回答用户的问题\n`;
      comprehensivePrompt += `3. 如果已有信息不足以完全回答用户问题，请明确说明哪些信息缺失，但不要继续调用工具\n`;
      comprehensivePrompt += `4. 基于已有信息给出尽可能详细和专业的分析\n`;
      comprehensivePrompt += `5. **必须使用工具返回的实际安全数据**（威胁情报、日志数据、资产信息），而不是使用占位符`;
      
      // 🔧 修复：包含完整的对话历史（包括tool_calls和tool结果），让AI看到完整的ReAct上下文
      // 但是不传递tools选项，强制AI生成文本而不是调用工具
      const historyWithContext = this.getConversationHistoryWithContext(conversation);
      const messages = this.aiService.buildMessages(
        comprehensivePrompt,
        historyWithContext,
        null,  // 不使用system prompt（避免ReAct循环提示）
        true   // 🔧 修复：includeToolResults = true，让AI看到完整的工具调用上下文
                // 这样AI可以理解之前的工具调用和结果，但不会继续调用工具（因为options中没有tools）
      );
      
      const options = {};  // 🔧 关键：不传递tools，强制AI生成文本而不是调用工具
                           // 即使includeToolResults=true，AI看到历史，但因为没有tools选项，无法调用新工具
      
      logger.info('[ToolCancel] Sending cancellation analysis request with', messages.length, 'messages');
      
      // 🔧 修复：先创建消息DOM，确保流式响应能正确显示
      this.appendMessage(MESSAGE_ROLES.ASSISTANT, '');
      const messagesEl = document.getElementById('messages');
      const lastMessage = messagesEl.lastElementChild;
      const contentDiv = lastMessage ? lastMessage.querySelector('.message-content') : null;
      
      const response = await this.aiService.sendMessage(messages, options);
      
      // 处理流式响应
      let fullContent = '';
      if (response.stream) {
        // 🔧 修复：确保response对象包含消息DOM引用
        if (contentDiv && !response.messageDiv) {
          response.messageDiv = lastMessage;
          response.contentDiv = contentDiv;
        }
        
        const streamResult = await this.handleStreamResponse(response);
        if (typeof streamResult === 'object' && streamResult !== null) {
          fullContent = streamResult.content || '';
        } else {
          fullContent = streamResult || '';
        }
        
        // 🔧 修复：如果内容为空，检查是否有tool_calls，并显示适当的提示
        if (!fullContent || fullContent.trim().length === 0) {
          const toolCalls = streamResult?.tool_calls || response.tool_calls;
          if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
            logger.warn('[ToolCancel] ⚠️ Content is empty but tool_calls detected. This should not happen when user cancelled.');
            // 即使有tool_calls，因为用户已取消，也不应该调用工具
            // 强制AI生成文本结论
            if (contentDiv) {
              contentDiv.innerHTML = '<span style="color: #6b7280; font-style: italic;">正在基于已有工具结果生成分析结论...</span>';
            }
            // 重新发送请求，强制生成文本
            await this.forceGenerateConclusionFromToolResults(toolResults, originalQuery);
            return;
          } else {
            logger.warn('[ToolCancel] ⚠️ Content is empty and no tool_calls detected after stream completion');
            // 如果内容为空，尝试重新请求
            if (contentDiv) {
              contentDiv.innerHTML = '<span style="color: #6b7280; font-style: italic;">正在重新生成分析结论...</span>';
            }
            // 重新发送请求，使用更明确的提示
            await this.forceGenerateConclusionFromToolResults(toolResults, originalQuery);
            return;
          }
        }
      } else if (response.content) {
        fullContent = response.content;
        if (contentDiv) {
          const html = TextFormatter.markdownToHtml(response.content);
          contentDiv.innerHTML = html || TextFormatter.escapeHtml(response.content).replace(/\n/g, '<br>');
        }
        this.saveConversations();
      } else {
        // 非流式响应但没有内容，尝试重新请求
        logger.warn('[ToolCancel] ⚠️ Non-stream response but no content received');
        if (contentDiv) {
          contentDiv.innerHTML = '<span style="color: #6b7280; font-style: italic;">正在重新生成分析结论...</span>';
        }
        await this.forceGenerateConclusionFromToolResults(toolResults, originalQuery);
        return;
      }
      
      // 确保UI更新
      this.scrollToBottom();
      logger.info('[ToolCancel] ✅ Conclusion generated based on existing data, content length:', fullContent.length);
    } catch (error) {
      logger.error('[ToolCancel] Error generating conclusion:', error);
      this.showError('生成结论失败: ' + error.message);
      throw error;
    }
  }
  
  /**
   * 强制基于工具结果生成结论（当流式响应失败时使用）
   * 🔧 修复：使用更简单直接的提示，确保AI生成文本
   * 🔧 增强：添加重试机制和更好的错误处理
   */
  async forceGenerateConclusionFromToolResults(toolResults, originalQuery, retryCount = 0) {
    const MAX_RETRIES = 2; // 最多重试2次
    
    try {
      const conversation = this.getCurrentConversation();
      
      // 🔧 修复：构建更明确、更简洁的提示，确保AI理解需求
      // 如果重试次数增加，进一步简化提示和消息历史
      const isRetry = retryCount > 0;
      let simplePrompt = '';
      
      if (isRetry) {
        // 重试时使用更简单的提示，减少token消耗
        simplePrompt = `用户问题：${originalQuery}\n\n`;
        simplePrompt += `已执行的工具结果：\n`;
        toolResults.forEach((tr, index) => {
          simplePrompt += `${index + 1}. ${tr.toolName}: `;
          if (tr.error) {
            simplePrompt += `失败 - ${tr.error}\n`;
          } else {
            // 限制长度，避免提示过长
            const resultStr = typeof tr.result === 'string' 
              ? tr.result.substring(0, 800)  // 重试时限制更短
              : JSON.stringify(tr.result).substring(0, 800);
            simplePrompt += `${resultStr}${resultStr.length >= 800 ? '...' : ''}\n`;
          }
        });
        simplePrompt += `\n请基于以上工具结果，直接回答用户的问题。不要调用任何工具。`;
      } else {
        // 第一次尝试使用详细提示
        simplePrompt = `**重要：请基于以下已执行的工具结果，直接给出分析结论。**\n\n`;
        simplePrompt += `**用户问题：** ${originalQuery}\n\n`;
        simplePrompt += `**已执行的工具结果：**\n\n`;
        
        toolResults.forEach((tr, index) => {
          simplePrompt += `### ${index + 1}. ${tr.toolName}\n`;
          if (tr.error) {
            simplePrompt += `执行失败: ${tr.error}\n\n`;
          } else {
            // 🔧 修复：限制结果长度，避免提示过长导致AI无法响应
            const resultStr = typeof tr.result === 'string' 
              ? tr.result.substring(0, 1500)  // 限制每个工具结果最多1500字符
              : JSON.stringify(tr.result, null, 2).substring(0, 1500);
            simplePrompt += `执行成功，结果：\n\`\`\`\n${resultStr}${resultStr.length >= 1500 ? '\n...（结果已截断）' : ''}\n\`\`\`\n\n`;
          }
        });
        
        simplePrompt += `\n**要求：**\n`;
        simplePrompt += `1. **必须**基于以上工具结果直接给出分析结论，不要调用任何工具\n`;
        simplePrompt += `2. **必须**使用工具返回的实际数据（不是占位符）\n`;
        simplePrompt += `3. 如果工具结果不完整，请明确说明，但不要继续调用工具\n`;
        simplePrompt += `4. 给出专业的安全分析结论\n`;
        simplePrompt += `\n请直接回答用户的问题，不要调用任何工具。`;
      }
      
      // 🔧 修复：简化消息历史，避免上下文过长导致AI无法响应
      // 重试时进一步减少消息历史，最后一次重试甚至不使用历史
      let messages = [];
      if (isRetry && retryCount >= MAX_RETRIES - 1) {
        // 最后一次重试，不使用历史消息，只使用工具结果（已经在simplePrompt中）
        messages = [
          {
            role: MESSAGE_ROLES.USER,
            content: simplePrompt
          }
        ];
        logger.info('[ToolCancel] Last retry: using minimal context (no history), prompt length:', simplePrompt.length);
      } else {
        const messageLimit = isRetry ? 3 : 6;  // 重试时只取3条，第一次取6条
        const recentMessages = conversation && conversation.messages 
          ? conversation.messages.slice(-messageLimit)
          : [];
        const historyWithContext = this.getConversationHistoryWithContext(conversation, recentMessages);
        messages = this.aiService.buildMessages(
          simplePrompt,
          historyWithContext,
          null,  // 不使用system prompt
          false  // 🔧 修复：不包含工具结果（因为已经在simplePrompt中包含了）
        );
      }
      
      const options = {
        stream: true  // 🔧 修复：强制使用流式响应，确保能收到内容
      };  // 不传递tools
      
      logger.info('[ToolCancel] Force generating conclusion (attempt', retryCount + 1, '), tool results:', toolResults.length);
      logger.debug('[ToolCancel] Prompt length:', simplePrompt.length, 'Messages:', messages.length);
      
      // 🔧 修复：获取或创建消息DOM
      const messagesEl = document.getElementById('messages');
      let lastMessage = messagesEl.lastElementChild;
      let contentDiv = lastMessage ? lastMessage.querySelector('.message-content') : null;
      
      // 如果最后一条消息是空的或者是"正在重新生成"的提示，使用它；否则创建新的
      if (!lastMessage || !lastMessage.classList.contains('assistant') || 
          (contentDiv && !contentDiv.textContent.includes('正在') && !contentDiv.textContent.includes('生成结论失败'))) {
        this.appendMessage(MESSAGE_ROLES.ASSISTANT, '');
        lastMessage = messagesEl.lastElementChild;
        contentDiv = lastMessage ? lastMessage.querySelector('.message-content') : null;
      }
      
      const response = await this.aiService.sendMessage(messages, options);
      
      logger.debug('[ToolCancel] Response received:', {
        hasStream: !!response.stream,
        hasContent: !!response.content,
        hasReadStream: typeof response.readStream === 'function'
      });
      
      // 处理响应
      let fullContent = '';
      if (response.stream) {
        // 传递已存在的消息DOM引用
        if (lastMessage && contentDiv) {
          response.messageDiv = lastMessage;
          response.contentDiv = contentDiv;
        }
        
        try {
          const streamResult = await this.handleStreamResponse(response);
          fullContent = typeof streamResult === 'object' && streamResult !== null 
            ? (streamResult.content || '') 
            : (streamResult || '');
          
          logger.debug('[ToolCancel] Stream result:', {
            isObject: typeof streamResult === 'object',
            hasContent: !!fullContent,
            contentLength: fullContent.length,
            hasToolCalls: !!(streamResult?.tool_calls)
          });
        } catch (streamError) {
          logger.error('[ToolCancel] Error reading stream (attempt', retryCount + 1, '):', streamError);
          logger.error('[ToolCancel] Stream error details:', {
            message: streamError.message,
            stack: streamError.stack
          });
          
          // 🔧 修复：如果流式响应失败，且不是最后一次重试，直接重试
          // 如果是最后一次重试，尝试非流式响应作为降级方案
          if (retryCount < MAX_RETRIES) {
            logger.info('[ToolCancel] Stream failed, will retry...');
            // 不在这里尝试fallback，直接重试
            fullContent = ''; // 确保fullContent为空，触发重试逻辑
          } else {
            // 最后一次重试，尝试非流式响应作为降级方案
            logger.info('[ToolCancel] Last attempt: trying non-stream request as fallback...');
            try {
              const fallbackOptions = { stream: false };
              const fallbackResponse = await this.aiService.sendMessage(messages, fallbackOptions);
              if (fallbackResponse && fallbackResponse.content) {
                fullContent = fallbackResponse.content;
                logger.info('[ToolCancel] ✅ Fallback non-stream request succeeded, content length:', fullContent.length);
              } else {
                logger.warn('[ToolCancel] Fallback request also returned no content');
              }
            } catch (fallbackError) {
              logger.error('[ToolCancel] Fallback request also failed:', fallbackError);
            }
          }
        }
        
        if (!fullContent || fullContent.trim().length === 0) {
          logger.warn('[ToolCancel] ⚠️ Force generation returned empty content (attempt', retryCount + 1, ')');
          logger.warn('[ToolCancel] Tool results count:', toolResults.length);
          
          // 🔧 修复：如果还有重试次数，尝试重试（但使用更简单的提示）
          if (retryCount < MAX_RETRIES) {
            logger.info('[ToolCancel] Retrying force generation with simplified prompt...');
            if (contentDiv) {
              contentDiv.innerHTML = '<span style="color: #6b7280; font-style: italic;">正在重试生成分析结论...</span>';
            }
            // 等待一小段时间后重试，使用更简单的提示
            await new Promise(resolve => setTimeout(resolve, 1500));
            return await this.forceGenerateConclusionFromToolResults(toolResults, originalQuery, retryCount + 1);
          }
          
          // 🔧 修复：如果重试失败，至少显示工具结果摘要
          logger.error('[ToolCancel] ⚠️ Force generation failed after', MAX_RETRIES + 1, 'attempts');
          this.displayToolResultsSummary(toolResults, originalQuery, contentDiv);
        } else {
          logger.info('[ToolCancel] ✅ Force generation succeeded, content length:', fullContent.length);
          // 确保保存到对话历史
          if (conversation) {
            conversation.messages.push({
              role: MESSAGE_ROLES.ASSISTANT,
              content: fullContent,
              timestamp: new Date().toISOString()
            });
            this.saveConversations();
          }
        }
      } else if (response.content) {
        if (contentDiv) {
          const html = TextFormatter.markdownToHtml(response.content);
          contentDiv.innerHTML = html || TextFormatter.escapeHtml(response.content).replace(/\n/g, '<br>');
        }
        // 确保保存到对话历史
        if (conversation) {
          conversation.messages.push({
            role: MESSAGE_ROLES.ASSISTANT,
            content: response.content,
            timestamp: new Date().toISOString()
          });
          this.saveConversations();
        }
      } else {
        logger.error('[ToolCancel] ⚠️ Force generation returned no content (non-stream)');
        
        // 🔧 修复：如果还有重试次数，尝试重试
        if (retryCount < MAX_RETRIES) {
          logger.info('[ToolCancel] Retrying force generation...');
          if (contentDiv) {
            contentDiv.innerHTML = '<span style="color: #6b7280; font-style: italic;">正在重试生成分析结论...</span>';
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
          return await this.forceGenerateConclusionFromToolResults(toolResults, originalQuery, retryCount + 1);
        }
        
        // 如果重试失败，显示工具结果摘要
        this.displayToolResultsSummary(toolResults, originalQuery, contentDiv);
      }
      
      this.scrollToBottom();
    } catch (error) {
      logger.error('[ToolCancel] Error in force generation (attempt', retryCount + 1, '):', error);
      
      // 🔧 修复：如果还有重试次数，尝试重试
      if (retryCount < MAX_RETRIES) {
        logger.info('[ToolCancel] Retrying force generation after error...');
        const messagesEl = document.getElementById('messages');
        const lastMessage = messagesEl.lastElementChild;
        const contentDiv = lastMessage ? lastMessage.querySelector('.message-content') : null;
        if (contentDiv) {
          contentDiv.innerHTML = '<span style="color: #6b7280; font-style: italic;">发生错误，正在重试...</span>';
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        return await this.forceGenerateConclusionFromToolResults(toolResults, originalQuery, retryCount + 1);
      }
      
      // 如果重试失败，显示错误和工具结果摘要
      const messagesEl = document.getElementById('messages');
      const lastMessage = messagesEl.lastElementChild;
      const contentDiv = lastMessage ? lastMessage.querySelector('.message-content') : null;
      if (contentDiv) {
        let errorMsg = `**生成结论时发生错误：** ${error.message}\n\n`;
        errorMsg += `**已执行的工具结果摘要：**\n\n`;
        toolResults.forEach((tr, index) => {
          errorMsg += `${index + 1}. **${tr.toolName}**: `;
          if (tr.error) {
            errorMsg += `执行失败 - ${tr.error}\n`;
          } else {
            const resultStr = typeof tr.result === 'string' 
              ? tr.result.substring(0, 150) 
              : JSON.stringify(tr.result).substring(0, 150);
            errorMsg += `${resultStr}${resultStr.length >= 150 ? '...' : ''}\n`;
          }
        });
        
        const html = TextFormatter.markdownToHtml(errorMsg);
        contentDiv.innerHTML = html || TextFormatter.escapeHtml(errorMsg).replace(/\n/g, '<br>');
      }
      // 🔧 修复：不再抛出错误，而是显示摘要，让用户至少能看到工具结果
      // throw error;
    }
  }
  
  /**
   * 将工具结果添加到缓存
   * 🔧 新增：工具结果缓存机制
   */
  addToolResultToCache(conversationId, toolResult) {
    if (!conversationId) {
      logger.warn('[Cache] Cannot add tool result: conversationId is missing');
      return;
    }
    
    // 确保缓存存在
    if (!this.toolResultsCache[conversationId]) {
      this.toolResultsCache[conversationId] = [];
    }
    
    // 🔧 修复：检查是否已存在相同的工具结果
    // 优先通过toolCallId比较（最准确），如果没有toolCallId，则通过toolName+args比较
    // 注意：如果toolCallId不同，即使toolName+args相同，也应该都保存（可能是不同轮次的调用）
    const existingIndex = this.toolResultsCache[conversationId].findIndex(tr => {
      // 优先使用toolCallId比较（最准确）
      if (tr.toolCallId && toolResult.toolCallId && tr.toolCallId === toolResult.toolCallId) {
        return true;
      }
      // 如果都没有toolCallId，通过toolName+args比较
      // 注意：只有在都没有toolCallId的情况下才使用这个逻辑
      if (!tr.toolCallId && !toolResult.toolCallId && tr.toolName === toolResult.toolName) {
        const trArgs = JSON.stringify(tr.args || {});
        const resultArgs = JSON.stringify(toolResult.args || {});
        return trArgs === resultArgs;
      }
      return false;
    });
    
    if (existingIndex >= 0) {
      // 更新已存在的结果（相同toolCallId或相同toolName+args）
      this.toolResultsCache[conversationId][existingIndex] = toolResult;
      logger.debug('[Cache] Updated existing tool result in cache:', toolResult.toolName, 'toolCallId:', toolResult.toolCallId);
    } else {
      // 添加新结果（不同的toolCallId或不同的toolName+args）
      this.toolResultsCache[conversationId].push(toolResult);
      logger.debug('[Cache] Added tool result to cache:', toolResult.toolName, 'toolCallId:', toolResult.toolCallId, 'Total:', this.toolResultsCache[conversationId].length);
    }
  }
  
  /**
   * 从缓存中获取所有工具结果
   * 🔧 新增：工具结果缓存机制
   */
  getToolResultsFromCache(conversationId) {
    if (!conversationId) {
      logger.warn('[Cache] Cannot get tool results: conversationId is missing');
      return [];
    }
    
    if (!this.toolResultsCache[conversationId]) {
      logger.debug('[Cache] No cache found for conversation:', conversationId);
      return [];
    }
    
    const cachedResults = this.toolResultsCache[conversationId];
    logger.info('[Cache] Retrieved', cachedResults.length, 'tool results from cache for conversation:', conversationId);
    return cachedResults;
  }
  
  /**
   * 显示工具结果摘要（当AI生成失败时使用）
   * 🔧 修复：提取为独立函数，便于复用
   */
  displayToolResultsSummary(toolResults, originalQuery, contentDiv) {
    if (!contentDiv) {
      const messagesEl = document.getElementById('messages');
      const lastMessage = messagesEl.lastElementChild;
      contentDiv = lastMessage ? lastMessage.querySelector('.message-content') : null;
    }
    
    if (!contentDiv) {
      logger.error('[ToolCancel] Cannot find contentDiv for displaying summary');
      return;
    }
    
    // 生成工具结果摘要
    let summary = `**基于已执行的工具结果的分析：**\n\n`;
    summary += `**用户问题：** ${originalQuery}\n\n`;
    summary += `**工具执行结果：**\n\n`;
    
    toolResults.forEach((tr, index) => {
      summary += `### ${index + 1}. ${tr.toolName}\n`;
      if (tr.error) {
        summary += `❌ 执行失败: ${tr.error}\n\n`;
      } else {
        const resultStr = typeof tr.result === 'string' 
          ? tr.result 
          : JSON.stringify(tr.result, null, 2);
        // 限制长度，避免摘要过长
        const displayStr = resultStr.length > 500 
          ? resultStr.substring(0, 500) + '\n\n*（结果已截断，完整结果请查看工具执行记录）*'
          : resultStr;
        summary += `✓ 执行成功\n\`\`\`\n${displayStr}\n\`\`\`\n\n`;
      }
    });
    
    summary += `\n*注：AI生成结论失败，以上为工具执行结果摘要。请根据以上结果自行分析。*`;
    
    const html = TextFormatter.markdownToHtml(summary);
    contentDiv.innerHTML = html || TextFormatter.escapeHtml(summary).replace(/\n/g, '<br>');
    
    logger.info('[ToolCancel] ✅ Tool results summary displayed');
  }
  
  /**
   * 将工具结果发送给AI进行综合分析
   * 🔧 修复：添加batchId参数，用于追踪批次状态
   */
  async sendToolResultsToAI(toolResults, originalQuery, batchId = null) {
    try {
      const conversation = this.getCurrentConversation();
      
      // 构建综合分析提示
      let comprehensivePrompt = `[批量工具执行完成]\n\n`;
      comprehensivePrompt += `共执行了 ${toolResults.length} 个工具，结果如下：\n\n`;
      
      toolResults.forEach((tr, index) => {
        comprehensivePrompt += `## ${index + 1}. ${tr.toolName}\n`;
        if (tr.error) {
          comprehensivePrompt += `❌ 执行失败: ${tr.error}\n\n`;
        } else {
          comprehensivePrompt += `✓ 执行成功\n`;
          comprehensivePrompt += `结果:\n${JSON.stringify(tr.result, null, 2)}\n\n`;
        }
      });
      
      comprehensivePrompt += `\n**安全综合分析要求（SOC安全分析师工作规范）：**\n`;
      comprehensivePrompt += `1. 请基于以上所有安全工具的执行结果，进行综合安全分析并回答用户的安全问题\n`;
      comprehensivePrompt += `2. **必须使用工具返回的实际安全数据**（威胁情报、日志数据、资产信息），而不是使用占位符（如[IP地址]、[威胁类型]、[资产名称]、[威胁评分]等）\n`;
      comprehensivePrompt += `3. 如果工具返回了JSON格式的数据，请解析JSON并提取关键安全指标的实际值（威胁评分、置信度、时间戳、关联事件、受影响资产等）\n`;
      comprehensivePrompt += `4. 如果工具返回了对象或数组，请提取其中的具体安全字段值，重点关注威胁级别、影响范围、时间线等关键信息\n`;
      comprehensivePrompt += `5. **绝对不要**在Response中使用占位符或模板变量，必须使用工具返回的真实安全数据\n`;
      comprehensivePrompt += `6. **🔁 关键（事件响应循环）：如果某个工具返回的数据不完整、查询未找到结果、或需要更多威胁情报来评估安全事件，请在Observation中明确说明缺少的关键安全信息（威胁情报、资产信息、日志数据、历史事件等），然后继续推理并调用其他安全工具获取完整信息。这是ReAct循环的核心：基于观察结果继续推理和行动，直到获得足够信息进行安全评估。**\n`;
      comprehensivePrompt += `7. **⚠️ 重要：何时停止调用工具（最关键）：**\n`;
      comprehensivePrompt += `   - **如果工具已经返回了足够的信息来回答用户的问题（例如：已经查询到了IP的Owner信息、威胁情报、资产信息等），请直接基于已有信息给出分析结论，不要再继续调用其他工具。**\n`;
      comprehensivePrompt += `   - **如果工具返回了有效的、非空的数据（不是null、空数组、空对象或"未找到"），通常已经足够回答问题，应该停止调用工具。**\n`;
      comprehensivePrompt += `   - **如果已经执行了2个或更多成功的工具查询，通常已经足够回答问题，应该停止调用工具。**\n`;
      comprehensivePrompt += `   - **只有在工具返回了明确的"未找到"或"查询失败"结果，或者工具返回的数据明显不完整（缺少关键字段）时，才继续调用其他工具。**\n`;
      comprehensivePrompt += `   - **不要为了"完整性"而调用不必要的工具，不要重复调用相同类型的工具（如威胁情报、风险评估等）。**\n`;
      comprehensivePrompt += `8. 基于综合的安全数据，给出专业的安全分析、威胁评估和响应建议`;
      
      // 准备Function Calling工具
      let systemPrompt = null;
      const options = {};
      // 🔧 修复：确保functions总是数组，防止未定义错误
      const functions = await this.prepareFunctions() || [];
      if (functions.length > 0) {
        systemPrompt = this.buildSystemPromptForFunctionCalling();
        options.tools = FunctionCallAdapter.cleanFunctionsForAPI(functions);
        options.tool_choice = 'auto';  // 🔧 允许AI继续调用工具
      }
      
      // 🔧 修复：包含工具结果，让AI能看到完整的工具调用上下文，支持ReAct循环
      // 这样AI可以：
      // 1. 看到之前的assistant消息中的tool_calls
      // 2. 看到对应的tool结果（标准Function Calling格式）
      // 3. 基于这些上下文决定是否需要继续调用工具
      
      // 🔧 修复：先检查conversation history中是否有工具结果
      const rawConversationHistory = conversation ? conversation.messages : [];
      const toolMessages = rawConversationHistory.filter(msg => msg.role === MESSAGE_ROLES.TOOL);
      const assistantMessages = rawConversationHistory.filter(msg => msg.role === MESSAGE_ROLES.ASSISTANT);
      
      logger.info('[BatchExecute] Conversation history check:');
      logger.info('[BatchExecute] - Total messages:', rawConversationHistory.length);
      logger.info('[BatchExecute] - Tool messages:', toolMessages.length);
      logger.info('[BatchExecute] - Assistant messages:', assistantMessages.length);
      logger.info('[BatchExecute] - Tool results from execution:', toolResults.length);
      
      if (toolMessages.length > 0) {
        logger.info('[BatchExecute] Tool messages in history:');
        toolMessages.forEach((msg, idx) => {
          logger.info(`[BatchExecute]   ${idx + 1}. tool_call_id: ${msg.tool_call_id || msg.toolCallId || 'missing'}, name: ${msg.name || msg.toolName || 'missing'}, content length: ${(msg.content || '').length}`);
        });
      }
      
      const conversationHistoryWithContext = this.getConversationHistoryWithContext(conversation);
      const messages = this.aiService.buildMessages(
        comprehensivePrompt,
        conversationHistoryWithContext,
        systemPrompt,
        true  // 🔧 includeToolResults = true，让AI看到完整的工具调用上下文，支持循环调用
      );
      
      logger.info('[BatchExecute] Built messages for AI:');
      logger.info('[BatchExecute] - Total messages:', messages.length);
      messages.forEach((msg, idx) => {
        if (msg.role === 'tool') {
          logger.info(`[BatchExecute]   ${idx + 1}. [TOOL] tool_call_id: ${msg.tool_call_id}, name: ${msg.name}, content length: ${(msg.content || '').length}`);
        } else if (msg.role === 'assistant' && msg.tool_calls) {
          logger.info(`[BatchExecute]   ${idx + 1}. [ASSISTANT] with ${msg.tool_calls.length} tool_calls`);
        } else {
          logger.info(`[BatchExecute]   ${idx + 1}. [${msg.role.toUpperCase()}] content length: ${(msg.content || '').length}`);
        }
      });
      
      const response = await this.aiService.sendMessage(messages, options);
      
      // 处理流式响应
      let fullContent = '';
      let toolCallsFromStream = null;
      if (response.stream) {
        // 🔧 修复：handleStreamResponse现在返回对象
        // 🔧 注意：handleStreamResponse内部已经创建了消息DOM并保存到历史，这里只需要获取内容
        const streamResult = await this.handleStreamResponse(response);
        if (typeof streamResult === 'object' && streamResult !== null) {
          fullContent = streamResult.content || '';
          toolCallsFromStream = streamResult.tool_calls || null;
          logger.debug('[BatchExecute] Stream completed, content length:', fullContent.length, 'tool_calls:', toolCallsFromStream?.length || 0);
        } else {
          fullContent = streamResult || '';
          logger.debug('[BatchExecute] Stream completed (legacy format), content length:', fullContent.length);
        }
      } else if (response.content) {
        fullContent = response.content;
        this.appendMessage(MESSAGE_ROLES.ASSISTANT, response.content);
        this.saveConversations();
        logger.debug('[BatchExecute] Non-stream response, content length:', fullContent.length);
      }
      
      // 🔧 修复：确保内容已显示（流式响应已经在handleStreamResponse中显示，非流式响应已通过appendMessage显示）
      // 如果fullContent为空，检查是否有tool_calls
      if (!fullContent || fullContent.trim().length === 0) {
        const toolCallsCheck = toolCallsFromStream || response.tool_calls;
        if (toolCallsCheck && Array.isArray(toolCallsCheck) && toolCallsCheck.length > 0) {
          // 如果有tool_calls但没有content，说明AI只调用了工具，这是正常的
          logger.info('[BatchExecute] Content is empty but tool_calls detected:', toolCallsCheck.length);
          logger.info('[BatchExecute] This is normal: AI only called tools without generating text');
        } else {
          logger.warn('[BatchExecute] ⚠️ Warning: fullContent is empty and no tool_calls after processing response');
          logger.warn('[BatchExecute] Response stream:', response.stream, 'Response content:', response.content);
          // 不显示空内容，但继续后续处理
        }
      }
      
      // 检查是否有新的工具调用（可能需要进一步分析）
      // 🔧 修复：优先使用流式响应返回的tool_calls
      // 🔧 增强：传递递归深度，防止无限循环
      // 🔁 ReAct循环：如果AI请求继续调用工具，说明之前的工具结果不完整，需要继续循环
      const toolCalls = toolCallsFromStream || response.tool_calls;
      if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
        // 🔧 修复：检查工具结果是否已经足够回答用户问题
        // 如果工具已经返回了足够的信息（例如Owner信息），应该停止继续调用工具
        const hasSufficientInfo = this.checkIfToolResultsAreSufficient(toolResults, originalQuery);
        
        if (hasSufficientInfo) {
          logger.info('[BatchExecute] ⚠️ Tool results are sufficient, but AI still wants to call more tools');
          logger.info('[BatchExecute] Forcing AI to generate conclusion instead of calling more tools');
          
          // 强制AI基于已有信息生成结论，不再调用工具
          const forceConclusionPrompt = `请基于刚才执行的工具结果，直接给出分析结论，不要再调用其他工具。工具已经返回了足够的信息来回答用户的问题。\n\n用户问题：${originalQuery}\n\n请直接给出分析结论。`;
          
          // 🔧 修复：包含完整的对话历史，让AI看到完整的ReAct上下文
          const forceHistory = this.getConversationHistoryWithContext(conversation);
          const forceMessages = this.aiService.buildMessages(
            forceConclusionPrompt,
            forceHistory,
            null,  // 不使用system prompt
            true   // 🔧 修复：includeToolResults = true，让AI看到完整的工具调用上下文
                    // 但不会继续调用工具（因为options中没有tools）
          );
          
          const forceOptions = {};  // 🔧 关键：不传递tools，强制生成文本
                                     // 即使includeToolResults=true，AI看到历史，但因为没有tools选项，无法调用新工具
          
          try {
            const forceResponse = await this.aiService.sendMessage(forceMessages, forceOptions);
            let forceContent = '';
            if (forceResponse.stream) {
              const forceStreamResult = await this.handleStreamResponse(forceResponse);
              if (typeof forceStreamResult === 'object' && forceStreamResult !== null) {
                forceContent = forceStreamResult.content || '';
              } else {
                forceContent = forceStreamResult || '';
              }
            } else if (forceResponse.content) {
              forceContent = forceResponse.content;
              this.appendMessage(MESSAGE_ROLES.ASSISTANT, forceContent);
              this.saveConversations();
            }
            
            if (forceContent && forceContent.trim().length > 0) {
              logger.info('[BatchExecute] ✅ Forced conclusion generated');
              this.scrollToBottom();
              return;  // 直接返回，不再继续调用工具
            }
          } catch (forceError) {
            logger.error('[BatchExecute] Error forcing conclusion:', forceError);
            // 如果强制生成失败，继续正常流程
          }
        }
        
        logger.info('[BatchExecute] 🔁 ReAct循环：AI请求继续调用工具，说明之前的工具结果不完整');
        logger.info('[BatchExecute] 这是ReAct循环的正常流程：基于观察结果继续推理和行动');
        // 🔧 修复：确保functions总是数组，防止未定义错误
        const functions = await this.prepareFunctions() || [];
        // 从批次中获取递归深度（如果有），否则默认为0
        const batchRecursionDepth = batchId && this.pendingManualTools[batchId]?.recursionDepth || 0;
        // 🔧 修复：确保异步操作完成，防止卡死
        try {
          // 🔧 修复：如果fullContent为空但有tool_calls，移除"无内容"消息，让工具调用正常进行
          if (!fullContent || fullContent.trim().length === 0) {
            logger.info('[BatchExecute] Removing empty content message, proceeding with tool calls');
            const messagesEl = document.getElementById('messages');
            const lastMessage = messagesEl.lastElementChild;
            if (lastMessage && lastMessage.classList.contains('assistant')) {
              const contentDiv = lastMessage.querySelector('.message-content');
              if (contentDiv && (contentDiv.textContent.includes('无内容') || contentDiv.textContent.includes('未收到内容'))) {
                lastMessage.remove();
                logger.info('[BatchExecute] Removed empty content message');
              }
            }
          }
          await this.handleFunctionCalls(toolCalls, functions, originalQuery, batchRecursionDepth + 1);
        } catch (toolCallError) {
          logger.error('[BatchExecute] Error in additional tool calls:', toolCallError);
          // 即使工具调用失败，也不应该卡死，继续后续处理
        }
      } else {
        logger.info('[BatchExecute] ✅ AI已完成分析，没有请求更多工具调用');
        
        // 🔧 修复：如果AI没有生成内容也没有调用工具，可能是异常情况，需要重新请求
        if (!fullContent || fullContent.trim().length === 0) {
          logger.warn('[BatchExecute] ⚠️ AI没有生成内容也没有调用工具，可能是异常情况');
          logger.warn('[BatchExecute] 工具结果已发送，但AI没有响应。尝试强制AI生成分析结果...');
          
          // 强制AI生成分析结果（不使用工具调用）
          try {
            const forceAnalysisPrompt = `请基于刚才执行的工具结果，给出详细的安全分析。工具已执行完成，请直接分析结果并回答用户的问题，不要再次调用工具。\n\n用户问题：${originalQuery}\n\n请给出详细的安全分析报告。`;
            const forceHistory = this.getConversationHistoryWithContext(conversation);
            const forceMessages = this.aiService.buildMessages(
              forceAnalysisPrompt,
              forceHistory,
              null,  // 不使用system prompt
              false  // 不包含工具结果，因为已经在历史中
            );
            
            const forceOptions = {};
            const forceResponse = await this.aiService.sendMessage(forceMessages, forceOptions);
            
            let forceContent = '';
            if (forceResponse.stream) {
              const forceStreamResult = await this.handleStreamResponse(forceResponse);
              if (typeof forceStreamResult === 'object' && forceStreamResult !== null) {
                forceContent = forceStreamResult.content || '';
              } else {
                forceContent = forceStreamResult || '';
              }
            } else if (forceResponse.content) {
              forceContent = forceResponse.content;
              this.appendMessage(MESSAGE_ROLES.ASSISTANT, forceContent);
              this.saveConversations();
            }
            
            if (forceContent && forceContent.trim().length > 0) {
              logger.info('[BatchExecute] ✅ 强制生成分析结果成功');
              fullContent = forceContent;  // 更新fullContent，用于后续处理
            } else {
              logger.error('[BatchExecute] ❌ 强制生成分析结果失败，仍然没有内容');
              // 🔧 修复：如果强制生成失败，显示工具结果摘要
              const messagesEl = document.getElementById('messages');
              const lastMessage = messagesEl.lastElementChild;
              const contentDiv = lastMessage ? lastMessage.querySelector('.message-content') : null;
              if (contentDiv) {
                this.displayToolResultsSummary(toolResults, originalQuery, contentDiv);
              }
            }
          } catch (forceError) {
            logger.error('[BatchExecute] Error forcing analysis:', forceError);
            // 🔧 修复：如果强制生成出错，也显示工具结果摘要
            const messagesEl = document.getElementById('messages');
            const lastMessage = messagesEl.lastElementChild;
            const contentDiv = lastMessage ? lastMessage.querySelector('.message-content') : null;
            if (contentDiv) {
              this.displayToolResultsSummary(toolResults, originalQuery, contentDiv);
            }
          }
        }
        
        // 🔧 修复：确保UI已更新，滚动到底部
        this.scrollToBottom();
      }
      
      // 🔧 修复：生成建议行动（如果配置开启且没有新的工具调用）
      // 确保只在最终结果出现后才生成建议行动（没有tool_calls，流式响应完全结束）
      const hasToolCalls = toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0;
      
    if (!hasToolCalls) {
      this.tryCompleteReActRun(fullContent || '');
    }
      
    logger.debug('[SuggestedActions] Config check after tool execution:', {
      fullContent: !!fullContent,
      fullContentLength: fullContent?.length || 0,
      enableSuggestedActions: this.config.enableSuggestedActions,
      hasToolCalls: hasToolCalls,
      willGenerate: fullContent && fullContent.trim().length > 0 && !hasToolCalls && this.config.enableSuggestedActions !== false && !this.isReActRunning()
    });
      
    const suggestionContentAfterTools = this.getReActFinalContent(fullContent);
    if (suggestionContentAfterTools && !hasToolCalls && this.config.enableSuggestedActions !== false && !this.isReActRunning()) {
      logger.debug('[SuggestedActions] Generating after tool execution');
      try {
        await this.generateSuggestedActions(suggestionContentAfterTools, originalQuery);
      } catch (suggestError) {
        logger.error('[BatchExecute] Error generating suggestions:', suggestError);
        // 建议生成失败不应该影响主流程
      }
    } else if (hasToolCalls) {
      logger.debug('[SuggestedActions] Skipping generation - tool calls detected, will generate after next tool execution');
    }
      
      // 🔧 修复：确保最终UI状态正确，滚动到底部
      this.scrollToBottom();
      logger.debug('[BatchExecute] ✅ Comprehensive analysis completed');
      
      // 🔧 修复：确保loading状态已清除（双重保险，防止卡死）
      this.hideLoading();
      
      // 🔧 修复：强制UI更新，确保消息已显示
      await new Promise(resolve => setTimeout(resolve, 100));
      this.scrollToBottom();
    } catch (error) {
      logger.error('[BatchExecute] Error in comprehensive analysis:', error);
      this.showError('综合分析失败: ' + error.message);
      // 🔧 修复：确保错误时也隐藏loading，防止卡死
      this.hideLoading();
      // 🔧 修复：确保UI滚动到底部，显示错误消息
      this.scrollToBottom();
    }
  }
  
  /**
   * 自动执行工具（单个）
   */
  async autoExecuteTool(toolIntent, originalQuery, serviceId) {
    try {
      logger.info('[AutoExecute] Starting:', toolIntent.toolName);
      
      // 显示执行中的卡片
      const messagesEl = document.getElementById('messages');
      const executingDiv = document.createElement('div');
      executingDiv.className = 'tool-execution-prompt executing';
      executingDiv.innerHTML = `
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; padding: 12px; color: white;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <span style="font-size: 18px;">🔧</span>
            <strong>自动执行: ${TextFormatter.escapeHtml(toolIntent.toolName)}</strong>
            <span style="margin-left: auto; font-size: 12px; opacity: 0.9;">⏳ 执行中...</span>
          </div>
          <div style="font-size: 12px; opacity: 0.85; font-family: 'Courier New', monospace;">
            ${TextFormatter.escapeHtml(JSON.stringify(toolIntent.args, null, 2))}
          </div>
        </div>
      `;
      messagesEl.appendChild(executingDiv);
      this.scrollToBottom();
      
      // 执行工具
      const result = await this.executeToolFromIntent(toolIntent, originalQuery);
      
      // 更新卡片状态为成功
      executingDiv.classList.remove('executing');
      executingDiv.classList.add('completed');
      const statusSpan = executingDiv.querySelector('span[style*="margin-left"]');
      if (statusSpan) {
        statusSpan.textContent = '✓ 已完成';
      }
      
      // 保存工具调用记录到对话历史（使用标准Function Calling格式）
      const conversation = this.getCurrentConversation();
      if (conversation) {
        conversation.messages.push({
          role: MESSAGE_ROLES.TOOL,
          tool_call_id: toolIntent.toolCallId || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,  // 关联tool_call_id
          name: toolIntent.toolName,  // 工具名称
          content: typeof result === 'string' ? result : JSON.stringify(result),  // 工具结果内容
          // 保留额外信息用于UI显示
          toolName: toolIntent.toolName,
          args: toolIntent.args,
          result: result,  // 保存原始结果对象
          serviceName: this.mcpServices.find(s => s.id === serviceId)?.name || serviceId,
          timestamp: Date.now()
        });
        this.saveConversations();
      }
      
      // 使用AI格式化结果
      await this.formatAndDisplayToolResult(
        JSON.stringify(result, null, 2),
        toolIntent.toolName,
        originalQuery
      );
      
      logger.info('[AutoExecute] Completed:', toolIntent.toolName);
    } catch (error) {
      logger.error('[AutoExecute] Error:', error);
      
      // 更新卡片状态为失败
      const messagesEl = document.getElementById('messages');
      const lastCard = messagesEl.lastElementChild;
      if (lastCard && lastCard.classList.contains('executing')) {
        lastCard.classList.remove('executing');
        lastCard.classList.add('error');
        const statusSpan = lastCard.querySelector('span[style*="margin-left"]');
        if (statusSpan) {
          statusSpan.textContent = '✕ 执行失败';
        }
      }
      
      this.showError(`工具执行失败: ${error.message}`);
    }
  }
  
  // ==================== 9. UI辅助 ====================

  scrollToBottom() {
    const messagesEl = document.getElementById('messages');
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  
  // ==================== 10. TheHive 集成 ====================
  
  /**
   * 初始化 TheHive 集成
   */
  initTheHive() {
    try {
      const thehiveConfig = DEFAULT_CONFIG.thehive;
      
      logger.info('[TheHive] Config loaded:', {
        enabled: thehiveConfig.enabled,
        apiUrl: thehiveConfig.apiUrl,
        autoDetect: thehiveConfig.autoDetect
      });
      
      if (!thehiveConfig.enabled) {
        logger.warn('[TheHive] Integration is DISABLED - set enabled:true in defaults.js');
        return;
      }
      
      this.thehiveIntegration = new TheHiveIntegration(thehiveConfig);
      logger.info('[TheHive] ✓ Integration initialized successfully');
    } catch (error) {
      logger.error('[TheHive] Init failed:', error);
    }
  }

  parseTheHiveSuggestions(commentsText) {
    if (!commentsText) return [];
    const normalized = commentsText.replace(/\r/g, '').trim();
    if (!normalized) return [];
    
    let suggestionSection = '';
    
    // 新格式：匹配 “【调查建议】 ... （直到下一个【...】或文末）”
    const bracketRegex = /【调查建议】([\s\S]*?)(?=\n\s*【|$)/i;
    const bracketMatch = normalized.match(bracketRegex);
    if (bracketMatch && bracketMatch[1]) {
      suggestionSection = bracketMatch[1].trim();
    }
    
    // 旧格式：匹配 “=== 建议 === ... ===”
    if (!suggestionSection) {
      const sectionRegex = /===\s*([^\n=]*?建议[^\n=]*)===([\s\S]*?)(?=^===|\Z)/gmi;
      const sectionMatch = sectionRegex.exec(normalized);
      if (sectionMatch && sectionMatch[2]) {
        suggestionSection = sectionMatch[2].trim();
      }
    }
    
    // 退化：直接匹配 “建议:” 关键字
    if (!suggestionSection) {
      const keywordMatch = normalized.match(/建议[：:]\s*([\s\S]+)/i);
      if (keywordMatch && keywordMatch[1]) {
        suggestionSection = keywordMatch[1].trim();
      }
    }
    
    if (!suggestionSection) {
      return [];
    }
    
    // 如果后续还有新的 === 段落，截断
    const stopIndex = suggestionSection.indexOf('===');
    if (stopIndex > -1) {
      suggestionSection = suggestionSection.substring(0, stopIndex).trim();
    }
    
    // 截断下一个 comments 分隔符（---），避免串入其他留言
    const delimiterMatch = suggestionSection.search(/\n-{3,}\s*/);
    if (delimiterMatch > -1) {
      suggestionSection = suggestionSection.substring(0, delimiterMatch).trim();
    }
    
    if (!suggestionSection || /^暂无/i.test(suggestionSection)) {
      return [];
    }
    
    const segments = suggestionSection
      .split(/(?=\n?\s*\d+\s*[\.、\)\）])/)
      .map(seg => seg.replace(/^\s*\d+\s*[\.、\)\）]/, '').trim())
      .filter(Boolean);
    
    if (segments.length === 0) {
      return suggestionSection
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 4 && !/^建议/.test(line));
    }
    
    return segments;
  }

  getDefaultSecurityPrompts() {
    return DEFAULT_SECURITY_PROMPTS.slice();
  }

  renderTheHiveSuggestions(suggestions) {
    if (!suggestions || suggestions.length === 0) return;
    const mapped = suggestions.map((action, index) => ({
      action,
      priority: index === 0 ? 'high' : (index === 1 ? 'medium' : 'low'),
      source: 'thehive'
    }));
    this.displaySuggestedActions(mapped, 'TheHive 建议');
  }

  
  // 注意：以下方法已不再需要，因为按钮现在由 content.js 管理
  // checkTheHivePage(), showTheHiveButton(), hideTheHiveButton() 已移除
  
  /**
   * 加载 TheHive Case
   * @param {string} url - Case 页面的 URL（从 content.js 传入）
   */
  async loadTheHiveCase(url) {
    try {
      if (!this.thehiveIntegration) {
        this.showError('TheHive 集成未启用');
        return;
      }
      
      logger.info('[TheHive] Starting to load case...');
      logger.info('[TheHive] URL from content.js:', url);
      
      if (!url) {
        throw new Error('URL is required');
      }
      
      // 加载 Case
      const { caseId, case: caseData } = await this.thehiveIntegration.loadCaseFromUrl(url);
      logger.info('[TheHive] Case loaded:', caseId);
      
      // 获取 Case 标题
      const caseTitle = this.thehiveIntegration.getCaseTitle();
      
      // 只更新对话历史中的标题，不修改 Header（保持显示 "💬 AI SOC Chat"）
      const conversation = this.getCurrentConversation();
      if (conversation) {
        conversation.title = caseTitle;
        this.saveConversations();
        this.renderConversationList();
        logger.info('[TheHive] Conversation title updated to:', caseTitle);
      }
      
      // 获取 Comments
      const commentsText = await this.thehiveIntegration.getCaseComments();
      
      // 解析并渲染 TheHive 建议
      const hiveSuggestions = this.parseTheHiveSuggestions(commentsText);
      if (hiveSuggestions.length > 0) {
        this.renderTheHiveSuggestions(hiveSuggestions);
      } else {
        logger.info('[TheHive] No structured suggestions found in comments');
        const fallbackPrompts = this.getDefaultSecurityPrompts();
        if (fallbackPrompts.length > 0) {
          this.renderTheHiveSuggestions(fallbackPrompts, '安全防护提问建议');
        }
      }
      
      // 将 comments 保存到当前对话的上下文中
      if (conversation) {
        this.ensureConversationMetadata(conversation);
        conversation.metadata.thehiveComments = commentsText;
        conversation.metadata.thehiveCaseId = caseId;
        conversation.metadata.thehiveUpdatedAt = new Date().toISOString();
        this.saveConversations();
        this.detectAndStoreOwnerEmails(commentsText);
        logger.info('[TheHive] Comments stored in conversation metadata for context');
      }
      
      logger.info('[TheHive] ✓ Case and comments loaded successfully');
      
    } catch (error) {
      logger.error('[TheHive] Load case failed:', error);
      this.showError(`加载 Case 失败: ${error.message}`);
    }
  }
}

// Initialize chat
const chat = new AIChat();

// Expose for debugging
window.aiChat = chat;

// 监听来自 content.js 的消息
window.addEventListener('message', (event) => {
  // 安全检查：确保消息来自同一扩展
  if (event.source !== window.parent) return;
  
  const { action, url } = event.data;
  
  if (action === 'loadTheHiveCase') {
    logger.info('[Sidebar] Received loadTheHiveCase message from content script');
    logger.info('[Sidebar] URL:', url);
    
    // 调用加载方法，传入 URL
    if (chat && chat.loadTheHiveCase) {
      chat.loadTheHiveCase(url);  // 传递 URL 参数
    }
  }
});

logger.info('✓ AI SOC Chat loaded');
