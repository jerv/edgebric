# Telegram Integration

Interact with Edgebric through Telegram — ask questions, upload documents, and manage data sources from your phone.

::: info Conditional Feature
The Telegram section only appears in **Connected Accounts** when an admin has enabled Telegram in **Admin** > **Settings** > **Integrations**. If you don't see it, ask your admin to enable the integration first.
:::

::: warning Privacy Notice
Messages sent via Telegram transit Telegram's servers. For fully private operation, use the Edgebric web app directly. Vault mode sources are automatically excluded from Telegram queries.
:::

## Setup

### 1. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts to name your bot
3. BotFather gives you a **bot token** — copy it

### 2. Configure Edgebric

1. Set the `TELEGRAM_BOT_TOKEN` environment variable in your `.env` file, or enter it in **Admin** > **Settings** > **Integrations** > **Telegram**
2. Toggle **Telegram** to enabled
3. Click **Register Webhook** to connect your bot to Edgebric

Your Edgebric server must be reachable from the internet for Telegram's webhook to work. If you're running locally behind a firewall, you'll need a tunnel (e.g., ngrok or Cloudflare Tunnel).

### 3. Link Your Account

In **org mode**, users need to link their Telegram account to their Edgebric account:

1. In the Edgebric web UI, go to **Settings** > **Telegram** and click **Link Account**
2. A 6-digit code is displayed
3. Open your Telegram bot and send `/link 123456` (replacing with your code)
4. Your accounts are now linked

In **solo mode**, no linking is needed — the bot works immediately.

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Introduction and privacy disclaimer |
| `/ask <question>` | Ask a question against your documents |
| `/sources` | List your data sources |
| `/status` | Check Edgebric server status |
| `/help` | Show available commands |
| `/link <code>` | Link your Telegram account (org mode) |

You can also send a message without a command prefix — the bot treats it as a question.

## Uploading Documents

Send a document file (PDF, DOCX, TXT, MD) directly to the bot. It will prompt you to choose a data source, then upload and process the document.

## Privacy Considerations

- **Vault sources are excluded** — Queries via Telegram never search vault data sources, since messages transit external servers
- **Private mode** is respected — If you have private mode enabled, Telegram queries follow the same rules
- **Account unlinking** — Users can unlink their Telegram account at any time from **Settings** > **Telegram**

## Admin Settings

Admins control the Telegram integration from **Admin** > **Settings** > **Integrations**:

| Setting | Description |
|---------|-------------|
| **Enabled** | Turn the Telegram bot on/off |
| **Bot Token** | The token from BotFather |
| **Register Webhook** | Connect the bot to your Edgebric server |
