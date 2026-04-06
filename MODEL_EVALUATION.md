# Model Evaluation Checklist

Internal guide for evaluating and adding models to Edgebric's `OFFICIAL_CATALOG`.

## Prerequisites

- Edgebric running locally (desktop app)
- At least one data source with documents ingested
- Enough RAM to load the candidate model

## Step 1: Gather Model Information

Check the HuggingFace model card for:

- [ ] **Parameter count** -- e.g., 4B, 7B, 13B. MoE models list total and active params.
- [ ] **Context length** -- Must be 32K+ for RAG. 128K+ preferred.
- [ ] **Architecture** -- Transformer variant. Check llama.cpp compatibility at [ggml model support](https://github.com/ggerganov/llama.cpp#description).
- [ ] **Chat template** -- Model card should mention instruction tuning and a chat template (e.g., ChatML, Llama-style). Base models without instruction tuning won't work.
- [ ] **Capabilities** -- Look for HuggingFace tags: `tool-use`, `function-calling`, `image-text-to-text`, `vision`, `reasoning`.
- [ ] **License** -- Must be compatible with redistribution (we link to the download, not host it, but users need to accept the license).

## Step 2: Find the GGUF File

Preferred quantization: **Q4_K_M**. This balances quality and size for typical consumer hardware.

Search order for GGUF providers:

1. **Official repo** -- Check if the model publisher provides GGUFs (increasingly common for Qwen, Meta, Microsoft, Google).
2. **[unsloth](https://huggingface.co/unsloth)** -- High-quality quantizations, fast to publish new models.
3. **[bartowski](https://huggingface.co/bartowski)** -- Reliable community quantizer.

Record:
- [ ] **GGUF filename** -- e.g., `ModelName-Q4_K_M.gguf`
- [ ] **Download URL** -- Direct `/resolve/main/` link to the GGUF file
- [ ] **File size** -- In GB, for the `downloadSizeGB` field

## Step 3: Calculate RAM Requirement

```
RAM (GB) = GGUF file size (GB) * 1.2 + 2
```

The 1.2x multiplier accounts for llama.cpp's working memory (KV cache, scratch buffers). The +2 GB covers Edgebric's API server, Electron shell, and the embedding model running alongside the chat model.

Round up to determine `ramUsageGB`. Set `minRAMGB` to the nearest standard tier: 8, 16, 24, or 32.

Examples:
- 2.7 GB GGUF: `2.7 * 1.2 + 2 = 5.2 GB` -> ramUsageGB: 5.5, minRAMGB: 8
- 5.9 GB GGUF: `5.9 * 1.2 + 2 = 9.1 GB` -> ramUsageGB: 9.5, minRAMGB: 16
- 16.5 GB GGUF: `16.5 * 1.2 + 2 = 21.8 GB` -> ramUsageGB: 22, minRAMGB: 32

## Step 4: Test with Edgebric

### 4a. Basic loading

- [ ] Download the GGUF via the HuggingFace import in the Models page
- [ ] Load the model -- confirm it loads without errors in the desktop app logs
- [ ] Check that llama-server reports the model's context length correctly

### 4b. Chat template

- [ ] Send a simple message ("Hello, what can you help with?")
- [ ] Verify: no template tokens in output (no `<|im_start|>`, `<|user|>`, etc.)
- [ ] Verify: response is coherent and follows the assistant role

### 4c. Tool calling (critical)

Run these test queries with at least one data source containing documents:

1. **Basic search**: "What documents do I have?" -- should trigger `list_sources` or `list_documents`
2. **Knowledge search**: "What does [topic from your docs] say about [specific detail]?" -- should trigger `search_knowledge` and return cited results
3. **Citation check**: "Is it true that [claim from your docs]?" -- should trigger `cite_check`
4. **Web search**: "Search the web for [topic]" -- should trigger `web_search`
5. **Multi-step**: "Compare the first two documents in [source name]" -- should trigger `list_documents` then `compare_documents`

For each query, check:
- [ ] The model emits valid `tool_calls` JSON (visible in API server logs at debug level)
- [ ] Tool arguments are well-formed (correct field names, valid JSON strings)
- [ ] The model synthesizes tool results into a coherent answer
- [ ] The model doesn't hallucinate tool calls for tools that don't exist

### 4d. RAG quality

- [ ] Ask 3-5 questions that require information from your documents
- [ ] Verify answers cite specific documents and sections
- [ ] Verify the model doesn't hallucinate facts not present in retrieved chunks
- [ ] Check that answers are coherent when multiple chunks are retrieved

### 4e. Edge cases

- [ ] Long conversation (10+ turns) -- does context management hold up?
- [ ] Query with no relevant documents -- does the model say it couldn't find information rather than hallucinating?
- [ ] Mixed query (partly answerable from docs, partly general knowledge) -- does the model distinguish between sourced and general answers?

## Step 5: Add to OFFICIAL_CATALOG

Add an entry to `shared/types/src/models.ts` in the `OFFICIAL_CATALOG` array. Use this template:

```typescript
{
  tag: "model-tag",                           // Unique identifier, lowercase with hyphens
  ggufFilename: "ModelName-Q4_K_M.gguf",      // Exact GGUF filename
  downloadUrl: "https://huggingface.co/...",   // Direct /resolve/main/ URL
  name: "Model Display Name",                 // Human-readable name for the UI
  family: "FamilyName",                        // e.g., "Qwen", "Microsoft", "Google"
  description: "One-line description.",        // Mention key features and context length
  paramCount: "XB",                            // e.g., "4B", "35B (3B active)" for MoE
  downloadSizeGB: 0.0,                         // GGUF file size in GB
  ramUsageGB: 0.0,                             // From Step 3 calculation
  origin: "CompanyName",                       // Publisher/creator
  tier: "recommended",                         // "recommended" or "supported"
  minRAMGB: 8,                                 // Minimum RAM tier: 8, 16, 24, or 32
  capabilities: {
    vision: false,                             // true if image-text-to-text
    toolUse: false,                            // true only if tool calling verified in Step 4c
    reasoning: false,                          // true if enhanced reasoning confirmed
  },
  huggingFaceUrl: "https://huggingface.co/...", // Link to the base model page (not the GGUF repo)
},
```

### Tier guidelines

- **recommended** -- Passed all tests in Step 4. Tool calling works reliably. Intended as a go-to option for users with the right hardware. Keep this list small (3-5 models).
- **supported** -- Passed Steps 4a-4b and most of 4c-4d. May have limitations (e.g., no vision, occasional tool call failures). Good alternatives for users who need something different from the recommended set.

### Updating `inferCapabilitiesFromTags`

If the new model belongs to a family not already recognized in `shared/types/src/models.ts:inferCapabilitiesFromTags()`, update the regex pattern so community models from the same family get correct capability inference. The current pattern recognizes: `qwen3.5`, `llama-3.x`, `mistral`.

### Updating `getRecommendedModelTag`

If the new model should be the default recommendation for a RAM tier, update `getRecommendedModelTag()` in the same file. Current tiers:
- Under 12 GB RAM: `qwen3.5-4b`
- 12-24 GB RAM: `qwen3.5-35b-a3b`
- 24 GB+ RAM: `qwen3.5-27b`

## When to Re-evaluate

- **Major llama.cpp update** -- New architecture support or changes to tool calling format. Re-test tool calling for all catalog models.
- **New model family release** -- When a major provider (Qwen, Meta, Google, Microsoft, Mistral) releases a new generation, evaluate the instruction-tuned variants.
- **User reports** -- If users report issues with a catalog model (e.g., tool calling broke after an update), re-test and adjust tier or capabilities if needed.
- **Quarterly review** -- Check if newer models have surpassed current recommendations in quality or efficiency.
