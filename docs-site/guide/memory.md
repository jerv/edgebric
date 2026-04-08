# Agent Memory

Edgebric's AI remembers your preferences, facts, and instructions across conversations. Memories persist between sessions so you don't have to repeat yourself.

## How It Works

When you tell the AI something about yourself or your preferences, it can save that as a memory. In future conversations, relevant memories are automatically included as context so the AI tailors its responses to you.

**Examples of things the AI remembers:**

- Preferences: "I prefer concise answers" or "Always include code examples"
- Facts: "I work in the legal department" or "I'm using Edgebric for medical records"
- Corrections: "No, I meant the 2026 version, not 2025"

The AI detects these patterns automatically and saves them without you having to ask. You can also explicitly ask: "Remember that I prefer bullet points over paragraphs."

## Memory as a Data Source

Memories are stored as a special **Memory** data source visible in your Library. Each memory is a document entry you can:

- **View** — See all saved memories in the Library
- **Edit** — Update a memory's content
- **Delete** — Remove memories you no longer want

This gives you full control over what the AI knows about you.

## Memory in Queries

When you ask a question, Edgebric injects the top 3-5 most relevant memories into the query context (capped at ~200 tokens). This keeps memory lightweight and doesn't crowd out document context.

The AI has three memory tools it can use during conversations:

| Tool | What it does |
|------|-------------|
| `save_memory` | Saves a new memory |
| `list_memories` | Lists your current memories |
| `delete_memory` | Deletes a specific memory |

These appear in the Tool Use panel when the AI calls them.

## Organization vs. Solo Mode

- **Org mode**: Memories are per-user. Each user has their own Memory data source. Other users cannot see your memories.
- **Solo mode**: Memories are global (there's only one user).

## Settings

Memory is enabled by default. To disable it:

1. Go to **Settings**
2. Toggle **Memory** off

When disabled, the AI won't save new memories or include existing ones in queries. Your saved memories are not deleted — they're still in the Library if you re-enable the feature.

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/memory` | List all memories |
| `POST` | `/api/memory` | Create a memory |
| `PUT` | `/api/memory/:id` | Update a memory |
| `DELETE` | `/api/memory/:id` | Delete a memory |
| `PATCH` | `/api/memory/toggle` | Enable/disable memory |
