import { StorageManager } from '../utils/storage.js';
import { logger } from '../utils/logger.js';

export class ConversationManager {
  constructor() {
    this.conversations = [];
    this.currentConversationId = null;
    this.toolResultsCache = {}; // { conversationId: [{ toolName, result, error, args, serviceName, timestamp, toolCallId }] }
  }

  async load() {
    this.conversations = await StorageManager.getConversations();
    this.conversations.forEach(conv => {
      if (!conv.metadata || typeof conv.metadata !== 'object') {
        conv.metadata = {};
      }
    });
    logger.info('[ConversationManager] Loaded conversations:', this.conversations.length);
  }

  async save() {
    const success = await StorageManager.saveConversations(this.conversations);
    if (!success) {
      logger.warn('[ConversationManager] Failed to save conversations');
      return false;
    }
    return true;
  }

  create() {
    const conversation = {
      id: 'conv-' + Date.now(),
      title: '新对话',
      messages: [],
      conversationId: null,
      createdAt: new Date().toISOString(),
      metadata: {}
    };
    
    this.conversations.unshift(conversation);
    this.initToolResultsCache(conversation.id);
    
    return this.save().then(() => conversation);
  }

  switch(id) {
    const conversation = this.get(id);
    if (conversation) {
      this.currentConversationId = id;
      this.initToolResultsCache(id);
      logger.info('[ConversationManager] Switched to:', id);
      return conversation;
    }
    logger.warn('[ConversationManager] Conversation not found:', id);
    return null;
  }

  getCurrent() {
    return this.conversations.find(c => c.id === this.currentConversationId);
  }

  get(id) {
    return this.conversations.find(c => c.id === id);
  }

  getAll() {
    return this.conversations;
  }

  delete(id) {
    const index = this.conversations.findIndex(c => c.id === id);
    if (index !== -1) {
      this.conversations.splice(index, 1);
      delete this.toolResultsCache[id];
      
      if (this.currentConversationId === id) {
        this.currentConversationId = this.conversations.length > 0 ? this.conversations[0].id : null;
      }
      return this.save();
    }
    return Promise.resolve(false);
  }

  updateTitle(id, title) {
    const conv = this.get(id);
    if (conv) {
      conv.title = title;
      return this.save();
    }
    return Promise.resolve(false);
  }

  addMessage(id, role, content, metadata = {}) {
    const conv = this.get(id);
    if (conv) {
      conv.messages.push({
        role,
        content,
        timestamp: Date.now(),
        ...metadata
      });
      
      // Auto-generate title if it's the first user message
      if (role === 'user' && conv.messages.length <= 2 && conv.title === '新对话') {
        conv.title = content.slice(0, 30) + (content.length > 30 ? '...' : '');
      }
      
      return this.save();
    }
    return Promise.resolve(false);
  }

  initToolResultsCache(conversationId) {
    if (!this.toolResultsCache[conversationId]) {
      this.toolResultsCache[conversationId] = [];
      logger.info('[ConversationManager] Initialized tool cache for:', conversationId);
    }
  }

  addToolResult(conversationId, result) {
    this.initToolResultsCache(conversationId);
    this.toolResultsCache[conversationId].push(result);
  }

  getToolResults(conversationId) {
    return this.toolResultsCache[conversationId] || [];
  }

  clearToolResults(conversationId) {
    this.toolResultsCache[conversationId] = [];
  }
}

