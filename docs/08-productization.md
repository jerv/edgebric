# Productization Requirements

What separates the current working demo from a shippable product.

---

## Current State Audit

### What Works Today
- OIDC/SSO authentication (Google dev IdP)
- Document upload → Docling extraction → chunking → embedding via Ollama → sqlite-vec storage
- RAG query pipeline with SSE streaming and citations
- Admin dashboard with source management, user management
- Employee query interface with conversation persistence
- Group chats with @bot querying, threads, source sharing
- Email notification infrastructure

### What's Missing (by severity)

#### CRITICAL — Cannot Ship Without

**1. Organization Model (Multi-Tenancy Foundation)**
- Currently: zero concept of "organization." One flat instance.
- Needed: Organization entity (name, plan, settings, created_at). Every source, user, and session belongs to an org.
- Why critical: Cannot onboard multiple customers. Cannot isolate data between companies even if on different instances.
- Effort: Medium — schema changes, org-scoped queries throughout

**2. User Management**
- Currently: ADMIN_EMAILS env var is the only user management. Anyone with an email can log in.
- Needed: User table (email, name, role, org_id, created_at). Roles: owner, admin, member. Invite flow.
- Why critical: Cannot control who accesses the system. No audit trail of who did what.
- Effort: Medium — new table, role middleware, invite emails

**3. Source Access Control**
- Currently: all sources accessible to all users
- Needed: per-source access rules. Network sources: scoped by department or role. Vault sources: private by default.
- Why critical: department isolation is a core security promise
- Effort: Medium — permission model, query-time filtering

**4. Input Validation**
- Currently: minimal. API routes trust incoming data.
- Needed: zod schemas on every API route. Reject malformed input at the boundary.
- Why critical: without validation, any malformed request can crash the server or corrupt data
- Effort: Small-Medium — add zod schemas, validate in middleware

#### HIGH — Should Have Before Paying Customers

**5. CORS Configuration**
- Currently: hardcoded `http://localhost:5173` in development
- Needed: dynamic CORS from FRONTEND_URL env var, strict in production
- Effort: Small

**6. Rate Limiting**
- Currently: none
- Needed: per-user rate limits (prevent abuse), per-org limits (fair usage)
- Effort: Small — express-rate-limit middleware

**7. Structured Logging**
- Currently: `console.log` throughout
- Needed: pino or winston with structured JSON logs. Correlation IDs for cross-device request tracing.
- Effort: Small-Medium

**8. Error Handling**
- Currently: inconsistent. Some routes return raw errors.
- Needed: global error handler, consistent error response format, no stack traces in production
- Effort: Small

**9. Health Check Endpoint**
- Currently: none
- Needed: `GET /api/health` returns status of API, Ollama connectivity
- Effort: Small

**10. Docker Deployment**
- Currently: manual `node --import=tsx/esm src/server.ts`
- Needed: Dockerfile, docker-compose.yml for single-node deployment
- Effort: Medium

#### MEDIUM — Important for Product Quality

**11. Onboarding Wizard**
- Currently: user lands on empty dashboard
- Needed: first-run flow: create org → configure auth → create first source → upload first document → test query
- Effort: Medium — new UI flow, backend state tracking

**12. Testing**
- Currently: 2 test files in packages/core
- Needed: unit tests for all core business logic, integration tests for API routes, E2E for critical flows
- Effort: High (ongoing)

**13. CSRF Protection**
- Currently: none (session cookies without CSRF = vulnerable)
- Needed: CSRF tokens on state-changing requests
- Effort: Small

**14. Content Security Policy**
- Currently: none
- Needed: CSP headers to prevent XSS
- Effort: Small

**15. Graceful Shutdown**
- Currently: process.exit on SIGTERM
- Needed: drain connections, flush logs, close DB, then exit
- Effort: Small

---

## Compliance Posture

### On-Prem Software Model — What This Means for Compliance

Edgebric is **software sold to customers who run it on their own hardware**. We are a software vendor, not a data processor. This dramatically simplifies compliance:

| Certification | Required? | Why |
|---|---|---|
| SOC 2 Type II | No (for MVP/early) | We never touch customer data. SOC 2 audits our controls over customer data — which we don't have. Becomes relevant if we offer managed hosting. |
| HIPAA BAA | Simplified | We provide software, not a service. BAA scope is narrow: "our software doesn't transmit ePHI." No data processing agreement needed. |
| GDPR DPA | Template only | Provide a DPA template for EU customers. Our architecture is the compliance proof: data never leaves their infrastructure. |
| PCI DSS | No | We don't process payments (yet). When billing is added, use Stripe — they handle PCI. |
| ISO 27001 | No (for early stage) | Nice to have for enterprise sales. Not needed for SMB market. |
| EU AI Act | Partially | Employment-related AI is High Risk. Our human-in-the-loop (group chats with experts) + disclaimers cover the key requirements. Full compliance audit needed before EU launch. |

### Minimum Viable Compliance (What We Need Now)

1. **Privacy Policy** — Standard SaaS privacy policy. Key point: "we are a software vendor. Your data stays on your hardware. We never access, process, or store your data."
2. **Terms of Service** — Standard software license. Liability limitations. No warranty on AI accuracy (covered by disclaimer).
3. **DPA Template** — For EU customers. One-pager: "here's our architecture. Data residency is enforced by design."
4. **Architecture Document (One-Pager)** — Non-technical diagram showing data flow. For compliance officers to hand to auditors. "All processing happens on customer hardware. No external network calls."
5. **Security Practices Doc** — What we do as a vendor: code signing, dependency scanning, responsible disclosure process. NOT about customer data (because we don't have any).

**Estimated cost:** $0 (self-drafted). Legal review optional but recommended before public launch.

**What we DON'T need:**
- SOC 2 audit — not needed when we don't hold customer data
- HIPAA assessment — simplified scope for software vendor
- Expensive penetration testing — can do basic automated scanning (OWASP ZAP) for free

---

## Pricing & Distribution

See [11-pricing-distribution.md](11-pricing-distribution.md) for the full plan.

**Summary:** BSL 1.1 license, source-available on GitHub, pay-what-you-want download via marketing website ($5 minimum, $50 recommended), Stripe Checkout, ~$111/year fixed overhead.

---

## Product Quality Checklist (Pre-Launch)

- [x] Onboarding wizard completes without errors
- [x] First-time user can create source + upload doc + query in under 5 minutes
- [x] Admin can invite users and manage roles
- [x] All API routes have input validation
- [x] No console.log in production (structured logging only)
- [x] Error pages for 404, 500, network errors
- [ ] Mobile-responsive design tested on iPhone Safari
- [x] CORS properly configured for production domain
- [x] Rate limiting active
- [x] CSRF protection on all state-changing routes
- [x] CSP headers set
- [x] Health check endpoint returns accurate status
- [ ] Docker deployment tested on fresh machine
- [x] Privacy policy and ToS pages accessible
- [x] Architecture one-pager available for compliance review
- [x] Backup/restore procedure documented for SQLite database
