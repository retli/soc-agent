// Storage utilities for Chrome extension
import { STORAGE_KEYS } from '../config/constants.js';
import { DEFAULT_CONFIG } from '../config/defaults.js';

export class StorageManager {
  /**
   * Get AI configuration from storage
   */
  static async getAIConfig() {
    const result = await chrome.storage.local.get([STORAGE_KEYS.AI_CONFIG, STORAGE_KEYS.DIFY_CONFIG]);
    
    // Migrate from old difyConfig if needed
    if (!result[STORAGE_KEYS.AI_CONFIG] && result[STORAGE_KEYS.DIFY_CONFIG]) {
      console.log('[Storage] Migrating from legacy config');
      const config = {
        apiKey: '',
        apiUrl: DEFAULT_CONFIG.api.url,
        model: DEFAULT_CONFIG.api.model,
        user: result[STORAGE_KEYS.DIFY_CONFIG].user || DEFAULT_CONFIG.user.idPrefix + Date.now()
      };
      await this.saveAIConfig(config);
      return config;
    }
    
    return result[STORAGE_KEYS.AI_CONFIG] || {
      apiKey: DEFAULT_CONFIG.api.key,
      apiUrl: DEFAULT_CONFIG.api.url,
      authorization: DEFAULT_CONFIG.api.authorization,
      model: DEFAULT_CONFIG.api.model,
      user: DEFAULT_CONFIG.user.idPrefix + Date.now(),
      useFunctionCalling: DEFAULT_CONFIG.ui.useFunctionCalling,
      includeToolResults: DEFAULT_CONFIG.ui.includeToolResults,
      enableSuggestedActions: DEFAULT_CONFIG.ui.enableSuggestedActions,
      autoSendSuggestions: DEFAULT_CONFIG.ui.autoSendSuggestions
    };
  }

  /**
   * Save AI configuration
   */
  static async saveAIConfig(config) {
    await chrome.storage.local.set({ [STORAGE_KEYS.AI_CONFIG]: config });
  }

  /**
   * Get MCP services configuration
   */
  static async getMCPServices() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MCP_SERVICES);
    return result[STORAGE_KEYS.MCP_SERVICES] || [];
  }

  /**
   * Save MCP services configuration
   */
  static async saveMCPServices(services) {
    await chrome.storage.local.set({ [STORAGE_KEYS.MCP_SERVICES]: services });
  }

  /**
   * Get cached MCP tools
   */
  static async getMCPToolsCache() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MCP_TOOLS_CACHE);
    return result[STORAGE_KEYS.MCP_TOOLS_CACHE] || {};
  }

  /**
   * Save cached MCP tools
   */
  static async saveMCPToolsCache(cache) {
    await chrome.storage.local.set({ [STORAGE_KEYS.MCP_TOOLS_CACHE]: cache });
  }

  /**
   * Get MCP tools enabled status
   */
  static async getMCPToolsEnabled() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MCP_TOOLS_ENABLED);
    return result[STORAGE_KEYS.MCP_TOOLS_ENABLED] || {};
  }

  /**
   * Save MCP tools enabled status
   */
  static async saveMCPToolsEnabled(enabled) {
    await chrome.storage.local.set({ [STORAGE_KEYS.MCP_TOOLS_ENABLED]: enabled });
  }

  /**
   * Get MCP tools auto-execute status
   */
  static async getMCPToolsAutoExecute() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MCP_TOOLS_AUTO_EXECUTE);
    return result[STORAGE_KEYS.MCP_TOOLS_AUTO_EXECUTE] || {};
  }

  /**
   * Save MCP tools auto-execute status
   */
  static async saveMCPToolsAutoExecute(autoExecute) {
    await chrome.storage.local.set({ [STORAGE_KEYS.MCP_TOOLS_AUTO_EXECUTE]: autoExecute });
  }

  /**
   * Get conversations
   */
  static async getConversations() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.CONVERSATIONS);
    return result[STORAGE_KEYS.CONVERSATIONS] || [];
  }

  /**
   * Save conversations
   */
  static async saveConversations(conversations) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.CONVERSATIONS]: conversations });
      return true;
    } catch (error) {
      console.error('[Storage] Save failed:', error);
      return false;
    }
  }

  /**
   * Get development mode settings
   */
  static async getDevMode() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.DEV_MODE);
    return result[STORAGE_KEYS.DEV_MODE] || { enabled: false };
  }

  /**
   * Save development mode settings
   */
  static async saveDevMode(devMode) {
    await chrome.storage.local.set({ [STORAGE_KEYS.DEV_MODE]: devMode });
  }

  /**
   * Clear all storage
   */
  static async clearAll() {
    await chrome.storage.local.clear();
  }
}
