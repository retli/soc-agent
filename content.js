// Content script - injects sidebar into page
let sidebarIframe = null;
let isVisible = false;
let sidebarWidth = 400; // 默认宽度
let animationDuration = 300; // 默认动画时长
let thehiveButton = null; // TheHive 悬浮按钮
let thehiveConfig = null; // TheHive 配置

// 加载配置
async function loadConfig() {
  try {
    const module = await import(chrome.runtime.getURL('src/config/defaults.js'));
    const config = module.DEFAULT_CONFIG;
    sidebarWidth = config.ui.sidebarWidth || 400;
    animationDuration = config.ui.animationDuration || 300;
    thehiveConfig = config.thehive; // 保存 TheHive 配置
    console.log('[Content] Loaded config - sidebarWidth:', sidebarWidth, 'animationDuration:', animationDuration);
    console.log('[Content] TheHive config:', thehiveConfig);
  } catch (error) {
    console.warn('[Content] Failed to load config, using defaults:', error);
  }
}

// Create and inject sidebar
function createSidebar() {
  if (sidebarIframe) return;
  
  // Create iframe for sidebar
  sidebarIframe = document.createElement('iframe');
  sidebarIframe.id = 'dify-chat-sidebar';
  sidebarIframe.src = chrome.runtime.getURL('sidebar.html');
  sidebarIframe.style.cssText = `
    position: fixed;
    top: 0;
    left: -${sidebarWidth}px;
    width: ${sidebarWidth}px;
    height: 100vh;
    border: none;
    z-index: 2147483647;
    box-shadow: 2px 0 10px rgba(0,0,0,0.1);
    transition: left ${animationDuration}ms ease;
  `;
  
  document.body.appendChild(sidebarIframe);
  
  // Adjust page content
  adjustPageContent(false);
}

// Adjust page content to make room for sidebar
function adjustPageContent(show) {
  const body = document.body;
  if (show) {
    body.style.marginLeft = `${sidebarWidth}px`;
    body.style.transition = `margin-left ${animationDuration}ms ease`;
  } else {
    body.style.marginLeft = '0';
  }
}

// Toggle sidebar visibility
function toggleSidebar(show) {
  if (!sidebarIframe) {
    createSidebar();
  }
  
  isVisible = show;
  
  if (show) {
    sidebarIframe.style.left = '0';
    adjustPageContent(true);
  } else {
    sidebarIframe.style.left = `-${sidebarWidth}px`;
    adjustPageContent(false);
  }
}

// ==================== TheHive 集成 ====================

/**
 * 检测是否为 TheHive Case 页面
 */
function isTheHiveCasePage(url) {
  const pattern = /\/cases\/~\d+(?:\/details)?/;
  return pattern.test(url);
}

/**
 * 从 URL 提取 Case ID
 */
function extractCaseId(url) {
  const match = url.match(/\/cases\/(~\d+)/);
  return match ? match[1] : null;
}

/**
 * 创建 TheHive 悬浮按钮
 */
