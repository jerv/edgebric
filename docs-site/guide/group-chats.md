# Group Chats

Group chats let you collaborate with your team around shared knowledge. Share data sources, tag the bot to query documents, and branch into threads for focused discussion.

## Creating a Group Chat

1. Click **New Group Chat** in the sidebar
2. Give it a name (e.g., "Q4 Planning" or "Legal Review")
3. Set an expiration:
   - **24 hours** — Short-lived discussion
   - **1 week** — Sprint or project discussion
   - **1 month** — Ongoing topic
   - **Never** — Permanent channel

When a chat expires, all shared data source access is automatically revoked.

## Inviting Members

The chat creator can invite members from the organization:

1. Open the group chat
2. Click **Invite Member**
3. Search by name or email
4. Select the person to invite

Members receive an in-app notification when invited.

## Sharing Data Sources

Any member can share data sources into the chat, making them queryable by everyone in the conversation:

1. Click **Share Source** in the chat
2. Select a data source you have access to
3. A confirmation dialog shows exactly what will become accessible
4. Optionally set an expiration for the share
5. Confirm

::: warning
When you share a data source, everyone in the chat can query it via the bot. Only share sources you're comfortable making accessible to all members.
:::

To unshare a source, the person who shared it (or the chat creator) can remove it.

## Querying with @bot

To ask the AI a question in a group chat, tag it:

> **@bot** What does our refund policy say about digital products?

The bot searches all data sources shared into the chat and responds with a cited answer.

**Important:** The bot only responds when tagged. Human conversation flows freely without bot intervention — the bot won't interrupt your discussion.

## Threads

Branch off any message into a thread for focused discussion:

1. Hover over a message
2. Click **Reply in Thread**
3. The thread opens in a side panel

Threads work like channels within the chat. You can tag @bot in threads too — the bot reads the thread context to give relevant answers.

## Real-Time Updates

Group chats update in real-time:

- New messages appear instantly
- See when members join or leave
- Get notified when data sources are shared
- Bot thinking indicators show when a query is being processed

## Notifications

You can set notification preferences per group chat:

| Level | What you get notified about |
|-------|----------------------------|
| **All** | Every message |
| **Mentions** | Only when you're @mentioned |
| **None** | Muted — check manually |

## Managing the Chat

The chat creator can:

- Rename the chat
- Change the expiration
- Remove members
- Archive the chat

Any member can:

- Leave the chat
- Share or unshare their own data sources
- Mute notifications
