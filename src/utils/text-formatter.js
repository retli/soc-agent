/**
 * Text Formatter Utility
 * 
 * 功能：
 * 1. HTML转义（防止XSS）
 * 2. Markdown到HTML转换（支持加粗、斜体、代码、列表等）
 * 3. 时间格式化
 * 4. 工具结果格式化
 * 5. 文本截断
 * 6. 工具标记移除
 */

export class TextFormatter {
  /**
   * Escape HTML to prevent XSS
   */
  static escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Format timestamp to relative time
   */
  static formatTime(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  }

  /**
   * Format tool result for display
   */
  static formatToolResult(result) {
    try {
      let parsed = result;
      
      // If string, try to parse as JSON
      if (typeof result === 'string') {
        try {
          parsed = JSON.parse(result);
        } catch (e) {
          return result;
        }
      }
      
      // Handle MCP standard response format {content: [...]}
      if (parsed && parsed.content && Array.isArray(parsed.content)) {
        const textContent = parsed.content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join('\n');
        if (textContent) {
          return textContent;
        }
      }
      
      // Extract result field if present
      if (parsed && parsed.result) {
        return this.formatToolResult(parsed.result);
      }
      
      // If array, format as numbered list
      if (Array.isArray(parsed)) {
        return parsed.map((item, index) => {
          if (typeof item === 'string') {
            return `${index + 1}. ${item}`;
          }
          return `${index + 1}. ${JSON.stringify(item)}`;
        }).join('\n');
      }
      
      // If object, format as JSON with clear structure
      if (typeof parsed === 'object' && parsed !== null) {
        // 格式化对象，使其更易读，便于AI提取数据
        const jsonStr = JSON.stringify(parsed, null, 2);
        // 添加说明，帮助AI理解这是实际数据
        return `工具返回的实际数据（JSON格式）：\n${jsonStr}\n\n请使用上述JSON中的实际值，不要使用占位符。`;
      }
      
      return String(parsed);
    } catch (e) {
      return String(result);
    }
  }

  /**
   * Truncate text to specified length
   */
  static truncate(text, maxLength = 30) {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  }

  /**
   * Remove tool call markers from text
   */
  static removeToolMarkers(text) {
    return text
      .replace(/使用工具[：:].*/gi, '')
      .replace(/执行[：:]\s*\w+/gi, '')
      .replace(/Executing[：:]\s*\w+/gi, '')
      .trim();
  }

  /**
   * Parse ReAct formatted text into multi-iteration structure
   */
  static parseReActFormat(text) {
    if (!text) return null;
    
    const headerRegex = /(?:\*\*)?(Reasoning|Acting|Observation|Response|推理|行动|观察|响应)(?:\*\*)?[：:]\s*/gi;
    const sections = [];
    
    let match;
    while ((match = headerRegex.exec(text)) !== null) {
      const stage = this.normalizeReActStage(match[1]);
      if (!stage) continue;
      sections.push({
        stage,
        headerStart: match.index,
        contentStart: headerRegex.lastIndex
      });
    }
    
    if (sections.length === 0) {
      return null;
    }
    
    // Attach content to each section
    for (let i = 0; i < sections.length; i++) {
      const endIndex = i + 1 < sections.length ? sections[i + 1].headerStart : text.length;
      sections[i].content = text.slice(sections[i].contentStart, endIndex).trim();
    }
    
    const iterations = [];
    const responses = [];
    let currentIteration = null;
    let iterationCounter = 0;
    let activeStage = null;
    let activeIterationIndex = null;
    
    const pushIteration = () => {
      if (!currentIteration) return;
      const hasContent = ['reasoning', 'acting', 'observation'].some(key => {
        return currentIteration[key] && currentIteration[key].trim().length > 0;
      });
      if (hasContent) {
        iterations.push(currentIteration);
      }
      currentIteration = null;
    };
    
    for (const section of sections) {
      activeStage = section.stage;
      switch (section.stage) {
        case 'reasoning':
          pushIteration();
          iterationCounter += 1;
          currentIteration = { index: iterationCounter, reasoning: section.content };
          activeIterationIndex = iterationCounter;
          break;
        case 'acting':
          if (!currentIteration) {
            iterationCounter += 1;
            currentIteration = { index: iterationCounter };
          }
          currentIteration.acting = section.content;
          activeIterationIndex = currentIteration.index;
          break;
        case 'observation':
          if (!currentIteration) {
            iterationCounter += 1;
            currentIteration = { index: iterationCounter };
          }
          currentIteration.observation = section.content;
          activeIterationIndex = currentIteration.index;
          break;
        case 'response':
          responses.push(section.content);
          break;
        default:
          break;
      }
    }
    
    pushIteration();
    
    const responseText = responses.filter(Boolean).join('\n\n').trim();
    
    if (iterations.length === 0 && !responseText) {
      return null;
    }
    
    return {
      iterations,
      response: responseText,
      activeStage,
      activeIterationIndex
    };
  }

