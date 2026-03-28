# Acme Corp IT Security & Compliance Policy

## Access Control

### VPN Requirements

All remote access to internal systems requires the corporate VPN. The VPN client is Tailscale and must be installed on all company-managed devices. Personal devices are not permitted to connect to the VPN.

Split tunneling is disabled. All traffic routes through the VPN when connected.

### System Access Tiers

| Tier | Access Level | Approval Required |
|------|-------------|-------------------|
| Tier 1 | Email, Slack, Confluence | Automatic on hire |
| Tier 2 | AWS Console (read-only), Datadog | Manager approval |
| Tier 3 | AWS Console (write), Production DB | Director + Security team |
| Tier 4 | Root/admin access, Key Management | VP + CISO approval |

Access reviews are conducted quarterly. Unused accounts are automatically disabled after 90 days of inactivity.

## Compliance

### SOC 2 Type II

Acme Corp maintains SOC 2 Type II certification. Annual audits are conducted by Deloitte. The most recent audit was completed in September 2025 with zero findings.

### GDPR

European customer data is stored exclusively in the eu-west-1 (Ireland) AWS region. Data processing agreements (DPAs) are maintained with all sub-processors. Data subject access requests (DSARs) must be fulfilled within 30 days.

Right to deletion requests require complete removal from all systems including backups within 90 days.

### HIPAA

Acme Corp's healthcare vertical is HIPAA-compliant. PHI is encrypted at rest (AES-256) and in transit (TLS 1.3). Business Associate Agreements (BAAs) are required for all healthcare customers.

## Incident Categories

- **P1 (Critical)**: Data breach, system-wide outage, ransomware. Response: 15 minutes.
- **P2 (High)**: Partial service degradation, unauthorized access attempt. Response: 1 hour.
- **P3 (Medium)**: Phishing attempt, policy violation. Response: 4 hours.
- **P4 (Low)**: Software vulnerability disclosure, audit finding. Response: 24 hours.

## Data Retention

- Customer data: Retained for duration of contract + 1 year
- Employee records: 7 years after termination
- Audit logs: 5 years minimum
- Security camera footage: 90 days
- Email archives: 3 years
