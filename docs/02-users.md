# Users & Stories

---

## User Personas

### Primary Users

**The Employee (End User)**
- Any staff member with access to the company's Edgebric deployment
- Uses Edgebric in three contexts: individual queries (HR, policy, etc.), group chats (collaborative data-source-sharing with threads), and meeting sessions (ephemeral cross-device)
- Needs: fast, private, accurate answers to policy questions; ability to collaborate with colleagues and share data sources selectively
- Pain: slow HR response times, embarrassment asking sensitive questions, meetings that stall because nobody has the right information
- Success: gets an accurate answer with a cited source in under 10 seconds; group chats enable async collaboration across teams

**The Administrator (Power User / Deployer)**
- Department lead, operations manager, or People Ops manager
- Manages network data sources, configures integrations, monitors usage
- Needs: a tool that reduces inbound routine queries, surfaces policy gaps, and provides visibility into what employees are asking (aggregate only)
- Pain: spending 25-35% of time answering repetitive policy questions; no visibility into what employees struggle to find
- Success: routine query volume drops, policy gaps become visible, team can spend time on strategic work

### Secondary Users

**The IT / Security Administrator**
- Responsible for deploying and maintaining Edgebric nodes on company infrastructure
- In a distributed deployment: manages which devices run which department data sources
- Needs: simple setup, automatic device discovery, no cloud dependencies, clear data flow documentation for security review
- Pain: new software requests from business teams that trigger lengthy security review cycles
- Success: deploys in hours, not weeks; can demonstrate compliance posture in a single conversation; zero external dependencies to audit

**The Meeting Organizer**
- Any employee who creates meeting sessions (often a project lead, manager, or cross-functional coordinator)
- Needs: quick session creation, easy room code sharing, ability to see which data sources are available in the session
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
- My query routes to the relevant source node(s) via the mesh
- I receive a clear answer with the exact source cited (document name, section, page number)
- I can click the source to view the original document at the relevant section
- Every response shows a prominent, non-dismissible disclaimer
- If I need human help, I can start a group chat and invite the relevant person directly

---

### Employee — Vault Data Sources (Personal)

> As an employee, I want to manage my own private data sources so I can upload documents relevant to my work and query them privately, or share them selectively in group chats and meetings.

- I navigate to my vault data sources in the Data Sources page
- I upload documents (PDFs, docs, text files) that are relevant to my work
- These documents are indexed locally — they live encrypted on my device
- I can query my own vault data sources privately at any time
- When I join a group chat or meeting session, I choose which data sources to share
- My vault data sources are never searchable by anyone else unless I explicitly share them

---

### Employee — Group Chat (Collaborative Queries)

> As an employee, I want to collaborate with colleagues by sharing data sources into a group chat and querying the AI together, with threaded discussions for async exploration.

- I create a group chat and invite colleagues
- Each member can share their accessible data sources into the chat (with confirmation warnings)
- Anyone can @tag the bot to query all shared data sources
- The bot reads conversation context before responding — it understands the discussion
- Threads branch off any message for focused async exploration without cluttering the main chat
- Human-to-human conversation flows freely — the bot only responds when @tagged
- Group chats can expire (24h, 1w, 1m, never) — expired chats revoke all shared data source access

---

### Employee — Meeting Mode (Cross-Department Queries)

> As an employee in a cross-functional meeting, I want to ask questions that span multiple departments' knowledge and get synthesized answers — without anyone having to dig through documents or message absent colleagues.

- Someone creates a meeting session and shares the room code
- I join the session by entering the room code in Edgebric
- I see which data sources are available in this session (opted in by all participants)
- I opt in my own relevant data sources for this session
- I (or anyone in the session) asks a question: "Are there any compliance issues with the marketing claims in our new campaign?"
- The AI queries opted-in data sources from legal, marketing, and compliance simultaneously
- I get a synthesized answer with citations from each department's documents
- The query never moved any department's data — it traveled to each data source node and brought back only the answer
- When the meeting ends, the session dissolves — the ephemeral sharing is gone

---

### Employee — Incognito Mode (V2)

> As an employee asking a sensitive policy question, I want to know with certainty that my question is not visible to HR, my manager, or anyone at the company — not now, not ever.

- I tap the lock icon to enable Incognito Mode
- I see a clear explanation of what this means technically (no query ever leaves my device)
- I unlock the incognito vault with Face ID / fingerprint (biometric gate)
- I download the required data once: company policy embeddings + local AI model
- I ask questions; a visible network-blocked indicator confirms zero outgoing traffic
- Group chats and collaboration features are absent — incompatible with incognito

---

### Employee — Incognito Mode: Personal Records (V2)

> As an employee, I want to privately query my own personal HR records — performance reviews, salary details, contract terms — without HR knowing I'm looking at them.

- In Incognito Mode, I tap "Download My Personal Records"
- I authenticate once with my work email + one-time code
- My personal record package downloads and is stored encrypted in the biometric-gated vault
- I ask questions about my own records privately
- All processing is local — queries never leave my device

---

### Administrator — Network Data Source Management

> As an administrator, I want to upload and manage network data sources so that Edgebric always reflects current company policy.

- I navigate to the Data Sources page in the admin dashboard
- I create data sources by department or topic (e.g., "HR Policies," "Benefits," "Employee Handbook")
- I upload PDF, Word, or plain text documents via drag-and-drop into the appropriate data source
- If the system detects potential PII in a document, I see a warning before it's added
- I receive alerts when documents haven't been updated in a configurable period (default: 6 months)
- I can archive or delete documents without deleting the entire data source

---

### Administrator — Distributed Node Management

> As an administrator, I want to manage which data sources run on which devices, so I can enforce department-level data isolation.

- I see all Edgebric nodes discovered on the network via the mimik mesh
- Each node shows its device info, status, and which data sources it hosts
- I assign data sources to nodes: "Legal data source runs on the legal department's Mac Mini"
- The mesh handles discovery and routing — I don't configure IP addresses or network routes
- If a node goes offline, I see its status change; queries to its data sources return a graceful "unavailable" message
- When the node comes back, it auto-rediscovers and resumes serving queries

---

### Administrator — Integration Management

> As an administrator, I want to configure external integrations (e.g., Slack bot) so employees can query Edgebric from the tools they already use.

- I navigate to Integrations in the admin settings
- I see available integrations (Slack, email notifications, future: Teams, etc.)
- For Slack: I install the Edgebric bot into our workspace via OAuth ("Add to Slack" button)
- A clear privacy notice explains: "Queries and responses sent through Slack are subject to Slack's data policies. Source documents remain on your network."
- I can enable/disable integrations and configure notification preferences
- Email notifications can be sent for group chat invites, data source share events, and chat expiration warnings

---

### IT Administrator — Deployment

> As an IT administrator, I want to deploy Edgebric nodes on our infrastructure with minimal configuration and no external dependencies.

- I install the mimik mim OE runtime on each device that will host data sources
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
- As participants join, I see their names and which data sources they've opted in
- I can ask questions that query all opted-in data sources simultaneously
- When the meeting ends, I close the session — all ephemeral sharing dissolves
- Session transcript (questions and answers only, not source documents) is optionally saved for meeting notes
