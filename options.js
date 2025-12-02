/**
 * Options Page Manager
 * 设置页面管理器
 * 
 * 功能模块：
 * 1. AI API 配置管理
 * 2. MCP 服务配置管理
 * 3. 开发模式配置
 * 4. 配置测试与验证
 */

import { StorageManager } from './src/utils/storage.js';
import { MCPClient } from './src/services/mcp-client.js';
import { AIAPIService } from './src/services/ai-api.js';
import { TextFormatter } from './src/utils/text-formatter.js';
import { logger } from './src/utils/logger.js';
import { DEFAULT_CONFIG } from './src/config/defaults.js';

class OptionsManager {
  constructor() {
    this.mcpServices = [];
    this.devMode = { enabled: false, logLevel: 'info' };
    this.cachedTools = {};  // 缓存每个MCP服务的工具列表 { serviceId: tools[] }
    this.toolsEnabled = {}; // 工具的启用状态 { 'serviceId:toolName': boolean }
    this.toolsAutoExecute = {}; // 工具的自动执行状态 { 'serviceId:toolName': boolean }
    this.init();
  }
  
  async init() {
    await this.loadSettings();
    this.setupEventListeners();
    this.renderMCPServices();
  }
  
  async loadSettings() {
    // Load AI config
    const config = await StorageManager.getAIConfig();
    
    logger.info('[Options] Loaded config:', config);
    
    document.getElementById('apiUrl').value = config.apiUrl;
    document.getElementById('apiKey').value = config.apiKey;
    document.getElementById('authorization').value = config.authorization || '';
    document.getElementById('modelName').value = config.model || DEFAULT_CONFIG.api.model;
    document.getElementById('userId').value = config.user;
    document.getElementById('includeToolResults').checked = config.includeToolResults !== undefined 
      ? config.includeToolResults 
      : DEFAULT_CONFIG.ui.includeToolResults;
    document.getElementById('enableSuggestedActions').checked = config.enableSuggestedActions !== undefined 
      ? config.enableSuggestedActions 
      : DEFAULT_CONFIG.ui.enableSuggestedActions;
    document.getElementById('autoSendSuggestions').checked = config.autoSendSuggestions !== undefined 
      ? config.autoSendSuggestions 
      : DEFAULT_CONFIG.ui.autoSendSuggestions;
    
    // Load MCP services
    this.mcpServices = await StorageManager.getMCPServices();
    
    // Load cached MCP tools
    this.cachedTools = await StorageManager.getMCPToolsCache();
    logger.info('[Options] Loaded cached tools:', Object.keys(this.cachedTools).filter(k => !k.endsWith('_time')).length, 'services');
    
    // Load tools enabled status
    this.toolsEnabled = await StorageManager.getMCPToolsEnabled();
    logger.info('[Options] Loaded tools enabled status');
    
    // Load tools auto-execute status
    this.toolsAutoExecute = await StorageManager.getMCPToolsAutoExecute();
    logger.info('[Options] Loaded tools auto-execute status');
    
    // Load dev mode settings
    this.devMode = await StorageManager.getDevMode();
    document.getElementById('devModeToggle').checked = this.devMode.enabled || false;
    document.getElementById('logLevel').value = this.devMode.logLevel || 'info';
    
    // Update logger settings
    logger.setDevMode(this.devMode.enabled);
    logger.setLogLevel(this.devMode.logLevel);
    
    // Show/hide log level group
    this.toggleLogLevelGroup();
  }
  
  setupEventListeners() {
    document.getElementById('saveBtn').addEventListener('click', () => {
      this.saveSettings();
    });
    
    document.getElementById('resetBtn').addEventListener('click', () => {
      this.loadSettings();
    });
    
    document.getElementById('addMcpBtn').addEventListener('click', () => {
      this.addMCPService();
    });
    
    document.getElementById('testApiBtn').addEventListener('click', () => {
      this.testApiConnection();
    });
    
    document.getElementById('clearHistoryBtn').addEventListener('click', () => {
      this.clearAllHistory();
    });

    // Dev mode toggle
    document.getElementById('devModeToggle').addEventListener('change', (e) => {
      this.devMode.enabled = e.target.checked;
      this.toggleLogLevelGroup();
    });

    // Log level change
    document.getElementById('logLevel').addEventListener('change', (e) => {
      this.devMode.logLevel = e.target.value;
    });
  }

  toggleLogLevelGroup() {
    const logLevelGroup = document.getElementById('logLevelGroup');
    logLevelGroup.style.display = this.devMode.enabled ? 'block' : 'none';
  }
  
