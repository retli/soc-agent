/**
 * TheHive API Service
 * 提供 TheHive API 的封装和调用
 */

import { logger } from '../utils/logger.js';

export class TheHiveAPI {
  constructor(config) {
    this.apiUrl = config?.apiUrl || '';
    this.apiKey = config?.apiKey || '';
    this.organization = config?.organization || '';
  }

  /**
   * 更新配置
   */
  updateConfig(config) {
    this.apiUrl = config?.apiUrl || this.apiUrl;
    this.apiKey = config?.apiKey || this.apiKey;
    this.organization = config?.organization || this.organization;
  }

  /**
   * 通用 API 请求方法
   */
  async _request(endpoint, options = {}) {
    const url = `${this.apiUrl}/api${endpoint}`;
    
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      ...options.headers
    };

    if (this.organization) {
      headers['X-Organisation'] = this.organization;
    }

    try {
      logger.debug('[TheHive API] Request:', { url, method: options.method || 'GET' });
      
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`TheHive API Error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      logger.debug('[TheHive API] Response received');
      return data;
    } catch (error) {
      logger.error('[TheHive API] Request failed:', error);
      throw error;
    }
  }

  /**
   * 获取 Case 详情
   * @param {string} caseId - Case ID (格式: ~534597760)
   */
  async getCase(caseId) {
    // 保留 ~ 前缀，不要移除
    return await this._request(`/v1/case/${caseId}`);
  }

  /**
   * 获取 Case Comments
   * @param {string} caseId - Case ID (保留 ~ 前缀)
   */
  async getCaseComments(caseId) {
    // TheHive v5 API: 使用查询接口
    const query = {
      query: [
        {
          _name: "getCase",
          idOrName: caseId  // 保留 ~ 前缀
        },
        {
          _name: "comments"
        }
      ]
    };

    try {
      const response = await this._request('/v1/query', {
        method: 'POST',
        body: JSON.stringify(query)
      });
      
      return response;
    } catch (error) {
      logger.error('[TheHive API] Get comments failed:', error);
      throw error;
    }
  }

  /**
   * 添加 Comment 到 Case
   * @param {string} caseId - Case ID (保留 ~ 前缀)
   * @param {string} message - Comment 内容
   */
  async addComment(caseId, message) {
    return await this._request(`/v1/case/${caseId}/comment`, {
      method: 'POST',
      body: JSON.stringify({
        message: message
      })
    });
  }

  /**
   * 获取 Case Observables
   * @param {string} caseId - Case ID (保留 ~ 前缀)
   */
  async getObservables(caseId) {
    const query = {
      query: [
        {
          _name: "getCase",
          idOrName: caseId  // 保留 ~ 前缀
        },
        {
          _name: "observables"
        }
      ]
    };

    return await this._request('/v1/query', {
      method: 'POST',
      body: JSON.stringify(query)
    });
  }

  /**
   * 获取 Case Tasks
   * @param {string} caseId - Case ID (保留 ~ 前缀)
   */
  async getTasks(caseId) {
    const query = {
      query: [
        {
          _name: "getCase",
          idOrName: caseId  // 保留 ~ 前缀
        },
        {
          _name: "tasks"
        }
      ]
    };

    return await this._request('/v1/query', {
      method: 'POST',
      body: JSON.stringify(query)
    });
  }

  /**
   * 更新 Task 状态
   * @param {string} taskId - Task ID
   * @param {object} updates - 更新内容
   */
  async updateTask(taskId, updates) {
    return await this._request(`/v1/case/task/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    });
  }

  /**
   * 测试连接
   */
  async testConnection() {
    try {
      await this._request('/v1/user/current');
      return { success: true, message: 'Connection successful' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * 从 URL 提取 Case ID
   * @param {string} url - TheHive URL
   * @returns {string|null} Case ID (包含 ~ 前缀) 或 null
   * @example
   * extractCaseIdFromUrl('http://127.0.0.1:9000/cases/~534597760/details')
   * // 返回: '~534597760'
   */
  static extractCaseIdFromUrl(url) {
    // 匹配 /cases/~数字 或 /cases/~数字/details
    const match = url.match(/\/cases\/(~\d+)/);
    return match ? match[1] : null;
  }
}
