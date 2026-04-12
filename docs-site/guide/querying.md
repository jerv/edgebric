# Asking Questions

Edgebric no longer treats every request as "send the full prompt and all tools to the model and hope."

The chat stack now uses a **planner + execution + synthesis** flow:

1. classify the request
2. build a checklist when needed
3. run retrieval and tools with dependency awareness
4. stream the final answer

## Request Modes

Each request is routed into one of four modes:

| Mode | When Edgebric uses it |
|------|------------------------|
| **Direct chat** | greetings, simple conversation, lightweight non-tool responses |
| **Memory action** | explicit remember / list / delete / update requests |
| **Grounded answer** | normal document-backed questions |
| **Planned execution** | multi-step, tool-heavy, or multi-intent requests |

This is why "hello" should feel faster than a multi-part search request.

## Planned Execution

For more complex prompts, Edgebric creates a checklist before acting.

Examples:

- "Search my docs for X, compare it with Y from the web, and remember Z"
- "List the sources related to pricing, then summarize the latest one"
- "Check whether this clause matches our policy and tell me what changed"

The planner keeps those subtasks explicit so the model does not silently forget the second half of the request after the first tool call.

## Execution Graph

After planning, Edgebric runs tasks using an execution graph:

- independent **read-only** steps can run in parallel
- **mutating** steps stay sequential
- failed dependencies can short-circuit downstream steps

The chat UI shows this as a checklist so you can see what was planned, what ran, and what failed.

## Retrieval Is Now a Capability, Not a Separate Product

Older versions of Edgebric treated RAG and tool use like two different systems.

Now retrieval is one execution capability inside the same orchestration flow:

- internal knowledge search
- memory search
- optional web access where enabled

This keeps multi-part requests from bouncing between disconnected code paths.

## Streaming Behavior

Edgebric aims to stream in two layers:

- **progress immediately** via plan/checklist updates
- **answer tokens** as soon as generation starts

Simple requests should skip planner overhead entirely. Complex requests may plan first, but the UI should still show execution progress instead of sitting blank.

## Memory Requests

Explicit memory actions are first-class operations now:

- save memory
- list memories
- delete memory
- update memory

These do not need to wait for a full generic tool-selection loop before responding.

## Group Chats

Group chats use the same orchestration engine, but with a narrower execution policy:

- shared-source ACLs still apply
- mutating actions are more restricted
- web access can be tighter depending on the chat context

That keeps the behavior aligned without widening permissions.

## Answer Types

Edgebric still classifies final answers:

| Type | Meaning |
|------|---------|
| **Grounded** | Fully based on retrieved/tool-backed context |
| **Blended** | Mixed grounded context and general reasoning |
| **General** | Answered without retrieved document support |
| **Blocked** | Stopped by safety or policy rules |

For important answers, grounded responses are the target.

## Search Quality Settings

You can still enable optional retrieval enhancements such as:

- query decomposition
- reranking
- iterative retrieval

These improve coverage and ranking, but they add work. If you care about latency, keep in mind that every extra retrieval or rerank step has a cost.

## Practical Advice

- Use **specific prompts** when you want grounded answers.
- Use **one request with multiple intents** when you want the planner to coordinate a job for you.
- Expect the best overall experience on a **Tested Qwen model**.
- Treat non-Qwen or community models as experimental if you care about tool reliability.

## Bottom Line

Edgebric's querying model is now:

- **Qwen-first**
- **planner-driven for complex work**
- **checklist-visible in the UI**
- **faster for trivial chat**

That is the path the product is optimized around.
