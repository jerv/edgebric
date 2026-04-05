# Choosing Models

Edgebric uses open-source AI models that run entirely on your Mac. No cloud API calls, no subscriptions — the model runs locally via [llama.cpp](https://github.com/ggerganov/llama.cpp).

## How It Works

Edgebric manages two types of models:

- **Chat model** — Answers your questions using context from your documents. This is the main model you interact with.
- **Embedding model** — Converts document text into numerical representations for search. Runs in the background during document ingestion and queries. You generally don't need to change this.

Both models run as local servers managed by the desktop app. You don't need to install or configure llama.cpp yourself.

## Default Models

| Model | Purpose | Size | RAM needed |
|-------|---------|------|------------|
| **Qwen 3.5 4B** | Chat | ~2.6 GB | 8 GB+ |
| **nomic-embed-text** | Embeddings | ~275 MB | Minimal |

These are installed automatically during first-run setup.

## Capability Badges

In the model picker, each model shows capability badges that indicate what it can do:

| Badge | Meaning |
|-------|---------|
| **Vision** | Can analyze images and screenshots |
| **Tool Use** | Can use built-in tools (web search, document tools) |
| **Reasoning** | Enhanced multi-step reasoning ability |

Not all models support all capabilities. The badge system helps you choose the right model for your needs.

## Recommended Models

| Model | Size | Best for | Notes |
|-------|------|----------|-------|
| **Qwen 3.5 4B** | 2.6 GB | Personal use, 16 GB Macs | Fast, good quality. Default. |
| **Qwen 3.5 9B** | 5.8 GB | Team servers, 24 GB Macs | Best balance of quality and speed |
| **Qwen 3.5 27B** | ~16 GB | High-quality answers, 32 GB+ Macs | Slower but more capable |
| **Phi-4** | ~8 GB | Reasoning tasks | Strong at analysis and logic |
| **Gemma 3** | varies | General purpose | Good alternative to Qwen |

## Installing Models

### From the Built-in Catalog

1. Open the Edgebric web interface
2. Go to **Admin** > **Models**
3. Browse the model catalog — each entry shows size, capabilities, and RAM requirements
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
Models come in different quantization levels (Q4_K_M, Q5_K_M, Q8_0, etc.). Lower quantization = smaller file and less RAM, but slightly lower quality. **Q4_K_M** is the sweet spot for most users.
:::

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
Larger models need more RAM. A 4B model needs about 4–6 GB of RAM, while a 27B model can use 16–20 GB. Check the model size against your available memory before loading.
:::
