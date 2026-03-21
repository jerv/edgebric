# Pricing & Distribution Plan

Last updated: 2026-03-20

---

## Business Context

- Solo founder, no employees, no sales team
- All distribution is self-service (website + download)
- No cloud infrastructure costs — product runs on customer hardware
- Target market: non-technical small orgs (medical practices, law firms, accounting firms, small startups) with sensitive documents and no IT staff
- macOS only at launch

## Pricing Model

Two purchase options. No free tier — trial only.

### Trial

- **30 days**, full product, no feature limits
- No payment info required to start
- Trial IS the sales team — product sells itself or it doesn't

### Option 1: Perpetual License

- **$499 one-time** for current major version (v1.x)
- Free updates within major version
- **Upgrade to next major version**: discounted for existing license holders (amount TBD per release)
- New customers buying v2+: full price (may adjust per version)

### Versioning & Release Plan

- **v0.5 beta**: soft launch. Single-node only (no mesh). GUI installer, full feature set minus mesh/meeting mode.
- **v1.0**: includes mesh networking + meeting mode (Phases 5-6). This is the "full product."
- Beta pricing TBD — may offer v0.5 at a discount or use beta period as extended trial.

### Option 2: Subscription

- **$49/mo** (monthly only — lower entry price, higher total cost)
- Always on the latest version, all updates included
- Cancel anytime, lose access when period ends
- After 12 months: subscriber has paid $588 vs $499 for the license
- Before annual renewal: offer to convert to perpetual license (saves them money long-term, gives us upfront cash)

### Why These Numbers

- **$499 license**: below the "need committee approval" threshold for most small businesses. Office managers can expense this on a company card.
- **$49/mo subscription**: exists for buyers who can't or won't commit to $499 up front. They pay more over time ($588/yr vs $499 one-time). License pays for itself in ~10 months. This incentivizes the license for anyone who can afford it, while still capturing buyers who prefer low monthly OpEx.
- Both options dramatically undercut alternatives:
  - Notion AI for 15 users: ~$3,600/yr
  - Glean for 15 users: ~$9,000+/yr
  - Guru for 15 users: ~$4,500/yr
  - GoSearch for 15 users: ~$4,500/yr

### What's NOT in the Model

- No per-user pricing. Ever. Unlimited users on the node.
- No free tier. Trial only.
- No annual subscription option — monthly only. The license IS the annual option. If you're committing for a year, just buy the license and save money.
- No separate support subscription at launch. Email support included with purchase. Re-evaluate if support volume becomes unmanageable.
- No tiered pricing (Pro/Enterprise/etc.) at launch. One product, one price. Mesh features (Phase 5) may warrant a separate tier later.

## Distribution

### Platform

- **macOS only** at launch
- GUI installer (Electron-based) — no CLI required for end users
- CLI available as optional advanced tool
- Apple Developer Program ($99/yr) required for notarization before public launch. Not needed during dev/beta — testers bypass Gatekeeper manually.

### Payments & Licensing

- **LemonSqueezy or Paddle** (not raw Stripe) — handles payments, license keys, tax/VAT compliance, and download delivery in one platform
- ~5% per transaction (vs Stripe's 2.9% + building license infra yourself)
- No self-built license key validation — use the platform's built-in system

### Website

- Marketing site guides customers on compatible hardware
- Minimum specs published clearly
- **Recommended hardware**: Mac Mini M4 16GB ($499)
- Marketing line: "Under $1,000 total — hardware + software — for a private AI knowledge platform for your entire office"

## Overhead

| Expense | Cost |
|---|---|
| Apple Developer Program | $99/yr |
| Domain + website hosting | ~$10-20/mo |
| LemonSqueezy/Paddle | ~5% per transaction (no monthly fee) |
| Email (support inbox) | ~$0-10/mo |
| **Total fixed overhead** | **~$50-75/mo** |

## Revenue Math

At $499/license (after ~5% platform fee = ~$474 net):

| Monthly sales | Monthly revenue | Annual revenue |
|---|---|---|
| 3 | $1,422 | $17,064 |
| 5 | $2,370 | $28,440 |
| 7 | $3,318 | $39,816 |
| 10 | $4,740 | $56,880 |

Subscription revenue ($49/mo = ~$46.55 net per month per subscriber) compounds on top of license sales as recurring base.

## Hardware Requirements (Published to Customers)

### Minimum

- macOS (Apple Silicon recommended)
- 16GB RAM
- 20GB free disk space

### Recommended

- Mac Mini M4 (16GB, $499 new)
- Dedicated to running Edgebric (not shared with other heavy workloads)

### Also Works

- Any Apple Silicon Mac with 16GB+ RAM (MacBook Air/Pro, iMac, Mac Studio)
- Refurbished Mac Mini M1/M2 with 16GB ($300-400)
- Intel Macs with 16GB+ (slower inference, no Neural Engine)

## Competitive Positioning

### vs. Cloud AI (Glean, Guru, Notion AI, GoSearch)

- Data never leaves customer premises
- No per-user fees — one price, unlimited users
- No recurring cost (license option)
- EU AI Act / HIPAA / data sovereignty compliant by architecture
- Total cost (hardware + license) < 3 months of cloud alternatives

### vs. Open Source (PrivateGPT, AnythingLLM, Ollama)

- No technical setup required — GUI installer, no CLI
- Enterprise features included (SSO, vault encryption, group chats, audit)
- Support included
- Target market literally cannot set up OSS alternatives

### vs. Enterprise On-Prem (Pryon, Lucidworks)

- 10-100x cheaper
- Self-service, no sales cycle
- Designed for small orgs, not Fortune 500

## Open Pricing Questions (Resolve Before Launch)

- Exact v2 upgrade discount (intentionally not committed to a number — decide per release)
- Whether mesh features (Phase 5) warrant a separate higher-priced tier or just a v2 price bump
- Whether to run a "Founding Customer" launch promo ($349 for first N customers)
- Education/nonprofit discount? (common in indie software, good PR)
