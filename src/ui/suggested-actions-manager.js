import { logger } from '../utils/logger.js';
import { TextFormatter } from '../utils/text-formatter.js';

/**
 * Suggested Actions Manager
 * 负责管理建议行动的解析、渲染和交互
 */
export class SuggestedActionsManager {
  /**
   * @param {Object} config - 应用配置
   * @param {Function} onSuggestionClick - 点击建议时的回调函数 (suggestionText) => void
   */
  constructor(config, onSuggestionClick) {
    this.config = config;
    this.onSuggestionClick = onSuggestionClick;
    this.panel = null;
    this.content = null;
    
    // 延迟初始化DOM引用
    this.ensureDomElements();
  }

  ensureDomElements() {
    if (!this.panel) {
      this.panel = document.getElementById('suggestedActionsPanel');
    }
    if (!this.content) {
      this.content = document.getElementById('suggestedActionsContent');
    }
  }

  /**
   * 重置建议行动面板为初始状态
   */
  reset() {
    this.ensureDomElements();
    if (this.panel && this.content) {
      this.panel.style.display = 'none';
      this.content.innerHTML = '';
      logger.info('[SuggestedActions] Panel reset to initial state');
    }
  }

  /**
   * 解析AI响应中的建议行动
   * @param {string} content - AI响应内容
   * @returns {Object} 解析结果 { incident_type, suggestions: [] }
   */
  parse(content) {
    try {
      logger.info('[SuggestedActions] Parsing response...');
      
      // 尝试提取JSON（可能被markdown代码块包裹）
      let jsonText = content.trim();
      
      // 移除markdown代码块
      const codeBlockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
      } else {
        // 尝试直接匹配完整的JSON对象
        const jsonMatch = content.match(/\{[\s\S]*"suggestions"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/);
        if (jsonMatch) {
          jsonText = jsonMatch[0].trim();
        } else {
          // 如果匹配失败，尝试找到第一个完整的JSON对象
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
      
      // 清理jsonText，移除可能的JSON字符串片段
      if (jsonText.includes('"suggestions"') && !jsonText.match(/^\s*\{[\s\S]*\}\s*$/)) {
        const fullJsonMatch = jsonText.match(/\{[\s\S]*\}/);
        if (fullJsonMatch) {
          jsonText = fullJsonMatch[0];
        }
      }
      
      const result = JSON.parse(jsonText);
      
      // 标准化建议格式
      if (result.suggestions) {
        // 过滤无效建议
        result.suggestions = result.suggestions.filter(s => {
          if (typeof s === 'string') {
            return !s.includes('"suggestions"') && 
                   !s.includes('"action"') && 
                   !s.includes('"priority"') &&
                   !s.match(/^[\s]*[\[\{]/) && 
                   s.trim().length > 0;
          }
          return s !== null && s !== undefined;
        });
        
        result.suggestions = result.suggestions.map(s => {
          // 处理字符串类型的建议（先检查是否是JSON片段）
          if (typeof s === 'string') {
            if (s.includes('"suggestions"') || 
                s.includes('"action"') || 
                s.match(/^[\s]*[\[\{]/)) {
              logger.warn('[SuggestedActions] Skipping JSON string fragment:', s.substring(0, 50));
              return null;
            }
            return {
              action: s,
              priority: 'medium',
              reason: '',
              tool_name: ''
            };
          }
          
          // 处理对象类型的建议 - 提取action文本
          let actionText = '';
          if (typeof s === 'object' && s !== null) {
            actionText = s.action || s.text || '';
            
            // 如果找不到明确的action字段，尝试从其他字段提取
            if (!actionText) {
              const excludedKeys = ['priority', 'reason', 'tool_name', 'toolName', 'incident_type', 'id', '_id', 'type', 'status'];
              for (const key in s) {
                const value = s[key];
                if (!excludedKeys.includes(key) && 
                    typeof value === 'string' && 
                    value.trim().length > 0 &&
                    value.trim().length >= 5 && 
                    value.trim().length < 200 && 
                    !value.match(/^(high|medium|low|true|false|\d+)$/i)) {
                  actionText = value;
                  break;
                }
              }
            }
            
            if (!actionText) {
              logger.warn('[SuggestedActions] Could not extract action text from suggestion:', s);
              actionText = '建议行动';
            }
          } else {
            actionText = String(s);
          }
          
          return {
            action: actionText,
            priority: s.priority || 'medium',
            reason: s.reason || '',
            tool_name: s.tool_name || s.toolName || ''
          };
        })
        .filter(s => s !== null);
        
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
      
      // Fallback: 简单的行解析
      const lines = content.split('\n')
        .filter(line => {
          const trimmed = line.trim();
          return trimmed && 
                 !trimmed.includes('{') && 
                 !trimmed.includes('}') && 
                 !trimmed.includes('[') && 
                 !trimmed.includes(']') &&
                 !trimmed.includes('"suggestions"') &&
                 !trimmed.match(/^[\s]*["\']/);
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
   * 显示建议行动 UI
   * @param {Array} suggestions - 建议列表
   * @param {string} incidentType - 事件类型
   */
  display(suggestions, incidentType) {
    this.ensureDomElements();
    if (!this.panel || !this.content) {
      logger.error('[SuggestedActions] Panel elements not found!');
      return;
    }
    
    logger.info('[SuggestedActions] Displaying suggestions:', suggestions.length);
    
    // 清空旧内容
    this.content.innerHTML = '';
    
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
      this.content.appendChild(typeLabel);
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
      
      // 已经过 parse 归一化，可以直接使用对象属性
      // 这里移除了 sidebar.js 中重复的防御性代码
      const action = suggestion.action || '建议行动';
      const priority = suggestion.priority || 'medium';
      const reason = suggestion.reason || '';
      const toolName = suggestion.tool_name || '';
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
      
      this.content.appendChild(item);
    });
    
    // 显示面板
    this.panel.style.display = 'block';
  }

  /**
   * 处理建议点击
   */
  handleSuggestionClick(suggestion) {
    logger.info('[SuggestedActions] Suggestion clicked:', suggestion);
    
    // 填充到输入框
    const input = document.getElementById('messageInput');
    if (!input) return;
    
    input.value = suggestion;
    
    // 自动调整高度
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
    
    // 聚焦输入框
    input.focus();
    
    // 调用外部传入的回调
    if (this.onSuggestionClick) {
      this.onSuggestionClick(suggestion);
    }
  }

  /**
   * 测试方法：直接显示建议（用于调试）
   */
  testShowSuggestions() {
    logger.info('[SuggestedActions] TEST: Showing test suggestions');
    const testSuggestions = [
      { action: '查询该IP的历史告警记录', priority: 'high' },
      { action: '检查相关资产的网络流量', priority: 'medium' },
      { action: '分析同时段其他可疑活动', priority: 'low' }
    ];
    this.display(testSuggestions, '测试事件');
  }
}

