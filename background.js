// Background service worker for handling API calls to Anthropic

console.log('Background service worker loaded');

// Helper function for retrying with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, initialDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // If rate limited (429) or server error (5xx), retry
      const shouldRetry = error.message.includes('429') || 
                          error.message.includes('rate limit') ||
                          error.message.includes('5') && error.message.includes('Error');
      
      if (!shouldRetry || attempt === maxRetries - 1) {
        throw error;
      }
      
      // Exponential backoff: 1s, 2s, 4s
      const delay = initialDelay * Math.pow(2, attempt);
      console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms...`);
      await sleep(delay);
    }
  }
  
  throw lastError;
}

// Helper function for sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background: Received message:', request.action);
  
  if (request.action === 'summarizeTurn') {
    console.log('Background: Received summarizeTurn request for turn', request.data.turnNumber);
    handleSummarization(request.data, request.apiKey)
      .then(result => {
        console.log('Background: Successfully summarized turn', request.data.turnNumber);
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        console.error('Background: Summarization failed for turn', request.data.turnNumber, ':', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }
  
  if (request.action === 'startExport') {
    console.log('Background: Starting export process');
    handleFullExport(request.data)
      .then(() => {
        console.log('Background: Export completed successfully');
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Background: Export failed:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }
  
  if (request.action === 'getProgress') {
    chrome.storage.local.get(['exportProgress'], (result) => {
      sendResponse({ progress: result.exportProgress || null });
    });
    return true;
  }
  
  if (request.action === 'getExportHistory') {
    getExportHistory(request.conversationUrl)
      .then(history => {
        sendResponse({ success: true, data: history });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});

async function handleSummarization(turnData, apiKey) {
  const { user, assistant, turnNumber } = turnData;
  
  // Combine user and assistant messages for context
  const fullTurn = `User: ${user}\n\nAssistant: ${assistant}`;
  
  // Create prompt for Claude to generate both summaries
  const prompt = `You are summarizing a conversation turn between a user and an AI assistant. Provide two summaries:

1. A one-sentence summary (max 150 characters)
2. A one-paragraph summary (3-5 sentences)

Format your response as JSON:
{
  "oneLine": "...",
  "paragraph": "..."
}

