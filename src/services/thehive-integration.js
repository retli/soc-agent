/**
 * TheHive Integration Service
 * 处理 TheHive 集成的业务逻辑
 */

import { TheHiveAPI } from './thehive-api.js';
import { logger } from '../utils/logger.js';
import { TextFormatter } from '../utils/text-formatter.js';

export class TheHiveIntegration {
  constructor(config) {
    this.api = new TheHiveAPI(config);
    this.currentCaseId = null;
    this.currentCase = null;
  }

  /**
   * 更新配置
   */
  updateConfig(config) {
    this.api.updateConfig(config);
  }

  /**
   * 检测当前页面是否为 TheHive Case 页面
   * @param {string} url - 当前页面 URL
   * @returns {boolean}
   */
  isTheHiveCasePage(url) {
    // 匹配 /cases/~数字 或 /cases/~数字/details
    // 支持格式: cases/~534597760 或 cases/~534597760/details
    const pattern = /\/cases\/~\d+(?:\/details)?/;
    return pattern.test(url);
  }

  /**
   * 从当前页面加载 Case
   * @param {string} url - 当前页面 URL
   */
  async loadCaseFromUrl(url) {
    const caseId = TheHiveAPI.extractCaseIdFromUrl(url);
    
    if (!caseId) {
      throw new Error('无法从 URL 提取 Case ID');
    }

    logger.info('[TheHive] Loading case:', caseId);
    this.currentCaseId = caseId;
    
    // 获取 Case 详情
    this.currentCase = await this.api.getCase(caseId);
    
    return {
      caseId: caseId,
      case: this.currentCase
    };
  }

  /**
   * 获取 Case 的所有 Comments
   */
  async getCaseComments() {
    if (!this.currentCaseId) {
      throw new Error('No case loaded');
    }

    try {
      const comments = await this.api.getCaseComments(this.currentCaseId);
      return this.formatComments(comments);
    } catch (error) {
      logger.error('[TheHive] Get comments failed:', error);
      throw error;
    }
  }

  /**
   * 格式化 Comments 为可读文本
   * @param {Array} comments - TheHive comments 数组
   * @returns {string} 格式化后的文本
   */
  formatComments(comments) {
    if (!comments || comments.length === 0) {
      return '暂无 Comments';
    }

    let formatted = '=== TheHive Case Comments ===\n\n';
    
    comments.forEach((comment, index) => {
      const timestamp = new Date(comment.createdAt || comment._createdAt).toLocaleString('zh-CN');
      const author = comment.createdBy || comment._createdBy || 'Unknown';
      const message = comment.message || '';
      
      formatted += `[${index + 1}] ${timestamp} - ${author}\n`;
      formatted += `${message}\n\n`;
      formatted += '---\n\n';
    });

    return formatted;
  }

  /**
   * 获取 Case 的简要信息（用于显示标题）
   */
  getCaseTitle() {
    if (!this.currentCase) {
      return 'TheHive Case';
    }

    const caseNumber = this.currentCase.number || this.currentCaseId;
    const title = this.currentCase.title || 'Untitled';
    
    return `#${caseNumber} ${title}`;
  }

  /**
   * 获取 Case 的完整摘要
   */
  getCaseSummary() {
    if (!this.currentCase) {
      return null;
    }

    const summary = {
      id: this.currentCase._id,
      number: this.currentCase.number,
      title: this.currentCase.title,
      description: this.currentCase.description,
      severity: this.currentCase.severity,
      status: this.currentCase.status,
      tags: this.currentCase.tags || [],
      createdAt: new Date(this.currentCase._createdAt).toLocaleString('zh-CN'),
      createdBy: this.currentCase._createdBy
    };

    return summary;
  }

  /**
   * 清除当前加载的 Case
   */
  clearCurrentCase() {
    this.currentCaseId = null;
    this.currentCase = null;
  }
}
