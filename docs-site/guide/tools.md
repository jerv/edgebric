# Tools

Edgebric can use tools to extend the AI's capabilities beyond document search. Tools are activated automatically when your active model supports them.

## Available Tools

### Knowledge Search

The AI can search your data sources during a conversation. This happens automatically when you ask a question — the AI decides which sources to search and what to look for.

### Web Search

When enabled and supported by the model, the AI can search the web to supplement answers. This is useful when your documents don't cover a topic but you still want an answer.

::: info
Web search sends your query to an external search engine. If you need complete privacy, use Vault Mode or disable web search in settings.
:::

### Document Tools

The AI can work with documents you attach in the chat:

- **Text extraction** — Extract and summarize text from uploaded files
- **Image analysis** — For models with vision capability, analyze screenshots, photos, or diagrams

## Model Capabilities

Not all models support all tools. The model picker shows capability badges:

| Badge | Tools available |
|-------|----------------|
| **Tool Use** | Knowledge search, web search, document tools |
| **Vision** | Image analysis, screenshot reading |
| **Reasoning** | Enhanced multi-step analysis |

If your model doesn't have the **Tool Use** badge, the AI uses the standard RAG pipeline (search, then answer) without actively choosing tools.

## How Tool Use Works

When a model supports tool use:

1. You ask a question
2. The AI decides which tools to use (search knowledge, search web, analyze image, etc.)
3. The tools execute and return results
4. The AI synthesizes the results into a final answer

This happens automatically — you don't need to specify which tools to use. The AI picks the best approach based on your question.
