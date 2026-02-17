# SPIKE: Incremental Conversation Updates

## Problem Statement

Currently, the extension re-exports entire conversations each time, even if they've been exported before. This leads to:
- Duplicate content in Notion
- Wasted API calls to Anthropic for already-summarized turns
- Poor UX when users just want to add new turns to an existing conversation
- No way to know if a conversation has already been exported

## Goal

Enable the extension to:
1. Track which conversations have been exported to which Notion pages
2. Detect when a conversation has new turns since last export
3. Offer "Update" functionality to append only new turns
4. Cache conversation data to avoid redundant extraction and API calls

## Technical Investigation

### Notion API Capabilities

**Block IDs:**
- Every block created in Notion returns a unique `block_id` in the API response
- We can store the parent toggle block ID for each conversation export
- Notion API supports appending children to existing blocks via `PATCH /v1/blocks/{block_id}/children`

**Metadata Storage Options:**
1. **Chrome Storage** (Recommended)
   - Store conversation metadata locally
   - Fast lookups without API calls
   - Schema: `{ [conversationUrl]: { exportedAt, turnCount, parentBlockId, pageId, pageTitle } }`

2. **Notion Page Properties** (Alternative)
   - Could add a database of exported conversations
   - More complex, requires additional API calls
   - Better for multi-device sync but overkill for this use case

### Conversation Identification

**Current State:**
- Conversation URL is available: `https://claude.ai/chat/{conversationId}`
- URL uniquely identifies each conversation
- Can be used as the key for tracking

**Turn Tracking:**
- Each conversation has a sequential number of turns
- We can compare current turn count vs. stored turn count
- Delta = new turns to export

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User Opens Popup on Claude Conversation                  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Extract Conversation URL                                 │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Check chrome.storage for Export History                  │
│    Key: conversationUrl                                      │
└─────────────────────────────────────────────────────────────┘
                          ↓
                    ┌─────┴─────┐
                    │           │
              NOT FOUND      FOUND
                    │           │
                    ↓           ↓
        ┌──────────────┐  ┌──────────────────┐
        │ Show:        │  │ Extract current  │
        │ "Export      │  │ turn count       │
        │ Conversation"│  └──────────────────┘
        └──────────────┘          ↓
                              ┌───┴────┐
                              │        │
                         SAME COUNT  NEW TURNS
                              │        │
                              ↓        ↓
                    ┌──────────────┐ ┌────────────────┐
                    │ Show:        │ │ Show:          │
                    │ "Up to date" │ │ "Update (+X)"  │
                    │ OR           │ │ OR             │
                    │ "Re-export"  │ │ "Re-export"    │
                    └──────────────┘ └────────────────┘
```

## Proposed Implementation

### Phase 1: Export Tracking

**Storage Schema:**
```javascript
// chrome.storage.local
{
  exportHistory: {
    "https://claude.ai/chat/abc-123": {
      conversationUrl: "https://claude.ai/chat/abc-123",
      conversationTitle: "Quick question",
      exportedAt: "2026-02-17T10:30:00Z",
      turnCount: 5,
      notionPageId: "abc123...",
      notionPageTitle: "Twitter Monitor",
      parentBlockId: "def456...", // The main toggle block containing this export
      lastSummaries: [...] // Optional: cache for short period
    }
  }
}
```

**Changes Required:**

1. **background.js - After successful export:**
   ```javascript
   // Store export metadata
   await chrome.storage.local.get(['exportHistory'], (result) => {
     const history = result.exportHistory || {};
     history[conversationUrl] = {
       conversationUrl,
       conversationTitle: chatTitle,
       exportedAt: new Date().toISOString(),
       turnCount: turns.length,
       notionPageId: pageId,
       notionPageTitle: selectedPageTitle,
       parentBlockId: createdBlockId // Need to capture this
     };
     chrome.storage.local.set({ exportHistory: history });
   });
   ```

2. **background.js - Capture parent block ID:**
   ```javascript
   // In createNotionToggles(), capture the returned block ID
   const response = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
     method: 'PATCH',
     // ...
   });
   const data = await response.json();
   return data.results[0].id; // Return the parent block ID
   ```

3. **popup.js - Check export history on load:**
   ```javascript
   // After getting conversationUrl from active tab
   chrome.storage.local.get(['exportHistory'], (result) => {
     const history = result.exportHistory || {};
     const exportRecord = history[conversationUrl];
     
     if (exportRecord) {
       // Show export status and update option
       showExportStatus(exportRecord);
     }
   });
   ```

### Phase 2: Incremental Updates

**UI Changes:**

1. **Status Display:**
   ```
   ┌─────────────────────────────────────────┐
   │ Notion Page                             │
   │ ✓ Twitter Monitor                       │
   │                                         │
   │ Export Status                           │
   │ Last exported: 2 hours ago (5 turns)   │
   │ Current: 8 turns (+3 new)              │
   └─────────────────────────────────────────┘
   ```

2. **Action Buttons:**
   - **If no new turns:** "Up to date ✓" (disabled) + "Re-export" (secondary)
   - **If new turns:** "Update (+3 new)" (primary) + "Re-export" (secondary)
   - **If never exported:** "Export Conversation" (primary)

**Export Logic Changes:**

```javascript
async function handleExport(mode) {
  // mode: 'full' | 'update'
  
  if (mode === 'update') {
    // 1. Extract current conversation
    const allTurns = await extractConversation();
    
    // 2. Get export history
    const exportRecord = await getExportRecord(conversationUrl);
    
    // 3. Slice to get only new turns
    const newTurns = allTurns.slice(exportRecord.turnCount);
    
    // 4. Process only new turns
    const newSummaries = await summarizeTurns(newTurns);
    
    // 5. Append to existing Notion block
    await appendToNotionBlock(
      exportRecord.parentBlockId,
      newSummaries
    );
    
    // 6. Update export history
    await updateExportRecord(conversationUrl, {
      turnCount: allTurns.length,
      exportedAt: new Date().toISOString()
    });
  } else {
    // Full export (existing logic)
  }
}
```

### Phase 3: Smart Caching (Optional)

**Cache Strategy:**
- Store conversation extractions for 10 minutes
- Store summaries for 24 hours (cleared on browser restart)
- Avoid re-summarizing if same turn content is detected

**Cache Schema:**
```javascript
{
  conversationCache: {
    "https://claude.ai/chat/abc-123": {
      extractedAt: "2026-02-17T10:30:00Z",
      turns: [...],
      summaries: [...],
      expiresAt: "2026-02-17T10:40:00Z"
    }
  }
}
```

## UI Mockup Changes

### Popup - Previously Exported Conversation

```
┌─────────────────────────────────────────────┐
│ Claude → Notion                          ⚙️ │
│ Export conversations                        │
├─────────────────────────────────────────────┤
│ Notion Page                                 │
│ ┌─────────────────────────────────────────┐ │
│ │ Search for a page...                    │ │
│ └─────────────────────────────────────────┘ │
│ ✓ Twitter Monitor                           │
├─────────────────────────────────────────────┤
│ Export Status                               │
│ ✓ Previously exported                       │
│ 📅 2 hours ago                             │
│ 📊 5 turns → 8 turns (+3 new)              │
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ │
│ │      Update Conversation (+3)           │ │
│ └─────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────┐ │
│ │      Re-export from Scratch             │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### Popup - Up to Date

