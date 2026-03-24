# Overview — Vision, Problem & Positioning

---

## Vision

> **"Data never moves. Queries move."**

Edgebric is a **distributed knowledge platform** built on [mimik](https://mimik.com)'s edge computing mesh. It enables organizations to build, distribute, and query knowledge bases across multiple devices — where each device physically holds its own data, devices discover each other automatically via the mesh, and queries route across the network to find answers without any data leaving its host device.

HR is the flagship use case: the most emotionally loaded, the most legally sensitive, and the most universally relatable knowledge domain in any organization. If Edgebric earns employee trust in HR — where trust is hardest to earn — it validates the architecture for every other sensitive context: legal, compliance, IT, finance, executive operations, and beyond.

Edgebric is not a chatbot. It is a **distributed knowledge intelligence platform** whose privacy guarantee is enforced by physics — data lives on the device that owns it, period — not by access control policies that can be misconfigured.

### Why mimik Is Required (Not Optional)

Without mimik's edge mesh, building this product requires a central server that aggregates all knowledge — defeating the entire privacy architecture. mimik provides:

- **mDNS-based device discovery** — devices on the same network find each other automatically, no IP configuration
- **Cross-device HTTP routing** — queries travel to sources without moving data to a central point
- **Service mesh coordination** — mAIChain fans out queries to multiple source nodes and synthesizes responses
- **Local AI inference** — mILM runs LLMs and embedding models on each device, mKB stores vectors locally
- **iOS/Android SDKs** — the same architecture runs on phones, turning every device into a source node

This product literally cannot exist without mimik's platform. A central server alternative would require copying all data to one location — which is exactly the privacy problem Edgebric exists to solve.

---

## Three Operational Modes

### 1. Org Mode (Single Node)
The simplest deployment. One device (Mac Mini, laptop, or server) holds the organization's network sources. Employees query it from their browsers. This is the existing product — a privacy-first on-premise AI assistant.

### 2. Department / Security Mode (Multi-Node Mesh)
Knowledge is distributed across multiple devices by department or sensitivity tier. The legal team's sources live on the legal department's device. HR's sources live on HR's device. Finance on finance's. mimik's mesh discovers all nodes automatically. When an employee asks a cross-domain question, the query routes to the relevant nodes — data never leaves its host device.

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
A $599 Mac Mini M4 can serve 100-200 daily users running local AI inference. That's a one-time hardware cost vs. $150+/month for cloud AI subscriptions. For a 100-person company, cloud HR AI costs $3,600-$20,400/year. Edgebric costs $599 once. Solo mode is free forever — no license needed for personal use on your own machine.

### Competitive Differentiation

| | Edgebric | Cloud AI (Leena, Moveworks, Copilot) | Traditional On-Prem |
|---|---|---|---|
| Data location | Each device holds its own data | Third-party cloud servers | Central on-prem server |
| Privacy guarantee | Physical isolation (data never moves) | Contractual (policy-based) | Access control (bypassable) |
| Cross-department queries | Yes — mesh routes queries, not data | Yes — but all data centralized | Siloed or centralized |
| Works offline | Yes | No | Yes |
| Device discovery | Automatic (mDNS mesh) | N/A | Manual IP configuration |
| Meeting mode | Yes — ephemeral cross-device sessions | No | No |
| Vault sources | Yes — employee-owned, device-local, encrypted | No | No |
| Pricing | Free (solo) / $499 license (org) | $3,600-$20,400/yr (100 employees) | $5,000-$50,000 server |
| Hardware cost | $599 one-time (Mac Mini) | Included in subscription | $5,000-$50,000 server |
| GDPR/CCPA compliance | By architecture | Requires legal scaffolding | By policy (auditable) |
| Powered by | mimik edge mesh | AWS / Azure / GCP | Bare metal / VMware |

### Competitive Landscape

- **Glean** ($7.2B valuation) — horizontal enterprise search, recently launched on-prem via expensive Dell partnership; not distributed, requires massive central infrastructure
- **Moveworks** (acquired by ServiceNow, $2.85B) — HR/IT AI, cloud-only, now bundled into $100k+ ServiceNow contracts
- **Leena AI** ($40M raised) — HR-specific, cloud-only, from $3/employee/month, complaints of generic answers
- **Guru** — general knowledge base with AI, $5-12/user, cloud-only
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

---

## Why This Matters for mimik

mimik has a "so what" problem. The platform is technically impressive — mDNS discovery, edge microservices, cross-device routing, local AI inference — but there are zero reference applications that demonstrate why any of this matters to a real user.

Edgebric is that reference application. It demonstrates:

1. **Why mesh discovery matters** — devices find each other automatically, no IT configuration
2. **Why data should stay on-device** — physical isolation is stronger than any access control
3. **Why cross-device queries matter** — meeting mode and group chats create value that literally requires the mesh
4. **Why edge AI matters** — local inference means no cloud costs, no data leakage, no vendor lock-in
5. **Why iOS/Android SDKs matter** — phones become source nodes in meeting mode

This is not a generic chatbot with mimik bolted on. This is a product that cannot exist without mimik's platform — and that makes mimik's platform make sense.
