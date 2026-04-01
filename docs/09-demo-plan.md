> **Status: ASPIRATIONAL** — Demo script for showcasing mesh networking. Hardware setup is accurate but demo data is hypothetical. Model reference (Qwen3.5-4B) may not match current default (qwen3:4b).

# Demo Plan — Edgebric

---

## Context

**Core message:** Edgebric demonstrates that a distributed, privacy-first knowledge platform can work entirely on local hardware using Ollama for AI inference and sqlite-vec for vector search — with no cloud dependencies.

**What NOT to claim:** Don't overstate capabilities. Focus on what was built and why the distributed architecture matters. Let the product speak for itself.

---

## Demo Setup

### Hardware
- **MacBook** — Coordinator node. Runs: Ollama (Qwen3.5-4B), sqlite-vec, API server, web app
- **Device A** — Source node. Runs: Edgebric with Ollama, sqlite-vec with "Marketing Campaign" source
- **Device B** — Source node. Runs: Edgebric with Ollama, sqlite-vec with "Legal Compliance" source

### Network
- WiFi hotspot from one device (MacBook or phone)
- All devices on same network for mDNS discovery
- No corporate network or internet required for the demo itself

### Pre-Loaded Data

**MacBook Source: "Engineering — Release Notes"**
- Product release notes for a fictional Q3 launch
- Feature descriptions, timelines, known issues
- Technical specifications and API changes
- ~15-20 chunks, realistic content

**Device A Source: "Marketing — Campaign Brief"**
- Campaign messaging and positioning for the Q3 launch
- Target audience descriptions
- Marketing claims and value propositions
- Social media copy drafts
- ~10-15 chunks

**Device B Source: "Legal — Compliance Checklist"**
- Regulatory requirements for product claims
- Advertising compliance rules
- Data privacy requirements for marketing materials
- Terms and conditions templates
- ~10-15 chunks

---

## Demo Script (12-15 minutes)

### Act 1: The Problem (2 minutes)

"Every company has knowledge scattered across departments. Marketing has campaign briefs. Legal has compliance checklists. Engineering has release notes. When these teams need to collaborate — which is every meeting, every product launch — they waste time digging through each other's documents or waiting for someone to email them the right file.

The bigger problem: this knowledge is often sensitive. Legal doesn't want their compliance notes in a central AI that marketing can freely query. Engineering doesn't want pre-release details accessible to everyone. And no one wants their sensitive documents uploaded to a cloud AI provider.

Current solutions force a choice: centralize everything in one place (security risk) or keep it siloed (productivity cost). What if the data could stay exactly where it is, and only the questions traveled?"

### Act 2: Single-Node — The Foundation (2 minutes)

**Show:** MacBook running Edgebric in Org Mode.

1. Open admin dashboard, show the "Engineering — Release Notes" source
2. Switch to employee view, ask: "What features are shipping in Q3?"
3. Show the answer streaming in with citations (document name, section, page)
4. Point out: "Everything here — the AI model running on Ollama, the vector database in sqlite-vec, the documents — is running on this MacBook. No cloud. No API calls to OpenAI. Fully local."

"This is the foundation. A single device running local AI over local sources. Privacy by architecture — the data literally can't leave because there's nowhere for it to go. But this is just one device with one team's source."

### Act 3: The Mesh — Devices Discover Each Other (2 minutes)

**Show:** Turn on Device A, launch Edgebric.

1. Device A starts Ollama, joins the mesh via mDNS
2. On MacBook admin dashboard: show the new node appearing automatically
3. "No IP addresses configured. No setup wizard. The device found the MacBook through mDNS — the same kind of zero-config discovery that makes AirDrop work."
4. Show Device A's "Marketing Campaign" source in the node dashboard

**Show:** Turn on Device B, launch Edgebric.

5. Second device appears in the mesh
6. "Now we have three autonomous source nodes, each with their own data, each discovered automatically."

"Each device is an autonomous node running its own Ollama instance and sqlite-vec database. They found each other without any configuration. The Marketing source lives on Device A. The Legal source lives on Device B. The Engineering source lives on this MacBook. Nothing has been copied anywhere."

### Act 4: Meeting Mode — The Magic Moment (3-4 minutes)

**Show:** Create a meeting session on the MacBook.

1. Click "Create Session" — room code appears: "LAUNCH-Q3"
2. On Device A: enter room code "LAUNCH-Q3" → joins session
3. On Device B: enter room code "LAUNCH-Q3" → joins session
4. Show participant list with their data sources
5. Each participant opts in their data sources (show the granular toggles)

**The key question:**

6. Type: "Are there any compliance issues with the marketing claims in our Q3 campaign?"
7. Show the query fanning out — the loading state shows which nodes are being queried
8. Answer streams in, drawing from ALL THREE sources:
   - Marketing source: "The campaign claims X, Y, Z about the product..."
   - Legal source: "Regulation ABC requires that claims about X must include disclaimer..."
   - Engineering source: "Feature Y is actually launching in Q4, not Q3..."
