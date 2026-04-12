# Choosing Models

Edgebric is now a **Qwen-first** product.

That means:

- **Qwen models are the tested path** for chat, retrieval, memory, and tool execution.
- **Other built-in models are experimental** unless the UI marks them otherwise.
- **Community GGUF imports are advanced-use only**. They may load and answer basic prompts, but Edgebric does not promise solid tool use, memory handling, or agent reliability on them.

## Support Levels

Edgebric uses three support labels in the app:

| Label | Meaning |
|-------|---------|
| **Tested** | Engineered and tested for Edgebric's full agent flow |
| **Experimental** | Loadable, but tool use and memory behavior may be degraded |
| **Community** | Advanced/manual use only; Edgebric does not guarantee agent behavior |

In practice, you should treat **Tested** as the real product surface.

## Recommended Hardware Tiers

| Your RAM | Recommendation | Expectation |
|----------|----------------|-------------|
| **16 GB** | Qwen 3.5 9B or smaller | Functional, but slower and more constrained |
| **24-32 GB** | Qwen 3.5 35B-A3B or similar | Target Edgebric experience |
| **32 GB+** | Qwen 3.5 27B | Best local quality for the current stack |

If you want the best current Edgebric behavior, optimize for the **24-32 GB** tier.

## Default Path

The recommended Edgebric setup is:

- **Chat model:** a tested Qwen model
- **Embedding model:** `nomic-embed-text`

Edgebric ships its prompts, planner behavior, tool metadata, and latency assumptions around the Qwen path first. That is the path we expect to behave well under real usage.

## Why Qwen

Edgebric is no longer pretending every model family works equally well.

Qwen is the primary target because it consistently performs better across the specific things Edgebric needs:

- structured tool use
- grounded answers over retrieved context
- usable latency on consumer hardware
- better reliability across multi-step chat flows

That matters more than benchmark wins in unrelated settings.

## What Experimental Means

An **Experimental** model may still be useful. It may even outperform Qwen on a narrow benchmark. But in Edgebric it can fail in product-specific ways:

- miss or skip tool calls
- handle multi-part prompts inconsistently
- degrade memory behavior
- respond more slowly in real chat flows
- produce weaker results under longer retrieved context

Experimental does **not** mean broken. It means you should expect rough edges.

## Community GGUF Models

Edgebric will still let you import arbitrary GGUF models from HuggingFace.

Requirements:

1. GGUF format
2. A working chat template
3. Enough context length and RAM to be usable

But "loads successfully" is not the same thing as "works well in Edgebric."

If you import a community model, expect basic chat first. Treat tool use, memory, and agent workflows as optional until proven otherwise.

## Capability Badges

The UI shows capability badges like:

- **Vision**
- **Tools**
- **Reasoning**

These badges are useful, but they are not the whole story.

A model can support tool calling in theory and still perform poorly in Edgebric's real planner/executor flow. That is why the **support label matters more than capability badges**.

## Practical Guidance

If you want Edgebric to feel solid:

1. Start with a **Tested Qwen model**
2. Stay on the **24-32 GB** hardware tier if possible
3. Only switch to **Experimental** models when you are intentionally evaluating tradeoffs
4. Treat **Community** models as advanced/manual use, not the default experience

## Installing and Switching Models

From **Admin > Models** you can:

- load models into RAM
- set the active chat model
- compare RAM usage
- see whether a model is **Tested**, **Experimental**, or **Community**

Use the desktop app to install or remove model files. Use the Models page to choose which loaded model is active.

## Bottom Line

Edgebric supports multiple local model families.

Edgebric is **optimized for Qwen**.

If you want the best current experience, treat Qwen as the default and everything else as a deliberate tradeoff.
