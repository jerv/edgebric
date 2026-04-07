# Choosing Models

Edgebric uses open-source AI models that run entirely on your Mac. No cloud API calls, no subscriptions -- the model runs locally via [llama.cpp](https://github.com/ggerganov/llama.cpp).

## How It Works

Edgebric manages two types of models:

- **Chat model** -- Answers your questions using context from your documents. This is the main model you interact with.
- **Embedding model** -- Converts document text into numerical representations for search. Runs in the background during document ingestion and queries. You generally don't need to change this.

Both models run as local servers managed by the desktop app. You don't need to install or configure llama.cpp yourself.

## Default Models

| Model | Purpose | Size | RAM needed |
|-------|---------|------|------------|
| **Qwen 3.5 4B** | Chat | ~2.7 GB | 8 GB+ |
| **nomic-embed-text** | Embeddings | ~150 MB | Minimal |

These are installed automatically during first-run setup. The chat model is selected based on your available RAM -- machines with 24 GB+ get Qwen 3.5 35B-A3B (MoE) instead.

## What Makes a Model Compatible

Any model that meets these requirements will load in Edgebric:

1. **GGUF format** -- Edgebric uses llama.cpp, which only loads `.gguf` files. Models in other formats (safetensors, ONNX, PyTorch) won't work.
2. **Chat template support** -- The model must include a chat template (or use one built into llama.cpp). Without it, the model can't distinguish between system prompts, user messages, and assistant responses, resulting in garbled output.

Meeting these requirements gets a model running. But "runs" and "works well with Edgebric" are different things.

## What Makes a Model Good with Edgebric

### Tool calling support (critical)

Edgebric's RAG pipeline relies on the AI model calling tools to search documents, cite sources, compare files, verify claims, and more. There are 14 tools available:

- **Knowledge tools** -- `search_knowledge`, `list_sources`, `list_documents`, `get_source_summary`, `create_source`, `upload_document`, `delete_document`, `delete_source`, `save_to_vault`, `compare_documents`, `cite_check`, `find_related`
- **Web tools** -- `web_search`, `read_url`

Tool calling works through the OpenAI-compatible `/chat/completions` API. The model receives tool definitions as JSON schemas and must respond with structured `tool_calls` containing the tool name and JSON arguments. If a model doesn't support this format, it falls back to basic chat -- it can still answer questions from its training data, but it can't search your documents, cite sources, or use any of Edgebric's features.

### Sufficient context length (32K+ recommended)

When you ask a question, Edgebric's hybrid search retrieves relevant document chunks and stuffs them into the prompt alongside the system prompt, tool definitions, conversation history, and your query. This context adds up fast:

- System prompt + tool definitions: ~2K tokens
- Retrieved document chunks (5-10 chunks): ~3K-8K tokens
- Conversation history: varies
- User query: ~100-500 tokens

Models with short context windows (4K-8K) may truncate the retrieved chunks, losing the most relevant information. 32K context is a practical minimum for RAG workloads. Most modern models support 128K+ which is more than enough.

### Appropriate size for your RAM

The model, your OS, and Edgebric itself all share your system RAM. A rough breakdown:

| Component | RAM usage |
|-----------|-----------|
| macOS + background apps | ~4-6 GB |
| Edgebric (API server, Electron shell, embedding model) | ~2-3 GB |
| **Chat model** | **varies by model** |

Edgebric reserves ~8 GB of headroom for OS and apps when calculating whether a model fits. If the model's RAM requirement exceeds what's left, you'll see a warning in the UI. The model may still load, but performance will suffer as macOS swaps to disk.

| Your RAM | Recommended model | Model RAM |
|----------|-------------------|-----------|
| 8 GB | Qwen 3.5 4B | ~5.5 GB |
| 16 GB | Qwen 3.5 35B-A3B (MoE) | ~9 GB |
| 24 GB+ | Qwen 3.5 27B | ~22 GB |

**How to estimate RAM for any model:** Take the GGUF file size and multiply by ~1.2x (llama.cpp needs working memory on top of model weights). Then add ~2 GB for Edgebric's overhead. For example, a 5.9 GB GGUF file needs roughly `5.9 * 1.2 + 2 = ~9 GB` of RAM.

### Vision support (optional)

Models with vision capability can analyze images and screenshots that users include in their queries. This is useful for document screenshots, diagrams, and photos but is not required for text-based RAG.

## Capability Badges

In the model picker, each model shows capability badges:

| Badge | Meaning |
|-------|---------|
| **Vision** | Can analyze images and screenshots |
| **Tool Use** | Can use built-in tools (search, citations, web search, document management) |
| **Reasoning** | Enhanced multi-step reasoning ability |

Not all models support all capabilities. The badges help you choose the right model for your needs.

## Compatibility Tiers

### Recommended

Curated by the Edgebric team. These models have been tested end-to-end including tool calling, RAG retrieval quality, chat template correctness, and response quality. They appear first in the model catalog and are what we suggest for most users.

Current recommended models:

| Model | Params | Download | RAM | Capabilities |
|-------|--------|----------|-----|-------------|
| **Qwen 3.5 4B** | 4B | 2.7 GB | ~5.5 GB | Vision, Tool Use |
| **Qwen 3.5 9B** | 9B | 5.9 GB | ~9.5 GB | Vision, Tool Use |
| **Qwen 3.5 35B-A3B** | 35B (3B active) | 5.5 GB | ~9 GB | Vision, Tool Use, Reasoning |

The MoE model (35B-A3B) is a standout -- it has 35B total parameters but only activates 3B at a time, giving near-35B quality at 9B-level resource usage.

### Supported

Known to work with Edgebric but may have limitations. These have been tested for basic compatibility but may not excel at all features.

| Model | Params | Download | RAM | Capabilities | Notes |
|-------|--------|----------|-----|-------------|-------|
| **Qwen 3.5 27B** | 27B | 16.5 GB | ~22 GB | Vision, Tool Use, Reasoning | Needs 32 GB RAM |
| **Phi-4 Mini** | 3.8B | 2.5 GB | ~5 GB | Tool Use | No vision, 128K context |
| **Gemma 3 4B** | 4B | 3.3 GB | ~6 GB | Vision | No tool use |
| **Gemma 3 12B** | 12B | 8.1 GB | ~13 GB | Vision | No tool use |

Note that Gemma 3 models lack tool calling support. They work for basic chat with your documents (Edgebric falls back to context-stuffing without tools), but cannot use features like web search, citation verification, or document comparison.

### Community

Any GGUF model from HuggingFace can be imported for basic chat. Advanced features like tool use and vision require compatible models — see the [Recommended Models](#recommended-models) list. Edgebric lets you search HuggingFace and download any GGUF model directly. These models will load and run inference, but Edgebric cannot guarantee that tool calling, chat templates, or advanced features work correctly.

Community models get capability badges inferred from their HuggingFace tags (e.g., `tool-use`, `image-text-to-text`, `reasoning`), and certain model families (Qwen 3.5, Llama 3.x, Mistral) are recognized as likely supporting tool use. But inference from tags is not the same as testing.

## What Can Go Wrong with Community Models

If you download an untested model from HuggingFace, here are the common failure modes:

### No tool calling support

The model generates text responses but doesn't emit structured `tool_calls` JSON. Edgebric's tool runner receives nothing to execute, so the AI can't search your documents, cite sources, or use any tools. You get a basic chatbot that only knows what's in its training data.

**How to tell:** Ask a question about your documents. If the AI says "I don't have access to your documents" or gives a generic answer without citations, tool calling isn't working.

### Short context window

Models with less than 32K context truncate the input when Edgebric stuffs retrieved document chunks into the prompt. The model might only see the system prompt and your question, losing all the retrieved context.

**How to tell:** Answers seem unrelated to your documents even though relevant content exists. The model may hallucinate rather than using the provided context.

### Missing or broken chat template

Without a proper chat template, the model can't distinguish between system/user/assistant turns. Output may be garbled, repeat the system prompt, or generate tokens that look like template markup.

**How to tell:** Responses contain `<|im_start|>`, `<|user|>`, or other template tokens in the visible output.

### Wrong quantization level

- **Q2_K** -- Too degraded. Tool call JSON comes out malformed, reasoning quality drops sharply.
- **FP16 / Q8_0** -- Maximum quality but very large files. A 7B model at FP16 is ~14 GB. Only use these if you have the RAM.
- **Q4_K_M** -- Best balance of quality and size. This is what Edgebric uses for all recommended models.

### Fine-tunes with altered output format

Some community fine-tunes modify the model's output format for specific use cases (e.g., coding assistants, roleplay). These may produce tool call JSON in a non-standard format that Edgebric's tool runner can't parse.

## Recommended Models

| Model | Size | Best for | Notes |
|-------|------|----------|-------|
| **Qwen 3.5 4B** | 2.7 GB | Personal use, 8 GB Macs | Fast, good quality. Default. |
| **Qwen 3.5 35B-A3B** | 5.5 GB | 16 GB Macs | MoE -- big model quality, small model speed |
| **Qwen 3.5 9B** | 5.9 GB | Team servers, 16 GB Macs | Best balance of quality and speed |
| **Qwen 3.5 27B** | 16.5 GB | High-quality answers, 32 GB+ Macs | Slower but most capable |
| **Phi-4 Mini** | 2.5 GB | Constrained setups | Compact, 128K context |
| **Gemma 3 4B/12B** | 3.3/8.1 GB | General purpose, vision tasks | No tool use support |

## Installing Models

### From the Built-in Catalog

1. Open the Edgebric web interface
2. Go to **Admin** > **Models**
3. Browse the model catalog -- each entry shows size, capabilities, and RAM requirements
4. Click **Download** on the model you want
5. A progress bar tracks the download
6. Once downloaded, click **Load** to activate the model

### From HuggingFace

Edgebric supports any model in the [GGUF format](https://huggingface.co/models?library=gguf) from HuggingFace:

1. Find a GGUF model on HuggingFace
2. In the Models page, use the **Import from HuggingFace** option
3. Paste the model URL or name
4. Edgebric downloads and registers the model

::: tip Quantization
Models come in different quantization levels (Q2_K, Q4_K_M, Q5_K_M, Q8_0, FP16). Lower quantization = smaller file and less RAM, but lower quality. **Q4_K_M** is the sweet spot for most users -- it's what all recommended models use.
:::

## Where to Find GGUF Models

When looking for GGUF versions of new models:

- **[unsloth](https://huggingface.co/unsloth)** -- High-quality quantizations, usually the first to publish GGUFs for new models.
- **[bartowski](https://huggingface.co/bartowski)** -- Reliable community quantizer with a wide catalog.
- **Official model repos** -- Qwen, Meta, Microsoft, and Google increasingly publish their own GGUF files alongside safetensors releases.

Search HuggingFace for `[model name] GGUF` and look for Q4_K_M variants from these sources.

## Switching Models

You can have multiple models installed and switch between them:

1. Go to **Admin** > **Models**
2. Click **Load** next to the model you want to use
3. The current model is unloaded and the new one takes its place

The Models page shows RAM and disk usage for each installed model, so you can manage your resources.

## Custom GGUF Models

Any GGUF model compatible with llama.cpp works with Edgebric. If you have a custom fine-tuned model:

1. Place the `.gguf` file in your Edgebric data directory
2. Use the **Import Local Model** option in the Models page
3. Edgebric registers and loads the model

::: warning RAM Usage
Larger models need more RAM. Edgebric shows a warning when a model's RAM requirement exceeds your available memory. As a rule of thumb: GGUF file size x 1.2 + 2 GB overhead = approximate RAM needed.
:::
