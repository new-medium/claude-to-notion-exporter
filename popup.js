// Popup script for handling user interaction and Notion API integration

const NOTION_BLOCK_LIMIT = 2000;

// DOM elements
const settingsBtn = document.getElementById('settingsBtn');
const pageSearchInput = document.getElementById('pageSearch');
const searchResults = document.getElementById('searchResults');
const selectedPageDiv = document.getElementById('selectedPage');
const exportBtn = document.getElementById('exportBtn');
const exportButtonsDiv = document.getElementById('exportButtons');
const exportStatusDiv = document.getElementById('exportStatus');
const exportStatusContent = document.getElementById('exportStatusContent');
const statusDiv = document.getElementById('status');
const progressDiv = document.getElementById('progress');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

let selectedPageId = null;
let selectedPageTitle = null;
let selectedPageUrl = null;
let notionToken = null;
let searchTimeout = null;
let currentConversationUrl = null;
let currentTurnCount = 0;
let exportHistory = null;

// Load credentials and check if export is in progress
chrome.storage.local.get(['anthropicApiKey', 'notionToken', 'selectedPageId', 'selectedPageTitle', 'selectedPageUrl', 'exportProgress'], async (result) => {
  if (!result.anthropicApiKey || !result.notionToken) {
    showStatus('warning', 'Please configure your API keys in settings first');
    exportBtn.disabled = true;
  } else {
    notionToken = result.notionToken;
    
    // Load selected page if exists
    if (result.selectedPageId && result.selectedPageTitle) {
      selectedPageId = result.selectedPageId;
      selectedPageTitle = result.selectedPageTitle;
      selectedPageUrl = result.selectedPageUrl || `https://www.notion.so/${result.selectedPageId.replace(/-/g, '')}`;
      showSelectedPage(selectedPageTitle);
      exportBtn.disabled = false;
    }
  }
  
  // Check if export is in progress
  if (result.exportProgress) {
    showExportInProgress(result.exportProgress);
    startProgressPolling();
  }
  
  // Check current conversation and export history
  await checkConversationStatus();
});

// Settings button
settingsBtn.addEventListener('click', () => {
  chrome.windows.create({
    url: 'settings.html',
    type: 'popup',
    width: 500,
    height: 500
  });
});

// Page search with debounce
pageSearchInput.addEventListener('input', (e) => {
  const query = e.target.value.trim();
  
  clearTimeout(searchTimeout);
  
  if (query.length < 2) {
    searchResults.classList.remove('show');
    return;
  }
  
  searchTimeout = setTimeout(() => {
    searchNotionPages(query);
  }, 300);
});

// Click outside to close search results
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-container')) {
    searchResults.classList.remove('show');
  }
});

async function searchNotionPages(query) {
  if (!notionToken) {
    showStatus('warning', 'Please configure Notion token in settings');
    return;
  }
  
  searchResults.innerHTML = '<div class="loading">Searching...</div>';
  searchResults.classList.add('show');
  
  try {
    const response = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        query: query,
        filter: { property: 'object', value: 'page' },
        page_size: 10
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to search pages');
    }
    
    const data = await response.json();
    displaySearchResults(data.results);
    
  } catch (error) {
    console.error('Search error:', error);
    searchResults.innerHTML = '<div class="loading">Search failed</div>';
  }
}

function displaySearchResults(pages) {
  if (pages.length === 0) {
    searchResults.innerHTML = '<div class="loading">No pages found</div>';
    return;
  }
  
  searchResults.innerHTML = '';
  
  pages.forEach(page => {
    const title = getPageTitle(page);
    const path = getPagePath(page);
    
    const resultDiv = document.createElement('div');
    resultDiv.className = 'search-result';
    resultDiv.innerHTML = `
      <div class="result-title">${title}</div>
      ${path ? `<div class="result-path">${path}</div>` : ''}
    `;
    
    resultDiv.addEventListener('click', () => {
      selectPage(page.id, title);
    });
    
    searchResults.appendChild(resultDiv);
  });
}

function getPageTitle(page) {
  // Try different title properties
  if (page.properties?.title?.title?.[0]?.plain_text) {
    return page.properties.title.title[0].plain_text;
  }
  if (page.properties?.Name?.title?.[0]?.plain_text) {
    return page.properties.Name.title[0].plain_text;
  }
  // Fallback to any title-type property
  for (const prop of Object.values(page.properties || {})) {
    if (prop.type === 'title' && prop.title?.[0]?.plain_text) {
      return prop.title[0].plain_text;
    }
  }
  return 'Untitled';
}

function getPagePath(page) {
  // Return parent info if available
  if (page.parent?.type === 'page_id') {
    return 'In another page';
  }
  if (page.parent?.type === 'database_id') {
    return 'In database';
  }
  if (page.parent?.type === 'workspace') {
    return 'Workspace';
  }
  return null;
}

