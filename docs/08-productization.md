> **Status: CURRENT** — Audited against codebase on 2026-03-31. All critical and high-priority items are implemented.

# Productization Requirements

What separated the working demo from a shippable product. **All items below are now complete** unless explicitly marked otherwise.

---

## Implementation Status

### CRITICAL — All Complete

**1. Organization Model (Multi-Tenancy Foundation)** — DONE
- Organizations table in schema (name, plan, settings, created_at)
- Every source, user, and session belongs to an org via `orgId`
- Org routes in `routes/org.ts`

**2. User Management** — DONE
- User table with email, name, role (owner/admin/member), orgId, status, createdAt
- Invite flow with `invitedBy` field
- User store service (`services/userStore.ts`)
- Role middleware for admin/member access control

**3. Source Access Control** — DONE
- `dataSourceAccess` table with per-source email-based permissions
- `accessMode` field: "all" or "restricted"
- Permission filtering in `dataSourceStore` at query time

**4. Input Validation** — DONE
- Zod validation middleware (`middleware/validate.ts`)
- `validateBody()` applied across all route files

### HIGH — All Complete

**5. CORS Configuration** — DONE
- Dynamic CORS from FRONTEND_URL env var
- Strict allowlist with localhost fallback in dev
- mDNS (.local) support for mesh networking

**6. Rate Limiting** — DONE
- Global: 100 requests/min
- Query-specific: 20/min per session
- OAuth endpoints: 5/min (strict)
- Uses express-rate-limit

**7. Structured Logging** — DONE
- Pino logger with JSON output in production
- pino-http middleware for request logging
- Auto-ignore for `/health` and `/query` routes

**8. Error Handling** — DONE
- Global error handler with consistent response format
- 400 for validation errors, 500 for server errors
- No stack traces in production (guarded by isDev check)

**9. Health Check Endpoint** — DONE
- `GET /api/health` — checks database, inference (llama-server), vector store, disk usage
- Admin-only detailed view, public simple status

**10. Docker Deployment** — DONE
- Multi-stage Dockerfile
- `docker-compose.yml` (dev) and `docker-compose.prod.yml` (production)
- Production compose uses pre-built images from GHCR

### MEDIUM — All Complete

**11. Onboarding Wizard** — DONE
- Multi-step flow: Organization → Data Source → Upload Document → Test Query
- Route: `/onboarding`
- Component: `components/onboarding/OnboardingWizard.tsx`

**12. Testing** — DONE
- ~28 test files across packages
- API integration tests, core unit tests
- Playwright E2E tests in `e2e/` and `e2e-live/`

**13. CSRF Protection** — DONE
- Double-submit cookie implementation
- Cookie: `edgebric.csrf`, Header: `x-csrf-token`
- Timing-safe comparison using `timingSafeEqual()`

**14. Content Security Policy** — DONE
- CSP headers via Helmet with directives for default-src, script-src, style-src, img-src, connect-src
- HSTS for production

**15. Graceful Shutdown** — DONE
- SIGTERM and SIGINT handlers
- Closes HTTP server, stops sync scheduler, closes database, flushes logs
- 10-second timeout before forced exit

### Additional Items — Complete

| Item | Status | Notes |
|---|---|---|
| Toast notifications | DONE | Global toast system via `useToast` hook |
| Session expiry | DONE | 24h session maxAge, file-backed store with TTL |
| Security headers | DONE | Helmet + CSP + HSTS |
| Privacy policy / ToS | DONE | In-app at `/privacy` and `/terms` routes |
| Audit log | DONE | Immutable hash-chained log, routes in `routes/audit.ts` |
| Desktop app | DONE | Electron menu bar app with setup wizard (replaces old CLI) |

---

## Remaining Items

| Item | Status | Notes |
|---|---|---|
| Mobile-responsive design | PARTIAL | Some responsive classes exist (sm:/md:), not fully tested on iPhone Safari |
| Docker deployment test | NOT VERIFIED | Dockerfile exists but untested on fresh machine |
| Error pages (404/500) | PARTIAL | Relies on TanStack Router error handling, no dedicated components |
| Admin guide | PARTIAL | Docs exist in `docs/`, no dedicated in-app help page |

---

## Compliance Posture

### On-Prem Software Model — What This Means for Compliance

Edgebric is **software sold to customers who run it on their own hardware**. We are a software vendor, not a data processor. This dramatically simplifies compliance:

| Certification | Required? | Why |
|---|---|---|
| SOC 2 Type II | No (for MVP/early) | We never touch customer data. Becomes relevant if we offer managed hosting. |
| HIPAA BAA | Simplified | We provide software, not a service. BAA scope is narrow. |
| GDPR DPA | Template only | Provide a DPA template for EU customers. Architecture is compliance proof. |
| PCI DSS | No | Stripe handles PCI when billing is added. |
| ISO 27001 | No (for early stage) | Nice to have for enterprise sales. Not needed for SMB market. |
| EU AI Act | Partially | Employment-related AI is High Risk. Human-in-the-loop + disclaimers cover key requirements. |

### Minimum Viable Compliance (What We Need Now)

1. **Privacy Policy** — DONE (in-app at `/privacy`)
2. **Terms of Service** — DONE (in-app at `/terms`)
3. **DPA Template** — For EU customers. One-pager.
4. **Architecture Document (One-Pager)** — DONE (`10-architecture-onepager.md`)
5. **Security Practices Doc** — Code signing, dependency scanning, responsible disclosure.

---

## Pricing & Distribution

See [11-pricing-distribution.md](11-pricing-distribution.md) for the full plan.

**Summary:** AGPL 3.0 license, open source on GitHub, pay-what-you-want download via marketing website ($5 minimum, $50 recommended), GitHub Sponsors, ~$111/year fixed overhead.

---

## Product Quality Checklist (Pre-Launch)

- [x] Onboarding wizard completes without errors
- [x] First-time user can create source + upload doc + query in under 5 minutes
- [x] Admin can invite users and manage roles
- [x] All API routes have input validation
- [x] No console.log in production (structured logging only)
- [x] Error pages for common failures
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
