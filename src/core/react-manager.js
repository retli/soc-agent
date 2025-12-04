import { logger } from '../utils/logger.js';
import { TextFormatter } from '../utils/text-formatter.js';

/**
 * ReAct State Manager
 * 管理 ReAct (Reasoning + Acting) 循环的状态
 */
export class ReActManager {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      active: false,
      iteration: 0,
      lastContent: '',
      noticeShown: false
    };
    logger.debug('[ReActManager] State reset');
  }

  start() {
    this.state = {
      active: true,
      iteration: 0,
      lastContent: '',
      noticeShown: false
    };
    logger.debug('[ReActManager] Run started');
  }

  isActive() {
    return !!this.state.active;
  }

  incrementIteration() {
    if (!this.state.active) {
      this.start();
    }
    this.state.iteration = (this.state.iteration || 0) + 1;
    logger.debug('[ReActManager] Iteration:', this.state.iteration);
  }

  getIterationCount() {
    return this.state.iteration || 0;
  }

  setLastContent(content) {
    this.state.lastContent = content || '';
  }

  getFinalContent(preferredContent = '') {
    if (preferredContent && preferredContent.trim().length > 0) {
      return preferredContent;
    }
    const lastContent = this.state.lastContent;
    if (lastContent && lastContent.trim().length > 0) {
      return lastContent;
    }
    return preferredContent;
  }

  /**
   * 尝试完成 ReAct 运行
   * @returns {boolean} 是否真正完成了运行
   */
  tryComplete(fullContent = '', onComplete = null) {
    if (!this.isActive()) {
      return false;
    }

    const hasPlainText = fullContent && fullContent.trim().length > 0;
    const reactData = TextFormatter.parseReActFormat(fullContent);
    const hasResponseBlock = reactData && reactData.response && reactData.response.trim().length > 0;

    if (hasResponseBlock || (!reactData && hasPlainText)) {
      logger.debug('[ReActManager] Run completed after iterations:', this.state.iteration);
      
      this.state.active = false;
      this.state.iteration = 0;
      this.state.lastContent = fullContent || '';
      
      if (!this.state.noticeShown) {
        if (onComplete) {
          onComplete();
        }
        this.state.noticeShown = true;
      }
      return true;
    }
    return false;
  }
}