function selectPage(pageId, pageTitle) {
  selectedPageId = pageId;
  selectedPageTitle = pageTitle;
  
  // Construct Notion URL from page ID
  // Remove hyphens if present and format as Notion URL
  const cleanId = pageId.replace(/-/g, '');
  selectedPageUrl = `https://www.notion.so/${cleanId}`;
  
  // Save selection
  chrome.storage.local.set({ selectedPageId, selectedPageTitle, selectedPageUrl });
  
  // Update UI
  showSelectedPage(pageTitle);
  searchResults.classList.remove('show');
  pageSearchInput.value = '';
  exportBtn.disabled = false;
  
  // Recheck export status with new page selected
  checkConversationStatus();
}

async function checkConversationStatus() {
  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url || !tab.url.includes('claude.ai')) {
      return; // Not on Claude page
    }
    
    currentConversationUrl = tab.url;
    
    // Extract conversation to get turn count
    const response = await chrome.tabs.sendMessage(tab.id, { 
      action: 'extractConversation' 
    });
    
    if (response && response.success) {
      currentTurnCount = response.data.length;
      
      // Get export history for this conversation
      chrome.runtime.sendMessage({
        action: 'getExportHistory',
        conversationUrl: currentConversationUrl
      }, (historyResponse) => {
        if (historyResponse && historyResponse.success && historyResponse.data) {
          exportHistory = historyResponse.data;
          updateExportStatusUI();
        }
      });
    }
  } catch (error) {
    console.error('Error checking conversation status:', error);
  }
}

function updateExportStatusUI() {
  if (!exportHistory) {
    exportStatusDiv.classList.remove('show');
    // Show default export button
    exportButtonsDiv.innerHTML = '<button id=\"exportBtn\" ' + (selectedPageId ? '' : 'disabled') + '>Export Conversation</button>';
    return;
  }
  
  const newTurns = currentTurnCount - exportHistory.turnCount;
  const timeAgo = getTimeAgo(exportHistory.exportedAt);
  
  // Show export status
  exportStatusDiv.classList.add('show');
  
  if (newTurns > 0) {
    // Has new turns - show update option
    exportStatusContent.innerHTML = `
      <div class=\"export-status-info\">
        <span class=\"status-badge update\">+${newTurns} new turn${newTurns > 1 ? 's' : ''}</span>
      </div>
      <div class=\"export-status-info\">
        Last exported: <strong>${timeAgo}</strong>
      </div>
      <div class=\"export-status-info\">
        Previous: ${exportHistory.turnCount} turn${exportHistory.turnCount > 1 ? 's' : ''} → Current: ${currentTurnCount} turn${currentTurnCount > 1 ? 's' : ''}
      </div>
    `;
    
    exportButtonsDiv.innerHTML = `
      <div class=\"button-group\">
        <button id=\"updateBtn\">Update (+${newTurns})</button>
        <button id=\"reexportBtn\" class=\"secondary\">Re-export</button>
      </div>
    `;
    
    // Add event listeners
    document.getElementById('updateBtn').addEventListener('click', () => handleExport('update'));
    document.getElementById('reexportBtn').addEventListener('click', () => handleExport('full'));
    
  } else if (newTurns === 0) {
    // Up to date
    exportStatusContent.innerHTML = `
      <div class=\"export-status-info\">
        <span class="status-badge success">Up to date</span>
      </div>
      <div class="export-status-info">
        Last exported: <strong>${timeAgo}</strong>
      </div>
      <div class="export-status-info">
        ${exportHistory.turnCount} turn${exportHistory.turnCount > 1 ? 's' : ''}
      </div>
    `;
    
    exportButtonsDiv.innerHTML = `
      <button id="exportBtn" disabled>Up to date</button>
      <button id=\"reexportBtn\" class=\"secondary\" style=\"margin-top: 8px;\">Re-export from Scratch</button>
    `;
    
    document.getElementById('reexportBtn').addEventListener('click', () => handleExport('full'));
  }
}

