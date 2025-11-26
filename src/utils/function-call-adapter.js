/**
 * Function Call Adapter
 * 
 * 将 MCP 工具格式转换为 Function Calling 格式
 * 支持工具路由和多工具调用
 */

import { logger } from './logger.js';

export class FunctionCallAdapter {
  /**
   * 将 MCP 工具列表转换为 Function Calling 格式
   * 
   * @param {Array} mcpTools - MCP工具列表
   * @param {String} serviceId - MCP服务ID（用于后续路由）
   * @param {String} serviceName - MCP服务名称
   * @returns {Array} Function Calling 格式的工具列表
   */
  static mcpToolsToFunctions(mcpTools, serviceId, serviceName) {
    if (!Array.isArray(mcpTools)) {
      logger.warn('[FunctionAdapter] Invalid MCP tools:', mcpTools);
      return [];
    }

    return mcpTools.map(tool => {
      const functionDef = {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description || `${tool.name}`,
          parameters: this.convertMCPSchema(tool.inputSchema)
        }
      };

      // 附加元数据用于路由（不会发送给API）
      functionDef._meta = {
        serviceId: serviceId,
        serviceName: serviceName,
        mcpToolName: tool.name
      };

      return functionDef;
    });
  }

  /**
   * 转换 MCP inputSchema 到 Function Calling parameters 格式
   */
  static convertMCPSchema(inputSchema) {
    if (!inputSchema) {
      return {
        type: 'object',
        properties: {},
        required: []
      };
    }

    // MCP使用JSON Schema格式，与Function Calling兼容
    // 但需要确保格式正确
    const params = {
      type: inputSchema.type || 'object',
      properties: inputSchema.properties || {},
      required: inputSchema.required || []
    };

    // 添加描述字段
    if (inputSchema.description) {
      params.description = inputSchema.description;
    }

    return params;
  }

  /**
   * 从多个MCP服务聚合工具列表
   * 
   * @param {Object} mcpServicesMap - {serviceId: {name, tools: []}}
   * @param {Object} toolsEnabled - 工具启用状态 {serviceId:toolName: boolean}
   * @returns {Array} 聚合后的Function列表
   */
  static aggregateToolsFromServices(mcpServicesMap, toolsEnabled = {}) {
    const allFunctions = [];

    for (const [serviceId, serviceData] of Object.entries(mcpServicesMap)) {
      if (!serviceData.enabled) {
        logger.debug(`[FunctionAdapter] Service ${serviceId} is disabled, skipping`);
        continue;
      }

      if (!serviceData.tools || !Array.isArray(serviceData.tools)) {
        continue;
      }

      const functions = this.mcpToolsToFunctions(
        serviceData.tools,
        serviceId,
        serviceData.name
      );

      // 过滤已启用的工具
      const enabledFunctions = functions.filter(func => {
        const toolKey = `${serviceId}:${func.function.name}`;
        const isEnabled = toolsEnabled[toolKey] !== false; // 默认启用
        
        if (!isEnabled) {
          logger.debug(`[FunctionAdapter] Tool ${toolKey} is disabled`);
        }
        
        return isEnabled;
      });

      allFunctions.push(...enabledFunctions);
    }

    logger.info('[FunctionAdapter] Aggregated', allFunctions.length, 'functions from', Object.keys(mcpServicesMap).length, 'services');
    return allFunctions;
  }

  /**
   * 从AI响应中提取工具调用信息
   * 
   * @param {Object} response - AI API的响应对象
   * @returns {Array} 标准化的工具调用数组
   */
  static extractToolCalls(response) {
    if (!response || !response.tool_calls || response.tool_calls.length === 0) {
      return [];
    }

    const toolCalls = Array.isArray(response.tool_calls) 
      ? response.tool_calls 
      : [response.tool_calls];

    logger.info('[FunctionAdapter] Extracting tool calls, count:', toolCalls.length);
    logger.debug('[FunctionAdapter] Raw tool calls:', JSON.stringify(toolCalls, null, 2));

    return toolCalls.map((call, index) => {
      logger.debug(`[FunctionAdapter] Processing tool call ${index + 1}:`, {
        id: call.id,
        name: call.function?.name || call.name,
        argumentsType: typeof (call.function?.arguments),
        argumentsRaw: call.function?.arguments
      });

      let parsedArguments;
      const argsString = call.function?.arguments;
      
      try {
        if (typeof argsString === 'string') {
          // 检查是否为空字符串
          if (argsString.trim() === '') {
            logger.warn(`[FunctionAdapter] Tool call ${index + 1} has empty arguments string, using empty object`);
            parsedArguments = {};
          } else {
            parsedArguments = JSON.parse(argsString);
            logger.debug(`[FunctionAdapter] Tool call ${index + 1} arguments parsed successfully:`, parsedArguments);
          }
        } else {
          parsedArguments = argsString || call.arguments || {};
          logger.debug(`[FunctionAdapter] Tool call ${index + 1} using direct arguments:`, parsedArguments);
        }
      } catch (error) {
        logger.error(`[FunctionAdapter] Failed to parse arguments for tool call ${index + 1}:`, {
          error: error.message,
          argumentsString: argsString
        });
        throw error;
      }

      return {
        id: call.id || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: call.type || 'function',
        function: {
          name: call.function?.name || call.name,
          arguments: parsedArguments
        }
      };
    });
  }

  /**
   * 根据工具名查找对应的MCP服务
   * 
   * @param {String} toolName - 工具名称
   * @param {Array} functions - Function列表（包含_meta）
   * @returns {Object|null} {serviceId, serviceName}
   */
  static findServiceByTool(toolName, functions) {
    const func = functions.find(f => f.function.name === toolName);
    
    if (!func || !func._meta) {
      logger.warn('[FunctionAdapter] No service found for tool:', toolName);
      return null;
    }

    return {
      serviceId: func._meta.serviceId,
      serviceName: func._meta.serviceName
    };
  }

  /**
   * 构建工具执行结果消息（用于返回给AI）
   * 
   * @param {String} toolCallId - 工具调用ID
   * @param {String} toolName - 工具名称
   * @param {String} result - 执行结果
   * @returns {Object} 符合格式的消息对象
   */
  static buildToolResultMessage(toolCallId, toolName, result) {
    return {
      role: 'tool',
      tool_call_id: toolCallId,
      name: toolName,
      content: typeof result === 'string' ? result : JSON.stringify(result)
    };
  }

  /**
   * 准备发送给API的Function列表（移除元数据）
   * 
   * @param {Array} functions - 包含_meta的Function列表
   * @returns {Array} 纯净的Function列表
   */
  static cleanFunctionsForAPI(functions) {
    return functions.map(func => ({
      type: func.type,
      function: func.function
    }));
  }
}
