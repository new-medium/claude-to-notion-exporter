// Settings page script

const apiKeyInput = document.getElementById('apiKey');
const notionTokenInput = document.getElementById('notionToken');
const setupLink = document.getElementById('setupLink');
const saveBtn = document.getElementById('saveBtn');
const testBtn = document.getElementById('testBtn');
const backBtn = document.getElementById('backBtn');
const statusDiv = document.getElementById('status');

// Load saved credentials
chrome.storage.local.get(['anthropicApiKey', 'notionToken'], (result) => {
  if (result.anthropicApiKey) {
    apiKeyInput.value = result.anthropicApiKey;
  }
  
  if (result.notionToken) {
    notionTokenInput.value = result.notionToken;
  }
});

// Back button
backBtn.addEventListener('click', () => {
  window.close();
});

// Setup link
setupLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ 
    url: 'https://www.notion.so/my-integrations',
    active: true
  });
  showStatus('info', 'Create a new integration, copy the token, and share your page with the integration.');
});

// Save button
saveBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  const notionToken = notionTokenInput.value.trim();
  
  if (!apiKey) {
    showStatus('error', 'Please enter your Anthropic API key');
    return;
  }
  
  if (!notionToken) {
    showStatus('error', 'Please enter your Notion integration token');
    return;
  }
  
  try {
    await chrome.storage.local.set({ 
      anthropicApiKey: apiKey,
      notionToken: notionToken
    });
    
    showStatus('success', 'Settings saved successfully!');
    
    // Close after a short delay
    setTimeout(() => {
      window.close();
    }, 1000);
  } catch (error) {
    showStatus('error', `Error saving settings: ${error.message}`);
  }
});

// Test connection button
testBtn.addEventListener('click', async () => {
  const notionToken = notionTokenInput.value.trim();
  
  if (!notionToken) {
    showStatus('error', 'Please enter your Notion integration token');
    return;
  }
  
  showStatus('info', 'Testing Notion connection...');
  testBtn.disabled = true;
  
  try {
    const response = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        filter: { property: 'object', value: 'page' },
        page_size: 1
      })
    });
    
    if (response.ok) {
      showStatus('success', 'Notion connection successful!');
    } else {
      const error = await response.json();
      showStatus('error', `Connection failed: ${error.message || 'Invalid token'}`);
    }
  } catch (error) {
    showStatus('error', `Connection failed: ${error.message}`);
  } finally {
    testBtn.disabled = false;
  }
});

function showStatus(type, message) {
  statusDiv.className = `status ${type}`;
  statusDiv.textContent = message;
}
