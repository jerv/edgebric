# Overview — Vision, Problem & Positioning

---

## Vision

> **"If it's private enough for HR, it's private enough for anything."**

Edgebric is a privacy-first, on-premise AI assistant that answers questions from a company's own policy and knowledge documents — running entirely on the company's infrastructure, with zero data leaving the building.

HR is the flagship use case: the most emotionally loaded, the most legally sensitive, and the most universally relatable environment in any organization. If Edgebric earns employee trust in HR — where trust is hardest to earn — it validates the architecture for every other sensitive context a company can imagine: legal, compliance, IT, finance, executive operations, and beyond.

Edgebric is not an HR tool. It is a **private knowledge intelligence platform** whose first and most compelling story happens to be HR.

Built on [mimik](https://mimik.com)'s edge computing platform, Edgebric runs on the company's own hardware via the mim OE runtime, uses the mimik edge service mesh for device discovery, and leverages mimik's local AI stack (mKB, mILM, mAIChain) for all inference — making cloud dependency optional, not required.

---

## Problem Statement

### For Employees

Finding answers to workplace policy questions is slow, awkward, and often anxiety-inducing.

- 79% of employees need HR help at least once per month, averaging 3.6 interactions per person
- In a 2,000-person company, that's ~86,500 HR interactions per year
- Only 26% of employees use self-service HR systems effectively — the rest email, call, or message HR directly
- Employees frequently avoid asking sensitive questions entirely out of fear of being judged, flagged, or having the question used against them:
  - "What are my rights if I'm put on a PIP?"
  - "Does the company have to pay out my PTO if I quit?"
  - "How do I report my manager?"
  - "What does my non-compete actually say?"

### For HR Teams

HR spends significant time answering the same questions repeatedly, leaving less time for work that requires human judgment.

- Estimated productivity loss: ~$385,000/year per 1,000 employees from routine HR query handling
- Onboarding new HR staff requires weeks of policy familiarization
- HR cannot always verify policy details instantly during employee conversations

### For Companies

Existing AI solutions designed for this problem introduce serious compliance and security risk:

- **Microsoft Copilot** has been banned by the U.S. House of Representatives due to data security concerns; average organization has 802,000 sensitive files at risk
- **Workday AI** is subject to an active class-action lawsuit alleging algorithmic discrimination
- **Cloud AI APIs** (OpenAI, Anthropic, Google) make GDPR/CCPA compliance around HR data difficult or impossible without complex legal scaffolding — most companies are quietly non-compliant
- As of August 2026, the EU AI Act classifies employment-related AI as **High Risk**, requiring bias audits, human oversight, and documentation

---

## Product Positioning

### Tagline (Working)
*"Private by design. Accurate by default."*

### Positioning Statement
For companies that handle sensitive internal knowledge, Edgebric is the on-premise AI assistant that answers employee questions from company documents — with the security guarantee that data never leaves company infrastructure. Unlike cloud-based alternatives, Edgebric's privacy is architectural, not contractual.

### The HR-First Story
HR is positioned as the hero use case — not because Edgebric is exclusively an HR tool, but because HR represents the highest-stakes environment for employee trust and data sensitivity. A product that earns trust in HR earns it everywhere. Marketing leads with HR; the platform serves any team with sensitive documentation.

### Competitive Differentiation

| | Edgebric | Cloud AI (Leena, Glean, Copilot) |
|---|---|---|
| Data location | On company infrastructure | Third-party cloud servers |
| Privacy guarantee | Architectural (data cannot leave) | Contractual (policy-based) |
| GDPR/CCPA compliance | By design | Requires legal scaffolding |
| Works offline | Yes | No |
| Incognito mode | Yes (V2) | No |
| Personal records (private) | Yes — employee's own data, on their device (V2) | No |
| Source citations | Yes (clickable, inline) | Partial |
| Pricing | TBD (self-hosted) | $50k–$240k/yr enterprise contracts |
| Powered by | mimik edge platform | AWS / Azure / GCP |

### Competitive Landscape Summary

- **Glean** ($7.2B) — horizontal enterprise search, just launched on-prem via expensive Dell partnership; not HR-specific
- **Moveworks** (acquired by ServiceNow, $2.85B) — HR/IT AI, cloud-only, now bundled into $100k+ ServiceNow contracts
- **Leena AI** ($40M raised) — HR-specific, cloud-only, complaints of generic answers and long customization timelines
- **Guru** — general knowledge base with AI, $5-12/user, cloud-only
- **No competitor** offers: affordable on-prem + incognito mode + personal records privacy + offline capability
