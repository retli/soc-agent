/**
 * AI API Service
 * 
 * 📡 核心职责：
 * - OpenAI标准格式API通信
 * - SSE流式响应解析
 * - Function Calling支持
 * - 消息历史构建
 * 
 * 🔧 主要功能：
 * 1. sendMessage() - 发送聊天请求（支持流式/非流式）
 * 2. handleStreamResponse() - 处理SSE流式响应
 *    - 按行解析 "data: {JSON}" 格式
 *    - 增量累积 tool_calls
 *    - 支持 [DONE] 结束标记
 * 3. buildMessages() - 构建OpenAI消息数组
 *    - 处理系统提示、对话历史、当前查询
 *    - 可选包含工具结果上下文
 * 4. testConnection() - 测试API连接
 * 
 * 📦 请求格式（OpenAI标准）：
 * {
 *   model: "qwen3-235b-a22b",
 *   messages: [{role: "user", content: "..."}],
 *   temperature: 0.7,
 *   stream: true,
 *   tools: [{type: "function", function: {...}}]  // 可选
 * }
 * 
 * 📥 响应格式：
 * - 非流式: {choices: [{message: {content, tool_calls}}], usage: {...}}
 * - 流式: data: {choices: [{delta: {content, tool_calls}}]}\n\n
 */

// AI API service layer
import { DEFAULT_CONFIG } from '../config/defaults.js';
import { MESSAGE_ROLES } from '../config/constants.js';
import { logger } from '../utils/logger.js';

export class AIAPIService {
  constructor(config) {
    this.config = config;
  }

  /**
   * Update configuration
   */
  updateConfig(config) {
    this.config = config;
  }

