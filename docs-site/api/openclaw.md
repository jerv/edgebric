# OpenClaw Skill

OpenClaw is a skill that lets AI agents (like Claude) use Edgebric as a private knowledge backend. Install the OpenClaw skill on your AI agent, and it can search your Edgebric data sources and get cited answers — all without your documents leaving your machine.

## What Is a Skill?

In the context of AI agents, a skill is a plugin that gives the agent a new capability. The OpenClaw skill teaches an AI agent how to talk to Edgebric's API.

## Installation

The OpenClaw skill is included in the Edgebric repository under `openclaw-skill/`.

### For Claude (MCP Server)

1. Generate an API key in **Admin** > **API Keys** (with `read` permission)
2. Add the OpenClaw MCP server to your Claude configuration:

```json
{
  "mcpServers": {
    "edgebric": {
      "command": "node",
      "args": ["path/to/openclaw-skill/index.js"],
      "env": {
        "EDGEBRIC_API_URL": "https://localhost:3001",
        "EDGEBRIC_API_KEY": "eb_your_api_key"
      }
    }
  }
}
```

3. Restart Claude. The agent now has access to your Edgebric knowledge base.

### For Other Agents

OpenClaw uses Edgebric's standard [Agent API](/api/agent-api). Any agent framework that supports HTTP tool calls can integrate:

1. Create an API key in **Admin** > **API Keys**
2. Use the `/api/v1/search` and `/api/v1/generate` endpoints
3. Pass the API key in the `Authorization: Bearer` header

## Available Tools

When installed, OpenClaw provides these tools to the AI agent:

### `search_knowledge`

Search Edgebric's data sources for relevant information.

**Parameters:**
- `query` — What to search for
- `sourceIds` — (optional) Limit to specific data sources

**Returns:** Ranked list of relevant document passages with citations.

### `list_sources`

List all data sources the API key has access to.

**Returns:** Array of data sources with name, description, and document count.

## Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `EDGEBRIC_API_URL` | Edgebric server URL | `https://localhost:3001` |
| `EDGEBRIC_API_KEY` | API key for authentication | (required) |

## Usage Examples

Once installed, you can ask your AI agent questions that it answers using your Edgebric documents:

> **You:** What does our employee handbook say about remote work?
>
> **Agent:** *[searches Edgebric, finds relevant passages]* According to the Employee Handbook (Section 4.2, page 12), remote work is available to all full-time employees after their probationary period...

> **You:** Find all documents related to GDPR compliance
>
> **Agent:** *[searches Edgebric]* I found 3 relevant documents in your "Legal" data source: GDPR Policy v2.pdf, Data Processing Agreement.docx, and Privacy Impact Assessment.pdf...

## Security

- The OpenClaw skill only has access to data sources permitted by its API key
- Use source-scoped API keys to limit what the agent can search
- All queries go through Edgebric's standard authentication and access control
- No documents are sent to external services — the agent receives only the relevant passages
