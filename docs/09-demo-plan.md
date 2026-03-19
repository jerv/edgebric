# Demo Plan — mimik Leadership

---

## Context

**Who:** mimik leadership team — demonstrating that the mimik edge platform enables products that couldn't exist any other way.

**Core message:** mimik has impressive technology — device discovery, edge microservices, local AI, cross-device routing — but thin developer ecosystem and no reference applications. This demo shows why the platform matters to real users.

**What NOT to claim:** Don't overstate platform discoveries. Focus on what was built and why it requires mimik. Let the product speak for itself.

**Language that resonates with mimik:** "device-first," "agentic," "data sovereignty," "zero-config," "autonomous nodes," "mesh-native," "privacy by architecture."

---

## Demo Setup

### Hardware
- **MacBook** — Coordinator node. Runs: mim OE Runtime, mILM (Qwen3.5-4B), mKB, API server, web app
- **iPhone A** — Source node. Runs: iOS app with mim OE Runtime, mKB with "Marketing Campaign" source
- **iPhone B** — Source node. Runs: iOS app with mim OE Runtime, mKB with "Legal Compliance" source

### Network
- WiFi hotspot from one device (MacBook or iPhone)
- All 3 devices on same network for mDNS discovery
- No corporate network or internet required for the demo itself

### Pre-Loaded Data

**MacBook Source: "Engineering — Release Notes"**
- Product release notes for a fictional Q3 launch
- Feature descriptions, timelines, known issues
- Technical specifications and API changes
- ~15-20 chunks, realistic content

**iPhone A Source: "Marketing — Campaign Brief"**
- Campaign messaging and positioning for the Q3 launch
- Target audience descriptions
- Marketing claims and value propositions
- Social media copy drafts
- ~10-15 chunks

**iPhone B Source: "Legal — Compliance Checklist"**
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
4. Point out: "Everything here — the AI model, the vector database, the documents — is running on this MacBook. No cloud. No API calls to OpenAI. Fully local."

"This is the foundation. A single device running local AI over local sources. Privacy by architecture — the data literally can't leave because there's nowhere for it to go. But this is just one device with one team's source."

### Act 3: The Mesh — Devices Discover Each Other (2 minutes)

**Show:** Turn on iPhone A, launch the Edgebric iOS app.

1. iPhone A starts mimik runtime, joins the mesh
2. On MacBook admin dashboard: show the new node appearing automatically
3. "No IP addresses configured. No setup wizard. The phone found the MacBook through mimik's mDNS mesh — the same kind of zero-config discovery that makes AirDrop work."
4. Show iPhone A's "Marketing Campaign" source in the node dashboard

**Show:** Turn on iPhone B, launch the app.

5. Second phone appears in the mesh
6. "Now we have three autonomous source nodes, each with their own data, each discovered automatically."

"This is mimik's edge mesh in action. Each device is an autonomous node running its own AI services. They found each other without any configuration. The Marketing source lives on Alice's phone. The Legal source lives on Carol's phone. The Engineering source lives on this MacBook. Nothing has been copied anywhere."

### Act 4: Meeting Mode — The Magic Moment (3-4 minutes)

**Show:** Create a meeting session on the MacBook.

1. Click "Create Session" — room code appears: "LAUNCH-Q3"
2. On iPhone A: enter room code "LAUNCH-Q3" → joins session
3. On iPhone B: enter room code "LAUNCH-Q3" → joins session
4. Show participant list with their KBs
5. Each participant opts in their KBs (show the granular toggles)

**The key question:**

6. Type: "Are there any compliance issues with the marketing claims in our Q3 campaign?"
7. Show the query fanning out — the loading state shows which nodes are being queried
8. Answer streams in, drawing from ALL THREE sources:
   - Marketing source: "The campaign claims X, Y, Z about the product..."
   - Legal source: "Regulation ABC requires that claims about X must include disclaimer..."
   - Engineering source: "Feature Y is actually launching in Q4, not Q3..."
9. Citations show which source each piece of information came from

"One question. Three devices. Three different departments' sources. The answer synthesizes information that no single team had alone. And here's the key: **no data moved**. The marketing documents are still only on Alice's phone. The legal documents are still only on Carol's phone. The question traveled to each device, each device searched its own source locally, and only the relevant answer fragments came back to be synthesized.

This is what mimik's mesh makes possible. Without the mesh, you'd need a central server holding all three teams' documents. Which means one compromised server exposes everything. With the mesh, a compromised phone only exposes that one team's source — because the other teams' data was never there."