```
┌─────────────────────────────────────────────┐
│ Export Status                               │
│ ✓ Up to date                                │
│ 📅 2 hours ago                             │
│ 📊 8 turns                                  │
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ │
│ │      ✓ Up to date                       │ │
│ └─────────────────────────────────────────┘ │
│           (button disabled, green)          │
│                                             │
│          Re-export from Scratch             │
│         (link style, secondary)             │
└─────────────────────────────────────────────┘
```

## Benefits

1. **Cost Savings:**
   - Avoid re-processing turns that were already summarized
   - Reduce Anthropic API calls by 80-90% for repeat exports

2. **Better UX:**
   - Visual feedback on export status
   - Clear indication of new content
   - Faster updates (only process delta)

3. **Organization:**
   - One continuous conversation in Notion vs. multiple duplicates
   - Chronological order maintained
   - Easy to track conversation growth

## Potential Issues & Solutions

### Issue 1: User Edits Notion Content

**Problem:** If user manually edits/deletes turns in Notion, our count will be wrong

**Solution:**
- Don't validate against Notion content
- Trust our local record
- Provide "Re-export" option to start fresh if needed

### Issue 2: Conversation URL Changes

**Problem:** Claude might change conversation URLs on renames

**Solution:**
- Primary key remains the URL from browser tab
- On URL mismatch, treat as new conversation
- Could optionally match by conversation title as fallback

### Issue 3: Multiple Exports to Different Pages

**Problem:** User exports same conversation to multiple Notion pages

**Solution:**
```javascript
// Change storage schema to support multiple exports
{
  exportHistory: {
    "https://claude.ai/chat/abc-123": [
      { notionPageId: "page1", parentBlockId: "...", turnCount: 5 },
      { notionPageId: "page2", parentBlockId: "...", turnCount: 5 }
    ]
  }
}

// On popup load, if multiple exports exist, let user choose which to update
```

### Issue 4: Storage Limits

**Problem:** chrome.storage.local has limits (5-10MB typical)

**Solution:**
- Store only metadata, not full conversation/summary content
- Periodically clean up old export records (>30 days)
- Estimated: 1KB per export record = 5000+ conversations before limit

## Implementation Phases

### Phase 1 (MVP): Export Tracking
- Track export history in chrome.storage
- Show "Previously exported" status
- Estimate: 4 hours

### Phase 2: Incremental Updates
- Implement update vs. re-export logic
- Add Notion block append functionality
- Update UI with dual buttons
- Estimate: 6 hours

### Phase 3: Polish & Edge Cases
- Handle multiple exports per conversation
- Add export history management (clear, view all)
- Smart caching
- Estimate: 4 hours

**Total Estimate: 14 hours**

## Decision Points

1. **Should we support multiple exports of same conversation?**
   - YES: More flexible, users might want conversation in different pages
   - Complexity: Need to track multiple Notion destinations per conversation

2. **How long to cache conversation data?**
   - Recommendation: 10 minutes for extraction, 24 hours for summaries
   - Balances performance vs. storage usage

3. **Should we validate Notion content before appending?**
   - NO: Trust local record, don't add API roundtrips
   - Provide "Re-export" as escape hatch

4. **Auto-update or manual?**
   - Manual: Safer, user controls when to update
   - Could add setting for "auto-update on new turns detected"

## Success Metrics

- **90% reduction** in duplicate exports
- **80% reduction** in API costs for conversations with updates
- **50% faster** export time for updates vs. full re-export
- **User satisfaction:** Clear status indication, no confusion about export state

## Next Steps

1. Review spike with team/user
2. Decide on Phase 1 vs. full implementation
3. Create implementation tickets
4. Update README with new functionality
5. Consider adding settings page section for export history management