Conversation turn to summarize:
${fullTurn}`;

  // Wrap the API call in retry logic
  return await retryWithBackoff(async () => {
    // Try multiple model names in order of preference
    const modelsToTry = [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-sonnet-20240620', 
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307'
    ];
    
    let lastError = null;
    
    for (const model of modelsToTry) {
      try {
        console.log(`Trying model: ${model}`);
        
        const requestBody = {
        model: model,
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: prompt
        }]
      };
      
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(requestBody)
      });

      console.log(`Model ${model} response status:`, response.status);

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorData = await response.json();
          
          // Extract error message from various possible structures
          if (errorData.error) {
            if (typeof errorData.error === 'string') {
              errorMessage = errorData.error;
            } else if (errorData.error.message) {
              errorMessage = errorData.error.message;
            } else if (errorData.error.type) {
              errorMessage = `${errorData.error.type}: ${errorData.error.message || 'Unknown error'}`;
            } else {
              errorMessage = JSON.stringify(errorData.error);
            }
          } else if (errorData.message) {
            errorMessage = errorData.message;
          }
          
          // Only log detailed error for non-404 responses (404 is expected during model fallback)
          if (response.status !== 404) {
            console.error(`Model ${model} error response:`, JSON.stringify(errorData, null, 2));
          }
        } catch (e) {
          // Failed to parse JSON error response
          errorMessage = response.statusText || `HTTP ${response.status}`;
        }
        
        // If 404, try next model (this is expected behavior)
        if (response.status === 404) {
          console.log(`Model ${model} not available, trying next model...`);
          lastError = new Error(`Model not found: ${model}`);
          continue;
        }
        
        console.error(`Model ${model} error: ${errorMessage}`);
        
        // If rate limited, throw to trigger retry
        if (response.status === 429) {
          throw new Error(`Rate limit (429): ${errorMessage}`);
        }
        
        // For other errors, throw immediately
        throw new Error(`API Error: ${errorMessage}`);
      }

      // Success! Parse and return
      const data = await response.json();
      console.log(`Successfully used model: ${model}`);
      const content = data.content[0].text;
    
      // Parse the JSON response
      let summaries;
      try {
        // Try to extract JSON from the response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          summaries = JSON.parse(jsonMatch[0]);
        } else {
          // Fallback: parse manually if JSON isn't clean
          throw new Error('No JSON found in response');
        }
      } catch (parseError) {
        // Fallback: use the full content as paragraph and first sentence as one-liner
        const sentences = content.split(/[.!?]+/).filter(s => s.trim());
        summaries = {
          oneLine: sentences[0]?.trim() || content.substring(0, 150),
          paragraph: content.trim()
        };
      }
      
      return {
        turnNumber,
        oneLine: summaries.oneLine,
        paragraph: summaries.paragraph,
        sourceUser: user,
        sourceAssistant: assistant
      };
      
    } catch (error) {
      lastError = error;
      console.error(`Model ${model} failed:`, error);
      // Continue to next model
      continue;
    }
  }
    
  // If we get here, all models failed
  console.error('All models failed. Last error:', lastError);
  throw lastError || new Error('All models failed');
  });
}

async function handleFullExport(exportData) {
  const { turns, chatTitle, conversationUrl, apiKey, notionToken, pageId, exportMode, existingExportData } = exportData;
  const NOTION_BLOCK_LIMIT = 2000;
  
  try {
    // Determine which turns to process
    let turnsToProcess = turns;
    let startIndex = 0;
    
    if (exportMode === 'update' && existingExportData) {
      // Only process new turns
      startIndex = existingExportData.turnCount;
      turnsToProcess = turns.slice(startIndex);
      console.log(`Update mode: Processing ${turnsToProcess.length} new turns (${startIndex + 1} to ${turns.length})`);
      
      if (turnsToProcess.length === 0) {
        throw new Error('No new turns to export');
      }
    }
    
    // Update progress
    await updateProgress('starting', 0, turnsToProcess.length, 'Starting export...');
    
    // Process each turn
    const summaries = [];
    for (let i = 0; i < turnsToProcess.length; i++) {
      const turn = turnsToProcess[i];
      
      await updateProgress('summarizing', i, turnsToProcess.length, `Processing turn ${startIndex + i + 1} of ${turns.length}...`);
      
      try {
        const summary = await handleSummarization(turn, apiKey);
        summaries.push(summary);
      } catch (error) {
        console.error(`Error summarizing turn ${startIndex + i + 1}:`, error);
        summaries.push({
          turnNumber: turn.turnNumber,
          oneLine: `Turn ${turn.turnNumber} (summary failed)`,
          paragraph: 'Summary generation failed for this turn.',
          sourceUser: turn.user,
          sourceAssistant: turn.assistant
        });
      }
      
      // Delay between turns to avoid rate limiting (increased from 300ms)
      if (i < turnsToProcess.length - 1) {
        await sleep(800);
      }
    }
    
    await updateProgress('creating', turnsToProcess.length, turnsToProcess.length, 'Creating Notion blocks...');
    
    let parentBlockId;
    
    // Create or append blocks in Notion
    if (exportMode === 'update' && existingExportData) {
      // Append to existing block
      await appendNotionToggles(summaries, existingExportData.parentBlockId, notionToken, NOTION_BLOCK_LIMIT);
      parentBlockId = existingExportData.parentBlockId;
    } else {
      // Create new master toggle
      parentBlockId = await createNotionToggles(summaries, pageId, notionToken, chatTitle, conversationUrl, NOTION_BLOCK_LIMIT);
    }
    
    // Store/update export history
    await storeExportHistory(conversationUrl, {
      conversationUrl,
      conversationTitle: chatTitle,
      exportedAt: new Date().toISOString(),
      turnCount: turns.length,
      notionPageId: pageId,
      parentBlockId: parentBlockId
    });
    
    // Clear progress and show success notification
    await chrome.storage.local.remove(['exportProgress']);
    
    const message = exportMode === 'update' 
      ? `Successfully added ${turnsToProcess.length} new turns to Notion!`
      : `Successfully exported ${turns.length} turns to Notion!`;
    
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: exportMode === 'update' ? 'Update Complete' : 'Export Complete',
      message: message
    });
    
  } catch (error) {
    console.error('Export error:', error);
    await updateProgress('error', 0, 0, error.message);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: 'Export Failed',
      message: error.message
    });
    throw error;
  }
}

async function updateProgress(status, current, total, message) {
  await chrome.storage.local.set({
    exportProgress: { status, current, total, message }
  });
}

async function storeExportHistory(conversationUrl, exportData) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['exportHistory'], (result) => {
      const history = result.exportHistory || {};
      history[conversationUrl] = exportData;
      chrome.storage.local.set({ exportHistory: history }, () => {
        console.log('Stored export history for:', conversationUrl);
        resolve();
      });
    });
  });
}

async function getExportHistory(conversationUrl) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['exportHistory'], (result) => {
      const history = result.exportHistory || {};
      resolve(history[conversationUrl] || null);
    });
  });
}

async function createNotionToggles(summaries, pageId, notionToken, chatTitle, conversationUrl, NOTION_BLOCK_LIMIT) {
  const timestamp = new Date().toLocaleString();
  
  // Create toggle blocks for each turn (only 2 levels of nesting in initial creation)
  const toggleBlocks = summaries.map(summary => {
    return {
      object: 'block',
      type: 'toggle',
      toggle: {
        rich_text: [{
          type: 'text',
          text: { content: summary.oneLine }
        }],
        children: [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{
                type: 'text',
                text: { content: summary.paragraph }
              }]
            }
          },
          {
            object: 'block',
            type: 'toggle',
            toggle: {
              rich_text: [{
                type: 'text',
                text: { content: 'Source Text' }
              }]
              // Children will be added in a second pass
            }
          }
        ]
      }
    };
  });
  
  // Create master toggle with chat title containing all turns
  const masterToggle = {
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: [{
        type: 'text',
        text: { content: chatTitle || 'Claude Conversation' }
      }],
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: { content: `Exported on ${timestamp} • ${summaries.length} turns • ` }
              },
              {
                type: 'text',
                text: { 
                  content: 'View original',
                  link: { url: conversationUrl }
                }
              }
            ]
          }
        },
        ...toggleBlocks
      ]
    }
  };
  
  // Step 1: Create the master toggle with turns (2 levels of nesting)
  const response1 = await fetch('https://api.notion.com/v1/blocks/' + pageId + '/children', {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${notionToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify({
      children: [masterToggle]
    })
  });
  
  if (!response1.ok) {
    const errorData = await response1.json().catch(() => ({}));
    throw new Error(`Notion API Error: ${errorData.message || response1.statusText}`);
  }
  
  const result1 = await response1.json();
  
  // Step 2: Find all "Source Text" toggle blocks and populate them
  const masterBlockId = result1.results[0].id;
  
  console.log('Created master block with ID:', masterBlockId);
  
  // Get children of master toggle
  const response2 = await fetch(`https://api.notion.com/v1/blocks/${masterBlockId}/children`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${notionToken}`,
      'Notion-Version': '2022-06-28'
    }
  });
  
  if (!response2.ok) {
    let errorMessage = `HTTP ${response2.status}`;
    try {
      const errorData = await response2.json();
      console.error('Notion API error response:', JSON.stringify(errorData, null, 2));
      errorMessage = errorData.message || JSON.stringify(errorData);
    } catch (e) {
      errorMessage = response2.statusText || errorMessage;
    }
    throw new Error(`Notion API Error: ${errorMessage}`);
  }
  
  const masterChildren = await response2.json();
  
  // Process each turn toggle (skip the first child which is the timestamp paragraph)
  for (let i = 1; i < masterChildren.results.length && i <= summaries.length; i++) {
    const turnBlock = masterChildren.results[i];
    const summaryIndex = i - 1;
    const summary = summaries[summaryIndex];
    
    // Get children of this turn toggle
    const response3 = await fetch(`https://api.notion.com/v1/blocks/${turnBlock.id}/children`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28'
      }
    });
    
    if (!response3.ok) continue;
    
    const turnChildren = await response3.json();
    // The "Source Text" toggle should be the second child (index 1)
    const sourceTextToggle = turnChildren.results[1];
    
    if (sourceTextToggle && sourceTextToggle.type === 'toggle') {
      // Chunk source text if needed
      const userChunks = chunkText(summary.sourceUser, NOTION_BLOCK_LIMIT);
      const assistantChunks = chunkText(summary.sourceAssistant, NOTION_BLOCK_LIMIT);
      
      // Build source text children
      const sourceTextChildren = [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: 'User:' },
              annotations: { bold: true }
            }]
          }
        },
        ...userChunks.map(chunk => ({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: chunk }
            }]
          }
        })),
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: 'Assistant:' },
              annotations: { bold: true }
            }]
          }
        },
        ...assistantChunks.map(chunk => ({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: chunk }
            }]
          }
        }))
      ];
      
      // Add children to the source text toggle
      await fetch(`https://api.notion.com/v1/blocks/${sourceTextToggle.id}/children`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
          children: sourceTextChildren
        })
      });
      
      // Small delay to avoid rate limiting
      await sleep(200);
    }
  }
  
  // Return the master block ID for future updates
  return masterBlockId;
}