  /**
   * Send chat completion request
   */
  async sendMessage(messages, options = {}) {
    const useStream = options.stream !== undefined ? options.stream : (this.config.stream || DEFAULT_CONFIG.api.stream);
    
    logger.debug('[API] Sending message. Stream:', useStream, 'Options:', options);
    logger.debug('[API] Messages:', messages);
    
    // 构建标准OpenAI格式的请求体
    const requestBody = {
      model: this.config.model || DEFAULT_CONFIG.api.model,
      messages: messages,
      temperature: parseFloat(options.temperature || DEFAULT_CONFIG.api.temperature),
      stream: useStream
    };
    
    // 可选参数
    if (options.maxTokenLength || DEFAULT_CONFIG.api.maxTokenLength) {
      requestBody.max_tokens = parseInt(options.maxTokenLength || DEFAULT_CONFIG.api.maxTokenLength);
    }
    
    if (options.topP !== undefined || DEFAULT_CONFIG.api.topP !== undefined) {
      requestBody.top_p = parseFloat(options.topP || DEFAULT_CONFIG.api.topP);
    }
    
    // 添加工具定义（Function Calling）
    if (options.tools && Array.isArray(options.tools) && options.tools.length > 0) {
      requestBody.tools = options.tools;
      if (options.tool_choice) {
        requestBody.tool_choice = options.tool_choice;
      }
      logger.debug('[API] Function Calling enabled with', options.tools.length, 'tools');
    }
    
    const requestUrl = `${this.config.apiUrl}`;
    const requestHeaders = {
      'apikey': this.config.apiKey,
      'Content-Type': 'application/json'
    };
    
    // 添加 Authorization 认证参数（如果有配置）
    if (this.config.authorization) {
      requestHeaders['Authorization'] = this.config.authorization;
    }
    
    logger.debug('[API] Request URL:', requestUrl);
    logger.debug('[API] Request headers:', requestHeaders);
    logger.debug('[API] Request body:', requestBody);
    
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestBody)
    });
    
    logger.debug('[API] Response status:', response.status, response.statusText);
    logger.debug('[API] Response headers:', Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[API] Error response:', errorText);
      throw new Error(`API request failed: ${response.status} ${errorText}`);
    }
    
    // 流式响应
    if (useStream) {
      return this.handleStreamResponse(response);
    }
    
    // 非流式响应
    const responseText = await response.text();
    logger.debug('[API] Non-stream response text:', responseText.substring(0, 200));
    
    try {
      const data = JSON.parse(responseText);
      
      // OpenAI标准格式：{"id":"...","object":"chat.completion","choices":[...],"usage":{...}}
      if (data.choices && Array.isArray(data.choices) && data.choices.length > 0) {
        const choice = data.choices[0];
        const message = choice.message;
        
        if (!message) {
          throw new Error('Response missing message field');
        }
        
        const result = {
          content: message.content || '',
          usage: data.usage,
          finish_reason: choice.finish_reason
        };
        
        // 检查是否包含工具调用（Function Calling）
        if (message.tool_calls && message.tool_calls.length > 0) {
          result.tool_calls = message.tool_calls;
          logger.info('[API] Function calls detected:', result.tool_calls.length, 'calls');
        }
        
        return result;
      }
      
      logger.error('[API] Unexpected response format:', data);
      throw new Error('Invalid API response format: expected choices array');
    } catch (parseError) {
      logger.error('[API] Failed to parse response:', parseError);
      throw new Error('Failed to parse API response: ' + parseError.message);
    }
  }

  /**
   * Handle streaming response
   */
  async handleStreamResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    const toolCallsMap = {}; // 累积工具调用 {index: {id, type, function: {name, arguments}}}
    let finishReason = null;
    
    const result = {
      stream: true,
      tool_calls: null, // 将在流结束后设置
      async *readStream() {
        try {
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
              logger.debug('[API] Stream completed');
              break;
            }
            
            // 解码数据块
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;
            
            logger.debug('[API] Received chunk:', chunk.substring(0, 100));
            
            // 处理SSE格式：按行解析
            // SSE格式: data: {JSON}\n\ndata: {JSON}\n\n
            const lines = buffer.split('\n');
            
            // 保留最后一行（可能不完整）
            buffer = lines.pop() || '';
            
            for (let line of lines) {
              line = line.trim();
              
              // 跳过空行
              if (!line) continue;
              
              // 处理SSE格式：去掉 "data: " 前缀
              if (line.startsWith('data: ')) {
                line = line.substring(6); // 去掉 "data: "
              }
              
              // 检查结束标记
              if (line === '[DONE]') {
                logger.debug('[API] Stream [DONE] marker received');
                break;
              }
              
              // 解析JSON
              try {
                const data = JSON.parse(line);
                
                if (!data.choices || !data.choices[0]) {
                  continue;
                }
                
                const choice = data.choices[0];
                const delta = choice.delta;
                
                // 处理内容
                if (delta && delta.content) {
                  logger.debug('[API] Yielding content:', delta.content);
                  yield delta.content;
                }
                
                // 处理工具调用（增量累积）
                if (delta && delta.tool_calls && Array.isArray(delta.tool_calls)) {
                  for (const toolCall of delta.tool_calls) {
                    const index = toolCall.index;
                    
                    if (!toolCallsMap[index]) {
                      toolCallsMap[index] = {
                        id: toolCall.id || '',
                        type: toolCall.type || 'function',
                        function: {
                          name: '',
                          arguments: ''
                        }
                      };
                    }
                    
                    // 累积函数名
                    if (toolCall.function && toolCall.function.name) {
                      toolCallsMap[index].function.name = toolCall.function.name;
                    }
                    
                    // 累积参数（逐字符）
                    if (toolCall.function && toolCall.function.arguments) {
                      toolCallsMap[index].function.arguments += toolCall.function.arguments;
                    }
                    
                    // 更新id（如果有）
                    if (toolCall.id) {
                      toolCallsMap[index].id = toolCall.id;
                    }
                  }
                }
                
                // 检查结束原因
                if (choice.finish_reason) {
                  finishReason = choice.finish_reason;
                  logger.debug('[API] Stream finished, reason:', finishReason);
                  
                  if (finishReason === 'tool_calls' || finishReason === 'stop') {
                    // 不立即break，继续处理剩余数据
                  }
                }
              } catch (e) {
                logger.warn('[API] Failed to parse SSE line:', line.substring(0, 100), e);
                // 继续处理下一行
              }
            }
          }
        } finally {
          reader.releaseLock();
          
          // 流结束后，转换toolCallsMap为数组
          if (Object.keys(toolCallsMap).length > 0) {
            result.tool_calls = Object.values(toolCallsMap);
            logger.info('[API] Stream completed with tool calls:', result.tool_calls.length);
          }
        }
      }
    };
    
    return result;
  }

  /**
   * Build messages array with system prompt and conversation history
   */
  buildMessages(query, conversationHistory = [], systemPrompt = null, includeToolResults = null) {
    const messages = [];
    
    // 如果未指定，使用配置中的默认值
    const shouldIncludeTools = includeToolResults !== null 
      ? includeToolResults 
      : (this.config.includeToolResults !== undefined ? this.config.includeToolResults : DEFAULT_CONFIG.ui.includeToolResults);
    
    const maxToolResultLength = DEFAULT_CONFIG.ui.maxToolResultLength;
    
    // Add system prompt if provided
    if (systemPrompt) {
      messages.push({
        role: MESSAGE_ROLES.SYSTEM,
        content: systemPrompt
      });
    }
    
    // Add conversation history
    const recentMessages = conversationHistory.slice(-DEFAULT_CONFIG.ui.maxMessageHistory);
    recentMessages.forEach(msg => {
      // 处理工具消息（标准Function Calling格式）
      if (msg.role === MESSAGE_ROLES.TOOL) {
        if (shouldIncludeTools) {
          // 🔒 使用标准Function Calling格式：role: 'tool', tool_call_id, name, content
          let toolContent = msg.content || '';
          
          // 如果没有content但有result，转换result为content
          if (!toolContent && msg.result !== undefined) {
            toolContent = typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result);
          }
          
          // 如果配置了最大长度限制，进行截断
          if (maxToolResultLength > 0 && toolContent.length > maxToolResultLength) {
            toolContent = toolContent.substring(0, maxToolResultLength) + '\n...(结果已截断)';
          }
          
          // 🔒 使用标准Function Calling格式返回工具结果
          const toolMessage = {
            role: MESSAGE_ROLES.TOOL,
            tool_call_id: msg.tool_call_id || msg.toolCallId || `call_${Date.now()}`,  // 关联tool_call_id
            name: msg.name || msg.toolName || 'unknown_tool',  // 工具名称
            content: toolContent  // 工具结果内容
          };
          
          messages.push(toolMessage);
          logger.info('[API] ✅ Added tool result message:', {
            tool_call_id: toolMessage.tool_call_id,
            name: toolMessage.name,
            contentLength: toolContent.length,
            contentPreview: toolContent.substring(0, 200)
          });
        }
        return;
      }
      
      // 普通消息
      // 🔧 修复：处理assistant消息中的tool_calls
      if (msg.role === MESSAGE_ROLES.ASSISTANT) {
        const assistantMsg = {
          role: msg.role,
          content: msg.content || null  // content可能为空（只有tool_calls）
        };
        
        // 🔧 修复：如果assistant消息包含tool_calls，需要保留这些信息
        if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
          assistantMsg.tool_calls = msg.tool_calls;
          logger.info('[API] ✅ Added assistant message with tool_calls:', {
            tool_calls_count: msg.tool_calls.length,
            content_length: (msg.content || '').length
          });
        }
        
        // 只有当有content或tool_calls时才添加消息
        if (assistantMsg.content || assistantMsg.tool_calls) {
          messages.push(assistantMsg);
        }
      } else if (msg.content) {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      }
    });
    
    // Add current query (only if it's not already the last message in history)
    // This prevents duplicate user messages when the query was already added to conversation.messages
    const lastMessage = recentMessages.length > 0 ? recentMessages[recentMessages.length - 1] : null;
    const isQueryAlreadyInHistory = lastMessage && 
                                    lastMessage.role === MESSAGE_ROLES.USER && 
                                    lastMessage.content === query;
    
    if (!isQueryAlreadyInHistory) {
      messages.push({
        role: MESSAGE_ROLES.USER,
        content: query
      });
    }
    
    return messages;
  }

  /**
   * Test API connection
   */
  async testConnection() {
    try {
      const messages = [{ role: MESSAGE_ROLES.USER, content: 'hi' }];
      // 强制使用非流式模式进行测试
      const response = await this.sendMessage(messages, { 
        maxTokenLength: 100,
        stream: false 
      });
      
      // 检查响应内容
      const content = response.content || '(API 返回成功但内容为空)';
      
      return {
        success: true,
        message: content.length > 50 ? content.substring(0, 50) + '...' : content
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}
