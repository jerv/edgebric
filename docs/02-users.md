# Users & Stories

---

## User Personas

### Primary Users

**The Employee (End User)**
- Any staff member with access to the company's Edgebric deployment
- Uses Edgebric in two contexts: individual knowledge queries (HR, policy, etc.) and collaborative meeting sessions
- Needs: fast, private, accurate answers to policy questions; ability to bring personal knowledge into meetings without exposing everything
- Pain: slow HR response times, embarrassment asking sensitive questions, meetings that stall because nobody has the right information
- Success: gets an accurate answer with a cited source in under 10 seconds; meetings run faster because cross-department questions get answered instantly

**The Administrator (Power User / Deployer)**
- Department lead, operations manager, or People Ops manager
- Manages organization knowledge bases, configures escalation targets, monitors usage
- Needs: a tool that reduces inbound routine queries, surfaces policy gaps, and provides visibility into what employees are asking (aggregate only)
- Pain: spending 25-35% of time answering repetitive policy questions; no visibility into what employees struggle to find
- Success: routine query volume drops, policy gaps become visible, team can spend time on strategic work

### Secondary Users

**The IT / Security Administrator**
- Responsible for deploying and maintaining Edgebric nodes on company infrastructure
- In a distributed deployment: manages which devices run which department knowledge bases
- Needs: simple setup, automatic device discovery, no cloud dependencies, clear data flow documentation for security review
- Pain: new software requests from business teams that trigger lengthy security review cycles
- Success: deploys in hours, not weeks; can demonstrate compliance posture in a single conversation; zero external dependencies to audit

**The Meeting Organizer**
- Any employee who creates meeting sessions (often a project lead, manager, or cross-functional coordinator)
- Needs: quick session creation, easy room code sharing, ability to see which knowledge bases are available in the session
- Pain: meetings that waste time because participants need information from departments not represented in the room
- Success: creates a session in seconds, participants join with a code, cross-department questions get instant AI-powered answers

**The Compliance / Legal Officer**
- Needs: demonstrable data governance for regulatory audits (GDPR, CCPA, HIPAA)
- Pain: inability to answer "where does our employee data go when they use the AI?"
- Success: the answer is "each department's data stays on their device, physically isolated" with architectural proof

### Future Users (V2+)

- Legal teams (contract playbooks, regulatory guidance on dedicated legal node)
- IT helpdesk teams (internal runbooks, system documentation)
- Finance teams (expense policy, procurement guidelines on finance node)
- Multi-office organizations (federated knowledge across locations via mimik mesh)

---

## User Stories

### Employee — Standard Query

> As an employee, I want to ask a question about company policy and get an accurate, cited answer immediately, without sending an email to HR and waiting days for a response.

- I open Edgebric in my browser or on mobile
- I type my question in plain language
- My query routes to the relevant knowledge base node(s) via the mesh
- I receive a clear answer with the exact policy source cited (document name, section, page number)
- I can click the source to view the original document at the relevant section
- Every response shows a prominent, non-dismissible disclaimer and an option to escalate to a real person if I'm unsure

---

### Employee — Personal Knowledge Base

> As an employee, I want to manage my own knowledge base so I can upload documents relevant to my work and query them privately, or share them selectively in meetings.

- I navigate to "My Knowledge Base" in Edgebric
- I upload documents (PDFs, docs, text files) that are relevant to my work
- These documents are indexed locally — they live on the device I uploaded from
- I can query my own knowledge base privately at any time
- When I join a meeting session, I choose which of my knowledge bases (or subsets) to share with that session
- My personal KB is never searchable by anyone else unless I explicitly opt it in to a session

---

### Employee — Meeting Mode (Cross-Department Queries)

> As an employee in a cross-functional meeting, I want to ask questions that span multiple departments' knowledge and get synthesized answers — without anyone having to dig through documents or message absent colleagues.

- Someone creates a meeting session and shares the room code
- I join the session by entering the room code in Edgebric
- I see which knowledge bases are available in this session (opted in by all participants)
- I opt in my own relevant knowledge bases for this session
- I (or anyone in the session) asks a question: "Are there any compliance issues with the marketing claims in our new campaign?"
- The AI queries opted-in KBs from legal, marketing, and compliance simultaneously
- I get a synthesized answer with citations from each department's documents
- The query never moved any department's data — it traveled to each KB node and brought back only the answer
- When the meeting ends, the session dissolves — the ephemeral sharing is gone

