# Privacy Modes

Edgebric keeps all documents on your local machine. Two privacy modes are available: **Private Mode** (conversations are not stored and query text is not logged) and **Vault Mode** (on-device encryption with client-side search). When neither mode is enabled, Edgebric operates in its default configuration with full features and conversation history.

## Default Behavior

Full features, full conversation history.

- Queries are stored in your conversation history
- You can revisit past conversations and continue them
- Individual queries are never shared with other users

**Best for:** Day-to-day use, team knowledge bases, ongoing research.

## Private Mode

Your queries are not stored in conversation history and query text is not logged. The system records that a query occurred for rate limiting purposes.

- Queries are not stored in conversation history
- Group chats and collaboration still work

**How to enable:** Toggle Private Mode in the chat interface before asking a question.

**Best for:** Sensitive questions you don't want stored in your conversation history (e.g., HR policy questions, health-related queries).

## Vault Mode

On-device encryption with client-side search.

- Document text is encrypted at rest with AES-256-GCM. Embedding vectors (numerical representations used for search) are stored unencrypted to enable similarity search.
- Vault queries are processed locally — search happens in the browser. The query text is sent to the local AI engine for embedding and inference, but no data leaves your machine or reaches external servers.
- Vault encryption keys are generated in the browser and never sent to the server. The key is stored in the browser's local storage. Note: the key is not password-protected in the current version.

**How to enable:** Create a Vault data source. Queries against vault sources automatically use Vault Mode.

**Best for:** Highly sensitive personal documents — medical records, tax returns, legal documents, private notes.

::: tip
You can use both modes at the same time. Vault sources always use Vault Mode. For other sources, toggle Private Mode on or off per query.
:::

## Comparison

| | Default | Private | Vault |
|---|---------|---------|-------|
| Documents stored locally | Yes | Yes | Yes (encrypted) |
| Conversation history | Yes | No | No |
| Query text logged | Yes | No | No |
| Works with group chats | Yes | Yes | No |
| Network queries to server | Yes | Yes | No |
| AI runs on | Server | Server | Your device |

## Admin Controls

Admins can enable or disable Private Mode and Vault Mode for the organization in **Admin** > **Settings** > **Integrations**:

- **Private Mode enabled** — Members can toggle Private Mode
- **Vault Mode enabled** — Members can create Vault data sources

When disabled, the corresponding toggle or option is hidden from the interface.
