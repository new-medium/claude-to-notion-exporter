# Claude to Notion Exporter

A Chrome extension that exports Claude.ai conversations with AI-powered summaries, creating actual toggle blocks directly in Notion via the Notion API.

## Features

- **Three-tier summaries** for each conversation turn:
  - One-sentence summary (main toggle header)
  - One-paragraph summary (visible content)
  - Full source text (nested toggle)

- **Direct Notion Integration**:
  - Creates actual toggle blocks (not markdown)
  - Appends to any Notion page you specify
  - Automatic text chunking (respects Notion's 2000-char block limit)
  - Nested toggles for source text

- **AI-powered**: Uses Claude API (Sonnet 4) to generate high-quality summaries

## Installation

### 1. Get API Keys

**Anthropic API Key:**
1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Create an account or sign in
3. Generate an API key
4. Cost: ~$0.08 per 50-turn conversation

**Notion Integration Token:**
1. Follow the detailed guide in [NOTION_SETUP.md](NOTION_SETUP.md)
2. Takes ~3 minutes total
3. Free on all Notion plans

### 2. Install Extension

1. Download and extract this folder
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the `claude-notion-exporter` folder

### 3. Configure

1. Click the extension icon
2. Enter your Anthropic API key
3. Enter your Notion integration token
4. Enter the URL of your Notion page
5. All credentials are saved locally in your browser

## Usage

1. **Open a Claude.ai conversation** you want to export
2. **Click the extension icon**
3. **Verify your settings** (keys and page URL)
4. **Click "Export Conversation"**:
   - Extension extracts all turns
   - Sends each to Claude API for summarization
   - Creates toggle blocks in your Notion page
   - Shows progress in real-time
5. **Open your Notion page** to see the toggles!

## Notion Output Structure

Each conversation creates:

```
# Claude Conversation Export
Exported on [timestamp] • X turns
---

▸ One-line summary of turn 1
  Paragraph summary of what happened.
  
  ▸ Source Text
    User: original message
    Assistant: original response

▸ One-line summary of turn 2
  ...
```

All blocks are **actual Notion toggles** - click to expand/collapse.

## File Structure

```
claude-notion-exporter/
├── manifest.json          # Extension configuration
├── popup.html            # UI interface
├── popup.js              # Main export logic
├── content.js            # Extracts conversation from Claude.ai
├── background.js         # Handles API calls to Anthropic
├── icon16.png            # Extension icons
├── icon48.png
├── icon128.png
└── README.md
```

## How It Works

1. **Content Script** (`content.js`):
   - Runs on claude.ai pages
   - Extracts conversation messages from DOM
   - Groups into user-assistant pairs

2. **Background Worker** (`background.js`):
   - Receives conversation turns
   - Calls Anthropic API for each turn
   - Returns both one-line and paragraph summaries

3. **Popup Interface** (`popup.js`):
   - Orchestrates the export process
   - Shows progress to user
   - Chunks text for Notion's limits
   - Generates final markdown file

## Cost Estimate

Using Claude Sonnet 4:
- ~500 tokens per turn (input + output)
- $3 per million input tokens
- **~$0.08 for a 50-turn conversation**

## Troubleshooting

**"No conversation found"**:
- Make sure you're on a claude.ai chat page
- Scroll through the conversation to ensure all messages are loaded
- Refresh the page and try again

**"API Error" (Anthropic)**:
- Check that your API key is valid
- Ensure you have API credits in your Anthropic account
- Check browser console for detailed error messages

**"Notion API Error: object not found"**:
- Make sure you shared the Notion page with your integration
- See [NOTION_SETUP.md](NOTION_SETUP.md) for detailed instructions

**"Notion API Error: unauthorized"**:
- Double-check your Notion integration token
- Make sure you copied the entire token

**"Invalid Notion page URL"**:
- URL should look like: `https://notion.so/Page-Name-123abc...`
- Make sure you're using a page URL, not a database URL

**Summaries not generating**:
- Check your internet connection
- Verify API key has proper permissions
- Try reducing the conversation to fewer turns

## Privacy & Security

- API key stored locally in Chrome storage
- No data sent to any server except Anthropic API
- Conversation content never stored by the extension
- All processing happens client-side

## Development

To modify the extension:

1. Make your changes to the source files
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Test on a claude.ai conversation

## License

MIT License - feel free to modify and distribute

## Credits

Built for efficient knowledge management between Claude conversations and Notion workspaces.
