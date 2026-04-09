# Agent Memory

Edgebric's AI remembers your preferences, facts, and instructions across conversations. Memories persist between sessions so you don't have to repeat yourself.

## How It Works

Memory in Edgebric is not a separate system — it uses the same data source infrastructure as everything else. When the AI learns something about you, it stores that information as an entry in a personal data source called **Memory**, visible in your Library alongside your other sources.

Because memory is just a data source, it benefits from the same hybrid search (vector + BM25), the same citation system, and the same access controls as all your other documents. When you ask a question, relevant memories are retrieved through the standard RAG pipeline and included as context — no special injection logic.

**Examples of things the AI remembers:**

- Preferences: "I prefer concise answers" or "Always include code examples"
- Facts: "I work in the legal department" or "I'm using Edgebric for medical records"
- Corrections: "No, I meant the 2026 version, not 2025"

The AI detects these patterns automatically and saves them without you having to ask. You can also explicitly ask: "Remember that I prefer bullet points over paragraphs."

## Managing Memory

Since memory is a data source, you manage it the same way you manage any other source in your Library:

- **View** — Open the Memory source in the Library to see all saved entries
- **Edit** — Update an entry's content directly
- **Delete** — Remove entries you no longer want

You can also manage memory from the chat. The AI uses standard data source tools to create, update, list, and delete memory entries:

| Tool | What it does |
|------|-------------|
| `create_data_source` | Saves a new memory entry |
| `update_data_source` | Updates an existing memory entry |
| `list_data_sources` | Lists your current memory entries |
| `delete_data_source` | Deletes a specific memory entry |

These are the same tools used for all data source operations — memory entries are just documents in the Memory source. Tool calls appear in the Tool Use panel when the AI uses them.

## Memory in Queries

When you ask a question, memories are retrieved through the same RAG pipeline as all other data sources. The Memory source is searched alongside your other sources, and relevant memories appear as normal citations in the response. There is no separate memory retrieval step or special token budget — memory competes for relevance on equal footing with your documents.

## Organization vs. Solo Mode

- **Org mode**: Each user has their own Memory data source. Other users cannot see your memories.
- **Solo mode**: There is one Memory source (there's only one user).

## Settings

Memory is enabled by default. To disable it:

1. Go to **Account** > **AI** tab
2. Toggle **Memory** off

When disabled, the AI won't save new memories or include existing ones in queries. Your saved memories are not deleted — they're still in the Library if you re-enable the feature.