function createTheHiveButton() {
  if (thehiveButton) return;
  
  thehiveButton = document.createElement('div');
  thehiveButton.id = 'thehive-load-button';
  thehiveButton.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 18px;">🔗</span>
      <span style="font-weight: 600;">加载 Case</span>
    </div>
  `;
  
  // 样式
  thehiveButton.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #10b981, #059669);
    color: white;
    padding: 12px 20px;
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
    cursor: pointer;
    z-index: 2147483646;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px;
    transition: all 0.3s ease;
    display: none;
    animation: slideInFromRight 0.3s ease-out;
  `;
  
  // 添加动画
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideInFromRight {
      from {
        opacity: 0;
        transform: translateX(100px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }
    
    #thehive-load-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(16, 185, 129, 0.5) !important;
    }
    
    #thehive-load-button:active {
      transform: translateY(0);
    }
  `;
  document.head.appendChild(style);
  
  // 点击事件
  thehiveButton.addEventListener('click', handleTheHiveButtonClick);
  
  document.body.appendChild(thehiveButton);
  console.log('[Content] TheHive button created');
}

/**
 * 显示 TheHive 按钮
 */
function showTheHiveButton() {
  if (!thehiveButton) {
    createTheHiveButton();
  }
  if (thehiveButton) {
    thehiveButton.style.display = 'flex';
    console.log('[Content] TheHive button shown');
  }
}

/**
 * 隐藏 TheHive 按钮
 */
function hideTheHiveButton() {
  if (thehiveButton) {
    thehiveButton.style.display = 'none';
    console.log('[Content] TheHive button hidden');
  }
}

/**
 * 处理按钮点击
 */
async function handleTheHiveButtonClick() {
  console.log('[Content] TheHive button clicked');
  
  // 更新按钮状态
  const originalContent = thehiveButton.innerHTML;
  thehiveButton.innerHTML = '<span style="font-size: 18px;">⏳</span> <span>加载中...</span>';
  thehiveButton.style.pointerEvents = 'none';
  
  try {
    // 1. 打开侧边栏（如果未打开）
    if (!isVisible) {
      toggleSidebar(true);
      // 等待侧边栏完全加载
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // 2. 发送消息到侧边栏，触发加载
    if (sidebarIframe && sidebarIframe.contentWindow) {
      sidebarIframe.contentWindow.postMessage({
        action: 'loadTheHiveCase',
        url: window.location.href
      }, '*');
      
      console.log('[Content] Message sent to sidebar');
      
      // 成功提示
      thehiveButton.innerHTML = '<span style="font-size: 18px;">✅</span> <span>已加载</span>';
      setTimeout(() => {
        thehiveButton.innerHTML = originalContent;
        thehiveButton.style.pointerEvents = 'auto';
      }, 2000);
    }
  } catch (error) {
    console.error('[Content] Load TheHive case failed:', error);
    thehiveButton.innerHTML = '<span style="font-size: 18px;">❌</span> <span>加载失败</span>';
    setTimeout(() => {
      thehiveButton.innerHTML = originalContent;
      thehiveButton.style.pointerEvents = 'auto';
    }, 2000);
  }
}

/**
 * 检查当前页面并显示/隐藏按钮
 */
function checkPageAndToggleButton() {
  if (!thehiveConfig || !thehiveConfig.enabled) {
    console.log('[Content] TheHive integration disabled');
    hideTheHiveButton();
    return;
  }
  
  const currentUrl = window.location.href;
  console.log('[Content] Checking URL:', currentUrl);
  
  if (isTheHiveCasePage(currentUrl)) {
    console.log('[Content] ✓ TheHive Case page detected');
    showTheHiveButton();
  } else {
    console.log('[Content] Not a TheHive Case page');
    hideTheHiveButton();
  }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggleSidebar') {
    toggleSidebar(request.show);
    sendResponse({ success: true });
  }
  return true;
});

// Listen for messages from sidebar iframe
window.addEventListener('message', (event) => {
  // 验证消息来源（可选，但建议）
  if (event.data && event.data.action === 'closeSidebar') {
    toggleSidebar(false);
  }
});

// 监听 URL 变化（SPA 应用）
let lastUrl = location.href;
new MutationObserver(() => {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    console.log('[Content] URL changed to:', currentUrl);
    checkPageAndToggleButton();
  }
}).observe(document, { subtree: true, childList: true });

// 监听 popstate 事件（浏览器前进/后退）
window.addEventListener('popstate', () => {
  console.log('[Content] popstate event');
  checkPageAndToggleButton();
});

// Initialize
(async function init() {
  await loadConfig();
  createSidebar();
  
  // 检查当前页面并显示按钮
  setTimeout(() => {
    checkPageAndToggleButton();
  }, 1000);
})();