---

### Employee — Incognito Mode (V2)

> As an employee asking a sensitive policy question, I want to know with certainty that my question is not visible to HR, my manager, or anyone at the company — not now, not ever.

- I tap the lock icon to enable Incognito Mode
- I see a clear explanation of what this means technically (no query ever leaves my device)
- I unlock the incognito vault with Face ID / fingerprint (biometric gate)
- I download the required data once: company policy embeddings + local AI model
- I ask questions; a visible network-blocked indicator confirms zero outgoing traffic
- The "Ask HR to verify" button is absent — escalation is incompatible with incognito

---

### Employee — Incognito Mode: Personal Records (V2)

> As an employee, I want to privately query my own personal HR records — performance reviews, salary details, contract terms — without HR knowing I'm looking at them.

- In Incognito Mode, I tap "Download My Personal Records"
- I authenticate once with my work email + one-time code
- My personal record package downloads and is stored encrypted in the biometric-gated vault
- I ask questions about my own records privately
- All processing is local — queries never leave my device

---

### Administrator — Organization Knowledge Base Management

> As an administrator, I want to upload and manage organization-wide knowledge bases so that Edgebric always reflects current company policy.

- I navigate to "Organization Knowledge Bases" in the admin dashboard
- I create knowledge bases by department or topic (e.g., "HR Policies," "Benefits," "Employee Handbook")
- I upload PDF, Word, or plain text documents via drag-and-drop into the appropriate KB
- If the system detects potential PII in a document, I see a warning before it's added
- I receive alerts when documents haven't been updated in a configurable period (default: 6 months)
- I can archive or delete documents without deleting the entire KB

---

### Administrator — Distributed Node Management

> As an administrator, I want to manage which knowledge bases run on which devices, so I can enforce department-level data isolation.

- I see all Edgebric nodes discovered on the network via the mimik mesh
- Each node shows its device info, status, and which knowledge bases it hosts
- I assign knowledge bases to nodes: "Legal KB runs on the legal department's Mac Mini"
- The mesh handles discovery and routing — I don't configure IP addresses or network routes
- If a node goes offline, I see its status change; queries to its knowledge bases return a graceful "unavailable" message
- When the node comes back, it auto-rediscovers and resumes serving queries

---

### Administrator — Escalation Handling

> As an administrator, I want to receive questions that employees have flagged for human review so I can respond directly.

- Employee clicks "Request verification" (only available in standard mode)
- I receive the question and Edgebric's draft answer via Slack DM or email
- I can reply directly from the conversation viewer in the admin dashboard
- I can resolve escalations with or without a reply
- The employee receives a notification when I respond
- The interaction is logged with timestamp for compliance records

---

### Administrator — Analytics Dashboard

> As an administrator, I want to see what employees are asking so I can identify policy gaps and prioritize documentation work.

- I see aggregate analytics: most common question topics, unanswered questions, peak usage times
- No individual employee questions are ever visible (aggregate only; minimum 5 queries per topic)
- I see a list of questions Edgebric could not answer — these represent missing or unclear documentation
- I can export a policy gap report
- Meeting mode analytics: which cross-department question patterns are most common (helps identify where documentation is needed)

---

### IT Administrator — Deployment

> As an IT administrator, I want to deploy Edgebric nodes on our infrastructure with minimal configuration and no external dependencies.

- I install the mimik mim OE runtime on each device that will host knowledge
- Employee devices on the network discover Edgebric nodes automatically via the mimik edge service mesh — no IP configuration required
- For a single-node deployment: one command, one device, done
- For a multi-node deployment: install on additional devices, they auto-discover via mesh
- I can view device health, resource usage, and uptime from the admin panel
- I can revoke individual device tokens if a device is lost or an employee leaves

---

### Meeting Organizer — Session Management

> As a meeting organizer, I want to quickly create a knowledge-sharing session so my team can ask cross-domain questions during our meeting.

- I click "Create Session" in Edgebric
- I get a room code (e.g., "LAUNCH-2024" or a random 6-character code)
- I share the code with meeting participants via Slack, email, or verbally
- As participants join, I see their names and which knowledge bases they've opted in
- I can ask questions that query all opted-in knowledge bases simultaneously
- When the meeting ends, I close the session — all ephemeral sharing dissolves
- Session transcript (questions and answers only, not source documents) is optionally saved for meeting notes
