/**
 * Structured Output Helper
 * 结构化输出助手 - 让 AI 返回固定格式的数据
 */

import { logger } from './logger.js';

export class StructuredOutput {
  /**
   * 威胁分析结构
   */
  static SCHEMAS = {
    threatAnalysis: {
      type: "object",
      properties: {
        severity: { 
          type: "string", 
          enum: ["low", "medium", "high", "critical"],
          description: "威胁等级"
        },
        iocs: { 
          type: "array",
          items: { 
            type: "object",
            properties: {
              type: { type: "string", enum: ["ip", "domain", "hash", "url", "email"] },
              value: { type: "string" }
            }
          },
          description: "威胁指标列表"
        },
        attackTechniques: {
          type: "array",
          items: { type: "string" },
          description: "MITRE ATT&CK 技术编号，如 T1566"
        },
        recommendation: { 
          type: "string",
          description: "处置建议" 
        },
        affectedAssets: { 
          type: "array",
          items: { type: "string" },
          description: "受影响的资产"
        },
        confidence: { 
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "置信度 (0-1)"
        },
        summary: {
          type: "string",
          description: "简短摘要"
        }
      },
      required: ["severity", "recommendation", "confidence", "summary"]
    },

    investigationPlan: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: { type: "string", description: "调查步骤" },
              tool: { type: "string", description: "使用的工具" },
              priority: { type: "number", description: "优先级 1-5" }
            }
          }
        },
        estimatedTime: { type: "string", description: "预计耗时" },
        requiredTools: { 
          type: "array", 
          items: { type: "string" },
          description: "需要的工具"
        }
      },
      required: ["steps", "estimatedTime"]
    },

    iocExtraction: {
      type: "object",
      properties: {
        ips: { type: "array", items: { type: "string" } },
        domains: { type: "array", items: { type: "string" } },
        hashes: { type: "array", items: { type: "string" } },
        urls: { type: "array", items: { type: "string" } },
        emails: { type: "array", items: { type: "string" } },
        cves: { type: "array", items: { type: "string" } }
      }
    }
  };

  /**
   * 生成结构化输出的系统提示词
   */
  static generatePrompt(schemaName, userQuery) {
    const schema = this.SCHEMAS[schemaName];
    if (!schema) {
      logger.warn('[StructuredOutput] Unknown schema:', schemaName);
      return null;
    }

    return `你必须以 JSON 格式返回结果，严格遵循以下结构：

\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

用户问题：${userQuery}

请直接返回 JSON，不要包含任何其他文字。`;
  }

  /**
   * 验证返回的数据是否符合 schema
   */
  static validate(data, schemaName) {
    const schema = this.SCHEMAS[schemaName];
    if (!schema) return { valid: false, error: 'Unknown schema' };

    try {
      // 简单验证 required 字段
      const required = schema.required || [];
      for (const field of required) {
        if (!(field in data)) {
          return { valid: false, error: `Missing required field: ${field}` };
        }
      }

      // 验证枚举值
      for (const [key, prop] of Object.entries(schema.properties)) {
        if (prop.enum && data[key]) {
          if (!prop.enum.includes(data[key])) {
            return { valid: false, error: `Invalid value for ${key}: ${data[key]}` };
          }
        }
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * 解析 AI 返回的结构化数据
   */
  static parse(response) {
    try {
      // 尝试从 markdown 代码块中提取 JSON
      const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }

      // 直接解析
      return JSON.parse(response);
    } catch (error) {
      logger.error('[StructuredOutput] Parse failed:', error);
      return null;
    }
  }

  /**
   * 格式化威胁分析结果为 HTML
   */
  static formatThreatAnalysis(data) {
    const severityColors = {
      low: '#10b981',
      medium: '#f59e0b',
      high: '#ef4444',
      critical: '#dc2626'
    };

    const severityLabels = {
      low: '低',
      medium: '中',
      high: '高',
      critical: '严重'
    };

    const color = severityColors[data.severity] || '#6b7280';
    const label = severityLabels[data.severity] || data.severity;

    let html = `
      <div style="background: white; border-radius: 8px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
          <div style="background: ${color}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600;">
            ${label}
          </div>
          <div style="flex: 1; font-size: 14px; font-weight: 600; color: #1f2937;">
            ${data.summary || '威胁分析报告'}
          </div>
          <div style="font-size: 11px; color: #6b7280;">
            置信度: ${(data.confidence * 100).toFixed(0)}%
          </div>
        </div>

        ${data.iocs && data.iocs.length > 0 ? `
        <div style="margin-bottom: 12px;">
          <div style="font-size: 11px; font-weight: 600; color: #6b7280; margin-bottom: 6px;">威胁指标 (IOC)</div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            ${data.iocs.map(ioc => `
              <span style="background: #f3f4f6; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-family: monospace;">
                ${ioc.type}: ${ioc.value}
              </span>
            `).join('')}
          </div>
        </div>
        ` : ''}

        ${data.attackTechniques && data.attackTechniques.length > 0 ? `
        <div style="margin-bottom: 12px;">
          <div style="font-size: 11px; font-weight: 600; color: #6b7280; margin-bottom: 6px;">攻击技术</div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            ${data.attackTechniques.map(tech => `
              <span style="background: #fef3c7; color: #92400e; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">
                ${tech}
              </span>
            `).join('')}
          </div>
        </div>
        ` : ''}

        ${data.affectedAssets && data.affectedAssets.length > 0 ? `
        <div style="margin-bottom: 12px;">
          <div style="font-size: 11px; font-weight: 600; color: #6b7280; margin-bottom: 6px;">受影响资产</div>
          <div style="font-size: 12px; color: #374151;">
            ${data.affectedAssets.join(', ')}
          </div>
        </div>
        ` : ''}

        <div style="background: #f0fdf4; border-left: 3px solid #10b981; padding: 12px; border-radius: 4px;">
          <div style="font-size: 11px; font-weight: 600; color: #065f46; margin-bottom: 4px;">💡 处置建议</div>
          <div style="font-size: 12px; color: #166534; line-height: 1.5;">
            ${data.recommendation}
          </div>
        </div>
      </div>
    `;

    return html;
  }
}