async function appendNotionToggles(summaries, parentBlockId, notionToken, NOTION_BLOCK_LIMIT) {
  // Create toggle blocks for new turns (only 2 levels of nesting in initial creation)
  const toggleBlocks = summaries.map(summary => {
    return {
      object: 'block',
      type: 'toggle',
      toggle: {
        rich_text: [{
          type: 'text',
          text: { content: summary.oneLine }
        }],
        children: [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{
                type: 'text',
                text: { content: summary.paragraph }
              }]
            }
          },
          {
            object: 'block',
            type: 'toggle',
            toggle: {
              rich_text: [{
                type: 'text',
                text: { content: 'Source Text' }
              }]
              // Children will be added in a second pass
            }
          }
        ]
      }
    };
  });
  
  // Step 1: Append new turn toggles to the parent block
  const response1 = await fetch(`https://api.notion.com/v1/blocks/${parentBlockId}/children`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${notionToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify({
      children: toggleBlocks
    })
  });
  
  if (!response1.ok) {
    const errorData = await response1.json().catch(() => ({}));
    throw new Error(`Notion API Error: ${errorData.message || response1.statusText}`);
  }
  
  const result1 = await response1.json();
  
  // Step 2: Populate "Source Text" toggles
  for (let i = 0; i < result1.results.length; i++) {
    const turnBlock = result1.results[i];
    const summary = summaries[i];
    
    // Get children of this turn toggle
    const response2 = await fetch(`https://api.notion.com/v1/blocks/${turnBlock.id}/children`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28'
      }
    });
    
    if (!response2.ok) continue;
    
    const turnChildren = await response2.json();
    // The "Source Text" toggle should be the second child (index 1)
    const sourceTextToggle = turnChildren.results[1];
    
    if (sourceTextToggle && sourceTextToggle.type === 'toggle') {
      // Chunk source text if needed
      const userChunks = chunkText(summary.sourceUser, NOTION_BLOCK_LIMIT);
      const assistantChunks = chunkText(summary.sourceAssistant, NOTION_BLOCK_LIMIT);
      
      // Build source text children
      const sourceTextChildren = [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: 'User:' },
              annotations: { bold: true }
            }]
          }
        },
        ...userChunks.map(chunk => ({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: chunk }
            }]
          }
        })),
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: 'Assistant:' },
              annotations: { bold: true }
            }]
          }
        },
        ...assistantChunks.map(chunk => ({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: chunk }
            }]
          }
        }))
      ];
      
      // Add children to the source text toggle
      await fetch(`https://api.notion.com/v1/blocks/${sourceTextToggle.id}/children`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
          children: sourceTextChildren
        })
      });
      
      // Small delay to avoid rate limiting
      await sleep(200);
    }
  }
}

function chunkText(text, maxLength) {
  if (text.length <= maxLength) {
    return [text];
  }
  
  const chunks = [];
  let remaining = text;
  
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    
    let breakPoint = maxLength;
    const sentenceBreak = remaining.lastIndexOf('. ', maxLength);
    const paragraphBreak = remaining.lastIndexOf('\n\n', maxLength);
    
    if (paragraphBreak > maxLength * 0.5) {
      breakPoint = paragraphBreak + 2;
    } else if (sentenceBreak > maxLength * 0.5) {
      breakPoint = sentenceBreak + 2;
    }
    
    chunks.push(remaining.substring(0, breakPoint).trim());
    remaining = remaining.substring(breakPoint).trim();
  }
  
  return chunks;
}
