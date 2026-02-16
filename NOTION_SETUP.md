# Notion Integration Setup Guide

This guide will walk you through setting up the Notion integration so the extension can create toggle blocks directly in your Notion workspace.

## Step 1: Create a Notion Integration (2 minutes)

1. Go to https://www.notion.so/my-integrations
2. Click **"+ New integration"**
3. Fill in the details:
   - **Name**: "Claude Exporter" (or whatever you prefer)
   - **Associated workspace**: Select your workspace
   - **Type**: Internal integration
4. Click **"Submit"**
5. **Copy the "Internal Integration Token"** (starts with `secret_...`)
   - ⚠️ Keep this secret! Don't share it publicly

## Step 2: Share a Page with Your Integration (1 minute)

The integration needs permission to access the page where you want to create toggle blocks.

1. Open the Notion page where you want exports to go
2. Click the **"••• Share"** button (top right)
3. Click **"Invite"**
4. Search for your integration name ("Claude Exporter")
5. Click **"Invite"**
6. **Copy the page URL** from your browser address bar

Your page URL will look like:
```
https://www.notion.so/My-Page-Name-123abc456def...
```

## Step 3: Configure the Extension (30 seconds)

1. Open the extension popup
2. Paste your **Integration Token** in the "Notion Integration Token" field
3. Paste your **Page URL** in the "Notion Page URL" field
4. The extension will save these automatically

## You're Done! 🎉

Now when you click "Export Conversation", the extension will:
1. Extract the conversation from Claude.ai
2. Summarize each turn using Claude API
3. Create actual toggle blocks in your Notion page

## Troubleshooting

### "Notion API Error: object not found"
- Make sure you **shared the page** with your integration (Step 2)
- Check that the page URL is correct

### "Notion API Error: unauthorized"
- Double-check your integration token
- Make sure you copied the entire token (it's very long!)

### "Invalid Notion page URL"
- URL should look like: `https://notion.so/Page-Name-123abc...`
- Make sure you're using the actual page URL, not a database or workspace URL

### "Integration not showing up when sharing"
- Refresh the Notion page
- Try creating the integration again
- Make sure you selected the correct workspace

## Important Notes

### Page Selection
- You can use any page in your workspace
- The toggles will be **appended to the bottom** of the page
- Consider creating a dedicated "Claude Exports" page

### Permissions
- The integration can only access pages you explicitly share with it
- It can only create/read/update blocks, not delete them
- Your data stays in your workspace

### Multiple Exports
- Each export creates a new set of toggles on the same page
- Each export is timestamped with a header
- Consider creating separate pages for different conversation topics

## Example Notion Structure

After a successful export, your page will look like:

```
# Claude Conversation Export
Exported on 2/16/2026, 3:45 PM • 12 turns
---

▸ User asks about Chrome extension development
  Discussion about building a Claude conversation exporter...
  
  ▸ Source Text
    User: How do I build a Chrome extension?
    Assistant: Here's how to build a Chrome extension...

▸ Planning the extension architecture
  Breakdown of manifest.json, content scripts...
  
  ▸ Source Text
    User: What files do I need?
    Assistant: You'll need these key files...
```

## Privacy & Security

- Your integration token is stored locally in Chrome
- Only you have access to your integration
- The extension only sends data to:
  - Anthropic API (for summaries)
  - Notion API (to create blocks)
- No third-party services involved

## Costs

- **Notion**: Free (integrations are available on all plans)
- **Claude API**: ~$0.08 per 50-turn conversation
- No additional fees

---

Need help? Check the main README.md for more information.
