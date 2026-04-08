# Asking Questions

Edgebric answers your questions using the documents in your data sources. It searches your documents, finds relevant passages, and generates an answer with citations — all running locally on your Mac.

## How It Works

When you ask a question, Edgebric:

1. **Searches** your documents using both semantic search (understanding meaning) and keyword search (exact matches)
2. **Ranks** results using Reciprocal Rank Fusion — a technique that combines both search methods for better results
3. **Generates** an answer using the AI model, with the relevant document passages as context
4. **Cites** its sources — each answer includes references to the specific documents, sections, and page numbers used

This is called Retrieval-Augmented Generation (RAG). The AI model doesn't make things up from thin air — it bases its answers on your actual documents.

## Asking a Question

1. Open the chat interface from the main page
2. Type your question in natural language — just ask like you would ask a colleague
3. Press Enter or click Send
4. The answer streams in as it's generated

**Good questions:**
- "What is our parental leave policy?"
- "How do I file an expense report?"
- "What were the key decisions from the Q3 planning meeting?"

**Tips:**
- Be specific. "What are the PTO rules for contractors?" works better than "Tell me about PTO."
- If you don't get a good answer, try rephrasing or ask a more targeted question.
- You can scope your query to specific data sources using the source picker in the chat interface.

## Search Quality Settings

Admins can enable three opt-in features in **Admin** > **Settings** > **Integrations** that improve search quality at the cost of additional processing time:

| Setting | What it does | Trade-off |
|---------|-------------|-----------|
| **Query Decomposition** | Breaks complex questions into sub-queries for broader coverage | Slightly slower, better for multi-part questions |
| **Re-ranking** | Uses AI to re-order search results by relevance | Adds one inference call per query |
| **Iterative Retrieval** | Retries with reformulated queries when initial results are low confidence | May add 1-2 extra search rounds |

All three are off by default. When enabled, they apply across all query paths — standard chat, private mode, group chats, and the Agent API.

These settings are org-level — admins toggle them for the whole organization.

## Citations

Every answer includes citations showing where the information came from:

- **Document name** — Which file contains the source material
- **Section** — The heading or section within the document
- **Page number** — For PDFs, the specific page

Click a citation to view the original document passage. This lets you verify the answer and read more context.

If Edgebric can't find relevant information in your documents, it will tell you rather than guessing.

## Answer Types

Edgebric classifies each answer:

| Type | Meaning |
|------|---------|
| **Grounded** | Answer is fully based on your documents |
| **Blended** | Answer combines document information with general knowledge |
| **General** | No relevant documents found; answer uses the model's general knowledge |
| **Blocked** | Query was filtered for safety reasons |

## Conversations

Edgebric remembers context within a conversation. Follow-up questions reference earlier messages automatically:

> **You:** What is our vacation policy?
>
> **Edgebric:** *[answers with citations]*
>
> **You:** How does that apply to contractors?
>
> **Edgebric:** *[answers in context of the vacation policy discussion]*

### Managing Conversations

- Conversations are listed in the sidebar
- Click **New Chat** to start a fresh conversation
- Archive or delete old conversations from the conversation list
- Archived conversations can be restored later

### Converting to Group Chat

If a conversation would benefit from collaboration, you can convert it to a group chat:

1. Open the conversation
2. Click the options menu
3. Select **Convert to Group Chat**
4. Invite team members and share data sources

See [Group Chats](/guide/group-chats) for more on collaborative querying.

## Privacy Modes

When asking questions, your privacy mode affects what gets recorded:

| Mode | What's recorded |
|------|----------------|
| **Standard** | Conversation history stored for future reference |
| **Private** | Queries are anonymous — not linked to your identity |
| **Vault** | Everything stays on-device, encrypted |

See [Privacy Modes](/guide/privacy) for details on each mode.

## File & Image Attachments

If your active model supports it, you can attach files or images to your query:

- **Images** — For models with vision capabilities, attach a screenshot or photo and ask questions about it
- **Documents** — Attach a document directly in the chat to ask questions about its content without adding it to a data source

Look for the paperclip icon in the chat input area. It appears when your active model supports attachments.

## Feedback

Each answer has thumbs up/down buttons. Your feedback helps track answer quality. If an answer is wrong or unhelpful, thumbs down it and optionally leave a comment explaining what was wrong.