  static normalizeReActStage(label = '') {
    const normalized = label.replace(/\*/g, '').trim().toLowerCase();
    const mapping = {
      reasoning: 'reasoning',
      '推理': 'reasoning',
      acting: 'acting',
      '行动': 'acting',
      observation: 'observation',
      '观察': 'observation',
      response: 'response',
      '响应': 'response'
    };
    return mapping[normalized] || null;
  }
  
  /**
   * 格式化Action文本：提取工具名称，显示简洁说明
   * 优化：只显示工具名称和简洁说明，不显示参数细节
   */
  static formatActionText(actionText) {
    if (!actionText) return '';
    
    // 尝试提取工具调用信息（Function Calling格式）
    const toolCalls = [];
    
    // 方法1: 匹配JSON格式的工具调用（优先）
    const jsonMatch = actionText.match(/"name"\s*:\s*"([^"]+)"/gi);
    if (jsonMatch) {
      jsonMatch.forEach(m => {
        const nameMatch = m.match(/"name"\s*:\s*"([^"]+)"/i);
        if (nameMatch) {
          toolCalls.push(nameMatch[1]);
        }
      });
    }
    
    // 方法2: 匹配文本格式的工具调用
    if (toolCalls.length === 0) {
      const toolCallPattern = /(?:调用|使用|执行)?\s*工具[：:]\s*([^\s,，\n]+)/gi;
      let match;
      while ((match = toolCallPattern.exec(actionText)) !== null) {
        toolCalls.push(match[1]);
      }
    }
    
    // 方法3: 尝试从列表格式中提取（如：- 工具名: 说明）
    if (toolCalls.length === 0) {
      const listPattern = /[-*]\s*([^:：\n]+?)[：:]/g;
      let match;
      while ((match = listPattern.exec(actionText)) !== null) {
        const toolName = match[1].trim();
        // 过滤掉明显不是工具名称的内容
        if (toolName && toolName.length < 50 && !toolName.includes('{') && !toolName.includes('"')) {
          toolCalls.push(toolName);
        }
      }
    }
    
    // 如果找到了工具，显示简洁格式
    if (toolCalls.length > 0) {
      const uniqueTools = [...new Set(toolCalls)];
      
      const toolList = uniqueTools.map(tool => 
        `<span class="react-action-chip">${this.escapeHtml(tool)}</span>`
      ).join('');
      
      let cleanText = actionText
        .replace(/\{[^}]*"name"[^}]*"arguments"[^}]*\}/gi, '')
        .replace(/\{[^}]*"name"[^}]*\}/gi, '')
        .replace(/"name"\s*:\s*"[^"]+"/gi, '')
        .replace(/"arguments"\s*:\s*\{[^}]*\}/gi, '')
        .replace(/"arguments"\s*:\s*"[^"]*"/gi, '')
        .replace(/参数[：:]\s*[^\n]+/gi, '')
        .replace(/[{}[\]]/g, '')
        .replace(/,\s*,/g, ',')
        .replace(/\s+/g, ' ')
        .trim();
      
      uniqueTools.forEach(tool => {
        const escapedTool = tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        cleanText = cleanText.replace(new RegExp(escapedTool, 'gi'), '');
      });
      cleanText = cleanText.replace(/\s+/g, ' ').trim();
      
      let summaryHtml = '';
      if (cleanText && cleanText.length > 0 && !cleanText.match(/^[\s,，:：-]*$/)) {
        summaryHtml = `<div class="react-action-summary">${this.renderSimpleMarkdown(cleanText)}</div>`;
      } else {
        const defaultDesc = uniqueTools.length === 1
          ? `将使用工具 ${uniqueTools[0]} 执行操作`
          : `将使用 ${uniqueTools.length} 个工具执行操作`;
        summaryHtml = `<div class="react-action-summary">${this.escapeHtml(defaultDesc)}</div>`;
      }
      
      return `
        ${summaryHtml}
        <div class="react-action-tools">
          <span class="react-action-tools-label">工具</span>
          ${toolList}
        </div>
      `;
    }
    
    // 如果没有工具，直接渲染原始文本（但简化长代码）
    let simplified = actionText;
    
    // 如果包含很长的JSON或代码块，简化显示
    if (actionText.length > 200) {
      // 尝试提取关键信息
      const lines = actionText.split('\n').filter(line => {
        // 保留简短的行，过滤掉长JSON
        return line.length < 100 || (!line.includes('{') && !line.includes('"'));
      });
      simplified = lines.join('\n');
      if (simplified.length < actionText.length * 0.3) {
        // 如果简化太多，保留原始但截断
        simplified = actionText.substring(0, 150) + '...';
      }
    }
    
    return `<div class="react-action-summary">${this.renderSimpleMarkdown(simplified)}</div>`;
  }

  /**
   * Render simple markdown (without ReAct parsing) to avoid recursion
   */
  static renderSimpleMarkdown(text) {
    if (!text) return '';
    
    // First escape HTML to prevent XSS
    let html = this.escapeHtml(text);
    
    // Convert inline code
    html = html.replace(/`([^`]+?)`/g, '<code style="background: #f3f4f6; color: #374151; padding: 2px 6px; border-radius: 4px; font-family: \'Courier New\', Consolas, Monaco, monospace; font-size: 13px;">$1</code>');
    
    // Convert bold
    html = html.replace(/\*\*([^\*]+?)\*\*/g, '<strong style="font-weight: 600; color: #1f2937;">$1</strong>');
    html = html.replace(/__([^_]+?)__/g, '<strong style="font-weight: 600; color: #1f2937;">$1</strong>');
    
    // Convert italic
    html = html.replace(/\*([^\*\n]+?)\*/g, '<em style="font-style: italic; color: #4b5563;">$1</em>');
    html = html.replace(/\b_([^_\n]+?)_\b/g, '<em style="font-style: italic; color: #4b5563;">$1</em>');
    
    // Convert unordered lists
    html = html.replace(/^[\-\*]\s+(.+)$/gm, '<li style="margin: 1px 0; padding-left: 4px; line-height: 1.4; color: #374151;">$1</li>');
    html = html.replace(/(<li[^>]*>.*?<\/li>(?:<br>)?)+/g, '<ul style="margin: 4px 0; padding-left: 20px; list-style: disc; color: #6b7280;">$&</ul>');
    
    // Convert ordered lists
    html = html.replace(/^\d+\.\s+(.+)$/gm, '<li style="margin: 1px 0; padding-left: 4px; line-height: 1.4; color: #374151;">$1</li>');
    
    // Convert line breaks
    html = html.replace(/\n\n+/g, '<br><br>');
    html = html.replace(/\n/g, '<br>');
    
    // Clean up extra <br> tags
    html = html.replace(/<br><br><h[1-6]/g, '<br><h');
    html = html.replace(/<\/h[1-6]><br><br>/g, '</h><br>');
    html = html.replace(/<br><br><ul/g, '<br><ul');
    html = html.replace(/<\/ul><br><br>/g, '</ul>');
    html = html.replace(/<\/ul><br>/g, '</ul>');
    html = html.replace(/<\/li><br><br><li/g, '</li><li');
    html = html.replace(/<\/li><br><li/g, '</li><li');
    html = html.replace(/<br><br><li/g, '<li');
    html = html.replace(/<br><li/g, '<li');
    
    return html;
  }

  /**
   * 渲染 ReAct 结构
   */
  static renderReActFormat(reactData) {
    if (!reactData) return null;
    
    const iterations = Array.isArray(reactData.iterations) ? reactData.iterations : [];
    const hasContent = iterations.length > 0 || (reactData.response && reactData.response.trim().length > 0);
    
    if (!hasContent) return null;
    
    const activeStage = reactData.activeStage;
    const activeIteration = reactData.activeIterationIndex;
    
    let html = '<div class="react-stack">';
    
    iterations.forEach((iteration, idx) => {
      const badge = `<span class="react-iteration-badge">第${idx + 1}轮</span>`;
      const iterationIndex = iteration.index || idx + 1;
      const markActive = (stage) => iterationIndex === activeIteration && activeStage === stage ? ' react-section-active' : '';
      
      if (iteration.reasoning) {
        html += `
          <section class="react-card react-thought${markActive('reasoning')}">
            <header class="react-card-header">
              <span class="react-card-icon">💭</span>
              <span class="react-card-title">推理</span>
              ${badge}
            </header>
            <div class="react-card-content">
              ${this.renderSimpleMarkdown(iteration.reasoning)}
            </div>
          </section>
        `;
      }
      
      if (iteration.acting) {
        html += `
          <section class="react-card react-acting${markActive('acting')}">
            <header class="react-card-header">
              <span class="react-card-icon">⚡</span>
              <span class="react-card-title">行动</span>
              ${badge}
            </header>
            <div class="react-card-content">
              ${this.formatActionText(iteration.acting)}
            </div>
          </section>
        `;
      }
      
      if (iteration.observation) {
        html += `
          <section class="react-card react-observation${markActive('observation')}">
            <header class="react-card-header">
              <span class="react-card-icon">👁️</span>
              <span class="react-card-title">观察</span>
              ${badge}
            </header>
            <div class="react-card-content">
              ${this.renderSimpleMarkdown(iteration.observation)}
            </div>
          </section>
        `;
      }
    });
    
    if (reactData.response) {
      html += `
        <section class="react-card react-conclusion${activeStage === 'response' ? ' react-section-active' : ''}">
          <header class="react-card-header">
            <span class="react-card-icon">✅</span>
            <span class="react-card-title">响应</span>
          </header>
          <div class="react-card-content">
            ${this.renderSimpleMarkdown(reactData.response)}
          </div>
        </section>
      `;
    }
    
    html += '</div>';
    return html;
  }

  /**
   * Convert Markdown to HTML with simple, readable styling
   * 支持ReAct格式的自动识别和渲染
   */
  static markdownToHtml(text, previousHtml = null) { // previousHtml 保留兼容性（已不再需要）
    if (!text) return '';
    
    // 首先尝试解析ReAct格式
    const reactData = this.parseReActFormat(text);
    if (
      reactData &&
      (
        (Array.isArray(reactData.iterations) && reactData.iterations.length > 0) ||
        (reactData.response && reactData.response.trim().length > 0)
      )
    ) {
      return this.renderReActFormat(reactData);
    }
    
    // 否则使用标准的Markdown渲染
    // First escape HTML to prevent XSS
    let html = this.escapeHtml(text);
    
    // Convert inline code - 简化样式，使用浅灰背景
    html = html.replace(/`([^`]+?)`/g, '<code style="background: #f3f4f6; color: #374151; padding: 2px 6px; border-radius: 4px; font-family: \'Courier New\', Consolas, Monaco, monospace; font-size: 13px;">$1</code>');
    
    // Convert headers - 简化为深色文字，紧凑间距
    html = html.replace(/^### (.+)$/gm, '<h3 style="font-size: 15px; font-weight: 600; margin: 8px 0 4px 0; color: #1f2937;">$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2 style="font-size: 16px; font-weight: 600; margin: 10px 0 5px 0; color: #1f2937;">$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1 style="font-size: 17px; font-weight: 600; margin: 12px 0 6px 0; color: #1f2937;">$1</h1>');
    
    // Convert bold - 简单加粗，深色
    html = html.replace(/\*\*([^\*]+?)\*\*/g, '<strong style="font-weight: 600; color: #1f2937;">$1</strong>');
    html = html.replace(/__([^_]+?)__/g, '<strong style="font-weight: 600; color: #1f2937;">$1</strong>');
    
    // Convert italic - 轻微倾斜
    html = html.replace(/\*([^\*\n]+?)\*/g, '<em style="font-style: italic; color: #4b5563;">$1</em>');
    html = html.replace(/\b_([^_\n]+?)_\b/g, '<em style="font-style: italic; color: #4b5563;">$1</em>');
    
    // Convert unordered lists - 紧凑样式
    html = html.replace(/^[\-\*]\s+(.+)$/gm, '<li style="margin: 1px 0; padding-left: 4px; line-height: 1.4; color: #374151;">$1</li>');
    html = html.replace(/(<li[^>]*>.*?<\/li>(?:<br>)?)+/g, '<ul style="margin: 4px 0; padding-left: 20px; list-style: disc; color: #6b7280;">$&</ul>');
    
    // Convert ordered lists
    html = html.replace(/^\d+\.\s+(.+)$/gm, '<li style="margin: 1px 0; padding-left: 4px; line-height: 1.4; color: #374151;">$1</li>');
    
    // Convert line breaks - 保留段落分隔
    html = html.replace(/\n\n+/g, '<br><br>');
    html = html.replace(/\n/g, '<br>');
    
    // Clean up extra <br> tags
    html = html.replace(/<br><br><h[1-6]/g, '<br><h');
    html = html.replace(/<\/h[1-6]><br><br>/g, '</h><br>');
    html = html.replace(/<br><br><ul/g, '<br><ul');
    html = html.replace(/<\/ul><br><br>/g, '</ul>');
    html = html.replace(/<\/ul><br>/g, '</ul>');
    // Remove ALL <br> tags between list items (including single and double)
    html = html.replace(/<\/li><br><br><li/g, '</li><li');
    html = html.replace(/<\/li><br><li/g, '</li><li');
    html = html.replace(/<br><br><li/g, '<li');
    html = html.replace(/<br><li/g, '<li');
    
    return html;
  }
}
