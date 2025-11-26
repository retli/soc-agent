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
   * Parse and format ReAct format content
   * ReAct格式：Reasoning（推理）, Acting（行动）, Observation（观察）, Response（响应）
   * 支持多种格式：
   * - **Reasoning:** 或 Reasoning: 或 Reasoning：或 **推理:** 或 推理:
   * - **Acting:** 或 Acting: 或 Acting：或 **行动:** 或 行动:
   * - **Observation:** 或 Observation: 或 Observation：或 **观察:** 或 观察:
   * - **Response:** 或 Response: 或 Response：或 **响应:** 或 响应:
   * 
   * 增强：返回每个组件的结束位置，用于判断组件是否完整
   */
  static parseReActFormat(text) {
    if (!text) return null;
    
    // 只支持新格式：Reasoning, Acting, Observation, Response
    const reactPattern = {
      reasoning: /(?:\*\*)?(?:Reasoning|推理)(?:\*\*)?[：:]\s*([\s\S]*?)(?=\n\s*(?:\*\*)?(?:Acting|行动|Observation|观察|Response|响应)[：:]|$)/i,
      acting: /(?:\*\*)?(?:Acting|行动)(?:\*\*)?[：:]\s*([\s\S]*?)(?=\n\s*(?:\*\*)?(?:Observation|观察|Response|响应|Reasoning|推理)[：:]|$)/i,
      observation: /(?:\*\*)?(?:Observation|观察)(?:\*\*)?[：:]\s*([\s\S]*?)(?=\n\s*(?:\*\*)?(?:Response|响应|Reasoning|推理|Acting|行动)[：:]|$)/i,
      response: /(?:\*\*)?(?:Response|响应)(?:\*\*)?[：:]\s*([\s\S]*?)(?=\n\s*(?:\*\*)?(?:Reasoning|推理|Acting|行动|Observation|观察)[：:]|$)/i
    };
    
    const result = {};
    const componentEndPositions = {}; // 记录每个组件的结束位置
    
    // 匹配所有模式
    for (const [key, pattern] of Object.entries(reactPattern)) {
      const match = text.match(pattern);
      if (match && match[1]) {
        result[key] = match[1].trim();
        // 计算组件的结束位置（匹配开始位置 + 匹配内容长度）
        const startPos = match.index;
        const endPos = startPos + match[0].length;
        componentEndPositions[key] = endPos;
      }
    }
    
    // 如果找到了至少一个ReAct组件，返回解析结果和位置信息
    if (Object.keys(result).length > 0) {
      result._positions = componentEndPositions;
      return result;
    }
    
    return null;
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
      // 去重
      const uniqueTools = [...new Set(toolCalls)];
      
      const toolList = uniqueTools.map(tool => 
        `<span style="
          background: rgba(139, 92, 246, 0.15);
          color: #6b21a8;
          padding: 2px 6px;
          border-radius: 4px;
          font-family: 'Courier New', monospace;
          font-size: 12px;
          font-weight: 600;
        ">${this.escapeHtml(tool)}</span>`
      ).join(' ');
      
      // 提取简洁的文字说明（完全移除JSON和参数）
      let cleanText = actionText
        .replace(/\{[^}]*"name"[^}]*"arguments"[^}]*\}/gi, '') // 移除完整JSON对象
        .replace(/\{[^}]*"name"[^}]*\}/gi, '') // 移除JSON对象
        .replace(/"name"\s*:\s*"[^"]+"/gi, '') // 移除name字段
        .replace(/"arguments"\s*:\s*\{[^}]*\}/gi, '') // 移除arguments
        .replace(/"arguments"\s*:\s*"[^"]*"/gi, '') // 移除字符串arguments
        .replace(/参数[：:]\s*[^\n]+/gi, '') // 移除参数说明
        .replace(/[{}[\]]/g, '') // 移除JSON括号
        .replace(/,\s*,/g, ',') // 清理多余逗号
        .replace(/\s+/g, ' ') // 合并空格
        .trim();
      
      // 进一步清理：移除工具名称本身（如果出现在文本中）
      uniqueTools.forEach(tool => {
        cleanText = cleanText.replace(new RegExp(tool, 'gi'), '');
      });
      cleanText = cleanText.replace(/\s+/g, ' ').trim();
      
      // 如果清理后还有有意义的说明，显示说明+工具
      if (cleanText && cleanText.length > 5 && !cleanText.match(/^[\s,，:：-]*$/)) {
        // 限制说明长度
        if (cleanText.length > 100) {
          cleanText = cleanText.substring(0, 100) + '...';
        }
        return `${this.renderSimpleMarkdown(cleanText)}<br><div style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;"><span style="font-size: 11px; color: #6b21a8; font-weight: 600;">工具：</span>${toolList}</div>`;
      } else {
        // 只有工具名称，生成简洁说明
        const actionDesc = uniqueTools.length === 1 
          ? `将使用工具 ${uniqueTools[0]} 执行操作`
          : `将使用 ${uniqueTools.length} 个工具执行操作`;
        return `<div style="margin-bottom: 8px; color: #5b21b6; font-size: 13px;">${this.escapeHtml(actionDesc)}</div><div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;"><span style="font-size: 11px; color: #6b21a8; font-weight: 600;">工具：</span>${toolList}</div>`;
      }
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
    
    return this.renderSimpleMarkdown(simplified);
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
   * 增量渲染ReAct格式：只更新正在构建的组件，已完成的组件保持不变
   * 改进：通过内容比较判断组件是否还在更新，避免同时刷新多个组件
   */
  static renderReActFormatIncremental(reactData, fullText, previousHtml) {
    if (!reactData) return null;
    
    // 解析之前的HTML，提取已完成的组件及其内容
    let previousComponents = {};
    let previousContent = {}; // 存储之前的内容文本，用于比较
    try {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = previousHtml;
      previousComponents = {
        reasoning: tempDiv.querySelector('.react-reasoning'),
        acting: tempDiv.querySelector('.react-acting'),
        observation: tempDiv.querySelector('.react-observation'),
        response: tempDiv.querySelector('.react-response')
      };
      
      // 提取之前的内容文本（只支持新格式）
      if (previousComponents.reasoning) {
        const contentDiv = previousComponents.reasoning.querySelector('div[style*="color: #1e3a8a"]');
        previousContent.reasoning = contentDiv ? contentDiv.textContent.trim() : '';
      }
      
      if (previousComponents.acting) {
        const contentDiv = previousComponents.acting.querySelector('div[style*="color: #5b21b6"]');
        previousContent.acting = contentDiv ? contentDiv.textContent.trim() : '';
      }
      
      if (previousComponents.observation) {
        const contentDiv = previousComponents.observation.querySelector('div[style*="color: #047857"]');
        previousContent.observation = contentDiv ? contentDiv.textContent.trim() : '';
      }
      
      if (previousComponents.response) {
        const contentDiv = previousComponents.response.querySelector('div[style*="color: #78350f"]');
        previousContent.response = contentDiv ? contentDiv.textContent.trim() : '';
      }
    } catch (e) {
      // 如果解析失败，使用完整渲染
      return this.renderReActFormat(reactData);
    }
    
    // 只使用新格式：Reasoning, Acting, Observation, Response
    const reasoning = reactData.reasoning;
    const acting = reactData.acting;
    const observation = reactData.observation;
    const response = reactData.response;
    
    // 判断组件是否已完成：只有当内容完全相同且不再变化时，才认为已完成
    const prevReasoning = previousContent.reasoning || '';
    const prevActing = previousContent.acting || '';
    const prevObservation = previousContent.observation || '';
    const prevResponse = previousContent.response || '';
    
    // 🔧 顺序控制：检查之前已经渲染过的阶段，确保按顺序显示
    // 顺序：推理 → 行动 → 观察 → 响应
    const hasPreviousReasoning = previousComponents.reasoning !== null;
    const hasPreviousActing = previousComponents.acting !== null;
    const hasPreviousObservation = previousComponents.observation !== null;
    
    // 🔧 关键修复：只有当内容完全相同时才复用，否则重新渲染
    const isReasoningComplete = previousComponents.reasoning && 
      reasoning && 
      reasoning.trim() === prevReasoning;
    
    const isActingComplete = previousComponents.acting && 
      acting && 
      this.formatActionText(acting).replace(/<[^>]+>/g, '').trim() === prevActing;
    
    const isObservationComplete = previousComponents.observation && 
      observation && 
      observation.trim() === prevObservation;
    
    let html = '<div class="react-format" style="display: flex; flex-direction: column; gap: 12px;">';
    
    // Reasoning（推理步骤）- 蓝色
    if (reasoning) {
      const currentReasoning = reasoning.trim();
      // 如果内容完全相同，复用之前的HTML（已完成）
      if (isReasoningComplete && previousComponents.reasoning) {
        html += previousComponents.reasoning.outerHTML;
      } else {
        // 否则重新渲染（正在构建中或内容有变化）
        html += `
          <div class="react-reasoning" style="
            background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
            border-left: 4px solid #3b82f6;
            border-radius: 8px;
            padding: 12px 16px;
            box-shadow: 0 2px 6px rgba(59, 130, 246, 0.1);
          ">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <span style="font-size: 18px;">💭</span>
              <strong style="font-size: 14px; color: #1e40af; font-weight: 600;">推理 (Reasoning)</strong>
            </div>
            <div style="color: #1e3a8a; line-height: 1.6; font-size: 13px;">
              ${this.renderSimpleMarkdown(currentReasoning)}
            </div>
          </div>
        `;
      }
    } else if (previousComponents.reasoning) {
      // 🔧 修复：当前没有reasoning，但之前有，说明已完成，复用之前的HTML
      // 移除prevReasoning的检查，只要previousComponents.reasoning存在就复用
      html += previousComponents.reasoning.outerHTML;
    }
    
    // Acting（行动列表）- 紫色
    // 🔧 顺序控制：只有当推理阶段已经存在或之前已经渲染过时，才显示行动阶段
    if (acting && (reasoning || hasPreviousReasoning)) {
      const currentActingHtml = this.formatActionText(acting);
      // 如果内容完全相同，复用之前的HTML（已完成）
      if (isActingComplete && previousComponents.acting) {
        html += previousComponents.acting.outerHTML;
      } else {
        // 否则重新渲染（正在构建中或内容有变化）
        html += `
          <div class="react-acting" style="
            background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
            border-left: 4px solid #8b5cf6;
            border-radius: 8px;
            padding: 12px 16px;
            box-shadow: 0 2px 6px rgba(139, 92, 246, 0.1);
          ">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <span style="font-size: 18px;">⚡</span>
              <strong style="font-size: 14px; color: #6b21a8; font-weight: 600;">行动 (Acting)</strong>
            </div>
            <div style="color: #5b21b6; line-height: 1.6; font-size: 13px;">
              ${currentActingHtml}
            </div>
          </div>
        `;
      }
    } else if (previousComponents.acting) {
      // 🔧 修复：当前没有acting，但之前有，说明已完成，复用之前的HTML
      // 移除prevActing的检查，只要previousComponents.acting存在就复用
      html += previousComponents.acting.outerHTML;
    }
    
    // Observation（观察结果）- 绿色
    // 🔧 顺序控制：只有当行动阶段已经存在或之前已经渲染过时，才显示观察阶段
    // 🔧 修复闪屏问题：当Response出现时，如果之前有观察模块，应该直接复用，避免因内容细微差异导致重新渲染
    if (observation && (acting || hasPreviousActing)) {
      const currentObservation = observation.trim();
      // 🔧 关键修复：如果Response已经出现且之前有观察模块，说明观察阶段已完成，直接复用之前的HTML（避免抖动）
      // 这是最重要的修复：当Response开始更新时，观察模块应该完全固定
      if (response && previousComponents.observation) {
        // Response已出现，说明观察阶段已完成，无论当前observation内容如何，都复用之前的HTML
        html += previousComponents.observation.outerHTML;
      }
      // 如果内容完全相同，复用之前的HTML（已完成）
      else if (isObservationComplete && previousComponents.observation) {
        html += previousComponents.observation.outerHTML;
      } else {
        // 🔧 关键修复：即使Response也存在，也要先显示Observation，让用户看到"生成"的过程
        // 否则重新渲染（正在构建中或内容有变化）
        html += `
          <div class="react-observation" style="
            background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
            border-left: 4px solid #10b981;
            border-radius: 8px;
            padding: 12px 16px;
            box-shadow: 0 2px 6px rgba(16, 185, 129, 0.1);
          ">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <span style="font-size: 18px;">👁️</span>
              <strong style="font-size: 14px; color: #065f46; font-weight: 600;">观察 (Observation)</strong>
            </div>
            <div style="color: #047857; line-height: 1.6; font-size: 13px;">
              ${this.renderSimpleMarkdown(currentObservation)}
            </div>
          </div>
        `;
      }
    } else if (previousComponents.observation) {
      // 🔧 修复：当前没有observation，但之前有，说明已完成，复用之前的HTML
      // 移除prevObservation的检查，只要previousComponents.observation存在就复用
      html += previousComponents.observation.outerHTML;
    }
    
    // Response（响应）- 橙色/金色
    // 🔧 顺序控制：只有当观察阶段已经存在或之前已经渲染过时，才显示响应阶段
    // 🔧 关键修复：确保观察阶段先显示，然后等观察阶段完成后再显示响应阶段
    // 判断观察阶段是否完成：
    // 1) 之前已经渲染过Observation（hasPreviousObservation）- 说明已经完成，可以显示Response
    // 2) 当前observation存在且之前已经渲染过，且内容稳定（不再变化）- 说明已经完成，可以显示Response
    // 3) 如果observation存在但之前没有渲染过，说明这是第一次出现，应该先显示Observation，不显示Response
    // 4) 如果observation存在但内容还在变化（!isObservationComplete），说明还在构建中，不显示Response
    // 🔧 关键修复：只有当Observation已经存在（当前有或之前有）时，才显示Response
    // 这样确保Observation先显示，给用户"生成"的感觉
    const shouldShowResponse = response && (observation || hasPreviousObservation);
    
    if (shouldShowResponse) {
      const currentResponse = response.trim();
      // 如果之前有渲染，比较内容
      if (previousComponents.response && prevResponse) {
        // 如果内容完全相同，复用之前的HTML（已完成）
        if (currentResponse === prevResponse) {
          html += previousComponents.response.outerHTML;
        } else {
          // 内容有变化，重新渲染（正在构建中）
          html += `
            <div class="react-response" style="
              background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
              border-left: 4px solid #f59e0b;
              border-radius: 8px;
              padding: 12px 16px;
              box-shadow: 0 2px 6px rgba(245, 158, 11, 0.1);
            ">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <span style="font-size: 18px;">✅</span>
                <strong style="font-size: 14px; color: #92400e; font-weight: 600;">响应 (Response)</strong>
              </div>
              <div style="color: #78350f; line-height: 1.6; font-size: 13px;">
                ${this.renderSimpleMarkdown(currentResponse)}
              </div>
            </div>
          `;
        }
      } else {
        // 之前没有渲染，重新渲染
        html += `
          <div class="react-response" style="
            background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
            border-left: 4px solid #f59e0b;
            border-radius: 8px;
            padding: 12px 16px;
            box-shadow: 0 2px 6px rgba(245, 158, 11, 0.1);
          ">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <span style="font-size: 18px;">✅</span>
              <strong style="font-size: 14px; color: #92400e; font-weight: 600;">响应 (Response)</strong>
            </div>
            <div style="color: #78350f; line-height: 1.6; font-size: 13px;">
              ${this.renderSimpleMarkdown(currentResponse)}
            </div>
          </div>
        `;
      }
    } else if (prevResponse && previousComponents.response) {
      // 当前没有response，但之前有，说明已完成，复用之前的HTML
      html += previousComponents.response.outerHTML;
    }
    
    html += '</div>';
    return html;
  }

  /**
   * Render ReAct format to HTML with styled components
   */
  static renderReActFormat(reactData) {
    if (!reactData) return null;
    
    let html = '<div class="react-format" style="display: flex; flex-direction: column; gap: 12px;">';
    
    // Reasoning - 推理步骤（蓝色）
    if (reactData.reasoning) {
      html += `
        <div class="react-reasoning" style="
          background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
          border-left: 4px solid #3b82f6;
          border-radius: 8px;
          padding: 12px 16px;
          box-shadow: 0 2px 6px rgba(59, 130, 246, 0.1);
        ">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <span style="font-size: 18px;">💭</span>
            <strong style="font-size: 14px; color: #1e40af; font-weight: 600;">推理 (Reasoning)</strong>
          </div>
          <div style="color: #1e3a8a; line-height: 1.6; font-size: 13px;">
            ${this.renderSimpleMarkdown(reactData.reasoning)}
          </div>
        </div>
      `;
    }
    
    // Acting - 行动列表（紫色）
    if (reactData.acting) {
      // 优化Acting显示：提取工具名称，显示简洁说明
      const actingText = this.formatActionText(reactData.acting);
      
      html += `
        <div class="react-acting" style="
          background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
          border-left: 4px solid #8b5cf6;
          border-radius: 8px;
          padding: 12px 16px;
          box-shadow: 0 2px 6px rgba(139, 92, 246, 0.1);
        ">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <span style="font-size: 18px;">⚡</span>
            <strong style="font-size: 14px; color: #6b21a8; font-weight: 600;">行动 (Acting)</strong>
          </div>
          <div style="color: #5b21b6; line-height: 1.6; font-size: 13px;">
            ${actingText}
          </div>
        </div>
      `;
    }
    
    // Observation - 观察结果（绿色）
    if (reactData.observation) {
      html += `
        <div class="react-observation" style="
          background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
          border-left: 4px solid #10b981;
          border-radius: 8px;
          padding: 12px 16px;
          box-shadow: 0 2px 6px rgba(16, 185, 129, 0.1);
        ">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <span style="font-size: 18px;">👁️</span>
            <strong style="font-size: 14px; color: #065f46; font-weight: 600;">观察 (Observation)</strong>
          </div>
          <div style="color: #047857; line-height: 1.6; font-size: 13px;">
            ${this.renderSimpleMarkdown(reactData.observation)}
          </div>
        </div>
      `;
    }
    
    // Response - 响应（橙色/金色）
    if (reactData.response) {
      html += `
        <div class="react-response" style="
          background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
          border-left: 4px solid #f59e0b;
          border-radius: 8px;
          padding: 12px 16px;
          box-shadow: 0 2px 6px rgba(245, 158, 11, 0.1);
        ">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <span style="font-size: 18px;">✅</span>
            <strong style="font-size: 14px; color: #92400e; font-weight: 600;">响应 (Response)</strong>
          </div>
          <div style="color: #78350f; line-height: 1.6; font-size: 13px;">
            ${this.renderSimpleMarkdown(reactData.response)}
          </div>
        </div>
      `;
    }
    
    html += '</div>';
    return html;
  }

  /**
   * Convert Markdown to HTML with simple, readable styling
   * 支持ReAct格式的自动识别和渲染
   * 增强：支持增量更新，已完成的组件不再刷新
   */
  static markdownToHtml(text, previousHtml = null) {
    if (!text) return '';
    
    // 首先尝试解析ReAct格式
    const reactData = this.parseReActFormat(text);
    if (reactData && Object.keys(reactData).length > 0) {
      // 如果检测到ReAct格式，使用专门的渲染器
      // 如果提供了之前的HTML，尝试增量更新
      if (previousHtml) {
        return this.renderReActFormatIncremental(reactData, text, previousHtml);
      }
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
