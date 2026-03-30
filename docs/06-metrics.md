# Success Metrics

---

## Employee Experience

| Metric | Target | Notes |
|---|---|---|
| Query deflection rate (questions answered without human involvement) | 60%+ at 3 months | Across all modes (org, meeting, personal data source) |
| Response satisfaction (thumbs up rate) | 75%+ | Includes AI answers and admin replies |
| Median query response time — single-node | < 5 seconds | Org mode, single data source |
| Median query response time — cross-node | < 8 seconds | 2-3 node fan-out |
| Median query response time — meeting mode | < 12 seconds | 3-5 participant devices |
| Vault source adoption | 40%+ of users create at least one | Key stickiness metric |

---

## Group Chats

| Metric | Target | Notes |
|---|---|---|
| Group chats created per week (per org) | 5+ at 3 months | Indicates daily-use adoption |
| Avg sources shared per group chat | 2+ | Cross-domain value indicator |
| @bot query success rate in group chats | 80%+ | % of queries that produce cited answers |
| Thread usage rate | 30%+ of messages are in threads | Indicates async collaboration value |
| Repeat creators | 50%+ create 2+ group chats | Retention signal |

---

## Meeting Mode (Distributed)

| Metric | Target | Notes |
|---|---|---|
| Sessions created per week (per organization) | 5+ at 3 months | Indicates daily-use adoption |
| Avg sources shared per session | 3+ | Cross-domain value indicator |
| Cross-domain query success rate | 80%+ | % of multi-source queries that produce cited answers |
| Session transcript export rate | 30%+ | Indicates value beyond live meeting |
| Repeat session rate | 50%+ of organizers create 2+ | Retention signal |

---

## Distributed Mesh

| Metric | Target | Notes |
|---|---|---|
| Device discovery time | < 5 seconds | From device online to mesh-visible |
| Cross-device query success rate | 95%+ | Queries that reach target source node and return results |
| Node reconnection time | < 10 seconds | From network restoration to mesh re-join |
| Graceful degradation rate | 100% | Offline node queries return "unavailable," never error |

---

## Operational Efficiency

| Metric | Target | Notes |
|---|---|---|
| Reduction in inbound routine queries to staff | 50%+ | Primary ROI metric |
| Group chat resolution rate | 80%+ | Questions resolved via group chat without external tools |
| Policy gaps surfaced per month | Positive trend | More gaps found = better documentation (V2 analytics) |

---

## Privacy & Trust

| Metric | Target | Notes |
|---|---|---|
| External data transmission incidents | 0 | Verified by architecture, not policy |
| Data on device where it belongs | 100% | No source data on wrong node |
| Audit readiness | One-sentence answer | "Where does employee data go?" → "Each department's data stays on their device" |
| Incognito adoption rate (V2) | % of employees who enable | Trust signal |

---

## Demo & Portfolio

| Metric | Target | Notes |
|---|---|---|
| Multi-device demo | Multiple devices, cross-device query with citations | Core demo moment |
| Auto-discovery demo | Device joins mesh, advertises source, queryable in < 10 seconds | Platform showcase |
| Graceful degradation demo | Pull one device off network → query returns "unavailable" for that source → reconnect → auto-rediscovers | Resilience showcase |
| Meeting mode demo | Create session → share code → join → cross-domain query → session end | Daily-use value demo |
| Architecture explanation | Zero external dependency demonstrated in 60 seconds | For compliance/security audience |
| Competitive differentiation | "No competitor offers distributed physical isolation + meeting mode" in 30 seconds | For investors/partners |
