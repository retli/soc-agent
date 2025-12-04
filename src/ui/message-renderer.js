import { TextFormatter } from '../utils/text-formatter.js';
import { MESSAGE_ROLES } from '../config/constants.js';
import { logger } from '../utils/logger.js';

export class MessageRenderer {
  constructor() {
    this.messagesEl = document.getElementById('messages');
    // 绑定 this 到方法
    this.scrollToBottom = this.scrollToBottom.bind(this);
  }

  /**
   * 渲染会话中的所有消息
   * @param {Array} messages - 消息数组
   */
  renderMessages(messages) {
    this.clear();
    
    if (!messages || messages.length === 0) {
      this.renderWelcomeMessage();
      return;
    }
    
    messages.forEach(msg => {
      // 跳过 TOOL 类型的消息（它们通常作为上下文或在工具卡片中显示）
      if (msg.role === MESSAGE_ROLES.TOOL) {
        return;
      }
      
      const messageDiv = this.createMessageElement(msg.role, msg.content, msg.timestamp);
      this.append(messageDiv);
    });
    
    this.scrollToBottom();
  }
  
  /**
   * 渲染欢迎消息
   */
  renderWelcomeMessage() {
    const welcomeDiv = this.createMessageElement(
      MESSAGE_ROLES.ASSISTANT, 
      '你好！我是 AI 助手，有什么可以帮你的吗？'
    );
    this.append(welcomeDiv);
  }

  /**
   * 创建单个消息 DOM 元素
   */
  createMessageElement(role, content, timestamp) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    // 格式化内容
    const formattedContent = TextFormatter.format(content || '');
    
    let innerHTML = `
      <div class="message-content">${formattedContent}</div>
    `;
    
    // 为用户消息添加编辑按钮
    if (role === MESSAGE_ROLES.USER) {
      innerHTML += this.renderEditButton();
    }
    
    messageDiv.innerHTML = innerHTML;
    return messageDiv;
  }

  /**
   * 对外暴露的单条消息渲染接口
   */
  renderMessage(role, content, timestamp = Date.now()) {
    return this.createMessageElement(role, content, timestamp);
  }

  /**
   * 渲染编辑按钮 HTML
   */
  renderEditButton() {
    return `
      <button class="message-edit-btn" title="编辑消息">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
      </button>
    `;
  }

  /**
   * 追加消息到列表
   */
  appendMessage(role, content) {
    const messageDiv = this.createMessageElement(role, content, Date.now());
    this.append(messageDiv);
    return messageDiv;
  }

  append(element) {
    if (this.messagesEl) {
      this.messagesEl.appendChild(element);
      this.scrollToBottom();
  }

  /**
   * 创建工具执行提示元素
   */
  createToolPromptElement({ toolName, serviceName = '默认服务', args = {}, promptId }) {
    const promptDiv = document.createElement('div');
    promptDiv.className = 'tool-execution-prompt';
    if (promptId) {
      promptDiv.id = promptId;
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

    return promptDiv;
  }
}
  }

  clear() {
    if (this.messagesEl) {
      this.messagesEl.innerHTML = '';
    }
  }

  scrollToBottom() {
    if (this.messagesEl) {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }
  
  /**
   * 显示加载状态
   */
  showLoading() {
    // 如果已存在 loading，则不重复添加
    if (this.messagesEl.querySelector('.loading-message')) return;
    
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message assistant loading-message';
    loadingDiv.innerHTML = `
      <div class="message-content loading">
        <div class="loading-dot"></div>
        <div class="loading-dot"></div>
        <div class="loading-dot"></div>
      </div>
    `;
    this.append(loadingDiv);
  }
  
  /**
   * 隐藏加载状态
   */
  hideLoading() {
    const loaders = this.messagesEl.querySelectorAll('.loading-message');
    loaders.forEach(loader => loader.remove());
  }
  
  /**
   * 显示错误消息
   */
  showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    this.append(errorDiv);
  }

  /**
   * 渲染工具调用记录 HTML
   */
  renderToolRecordHTML(toolMsg) {
    const recordId = `tool-record-${toolMsg.timestamp || Date.now()}`;
    
    // 格式化参数显示
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
    
    const resultData = toolMsg.result || toolMsg.content;
    const resultPreview = resultData 
      ? (typeof resultData === 'string' ? resultData : JSON.stringify(resultData, null, 2))
      : '(无执行结果)';
    
    const serviceName = toolMsg.serviceName || '默认服务';
    
    return `
      <div class="tool-call-record" id="${recordId}" style="margin: 8px 0; animation: slideIn 0.3s ease-out;">
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
      </div>
    `;
  }
