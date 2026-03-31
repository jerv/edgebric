# Pricing & Distribution Plan

Last updated: 2026-03-30

---

## Business Context

- Solo founder, no employees, no sales team
- All distribution is self-service (marketing website + GitHub)
- No cloud infrastructure costs — product runs on customer hardware
- Primary goal: portfolio/resume value and community adoption
- Secondary goal: supplemental income to cover costs
- macOS only at launch

## License

### Business Source License 1.1 (BSL)

Edgebric is **source-available** under the BSL 1.1.

- **Usage Grant:** Free for personal use and internal business use (no user limits, no feature restrictions)
- **Additional Use Grant:** Non-production use (evaluation, testing, development)
- **Restriction:** No commercial redistribution — you cannot repackage, rebrand, or sell Edgebric or derivative works. You cannot offer Edgebric as a hosted/managed service.
- **Change Date:** 4 years from each release. On the change date, that release's code automatically converts to Apache 2.0.
- **Change License:** Apache License 2.0

Each release gets its own change date. The latest release is always under BSL. Only old versions eventually become fully open source.

### Why BSL

- Source code is publicly readable, auditable, and forkable for personal/internal use
- Developers can clone, build, and run it themselves
- Prevents commercial theft — nobody can rebrand and sell it
- Simpler than open-core (no feature gating, no dual codebases)
- Used by MariaDB, Sentry, CockroachDB — well-understood in the industry

### Trademark

The name "Edgebric" and associated logos are trademarks. Forks must use a different name and branding. The trademark policy will be published alongside the license.

## Distribution

### Source Code

- Public GitHub repository
- Anyone can read, clone, build from source
- Community contributions welcome (CLA required for non-trivial PRs)
- Bug reports and feature requests via GitHub Issues

### Desktop App (DMG)

- Signed and notarized macOS installer (.dmg)
- Hosted on **GitHub Releases** (free, unlimited bandwidth for public repos)
- Apple Developer Program ($99/yr) required for code signing + notarization
- Auto-updates via electron-updater pointed at GitHub Releases (no update server needed)

### Marketing Website

- Static site on **Vercel** or **Netlify** free tier
- Product overview, screenshots, hardware requirements
- "Download" button leads to Stripe Checkout (pay-what-you-want)
- "Already purchased?" page with email lookup for re-downloads
- "Need support?" page with contact info for enterprise support contracts

## Revenue Model

### Pay-What-You-Want Download

The marketing website offers a paid download for non-technical users who want a simple, normal install experience. Technical users can always build from source for free.

- **Minimum:** $5
- **Recommended (anchored):** $50
- **Preset buttons:** $30 | $50 (recommended) | $100 | Custom amount
- **Payment processor:** Stripe Checkout (no monthly fee, ~2.9% + $0.30 per transaction)

This is a convenience/support fee, not a paywall. The source code and GitHub Releases are public. The pay-what-you-want model captures value from non-technical users who prefer a guided download experience, and from supporters who want to fund development.

### Post-Purchase UX

1. User clicks "Download" on marketing site
2. Stripe Checkout opens with pay-what-you-want (preset at $50)
3. Payment completes -> redirect to thank-you page with download link
4. Stripe receipt email also includes the download link
5. Download link points to latest GitHub Release (.dmg)

### Re-Download Flow

For users who need to download again after purchase:

1. User visits "Already purchased?" page on marketing site
2. Enters the email they used at checkout
3. Serverless function queries Stripe API for matching customer
4. **Match found:** shows download link for latest release
5. **No match:** friendly message suggesting they check the email address or contact support
6. Rate-limited at 3 requests per IP per hour

### Enterprise Support Contracts

- Available on request via support@edgebric.com
- No published pricing — negotiated per engagement
- For organizations that want guaranteed response times or deployment assistance
- Not expected to be a significant revenue stream — exists as an option

## Email

- **support@edgebric.com** — public-facing contact
- Cloudflare Email Routing forwards to edgebric@gmail.com
- Gmail "Send as" configured so replies come from support@edgebric.com
- Cost: $0

## Support Policy

> Community-supported software. Bug reports welcome on GitHub. No SLA or guaranteed response times.

This messaging appears on:
- The marketing website download page
- The GitHub README
- The Stripe receipt / thank-you page

For organizations needing guaranteed support, the enterprise support contracts option is available.

## Overhead

| Item | Cost/year |
|---|---|
| Domain (edgebric.com) | $12 |
| Apple Developer Program | $99 |
| Stripe fees (per transaction) | ~2.9% + $0.30 |
| Email (Cloudflare routing) | $0 |
| Site hosting (Vercel/Netlify free tier) | $0 |
| DMG hosting (GitHub Releases) | $0 |
| Update infrastructure (GitHub Releases) | $0 |
| **Total fixed overhead** | **~$111/year** |

## Break-Even

At the $15 minimum (conservative — most sales will be minimum):
- Net per sale after Stripe: ~$14.07
- **8 sales/year to break even** on $111 fixed cost

At $50 recommended:
- Net per sale after Stripe: ~$48.25
- **3 sales/year to break even**

## Hardware Requirements (Published to Users)

### Minimum (Personal Use)

- macOS (Apple Silicon required)
- 16GB RAM
- 20GB free disk space
- Any Apple Silicon Mac (MacBook Air/Pro, iMac, Mac Mini, Mac Studio)

### Recommended (Org Server)

- Mac Mini M4 24GB ($699 new)
- Dedicated to running Edgebric
- Supports larger models (up to 27B Q3) and longer contexts

### Budget Option

- Mac Mini M4 16GB ($499) — functional for small teams with 4B models
- Refurbished Mac Mini M1/M2 16GB ($300-400) — personal/vault use

## Competitive Positioning

### vs. Cloud AI (Glean, Guru, Notion AI, GoSearch)

- Data never leaves customer premises
- No per-user fees — one download, unlimited users
- No recurring cost
- EU AI Act / HIPAA / data sovereignty compliant by architecture
- Total cost (hardware + download) < 1 month of cloud alternatives

### vs. Other Source-Available / Open Source (PrivateGPT, AnythingLLM)

- No technical setup required — GUI installer, no CLI
- Enterprise features included (SSO, vault encryption, group chats, audit)
- Polished desktop app experience
- Built for non-technical end users, not developers

### vs. Enterprise On-Prem (Pryon, Lucidworks)

- 100x cheaper
- Self-service, no sales cycle
- Designed for small orgs, not Fortune 500

## Pre-Launch Checklist

- [ ] BSL 1.1 LICENSE file added to repo root
- [ ] Trademark policy drafted and published
- [ ] Apple Developer Program enrolled
- [ ] Code signing + notarization pipeline working
- [ ] GitHub repo made public
- [ ] Marketing site live (static, Vercel/Netlify)
- [ ] Stripe Checkout configured (pay-what-you-want, $5 min, $50 default)
- [ ] Re-download email lookup serverless function deployed
- [ ] Cloudflare email routing configured (support@edgebric.com -> edgebric@gmail.com)
- [ ] Gmail "Send as" configured for support@edgebric.com
- [ ] README updated for public audience
- [ ] CONTRIBUTING.md added
- [ ] GitHub Issues templates configured
- [ ] First GitHub Release published with signed DMG
