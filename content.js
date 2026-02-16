// Content script for extracting Claude conversation turns
// This runs on claude.ai pages

(function() {
  'use strict';

  // Function to extract conversation title
  function extractTitle() {
    // Try the chat title button first (current Claude UI structure)
    const chatTitleButton = document.querySelector('[data-testid="chat-title-button"]');
    if (chatTitleButton) {
      const titleDiv = chatTitleButton.querySelector('.truncate, .font-base-bold');
      if (titleDiv && titleDiv.textContent.trim()) {
        return titleDiv.textContent.trim();
      }
    }
    
    // Common UI labels to skip
    const skipLabels = ['starred', 'new chat', 'pin', 'delete', 'rename'];
    
    // Try multiple selectors for the conversation title
    const titleSelectors = [
      '[data-testid="chat-title"]',
      '[data-testid="conversation-title"]',
      'h1',
      '.text-text-500',
      'header h1',
      'main h1'
    ];
    
    for (const selector of titleSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        const text = element.textContent.trim();
        // Skip if it's a common UI label or empty
        if (text && !skipLabels.some(label => text.toLowerCase() === label)) {
          return text;
        }
      }
    }
    
    // Fallback to page title or default
    return document.title.replace(' - Claude', '').trim() || 'Claude Conversation';
  }

  // Function to extract all conversation turns
  function extractConversation() {
    const turns = [];
    
    // Find all message containers in the conversation
    // Claude.ai structure: look for user and assistant message blocks
    const messages = document.querySelectorAll('[data-test-render-count]');
    
    if (messages.length === 0) {
      // Fallback: try alternative selectors
      const allMessages = document.querySelectorAll('.font-user-message, .font-claude-message');
      
      allMessages.forEach((msg, index) => {
        const isUser = msg.classList.contains('font-user-message') || 
                       msg.closest('[data-is-user-message="true"]') !== null;
        
        const text = msg.innerText || msg.textContent || '';
        
        if (text.trim()) {
          turns.push({
            role: isUser ? 'user' : 'assistant',
            content: text.trim(),
            index: index
          });
        }
      });
    } else {
      // Primary method: extract from data attributes
      messages.forEach((msg, index) => {
        // Determine if this is a user or assistant message
        const isUser = msg.querySelector('[data-testid="user-message"]') !== null ||
                       msg.closest('[data-is-user-message="true"]') !== null;
        
        // Get the text content
        const text = msg.innerText || msg.textContent || '';
        
        if (text.trim()) {
          turns.push({
            role: isUser ? 'user' : 'assistant',
            content: text.trim(),
            index: index
          });
        }
      });
    }
    
    return turns;
  }

  // Function to group turns into user-assistant pairs
  function groupTurns(turns) {
    const pairs = [];
    let currentPair = { user: '', assistant: '', turnNumber: 0 };
    let turnNumber = 1;
    
    turns.forEach(turn => {
      if (turn.role === 'user') {
        // If we have a previous pair with content, save it
        if (currentPair.user || currentPair.assistant) {
          pairs.push({ ...currentPair });
        }
        // Start new pair
        currentPair = {
          user: turn.content,
          assistant: '',
          turnNumber: turnNumber++
        };
      } else if (turn.role === 'assistant') {
        currentPair.assistant = turn.content;
      }
    });
    
    // Add the last pair if it has content
    if (currentPair.user || currentPair.assistant) {
      pairs.push(currentPair);
    }
    
    return pairs;
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractConversation') {
      try {
        const turns = extractConversation();
        const pairs = groupTurns(turns);
        const title = extractTitle();
        
        sendResponse({
          success: true,
          data: pairs,
          count: pairs.length,
          title: title
        });
      } catch (error) {
        sendResponse({
          success: false,
          error: error.message
        });
      }
      return true; // Keep channel open for async response
    }
  });
})();