function getTimeAgo(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minute${Math.floor(seconds / 60) > 1 ? 's' : ''} ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hour${Math.floor(seconds / 3600) > 1 ? 's' : ''} ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} day${Math.floor(seconds / 86400) > 1 ? 's' : ''} ago`;
  
  return date.toLocaleDateString();
}

function showSelectedPage(title) {
  selectedPageDiv.innerHTML = `
    <span class="selected-page-text">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width: 14px; height: 14px; stroke-width: 2; display: inline-block; vertical-align: text-top; margin-right: 6px;">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      ${title}
    </span>
    <span class="selected-page-link" title="Open in Notion">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      </svg>
    </span>
  `;
  selectedPageDiv.classList.add('show');
  
  // Add click handler to open the page
  selectedPageDiv.onclick = () => {
    if (selectedPageUrl) {
      chrome.tabs.create({ url: selectedPageUrl });
    }
  };
}

// Export/Update handler
async function handleExport(mode = 'full') {
  // Get credentials from storage
  const result = await chrome.storage.local.get(['anthropicApiKey', 'notionToken']);
  const apiKey = result.anthropicApiKey;
  const notionTokenValue = result.notionToken;
  
  if (!apiKey) {
    showStatus('error', 'Please configure your Anthropic API key in settings');
    return;
  }
  
  if (!notionTokenValue) {
    showStatus('error', 'Please configure your Notion integration token in settings');
    return;
  }
  
  if (!selectedPageId) {
    showStatus('error', 'Please select a Notion page');
    return;
  }
  
  try {
    // Disable all buttons
    const allButtons = exportButtonsDiv.querySelectorAll('button');
    allButtons.forEach(btn => btn.disabled = true);
    
    showStatus('info', 'Extracting conversation...');
    
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('claude.ai')) {
      showStatus('error', 'Please open this extension on a claude.ai conversation page');
      allButtons.forEach(btn => btn.disabled = false);
      return;
    }
    
    // Extract conversation from page
    const response = await chrome.tabs.sendMessage(tab.id, { 
      action: 'extractConversation' 
    });
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to extract conversation');
    }
    
    const turns = response.data;
    const chatTitle = response.title || 'Claude Conversation';
    const conversationUrl = tab.url;
    
    if (turns.length === 0) {
      throw new Error('No conversation turns found');
    }
    
    const statusMessage = mode === 'update' 
      ? `Found ${turns.length - exportHistory.turnCount} new turns. Starting update in background...`
      : `Found ${turns.length} turns. Starting export in background...`;
    
    showStatus('info', statusMessage);
    
    // Send to background worker to process
    chrome.runtime.sendMessage({
      action: 'startExport',
      data: {
        turns,
        chatTitle,
        conversationUrl,
        apiKey,
        notionToken: notionTokenValue,
        pageId: selectedPageId,
        exportMode: mode,
        existingExportData: mode === 'update' ? exportHistory : null
      }
    }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('error', chrome.runtime.lastError.message);
        allButtons.forEach(btn => btn.disabled = false);
      } else if (response && !response.success) {
        showStatus('error', response.error || 'Export failed');
        allButtons.forEach(btn => btn.disabled = false);
      }
    });
    
    // Start polling for progress
    const progressMessage = mode === 'update' 
      ? 'Update running in background. You can close this popup or switch tabs.'
      : 'Export running in background. You can close this popup or switch tabs.';
    showStatus('info', progressMessage);
    progressDiv.style.display = 'block';
    startProgressPolling();
    
  } catch (error) {
    console.error('Export error:', error);
    showStatus('error', `Error: ${error.message}`);
    progressDiv.style.display = 'none';
    const allButtons = exportButtonsDiv.querySelectorAll('button');
    allButtons.forEach(btn => btn.disabled = false);
  }
}

// Delegated event listener for export button (when it's the default one)
exportButtonsDiv.addEventListener('click', (e) => {
  if (e.target.id === 'exportBtn' && !e.target.disabled) {
    handleExport('full');
  }
});

// Extract Notion page ID from URL (utility function)
function extractPageId(url) {
  // Notion URLs: https://www.notion.so/Page-Name-123abc456def...
  // Or: https://notion.so/workspace/123abc456def...
  const match = url.match(/([a-f0-9]{32})|([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (match) {
    // Remove hyphens if present
    return match[0].replace(/-/g, '');
  }
  return null;
}

// Progress polling
let progressInterval = null;

function startProgressPolling() {
  if (progressInterval) {
    clearInterval(progressInterval);
  }
  
  progressInterval = setInterval(async () => {
    chrome.runtime.sendMessage({ action: 'getProgress' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error getting progress:', chrome.runtime.lastError);
        return;
      }
      
      const progress = response?.progress;
      
      if (!progress) {
        // Export complete or not started
        clearInterval(progressInterval);
        progressInterval = null;
        exportBtn.disabled = false;
        showStatus('success', 'Export completed!');
        progressDiv.style.display = 'none';
        return;
      }
      
      if (progress.status === 'error') {
        clearInterval(progressInterval);
        progressInterval = null;
        exportBtn.disabled = false;
        showStatus('error', progress.message);
        progressDiv.style.display = 'none';
        return;
      }
      
      // Update progress UI
      const percentage = progress.total > 0 
        ? Math.round((progress.current / progress.total) * 100)
        : 0;
      progressFill.style.width = `${percentage}%`;
      progressText.textContent = progress.message;
    });
  }, 500);
}

function showExportInProgress(progress) {
  exportBtn.disabled = true;
  progressDiv.style.display = 'block';
  showStatus('info', 'Export in progress...');
  const percentage = progress.total > 0 
    ? Math.round((progress.current / progress.total) * 100)
    : 0;
  progressFill.style.width = `${percentage}%`;
  progressText.textContent = progress.message;
}

// Show status message
function showStatus(type, message) {
  statusDiv.className = `status ${type}`;
  statusDiv.textContent = message;
}

// Update progress bar
function updateProgress(current, total, message) {
  const percentage = Math.round((current / total) * 100);
  progressFill.style.width = `${percentage}%`;
  progressText.textContent = message;
}
