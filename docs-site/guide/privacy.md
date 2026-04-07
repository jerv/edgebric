# Privacy Modes

Edgebric offers three privacy modes that control how your queries and data are handled. All modes keep documents on your local machine — the difference is how much metadata is recorded.

## Standard Mode

The default. Full features, full conversation history.

- Queries are stored in your conversation history
- You can revisit past conversations and continue them
- Aggregate analytics are collected (topic trends, query volume)
- Individual queries are never shared with other users

**Best for:** Day-to-day use, team knowledge bases, ongoing research.

## Private Mode

Anonymous querying. Your identity is not linked to your queries.

- A random anonymous token is used instead of your user ID
- Queries are not stored in conversation history
- Group chats and collaboration still work
- Admins cannot see who asked what

**How to enable:** Toggle Private Mode in the chat interface before asking a question. Each query in Private Mode uses a session-scoped anonymous token.

**Best for:** Sensitive questions you don't want associated with your identity (e.g., HR policy questions, health-related queries).

## Vault Mode

Maximum privacy. Everything stays on-device, encrypted.

- Documents are encrypted with AES-256-GCM
- AI inference runs locally on your machine (no server queries)
- All AI inference stays on-device (queries proxy through the local API server to llama-server on localhost)
- Password or biometric protection to access

**How to enable:** Create a Vault data source. Queries against vault sources automatically use Vault Mode.

**Best for:** Highly sensitive personal documents — medical records, tax returns, legal documents, private notes.

::: tip
You can use all three modes at the same time. Vault sources always use Vault Mode. For other sources, toggle Private Mode on or off per query. Standard is the default when Private Mode is off.
:::

## Comparison

| | Standard | Private | Vault |
|---|---------|---------|-------|
| Documents stored locally | Yes | Yes | Yes (encrypted) |
| Conversation history | Yes | No | No |
| Identity linked to queries | Yes | No | No |
| Works with group chats | Yes | Yes | No |
| Network queries to server | Yes | Yes | No |
| AI runs on | Server | Server | Your device |

## Admin Controls

Admins can enable or disable Private Mode and Vault Mode for the organization in **Admin** > **Settings** > **Integrations**:

- **Private Mode enabled** — Members can toggle Private Mode
- **Vault Mode enabled** — Members can create Vault data sources

When disabled, the corresponding toggle or option is hidden from the interface.
