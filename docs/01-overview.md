> **Status: CURRENT** — Accurately describes the product vision and architecture. "Meeting Mode" (Mode 3) is not yet implemented.

# Overview — Vision, Problem & Positioning

---

## Vision

> **"Data never moves. Queries move."**

Edgebric is a **distributed knowledge platform** that enables organizations to build, distribute, and query data sources across multiple devices — where each device physically holds its own data, devices discover each other automatically via mDNS, and queries route across the network to find answers without any data leaving its host device.

The platform uses **llama.cpp** for local AI inference (LLM chat and embeddings) and **sqlite-vec** for vector similarity search, all embedded within a single SQLite database per node. No cloud dependencies.

Edgebric is not a chatbot. It is a **distributed knowledge intelligence platform** whose privacy guarantee is enforced by physics — data lives on the device that owns it, period — not by access control policies that can be misconfigured.

### Core Technology Stack

The distributed architecture relies on standard, open technologies:

- **mDNS-based device discovery** — devices on the same network find each other automatically, no IP configuration
- **Cross-device HTTP routing** — queries travel to sources without moving data to a central point
- **Local AI inference** — llama.cpp runs LLMs and embedding models on each device
- **Local vector storage** — sqlite-vec stores vectors in the same SQLite database as all other data
- **Hybrid search** — BM25 keyword search (FTS5) + vector similarity (sqlite-vec) merged via Reciprocal Rank Fusion

---

## Three Operational Modes

### 1. Org Mode (Single Node)
The simplest deployment. One device (Mac Mini, laptop, or server) holds the organization's network sources. Employees query it from their browsers. This is the existing product — a privacy-first on-premise AI assistant.

### 2. Department / Security Mode (Multi-Node Mesh)
Knowledge is distributed across multiple devices by department or sensitivity tier. The legal team's sources live on the legal department's device. HR's sources live on HR's device. Finance on finance's. mDNS discovers all nodes automatically. When an employee asks a cross-domain question, the query routes to the relevant nodes — data never leaves its host device.

**This is security architecture, not convenience.** Physical device isolation means a compromised node cannot access another department's data, because that data simply isn't there. No amount of privilege escalation, SQL injection, or access control bypass can extract data that doesn't exist on the machine.

### 3. Meeting Mode (Ephemeral Mesh)
Users create a session with a room code. Participants join by entering the code. Each participant opts in specific personal or network sources to share with the session. The AI can now answer cross-domain questions by querying all opted-in sources across participants' devices. When the meeting ends, the session dissolves — no data was ever copied.

**Example:** A product launch meeting. Marketing shares their campaign brief source. Engineering shares their release notes source. Legal shares their compliance checklist source. Someone asks: "Are there any compliance issues with the claims in slide 12?" The query hits all three sources simultaneously, and the AI synthesizes an answer drawing from all three — without any team's documents leaving their device.

---

## Problem Statement

### For Employees

Finding answers to workplace policy questions is slow, awkward, and often anxiety-inducing.

- 79% of employees need HR help at least once per month, averaging 3.6 interactions per person
- In a 2,000-person company, that's ~86,500 HR interactions per year
- Only 26% of employees use self-service HR systems effectively — the rest email, call, or message HR directly
- Employees frequently avoid asking sensitive questions entirely out of fear of being judged, flagged, or having the question used against them

### For Teams in Cross-Functional Meetings

Cross-department questions are the #1 reason meetings run long. Someone needs information owned by another team, and nobody in the room has it. The meeting stalls while someone messages a colleague, searches a shared drive, or just guesses.

- Employees spend 31 hours per month in unproductive meetings (Atlassian)
- 67% of meetings are considered failures by attendees
- Cross-functional alignment is the #1 challenge cited by product managers

### For Companies

Existing AI solutions introduce serious compliance and security risk:

- **Microsoft Copilot** has been banned by the U.S. House of Representatives due to data security concerns; average organization has 802,000 sensitive files at risk
- **Workday AI** is subject to an active class-action lawsuit alleging algorithmic discrimination
- **Cloud AI APIs** (OpenAI, Anthropic, Google) make GDPR/CCPA compliance around HR data difficult or impossible without complex legal scaffolding
- As of August 2026, the EU AI Act classifies employment-related AI as **High Risk**, requiring bias audits, human oversight, and documentation