  async saveSettings() {
    const config = {
      apiUrl: document.getElementById('apiUrl').value.trim(),
      apiKey: document.getElementById('apiKey').value.trim(),
      authorization: document.getElementById('authorization').value.trim(),
      model: document.getElementById('modelName').value.trim() || DEFAULT_CONFIG.api.model,
      user: document.getElementById('userId').value.trim() || DEFAULT_CONFIG.user.idPrefix + Date.now(),
      includeToolResults: document.getElementById('includeToolResults').checked,
      enableSuggestedActions: document.getElementById('enableSuggestedActions').checked,
      autoSendSuggestions: document.getElementById('autoSendSuggestions').checked
    };
    
    logger.info('[Options] Saving config:', config);
    
    // Check for old API key format
    if (config.apiKey && config.apiKey.startsWith('app-')) {
      const confirmed = confirm('检测到你使用的可能是旧的 Dify API Key（以 app- 开头）。\n\n请确认你使用的是新接口的 API Key。\n\n是否继续保存？');
      if (!confirmed) {
        return;
      }
    }
    
    await StorageManager.saveAIConfig(config);
    await StorageManager.saveMCPServices(this.mcpServices);
    
    // Save dev mode settings
    await StorageManager.saveDevMode(this.devMode);
    logger.setDevMode(this.devMode.enabled);
    logger.setLogLevel(this.devMode.logLevel);
    
    logger.info('[Options] Settings saved');
    
    this.showSuccess();
  }
  
  showSuccess() {
    const msg = document.getElementById('successMessage');
    msg.classList.add('show');
    setTimeout(() => {
      msg.classList.remove('show');
    }, 3000);
  }
  
  addMCPService() {
    const service = {
      id: 'mcp-' + Date.now(),
      name: '新服务',
      url: '',
      enabled: true
    };
    
    this.mcpServices.push(service);
    this.renderMCPServices();
  }
  
