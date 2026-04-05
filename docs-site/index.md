---
layout: home

hero:
  name: Edgebric
  text: Private Knowledge Platform
  tagline: Upload documents, ask questions with AI, get cited answers. Nothing leaves your machine.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: API Reference
      link: /api/agent-api
    - theme: alt
      text: View on GitHub
      link: https://github.com/jerv/edgebric

features:
  - icon: "\U0001F512"
    title: Privacy by Architecture
    details: Documents stay on the machine that owns them. Queries move, data never does. Security enforced by physics, not policies.
  - icon: "\U0001F916"
    title: Local AI Inference
    details: Runs open-source language models locally via llama.cpp. No cloud API calls, no subscriptions, no data leaving your hardware.
  - icon: "\U0001F310"
    title: Mesh Networking
    details: Connect multiple Macs across offices. Queries fan out to all nodes in parallel — answers come back with citations, documents stay put.
  - icon: "\U0001F4DA"
    title: RAG-Powered Q&A
    details: Hybrid search combining vector similarity and keyword matching. Get answers with source citations including document name, section, and page number.
  - icon: "\U0001F465"
    title: Group Chats
    details: Collaborate with your team. Share data sources into chats, tag @bot to query, and branch into threads for focused exploration.
  - icon: "\U0001F30D"
    title: Cloud Sync
    details: Pull documents from Google Drive, OneDrive, Confluence, and Notion. Files sync to your local machine — never stored in the cloud.
---

## Quick Start

### Download the App

Head to [edgebric.com](https://edgebric.com) — download, drag to Applications, launch. No terminal required.

### One-Line Install

```bash
curl -fsSL https://edgebric.com/install.sh | bash
```

### Build from Source

```bash
git clone https://github.com/jerv/edgebric.git
cd edgebric
pnpm install && pnpm build
cd packages/desktop && pnpm dev
```

---

<div style="text-align: center; margin-top: 2rem;">
  <em>"Data never moves. Queries move."</em>
</div>