---

## Product Positioning

### Tagline
*"Private by design. Accurate by default."*

### Secondary Tagline
*"If it's private enough for HR, it's private enough for anything."*

### Positioning Statement
For organizations that handle sensitive internal knowledge across departments, Edgebric is the distributed knowledge platform where data physically stays on the device that owns it and queries move across the mesh to find answers. Unlike cloud AI or even traditional on-prem solutions, Edgebric's privacy is enforced by architecture — not by access controls, not by contracts, not by policy.

### The HR-First Story
HR is the hero use case — not because Edgebric is exclusively an HR tool, but because HR represents the highest-stakes environment for employee trust and data sensitivity. A product that earns trust in HR earns it everywhere. Marketing leads with HR; the platform serves any team with sensitive documentation.

### The Meeting Mode Story
Meeting mode is the daily-use hook. HR queries might happen once a week. Cross-department meetings happen every day. Meeting mode gives every employee a reason to use Edgebric regularly — and every use reinforces the platform's value.

### The Hardware Story
A $699 Mac Mini M4 can serve 100-200 daily users running local AI inference. That's a one-time hardware cost vs. $150+/month for cloud AI subscriptions. For a 100-person company, cloud HR AI costs $3,600-$20,400/year. Edgebric is open source (AGPL 3.0) and free to run — pay what you want for the convenience of a signed installer, or build from source.

### Competitive Differentiation

| | Edgebric | Cloud AI (Leena, Moveworks, Copilot) | Traditional On-Prem |
|---|---|---|---|
| Data location | Each device holds its own data | Third-party cloud servers | Central on-prem server |
| Privacy guarantee | Physical isolation (data never moves) | Contractual (policy-based) | Access control (bypassable) |
| Cross-department queries | Yes — mesh routes queries, not data | Yes — but all data centralized | Siloed or centralized |
| Works offline | Yes | No | Yes |
| Device discovery | Automatic (mDNS) | N/A | Manual IP configuration |
| Meeting mode | Yes — ephemeral cross-device sessions | No | No |
| Vault sources | Yes — employee-owned, device-local, encrypted | No | No |
| Pricing | Free and open source (AGPL 3.0) / pay-what-you-want download | $3,600-$20,400/yr (100 employees) | $5,000-$50,000 server |
| Hardware cost | $599 one-time (Mac Mini) | Included in subscription | $5,000-$50,000 server |
| GDPR/CCPA compliance | By architecture | Requires legal scaffolding | By policy (auditable) |
| Powered by | llama.cpp + sqlite-vec | AWS / Azure / GCP | Bare metal / VMware |

### Competitive Landscape

- **Glean** ($7.2B valuation) — horizontal enterprise search, recently launched on-prem via expensive Dell partnership; not distributed, requires massive central infrastructure
- **Moveworks** (acquired by ServiceNow, $2.85B) — HR/IT AI, cloud-only, now bundled into $100k+ ServiceNow contracts
- **Leena AI** ($40M raised) — HR-specific, cloud-only, from $3/employee/month, complaints of generic answers
- **Guru** — general knowledge base with AI, $5-12/user, cloud-only (their term)
- **No competitor offers:** distributed multi-device mesh + physical data isolation + meeting mode + vault sources + group chats + sub-$1K hardware deployment

### Target Markets

**Primary (MVP):**
- Small-to-medium businesses (10-200 employees) with physical office presence
- Dental practices, medical offices, small law firms — industries with both sensitive data AND existing hardware (55-65% have physical servers)
- Companies with MSPs (Managed Service Providers) who can deploy and maintain the hardware — 65-75% of SMBs already have one

**Secondary (V2):**
- Multi-office organizations needing federated knowledge across locations
- Regulated industries (healthcare, legal, finance) where data residency is non-negotiable
- Any organization where department-level data isolation is a security requirement, not just a preference