  async testApiConnection() {
    const resultEl = document.getElementById('apiTestResult');
    const btn = document.getElementById('testApiBtn');
    
    const apiUrl = document.getElementById('apiUrl').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();
    const authorization = document.getElementById('authorization').value.trim();
    const model = document.getElementById('modelName').value.trim() || DEFAULT_CONFIG.api.model;
    
    if (!apiUrl || !apiKey) {
      resultEl.style.color = '#991b1b';
      resultEl.textContent = '请先填写 API 地址和 API Key';
      return;
    }
    
    btn.disabled = true;
    btn.textContent = '测试中...';
    resultEl.textContent = '';
    
    try {
      const apiService = new AIAPIService({ apiUrl, apiKey, authorization, model });
      const result = await apiService.testConnection();
      
      if (result.success) {
        resultEl.style.color = '#065f46';
        resultEl.textContent = `✅ 连接成功！响应: ${result.message}`;
      } else {
        resultEl.style.color = '#991b1b';
        resultEl.textContent = `连接失败: ${result.error}`;
      }
      
    } catch (error) {
      logger.error('[API Test] Exception:', error);
      resultEl.style.color = '#991b1b';
      resultEl.textContent = `错误: ${error.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = '测试 API 连接';
    }
  }
  
  async removeMCPService(id) {
    this.mcpServices = this.mcpServices.filter(s => s.id !== id);
    
    // 清除缓存
    delete this.cachedTools[id];
    delete this.cachedTools[id + '_time'];
    await StorageManager.saveMCPToolsCache(this.cachedTools);
    
    // 清除该服务所有工具的启用状态
    const keysToDelete = Object.keys(this.toolsEnabled).filter(key => key.startsWith(`${id}:`));
    keysToDelete.forEach(key => delete this.toolsEnabled[key]);
    await StorageManager.saveMCPToolsEnabled(this.toolsEnabled);
    
    this.renderMCPServices();
  }
  
  async updateMCPService(id, field, value) {
    const service = this.mcpServices.find(s => s.id === id);
    if (service) {
      service[field] = value;
      
      // 如果修改了URL，清除缓存和工具状态
      if (field === 'url') {
        delete this.cachedTools[id];
        delete this.cachedTools[id + '_time'];
        await StorageManager.saveMCPToolsCache(this.cachedTools);
        
        // 清除该服务所有工具的启用状态
        const keysToDelete = Object.keys(this.toolsEnabled).filter(key => key.startsWith(`${id}:`));
        keysToDelete.forEach(key => delete this.toolsEnabled[key]);
        await StorageManager.saveMCPToolsEnabled(this.toolsEnabled);
        
        this.showTestResult(id, '💡 点击"测试"按钮以获取工具列表');
      }
    }
  }
  
  renderMCPServices() {
    const container = document.getElementById('mcpServicesList');
    container.innerHTML = '';
    
    if (this.mcpServices.length === 0) {
      container.innerHTML = '<div class="help-text">暂无 MCP 服务配置</div>';
      return;
    }
    
    this.mcpServices.forEach(service => {
      const serviceDiv = document.createElement('div');
      serviceDiv.className = 'mcp-service';
      serviceDiv.innerHTML = `
        <div class="mcp-service-header">
          <div class="mcp-service-name">${TextFormatter.escapeHtml(service.name)}</div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <label class="toggle">
              <input type="checkbox" ${service.enabled ? 'checked' : ''} data-action="toggle" data-id="${service.id}">
              <span class="toggle-slider"></span>
            </label>
            <button class="btn btn-success" data-action="test" data-id="${service.id}">测试</button>
            <button class="btn btn-warning" data-action="refresh" data-id="${service.id}">刷新</button>
            <button class="btn btn-danger" data-action="delete" data-id="${service.id}">删除</button>
          </div>
        </div>
        
        <div class="form-group">
          <label>服务名称</label>
          <input type="text" value="${TextFormatter.escapeHtml(service.name)}" data-action="name" data-id="${service.id}">
        </div>
        
        <div class="form-group">
          <label>SSE 端点 URL</label>
          <input type="url" value="${TextFormatter.escapeHtml(service.url)}" 
                 placeholder="http://127.0.0.1:8000/sse"
                 data-action="url" data-id="${service.id}">
          <div class="help-text">支持 Server-Sent Events (SSE) 的服务端点，使用 JSON-RPC 2.0 协议通信</div>
          
          <div id="toolsResult-${service.id}" class="tools-result-placeholder">
            💡 点击"测试"按钮以获取工具列表
          </div>
        </div>
      `;
      
      container.appendChild(serviceDiv);

      // Bind events
      this.bindServiceEvents(serviceDiv, service);
      
      // 如果有缓存，自动显示
      if (this.cachedTools[service.id]) {
        const tools = this.cachedTools[service.id];
        const cacheTime = new Date(this.cachedTools[service.id + '_time']).toLocaleTimeString('zh-CN');
        this.showToolsList(service.id, tools, service.name, cacheTime);
      }
    });
  }

  bindServiceEvents(serviceDiv, service) {
    const toggleEl = serviceDiv.querySelector(`[data-action="toggle"][data-id="${service.id}"]`);
    if (toggleEl) {
      toggleEl.addEventListener('change', (e) => {
        this.updateMCPService(service.id, 'enabled', e.target.checked);
      });
    }

    const delBtn = serviceDiv.querySelector(`[data-action="delete"][data-id="${service.id}"]`);
    if (delBtn) {
      delBtn.addEventListener('click', () => this.removeMCPService(service.id));
    }

    const testBtn = serviceDiv.querySelector(`[data-action="test"][data-id="${service.id}"]`);
    if (testBtn) {
      testBtn.addEventListener('click', (e) => this.testMCPService(service.id, e.currentTarget, false));
    }

    const refreshBtn = serviceDiv.querySelector(`[data-action="refresh"][data-id="${service.id}"]`);
    if (refreshBtn) {
      refreshBtn.addEventListener('click', (e) => this.testMCPService(service.id, e.currentTarget, true));
    }

    const nameInput = serviceDiv.querySelector(`[data-action="name"][data-id="${service.id}"]`);
    if (nameInput) {
      nameInput.addEventListener('change', (e) => this.updateMCPService(service.id, 'name', e.target.value));
    }

    const urlInput = serviceDiv.querySelector(`[data-action="url"][data-id="${service.id}"]`);
    if (urlInput) {
      urlInput.addEventListener('change', (e) => this.updateMCPService(service.id, 'url', e.target.value));
    }
  }
  
  async testMCPService(id, btnEl, forceRefresh = false) {
    const service = this.mcpServices.find(s => s.id === id);
    if (!service) return;
    
    const url = (service.url || '').trim();
    if (!url) {
      this.showTestResult(id, '⚠️ 请先填写服务 URL', true);
      return;
    }

    // 检查缓存（除非强制刷新）
    if (!forceRefresh && this.cachedTools[id]) {
      const tools = this.cachedTools[id];
      const cacheTime = new Date(this.cachedTools[id + '_time']).toLocaleTimeString('zh-CN');
      this.showToolsList(id, tools, service.name, cacheTime);
      logger.info('[MCP Test] Using cached tools for:', service.name);
      return;
    }

    const originalText = btnEl ? btnEl.textContent : '';
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = '获取中...';
    }
    this.showTestResult(id, '⏳ 正在连接服务并获取工具列表...', false);
    
    try {
      const mcpClient = new MCPClient(url);
      const tools = await mcpClient.getTools();
      
      if (tools && tools.length > 0) {
        // 缓存工具列表（内存和持久化）
        this.cachedTools[id] = tools;
        this.cachedTools[id + '_time'] = Date.now();
        await StorageManager.saveMCPToolsCache(this.cachedTools);
        
        // 显示工具列表（带开关）
        this.showToolsList(id, tools, service.name);
        logger.info('[MCP Test] Cached', tools.length, 'tools for:', service.name);
      } else {
        this.showTestResult(id, `⚠️ 连接成功但未获取到工具`, true);
      }
    } catch (error) {
      logger.error('[MCP Test] Error:', error);
      this.showTestResult(id, `❌ 连接失败: ${error.message}`, true);
      // 清除缓存（如果有）
      delete this.cachedTools[id];
      delete this.cachedTools[id + '_time'];
      await StorageManager.saveMCPToolsCache(this.cachedTools);
    } finally {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.textContent = originalText || '测试';
      }
    }
  }

  showToolsList(id, tools, serviceName, cacheTime = null) {
    const el = document.getElementById(`toolsResult-${id}`);
    if (!el) return;
    
    // 移除所有样式类，使用容器样式
    el.className = 'tools-result-container';
    el.style.color = '';
    el.style.background = '';
    el.style.padding = '';
    
    // 头部信息
    const header = cacheTime 
      ? `✅ 获取成功 (缓存 ${cacheTime}) - 共 ${tools.length} 个工具`
      : `✅ 获取成功 - 共 ${tools.length} 个工具`;
    
    // 生成紧凑的工具列表HTML，添加可点击的头部和默认隐藏的工具列表
    let html = `
      <div data-tools-header data-service-id="${id}" class="tools-header">
        <div class="tools-header-title">${header}</div>
        <span data-tools-toggle-icon class="tools-toggle-icon">▼</span>
      </div>
    `;
    html += `<div data-tools-list data-service-id="${id}" class="tools-list">`;
    
    tools.forEach(tool => {
      const toolKey = `${id}:${tool.name}`;
      const isEnabled = this.toolsEnabled[toolKey] !== false; // 默认启用
      const isAutoExecute = this.toolsAutoExecute[toolKey] === true; // 默认不自动执行
      const description = tool.description || '无描述';
      const escapedName = TextFormatter.escapeHtml(tool.name);
      const escapedDesc = TextFormatter.escapeHtml(description);
      const shouldTruncate = description.length > 120;
      const showToggle = shouldTruncate;
      
      html += `
        <div class="tool-item">
          <label class="toggle tool-toggle-small">
            <input type="checkbox" ${isEnabled ? 'checked' : ''} 
                   data-tool-toggle data-service-id="${id}" data-tool-name="${escapedName}">
            <span class="toggle-slider"></span>
          </label>
          <div class="tool-info">
            <div class="tool-name">${escapedName}</div>
            <div class="tool-description${shouldTruncate ? ' truncated' : ''}" title="${escapedDesc}">
              ${escapedDesc}
            </div>
            ${showToggle ? `<button class="tool-desc-toggle" data-desc-toggle data-service-id="${id}">展开说明</button>` : ''}
          </div>
          <label class="toggle tool-toggle-auto" title="开启后AI调用此工具时将自动执行">
            <input type="checkbox" ${isAutoExecute ? 'checked' : ''} 
                   data-tool-auto-toggle data-service-id="${id}" data-tool-name="${escapedName}">
            <span class="toggle-slider" style="background: #f59e0b;"></span>
          </label>
          <span style="font-size: 11px; color: #9ca3af; min-width: 40px;">${isAutoExecute ? '自动' : '手动'}</span>
        </div>
      `;
    });
    
    html += '</div>';
    el.innerHTML = html;
    
    // 绑定工具列表展开/折叠事件
    this.bindToolsListToggle(id);
    
    // 绑定工具开关事件
    this.bindToolToggleEvents(id);
    
    // 绑定描述展开事件
    this.bindToolDescriptionToggle(id);
  }

  bindToolsListToggle(serviceId) {
    const el = document.getElementById(`toolsResult-${serviceId}`);
    if (!el) return;
    
    // 工具列表展开/折叠
    const header = el.querySelector(`[data-tools-header][data-service-id="${serviceId}"]`);
    const toolsList = el.querySelector(`[data-tools-list][data-service-id="${serviceId}"]`);
    const toggleIcon = el.querySelector('[data-tools-toggle-icon]');
    
    if (header && toolsList && toggleIcon) {
      header.addEventListener('click', () => {
        const isExpanded = toolsList.classList.contains('show');
        
        if (isExpanded) {
          // 折叠
          toolsList.classList.remove('show');
          toggleIcon.style.transform = 'rotate(0deg)';
        } else {
          // 展开
          toolsList.classList.add('show');
          toggleIcon.style.transform = 'rotate(-180deg)';
        }
      });
    }
  }

  bindToolToggleEvents(serviceId) {
    const el = document.getElementById(`toolsResult-${serviceId}`);
    if (!el) return;
    
    // 工具启用/禁用切换
    const toggles = el.querySelectorAll('[data-tool-toggle]');
    toggles.forEach(toggle => {
      toggle.addEventListener('change', async (e) => {
        const toolName = e.target.getAttribute('data-tool-name');
        const toolKey = `${serviceId}:${toolName}`;
        this.toolsEnabled[toolKey] = e.target.checked;
        await StorageManager.saveMCPToolsEnabled(this.toolsEnabled);
        logger.info(`[Tool] ${e.target.checked ? 'Enabled' : 'Disabled'} tool: ${toolName}`);
      });
    });
    
    // 工具自动执行切换
    const autoToggles = el.querySelectorAll('[data-tool-auto-toggle]');
    autoToggles.forEach(toggle => {
      toggle.addEventListener('change', async (e) => {
        const toolName = e.target.getAttribute('data-tool-name');
        const toolKey = `${serviceId}:${toolName}`;
        this.toolsAutoExecute[toolKey] = e.target.checked;
        await StorageManager.saveMCPToolsAutoExecute(this.toolsAutoExecute);
        
        // 更新UI显示文本
        const label = e.target.closest('.tool-item').querySelector('span[style*="min-width"]');
        if (label) {
          label.textContent = e.target.checked ? '自动' : '手动';
        }
        
        logger.info(`[Tool] ${e.target.checked ? 'Auto-execute enabled' : 'Auto-execute disabled'} for tool: ${toolName}`);
      });
    });
  }

  bindToolDescriptionToggle(serviceId) {
    const el = document.getElementById(`toolsResult-${serviceId}`);
    if (!el) return;
    
    const buttons = el.querySelectorAll('[data-desc-toggle]');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const toolItem = btn.closest('.tool-item');
        if (!toolItem) return;
        const desc = toolItem.querySelector('.tool-description');
        if (!desc) return;
        const expanded = desc.classList.toggle('expanded');
        btn.textContent = expanded ? '收起说明' : '展开说明';
      });
    });
  }

  showTestResult(id, text, isError = false) {
    const el = document.getElementById(`toolsResult-${id}`);
    if (!el) return;
    
    // 清理内联样式
    el.style.color = '';
    el.style.background = '';
    el.style.padding = '';
    
    // 使用适当的样式类
    el.className = isError ? 'tools-result-error' : 'tools-result-placeholder';
    el.innerHTML = TextFormatter.escapeHtml(text);
  }
  
  async clearAllHistory() {
    // 二次确认
    const confirmed = confirm(
      '⚠️ 确认清空所有对话历史？\n\n' +
      '这将永久删除所有对话记录，包括：\n' +
      '• 所有对话内容\n' +
      '• 工具调用记录\n' +
      '• 对话标题和时间戳\n\n' +
      '此操作无法撤销！'
    );
    
    if (!confirmed) {
      return;
    }
    
    try {
      // 清空对话历史
      await StorageManager.saveConversations([]);
      
      logger.info('[Options] All conversation history cleared');
      
      // 显示成功提示
      alert('✅ 对话历史已清空\n\n请关闭并重新打开侧边栏以刷新界面。');
      
      // 改变按钮状态（临时反馈）
      const btn = document.getElementById('clearHistoryBtn');
      const originalText = btn.innerHTML;
      btn.innerHTML = '✓ 已清空';
      btn.disabled = true;
      
      setTimeout(() => {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }, 2000);
      
    } catch (error) {
      logger.error('[Options] Failed to clear history:', error);
      alert('❌ 清空失败：' + error.message);
    }
  }
}

// Initialize
const optionsManager = new OptionsManager();
