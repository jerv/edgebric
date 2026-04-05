> **Status: CURRENT** — Reflects the decided business model as of 2026-03-30. Stripe checkout on marketing website is not yet implemented (placeholder only).

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

### GNU Affero General Public License v3.0 (AGPL-3.0)

Edgebric is **open source** under the AGPL 3.0.

- **Use:** Free for any purpose — personal, commercial, educational, organizational
- **Modify:** Fork it, change it, extend it
- **Distribute:** Share it, deploy it, host it
- **Copyleft:** If you distribute modified versions or run them as a network service, you must share your source code under the same AGPL 3.0 license

### Why AGPL

- True open source — OSI approved, widely recognized
- Maximum contributor friendliness and adoption
- Copyleft protects against proprietary forks (can't take the code closed-source)
- No feature gating, no dual codebases, no license keys
- Used by Mastodon, Nextcloud, Grafana — proven model for community-driven projects
- Revenue from donations (GitHub Sponsors) and pay-what-you-want downloads

### Trademark

The name "Edgebric" and associated logos are trademarks. Forks must use a different name and branding.

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

- **Pay-what-you-want download** — convenience installer for non-technical users ($5 minimum, $50 recommended)
- **GitHub Sponsors** — recurring donations
- Source code always available free on GitHub
- Not a paywall — technical users build from source

## Support

- **Contact:** support@edgebric.com
- Community-supported software. Bug reports welcome on GitHub. No SLA or guaranteed response times.
- Enterprise support contracts available on request.

## Hardware Requirements

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

### vs. Other Open Source (PrivateGPT, AnythingLLM)

- No technical setup required — GUI installer, no CLI
- Enterprise features included (SSO, vault encryption, group chats, audit)
- Polished desktop app experience
- Built for non-technical end users, not developers

### vs. Enterprise On-Prem (Pryon, Lucidworks)

- 100x cheaper
- Self-service, no sales cycle
- Designed for small orgs, not Fortune 500

## Pre-Launch Checklist

- [x] AGPL 3.0 LICENSE file added to repo root
- [ ] Trademark policy drafted and published
- [ ] Apple Developer Program enrolled
- [ ] Code signing + notarization pipeline working
- [ ] GitHub repo made public
- [ ] Marketing site live (static, Vercel/Netlify)
- [ ] Stripe Checkout configured (pay-what-you-want, $5 min, $50 default)
- [ ] Re-download email lookup serverless function deployed
- [x] Cloudflare email routing configured (support@edgebric.com -> personal email)
- [x] GitHub Sponsors enrolled
- [x] CLA + CLA Assistant bot configured
- [ ] Gmail "Send as" configured for support@edgebric.com
- [ ] README updated for public audience
- [ ] CONTRIBUTING.md added
- [ ] GitHub Issues templates configured
- [ ] First GitHub Release published with signed DMG
