# Quick Setup Guide

## 10-Minute Installation

### Step 1: Get Your Anthropic API Key (2 minutes)

1. Go to https://console.anthropic.com/
2. Sign in or create account
3. Click "API Keys" in sidebar
4. Click "Create Key"
5. Copy the key (starts with `sk-ant-api03-...`)

### Step 2: Set Up Notion Integration (3 minutes)

**See [NOTION_SETUP.md](NOTION_SETUP.md) for detailed instructions.**

Quick version:
1. Go to https://www.notion.so/my-integrations
2. Click "+ New integration"
3. Name it "Claude Exporter"
4. Copy the integration token (starts with `secret_...`)
5. Open a Notion page where you want exports
6. Click "Share" → Invite your integration
7. Copy the page URL from your browser

### Step 3: Install Extension (1 minute)

1. Open Chrome
2. Go to `chrome://extensions/`
3. Toggle "Developer mode" ON (top right corner)
4. Click "Load unpacked" button
5. Select the `claude-notion-exporter` folder
6. Extension icon appears in toolbar!

### Step 4: Configure Extension (1 minute)

1. Click the extension icon
2. Paste your Anthropic API key
3. Paste your Notion integration token
4. Paste your Notion page URL
5. All fields show green dots when saved

### Step 5: First Export (2 minutes)

1. Open any Claude.ai conversation
2. Click the extension icon (blue square with "C→N")
3. Click "Export Conversation"
4. Wait for processing (shows progress)
5. Open your Notion page - toggles are there!

---

## What You'll Get

Each conversation turn becomes a toggle in Notion:

```
▸ One-line summary (click to expand)
  Paragraph summary explaining what happened
  
  ▸ Source Text (nested toggle)
    User: original message
    Assistant: original response
```

These are **actual Notion toggle blocks** - not markdown headers!

---

## Cost

- **Claude Sonnet 4**: $3 per million tokens
- **Typical conversation** (50 turns): ~$0.08
- **Your first $5 credit** from Anthropic covers ~60 conversations

---

## Tips

✅ **DO**:
- Export after major conversations
- Use on specific topic threads
- Keep conversations under 100 turns for speed

❌ **DON'T**:
- Export every single message (gets expensive)
- Share your API key
- Run on pages that aren't claude.ai

---

## Troubleshooting

**Can't find extension icon?**
→ Click the puzzle piece 🧩 in Chrome toolbar, pin the extension

**API key not working?**
→ Make sure you copied the entire key (very long!)
→ Check you have credits at console.anthropic.com

**No conversation found?**
→ Scroll through the full conversation first
→ Refresh the claude.ai page

**Import to Notion not working?**
→ Make sure file ends in `.md`
→ Drag directly onto Notion page (don't use import menu)

---

## Next Steps

Once you've done your first export:

1. Try organizing multiple conversations in Notion databases
2. Create a template page for conversation exports
3. Add tags and properties to track topics
4. Use Notion's search to find insights across conversations

Enjoy your organized Claude knowledge base! 🚀
