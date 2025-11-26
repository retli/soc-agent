/**
 * URL Matcher Utility
 * 用于检测和匹配特定的 URL 模式
 */

export class URLMatcher {
  /**
   * 检测是否为 TheHive Case 页面
   * @param {string} url - URL 地址
   * @returns {boolean}
   */
  static isTheHiveCasePage(url) {
    // 匹配 /cases/~数字 或 /cases/~数字/details
    // 示例: http://10.85.205.68:9000/cases/~534597760/details
    const pattern = /\/cases\/~\d+(?:\/details)?/;
    return pattern.test(url);
  }

  /**
   * 从 URL 提取 Case ID
   * @param {string} url - URL 地址
   * @returns {string|null} Case ID (包含 ~ 前缀) 或 null
   */
  static extractCaseId(url) {
    const match = url.match(/\/cases\/(~?\d+)/);
    return match ? match[1] : null;
  }

  /**
   * 获取当前标签页的 URL
   * @returns {Promise<string>}
   */
  static async getCurrentTabUrl() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
          resolve(tabs[0].url);
        } else {
          resolve('');
        }
      });
    });
  }

  /**
   * 监听 URL 变化
   * @param {Function} callback - URL 变化时的回调函数
   */
  static onUrlChange(callback) {
    // 监听标签页更新
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.url) {
        callback(changeInfo.url, tab);
      }
    });

    // 监听标签页激活
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      if (tab.url) {
        callback(tab.url, tab);
      }
    });
  }
}
