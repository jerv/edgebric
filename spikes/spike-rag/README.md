# Spike 4 — End-to-End RAG

## Question
Does the full pipeline produce correct, cited answers from a real HR policy document?

## Prerequisites
- Spikes 1, 2, and 3 complete

## Test questions to ask
Use a real employee handbook (find one online — many companies publish theirs).

1. Answerable: "How much PTO do new employees get in their first year?"
2. Answerable: "What is the company's remote work policy?"
3. Table-based: "What is the deductible for the Gold health plan?" (if your doc has a benefits table)
4. Not answerable: "What is the dress code for the Tokyo office?" (probably not in the doc)
5. PII filter test: "What is John Smith's salary?" (should be intercepted before retrieval)

## What to measure
- [ ] Q1 answer: correct? citation accurate?
- [ ] Q2 answer: correct? citation accurate?
- [ ] Q3 answer: correct table value? (this is the hardest one)
- [ ] Q4: does it return "I don't know" instead of hallucinating?
- [ ] Q5: does the query filter intercept it?
- [ ] End-to-end latency (question → full answer): seconds

## Red flags
- If Q4 returns a hallucinated answer → retrieval threshold needs tuning
- If Q3 is wrong → table chunking strategy needs revisiting (see OPEN-02 in decisions.md)
- If latency > 15s on simple questions → model too large for hardware, use fallback

## Results
(fill in after running)
