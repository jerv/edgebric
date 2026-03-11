# Users & Stories

---

## User Personas

### Primary Users

**The Employee (End User)**
- Any staff member with access to the company's Edgebric deployment
- Needs: fast, private, accurate answers to policy questions without involving HR for routine queries
- Pain: slow HR response times, embarrassment asking sensitive questions, fear of questions being used against them
- Success: gets an accurate answer with a cited source in under 10 seconds, any time of day

**The Administrator (Power User / Deployer)**
- Department lead, operations manager, or People Ops manager
- Needs: a tool that reduces inbound routine queries, surfaces policy gaps, and helps them answer questions faster themselves
- Pain: spending 25–35% of time answering repetitive policy questions
- Success: routine query volume drops, policy gaps become visible, team can spend time on strategic work

### Secondary Users

**The IT / Security Administrator**
- Responsible for deploying and maintaining Edgebric on company infrastructure
- Needs: simple setup, no cloud dependencies to manage, clear data flow documentation for security review
- Pain: new software requests from business teams that trigger lengthy security review cycles
- Success: deploys in hours, not weeks; can demonstrate compliance posture in a single conversation

**The Compliance / Legal Officer**
- Needs: demonstrable data governance for regulatory audits (GDPR, CCPA, HIPAA)
- Pain: inability to answer "where does our employee data go when they use the HR AI?"
- Success: the answer is "nowhere — it stays on our server" with architectural proof

### Future Users (V2+)

- Legal teams (contract playbooks, regulatory guidance)
- IT helpdesk teams (internal runbooks, system documentation)
- Compliance teams (regulatory policy Q&A)
- Finance teams (expense policy, procurement guidelines)

---

## User Stories

### Employee — Standard Mode

> As an employee, I want to ask a question about company policy and get an accurate, cited answer immediately, without sending an email to HR and waiting days for a response.

- I open Edgebric in my browser or on mobile
- I type my question in plain language
- I receive a clear answer with the exact policy source cited (document name, section, page number)
- I can click the source to view the original document at the relevant section, with the supporting passage highlighted
- Every response shows a prominent, non-dismissible disclaimer and an option to escalate to a real HR person if I'm unsure

---

### Employee — Incognito Mode (Policy Questions)

> As an employee asking a sensitive policy question, I want to know with certainty that my question is not visible to HR, my manager, or anyone at the company — not now, not ever.

- I tap the lock icon to enable Incognito Mode
- I see a clear explanation of what this means technically (no query ever leaves my device)
- I confirm I understand the minimum device requirements and estimated download size
- I unlock the incognito vault with Face ID / fingerprint (biometric gate)
- I download the required data once: company policy embeddings + local AI model
- I ask questions; a visible network-blocked indicator confirms zero outgoing traffic during processing
- Incognito mode indicator remains visible throughout my session
- The "Ask HR to verify" button is absent — escalation is incompatible with incognito

---

### Employee — Incognito Mode (Personal Records)

> As an employee, I want to privately query my own personal HR records — my performance reviews, salary details, contract terms — without HR knowing I'm looking at them.

- In Incognito Mode, I tap "Download My Personal Records"
- I authenticate once with my work email + one-time code (server logs only that I downloaded my package — not what I asked)
- My personal record package downloads and is stored encrypted in the biometric-gated vault on my device
- I ask questions about my own records: "What exactly did my last review say about my communication skills?" / "Am I formally on a PIP?"
- All processing is local — queries never leave my device
- Only my own records are in this index; other employees' data is architecturally absent

---

### Administrator — Document Management

> As an administrator, I want to upload and manage policy documents so that Edgebric always reflects current company policy.

- I upload PDF, Word, or plain text documents via drag-and-drop
- I tag each document as `Policy / Public` or decline to add it (personal records should not be uploaded to the shared index)
- If the system detects potential PII in a document, I see a warning before it's added
- I receive alerts when documents haven't been updated in a configurable period (default: 6 months)
- I can archive documents without deleting them

---

### Administrator — Personal Records Management

> As an administrator, I want to upload personal employee records so that individual employees can access their own data privately in incognito mode.

- I navigate to the Personal Records section of the admin dashboard
- I upload a document and assign it to a specific employee (by employee ID or email)
- The document is encrypted server-side; I cannot retrieve it after upload (write-once)
- The employee is notified that new personal records are available for download
- I can revoke an employee's access to their personal package if needed (e.g., post-termination)

---

### Administrator — Analytics Dashboard

> As an administrator, I want to see what employees are asking so I can identify policy gaps and prioritize documentation work.

- I see aggregate analytics: most common question topics, unanswered questions, peak usage times
- No individual employee questions are ever visible (aggregate topic-level only; minimum 5 queries per topic before it surfaces)
- I see a list of questions Edgebric could not answer — these represent missing or unclear documentation
- I can export a policy gap report

---

### Administrator — Escalation Handling

> As an administrator, I want to receive questions that employees have flagged for human review so I can respond directly.

- Employee clicks "Request verification" (only available in standard mode)
- Administrator receives the question and Edgebric's draft answer via email or in-app notification
- Administrator responds directly from the dashboard; response is delivered to the employee
- The interaction is logged with timestamp for compliance records

---

### IT Administrator — Deployment

> As an IT administrator, I want to deploy Edgebric on our own infrastructure with minimal configuration and no external dependencies.

- I run a single command to start Edgebric (Docker Compose or mim OE equivalent)
- I complete a setup wizard: company name, admin credentials, first document upload
- Employee devices on the company network discover Edgebric automatically via the mimik edge service mesh — no IP configuration required
- I can view server health, resource usage, and uptime from the admin panel
- I can revoke individual device tokens if a device is lost or an employee leaves
