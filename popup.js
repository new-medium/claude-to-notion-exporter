// Popup script for handling user interaction and Notion API integration

const NOTION_BLOCK_LIMIT = 2000;

// DOM elements
const settingsBtn = document.getElementById('settingsBtn');
const pageSearchInput = document.getElementById('pageSearch');
const searchResults = document.getElementById('searchResults');
const selectedPageDiv = document.getElementById('selectedPage');
const exportBtn = document.getElementById('exportBtn');
const statusDiv = document.getElementById('status');
const progressDiv = document.getElementById('progress');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

let selectedPageId = null;
let selectedPageTitle = null;
let notionToken = null;
let searchTimeout = null;

// Load credentials and check if export is in progress
chrome.storage.local.get(['anthropicApiKey', 'notionToken', 'selectedPageId', 'selectedPageTitle', 'exportProgress'], async (result) => {
  if (!result.anthropicApiKey || !result.notionToken) {
    showStatus('warning', '⚙️ Please configure your API keys in settings first');
    exportBtn.disabled = true;
  } else {
    notionToken = result.notionToken;
    
    // Load selected page if exists
    if (result.selectedPageId && result.selectedPageTitle) {
      selectedPageId = result.selectedPageId;
      selectedPageTitle = result.selectedPageTitle;
      showSelectedPage(selectedPageTitle);
      exportBtn.disabled = false;
    }
  }
  
  // Check if export is in progress
  if (result.exportProgress) {
    showExportInProgress(result.exportProgress);
    startProgressPolling();
  }
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
  
  // Save selection
  chrome.storage.local.set({ selectedPageId, selectedPageTitle });
  
  // Update UI
  showSelectedPage(pageTitle);
  searchResults.classList.remove('show');
  pageSearchInput.value = '';
  exportBtn.disabled = false;
}

function showSelectedPage(title) {
  selectedPageDiv.textContent = `✓ ${title}`;
  selectedPageDiv.classList.add('show');
}

// Export button
exportBtn.addEventListener('click', async () => {
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
    exportBtn.disabled = true;
    showStatus('info', 'Extracting conversation...');
    
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('claude.ai')) {
      showStatus('error', 'Please open this extension on a claude.ai conversation page');
      exportBtn.disabled = false;
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
    
    showStatus('info', `Found ${turns.length} turns. Starting export in background...`);
    
    // Send to background worker to process
    chrome.runtime.sendMessage({
      action: 'startExport',
      data: {
        turns,
        chatTitle,
        conversationUrl,
        apiKey,
        notionToken: notionTokenValue,
        pageId: selectedPageId
      }
    }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('error', chrome.runtime.lastError.message);
        exportBtn.disabled = false;
      } else if (response && !response.success) {
        showStatus('error', response.error || 'Export failed');
        exportBtn.disabled = false;
      }
    });
    
    // Start polling for progress
    showStatus('info', 'Export running in background. You can close this popup or switch tabs.');
    progressDiv.style.display = 'block';
    startProgressPolling();
    
  } catch (error) {
    console.error('Export error:', error);
    showStatus('error', `Error: ${error.message}`);
    progressDiv.style.display = 'none';
    exportBtn.disabled = false;
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