9. Citations show which source each piece of information came from

"One question. Three devices. Three different departments' sources. The answer synthesizes information that no single team had alone. And here's the key: **no data moved**. The marketing documents are still only on Device A. The legal documents are still only on Device B. The question traveled to each device, each device searched its own source locally, and only the relevant answer fragments came back to be synthesized.

Without the mesh, you'd need a central server holding all three teams' documents. Which means one compromised server exposes everything. With the mesh, a compromised device only exposes that one team's source — because the other teams' data was never there."

### Act 5: Resilience (1-2 minutes)

**Show:** Pull Device B off the network (turn off WiFi or Airplane mode).

1. Ask another question: "What are the key dates for the Q3 launch?"
2. Answer comes back from MacBook + Device A only
3. Show the graceful message: "Legal Compliance source is currently unavailable"
4. "The system didn't crash. It didn't hang. It told you exactly what's missing and gave you the best answer it could from the available nodes."

**Show:** Bring Device B back online.

5. Device reconnects to mesh automatically
6. "And it's back. No restart needed. No re-configuration. The mesh healed itself."

### Act 6: Why This Architecture Matters (1-2 minutes)

"Let me be direct about why this architecture matters.

Edgebric runs entirely on local hardware. Ollama handles AI inference. sqlite-vec handles vector search. mDNS handles device discovery. HTTP handles cross-device communication. No cloud, no proprietary runtime, no vendor lock-in.

The mesh architecture IS the product's privacy guarantee. Device discovery, cross-device queries, session-scoped sharing — these are what enable something no competitor offers.

No one in the market — not Glean, not Moveworks, not Leena AI — offers distributed physical data isolation with cross-device knowledge synthesis."

### Act 7: End Session + Close (1 minute)

1. Click "End Session"
2. Show: ephemeral sharing dissolved. Data sources are private again.
3. "The meeting's over. The sharing is gone. No data was ever copied. Each device still has exactly what it started with."

"Data never moves. Queries move. That's the product."

---

## Backup Demos (If Time / Interest)

### Department Security Demo
- Show department mode: assign HR source to one node, Legal source to another
- Demonstrate that a query to the HR node literally cannot return Legal results (data isn't there)
- "This isn't access control. This is physics."

### Vault Source Demo
- Show an employee creating a vault source, uploading docs
- Query it privately
- Share one source in a group chat, keep another private
- "Every employee becomes a source node."

### Hardware Cost Pitch
- "This MacBook is serving as the coordinator for 3 source nodes. A $599 Mac Mini can do the same thing for 100-200 daily users. That's a one-time cost vs. $150/month for cloud AI subscriptions. The Mac Mini uses 4 watts idle — about $10/year in electricity."

---

## Pre-Demo Checklist

- [ ] All devices charged and on same WiFi network
- [ ] MacBook: Ollama running, API server started, web app accessible
- [ ] MacBook: "Engineering — Release Notes" source uploaded and indexed
- [ ] Device A: Edgebric installed, Ollama running
- [ ] Device A: "Marketing Campaign" source pre-loaded and indexed
- [ ] Device B: Edgebric installed, Ollama running
- [ ] Device B: "Legal Compliance" source pre-loaded and indexed
- [ ] Test all 5 demo questions — verify they produce good cross-source answers
- [ ] Test graceful degradation (pull one device, query, reconnect)
- [ ] Test session create/join/end flow end-to-end
- [ ] Browser DevTools network tab ready (to show zero external calls)
- [ ] Clean browser state (no distracting tabs/bookmarks)

---

## What Could Go Wrong + Mitigations

| Risk | Mitigation |
|---|---|
| WiFi hotspot drops | Have a backup hotspot ready. Demo works on any shared network. |
| App crashes on launch | Pre-launch apps before meeting. Have a video recording of the demo as backup. |
| Ollama inference is slow | Use Qwen3.5-4B not 9B. Pre-warm the model before demo (ask one question beforehand). |
| Cross-device query timeout | Set generous timeout (30s). Have a fallback question that only queries 2 nodes. |
| sqlite-vec returns no results | Pre-test every demo question. Keep backup questions that are known-good. |
| Mesh discovery takes too long | Pre-join mesh before demo starts. The "auto-discovery" moment can be shown via the admin dashboard node list refreshing. |

---

## What to Bring to the Meeting

1. MacBook (fully charged, demo ready)
2. Device A (fully charged, app installed, source loaded)
3. Device B (fully charged, app installed, source loaded)
4. Charger for MacBook
5. One-page product overview (printed or PDF) — not a slide deck
6. Architecture diagram (the three-mode diagram from 04-technical.md, printed)
