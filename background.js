// Background service worker
let sidebarState = {};

// Toggle sidebar on extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  const tabId = tab.id;
  const url = tab.url || '';

  // Only operate on http/https pages
  if (!/^https?:\/\//i.test(url)) {
    console.warn('Sidebar is only available on http/https pages. Current URL:', url);
    return;
  }

  // Toggle state
  sidebarState[tabId] = !sidebarState[tabId];

  const sendToggle = async () => {
    return chrome.tabs.sendMessage(tabId, {
      action: 'toggleSidebar',
      show: sidebarState[tabId]
    });
  };

  try {
    // Try send first
    await sendToggle();
  } catch (error) {
    // Receiving end does not exist -> inject content script and CSS, then retry
    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['sidebar.css']
      });
    } catch (e) {
      // insertCSS may fail if already present; ignore
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      await sendToggle();
    } catch (e2) {
      console.error('Error toggling sidebar after injection:', e2);
    }
  }
});

// Clean up state when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  delete sidebarState[tabId];
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSidebarState') {
    const tabId = sender && sender.tab ? sender.tab.id : undefined;
    sendResponse({ show: tabId ? (sidebarState[tabId] || false) : false });
  }
  return true;
});