### Act 5: Resilience (1-2 minutes)

**Show:** Pull iPhone B off the network (turn off WiFi or Airplane mode).

1. Ask another question: "What are the key dates for the Q3 launch?"
2. Answer comes back from MacBook + iPhone A only
3. Show the graceful message: "Legal Compliance source is currently unavailable"
4. "The system didn't crash. It didn't hang. It told you exactly what's missing and gave you the best answer it could from the available nodes."

**Show:** Bring iPhone B back online.

5. Phone reconnects to mesh automatically
6. "And it's back. No restart needed. No re-configuration. The mesh healed itself."

### Act 6: Why mimik (1-2 minutes)

"Let me be direct about why this matters for mimik.

mimik has incredible technology — device discovery, edge microservices, local AI, cross-device routing. But the developer ecosystem is thin and there are no reference applications that show why any of this matters to a real user.

This product is that reference application. It's not a chatbot with mimik bolted on. Without mimik's mesh, this product requires a central server that defeats its own privacy promise. The mesh IS the product architecture. Device discovery, cross-device queries, session-scoped sharing — these are mimik primitives that enable something no competitor offers.

No one in the market — not Glean, not Moveworks, not Leena AI — offers distributed physical data isolation with cross-device knowledge synthesis. Because none of them have a mesh platform."

### Act 7: End Session + Close (1 minute)

1. Click "End Session"
2. Show: ephemeral sharing dissolved. KBs are private again.
3. "The meeting's over. The sharing is gone. No data was ever copied. Each device still has exactly what it started with."

"Data never moves. Queries move. That's the product. And that's what mimik makes possible."

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

- [ ] All 3 devices charged and on same WiFi network
- [ ] MacBook: mim OE runtime running, API server started, web app accessible
- [ ] MacBook: "Engineering — Release Notes" source uploaded and indexed
- [ ] iPhone A: iOS app installed, mim OE runtime starts cleanly
- [ ] iPhone A: "Marketing Campaign" source pre-loaded and indexed
- [ ] iPhone B: iOS app installed, mim OE runtime starts cleanly
- [ ] iPhone B: "Legal Compliance" source pre-loaded and indexed
- [ ] Test all 5 demo questions — verify they produce good cross-source answers
- [ ] Test graceful degradation (pull one phone, query, reconnect)
- [ ] Test session create/join/end flow end-to-end
- [ ] Browser DevTools network tab ready (to show zero external calls)
- [ ] Clean browser state (no distracting tabs/bookmarks)

---

## What Could Go Wrong + Mitigations

| Risk | Mitigation |
|---|---|
| WiFi hotspot drops | Have a backup hotspot ready. Demo works on any shared network. |
| iPhone app crashes on launch | Pre-launch apps before meeting. Have a video recording of the demo as backup. |
| mILM inference is slow | Use Qwen3.5-4B not 9B. Pre-warm the model before demo (ask one question beforehand). |
| Cross-device query timeout | Set generous timeout (30s). Have a fallback question that only queries 2 nodes. |
| mKB returns no results | Pre-test every demo question. Keep backup questions that are known-good. |
| Mesh discovery takes too long | Pre-join mesh before demo starts. The "auto-discovery" moment can be shown via the admin dashboard node list refreshing. |

---

## What to Bring to the Meeting

1. MacBook (fully charged, demo ready)
2. iPhone A (fully charged, app installed, source loaded)
3. iPhone B (fully charged, app installed, source loaded)
4. Charger for MacBook
5. One-page product overview (printed or PDF) — not a slide deck
6. Business card
7. Architecture diagram (the three-mode diagram from 04-technical.md, printed)

---

## Post-Demo Conversation Points

If mimik leadership is interested, be ready to discuss:

1. **What mimik APIs were used:** mILM, mKB, MCM, mDNS discovery, iOS SDK (CocoaPods)
2. **What worked well:** device discovery, mKB vector search, mILM OpenAI compatibility
3. **What could be improved:** mAIChain documentation, mKB chunk deletion API, developer onboarding
4. **Product vision:** distributed source platform for any industry — HR is the flagship, but the architecture serves any sensitive knowledge domain
5. **Market opportunity:** zero competitors offer distributed mesh + physical data isolation + meeting mode. mimik's "so what" problem is a product problem, not a technology problem. This product answers "so what."
