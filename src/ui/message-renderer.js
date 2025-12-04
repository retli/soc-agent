import { TextFormatter } from '../utils/text-formatter.js';
import { MESSAGE_ROLES } from '../config/constants.js';

export class MessageRenderer {
  constructor() {
    this.messagesEl = document.getElementById('messages');
    this.inputEl = document.getElementById('messageInput');
    this.sendBtn = document.getElementById('sendBtn');
  }

  renderMessages(messages = []) {
    this.clear();
    if (!messages.length) {
      this.renderWelcomeMessage();
      return;
    }

    messages.forEach((msg) => {
      if (msg.role === MESSAGE_ROLES.TOOL) {
        return;
      }
      const element = this.createMessageElement(msg.role, msg.content, msg.timestamp);
      this.append(element);
    });

    this.scrollToBottom();
  }

  renderWelcomeMessage() {
    const welcome = this.createMessageElement(
      MESSAGE_ROLES.ASSISTANT,
      '你好！我是 AI 助手，有什么可以帮你的吗？'
    );
    this.append(welcome);
  }

  createMessageElement(role, content, timestamp = Date.now()) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const formattedContent = TextFormatter.format(content || '');
    let innerHTML = `<div class="message-content">${formattedContent}</div>`;

    if (role === MESSAGE_ROLES.USER) {
      innerHTML += this.renderEditButton();
    }

    messageDiv.innerHTML = innerHTML;
    messageDiv.dataset.timestamp = timestamp;
    return messageDiv;
  }

  renderMessage(role, content, timestamp = Date.now()) {
    return this.createMessageElement(role, content, timestamp);
  }

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

  appendMessage(role, content) {
    const element = this.createMessageElement(role, content);
    this.append(element);
    return element;
  }

  append(element) {
    if (!this.messagesEl || !element) return;
    this.messagesEl.appendChild(element);
    this.scrollToBottom();
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

  setInputState(disabled = false) {
    if (this.inputEl) {
      this.inputEl.disabled = disabled;
    }
    if (this.sendBtn) {
      this.sendBtn.disabled = disabled;
    }
  }

  clearInput() {
    if (!this.inputEl) return;
    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';
  }

  showLoading() {
    if (!this.messagesEl || this.messagesEl.querySelector('.loading-message')) return;
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

  hideLoading() {
    if (!this.messagesEl) return;
    this.messagesEl.querySelectorAll('.loading-message').forEach((el) => el.remove());
  }

  showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    this.append(errorDiv);
  }

  renderToolRecordHTML(toolMsg) {
    const recordId = `tool-record-${toolMsg.timestamp || Date.now()}`;

    let argsHtml = '';
    if (toolMsg.args && Object.keys(toolMsg.args).length > 0) {
      argsHtml = '<div style="display: flex; flex-direction: column; gap: 6px;">';
      for (const [key, value] of Object.entries(toolMsg.args)) {
        const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
        argsHtml += `
          <div style="display: flex; align-items: center; gap: 6px;">
            <label style="font-size: 10px; font-weight: 600; color: rgba(255, 255, 255, 0.9); min-width: 80px; flex-shrink: 0;">${TextFormatter.escapeHtml(key)}:</label>
            <span style="font-family: 'Courier New', monospace; font-size: 10px; background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 4px; padding: 4px 8px; color: #1f2937; flex: 1; word-break: break-all;">${TextFormatter.escapeHtml(valueStr)}</span>
          </div>
        `;
      }
      argsHtml += '</div>';
    } else {
      argsHtml = '<div style="font-size: 10px; color: rgba(255, 255, 255, 0.6); font-style: italic; padding: 4px 0;">无参数</div>';
    }

    const resultData = toolMsg.result || toolMsg.content;
    const resultPreview = resultData
      ? (typeof resultData === 'string' ? resultData : JSON.stringify(resultData, null, 2))
      : '(无执行结果)';

    const serviceName = toolMsg.serviceName || '默认服务';

    return `
      <div class="tool-call-record" id="${recordId}" style="margin: 8px 0; animation: slideIn 0.3s ease-out;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; padding: 8px 10px; color: white; box-shadow: 0 2px 6px rgba(102, 126, 234, 0.2);">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
            <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
              <span style="font-size: 14px;">🔧</span>
              <span style="font-size: 11px; font-weight: 500; letter-spacing: 0.2px;"> 
                <strong style="font-family: 'Courier New', monospace; background: rgba(255, 255, 255, 0.2); padding: 1px 4px; border-radius: 3px; font-weight: 600; font-size: 10px; margin-left: 2px;">
                  ${TextFormatter.escapeHtml(toolMsg.toolName)}
                </strong>
              </span>
              <span style="font-size: 9px; color: rgba(255, 255, 255, 0.8); background: rgba(255, 255, 255, 0.15); padding: 1px 5px; border-radius: 10px; margin-left: 6px; font-weight: 500; letter-spacing: 0.2px;">
                [${TextFormatter.escapeHtml(serviceName)}]
              </span>
            </div>
            <button class="tool-record-toggle" style="background: rgba(255, 255, 255, 0.15); border: none; color: white; cursor: pointer; padding: 2px 6px; border-radius: 4px; font-size: 10px;">
              <span style="display: inline-block; transition: transform 0.2s ease;">▼</span>
            </button>
          </div>
          <div class="tool-record-details" style="max-height: 0; overflow: hidden; opacity: 0; transition: max-height 0.3s ease, opacity 0.2s ease, margin 0.3s ease; margin: 0;">
            <div style="margin-top: 6px;">
              <div style="font-size: 9px; font-weight: 600; color: rgba(255, 255, 255, 0.8); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">执行参数</div>
              ${argsHtml}
            </div>
            <div>
              <div style="font-size: 9px; font-weight: 600; color: rgba(255, 255, 255, 0.8); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">执行结果</div>
              <div style="background: rgba(255, 255, 255, 0.95); border-radius: 5px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.3); border-left: 3px solid #10b981;">
                <div style="padding: 4px 8px; font-weight: 600; font-size: 9px; display: flex; align-items: center; gap: 4px; background-color: #d1fae5; color: #065f46;">✓ 执行成功</div>
                <pre style="color: #1f2937; padding: 8px; margin: 0; font-family: 'Courier New', monospace; font-size: 10px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; max-height: 300px; overflow-y: auto; background: #f9fafb; border-top: 1px solid rgba(0,0,0,0.05);">${TextFormatter.escapeHtml(resultPreview)}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

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
          <button class="tool-prompt-btn tool-prompt-btn-execute" data-prompt-id="${promptId}" style="flex: 1; padding: 4px 10px; border: none; border-radius: 4px; font-size: 10px; font重量: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 3px; transition: all 0.2s ease; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background-color: #10b981; color: white;">
            <span style="font-size: 11px;">▶</span> 执行
          </button>
          <button class="tool-prompt-btn tool-prompt-btn-cancel" data-prompt-id="${promptId}" style="flex: 1; padding: 4px 10px; border: none; border-radius: 4px; font-size: 10px; font重量: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 3px; transition: all 0.2s ease; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background-color: rgba(255, 255, 255, 0.2); color: white; border: 1px solid rgba(255, 255, 255, 0.3);">
            <span style="font-size: 11px;">✕</span> 取消
          </button>
        </div>
      </div>
    `;

    return promptDiv;
  }
}