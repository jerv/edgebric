# Spike 1 — mILM

## Question
Does Qwen3-4B run on available hardware? What's the token throughput? Does streaming response match OpenAI format?

## Setup
1. Download edgeEngine for macOS from https://github.com/edgeEngine/edgeEngine-SE-macOS/releases
2. Start it: `./edgeEngine`
3. Deploy mILM: see `setup.http` (use VS Code REST Client extension)
4. Download model: `POST /api/milm/v1/models` with Qwen3-4B GGUF URL

## Files
- `setup.http` — all HTTP calls in sequence

## What to measure
- [ ] Time to first token (seconds)
- [ ] Tokens per second (sustained)
- [ ] Memory usage (Activity Monitor)
- [ ] Does streaming SSE match `data: {"choices":[{"delta":{"content":"..."}}]}` format?
- [ ] Does `/embeddings` return a float array?

## Results
(fill in after running)

- Model used:
- Hardware:
- Time to first token:
- Tokens/second:
- RAM used:
- Streaming format matches OpenAI: yes/no
- Embeddings endpoint works: yes/no
- Notes:
