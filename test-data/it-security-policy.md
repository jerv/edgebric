# Acme Corp IT & Security Policy

**Classification:** Internal Use Only
**Last Updated:** February 15, 2026
**Owner:** Information Security Team

---

## 1. Acceptable Use Policy

### 1.1 Company Devices
Company-issued devices (laptops, phones, tablets) are provided for business use. Limited personal use is permitted, provided it does not interfere with work duties, violate any policy, or compromise device security.

### 1.2 Prohibited Activities
The following activities are strictly prohibited on company networks and devices:
- Installing unauthorized software or browser extensions
- Accessing illegal content or pirated material
- Running cryptocurrency miners or unauthorized servers
- Connecting unauthorized USB devices or external storage
- Using company resources for personal commercial ventures
- Sharing login credentials with any other person

### 1.3 Monitoring
Acme Corp reserves the right to monitor all activity on company networks and devices. This includes email, web browsing, file transfers, and application usage. Monitoring data is retained for 90 days and accessed only during investigations authorized by the CISO.

---

## 2. Password & Authentication

### 2.1 Password Requirements
All passwords must meet the following criteria:
- Minimum 14 characters
- At least one uppercase letter, one lowercase letter, one number, and one special character
- Cannot reuse the last 12 passwords
- Must be changed every 90 days

### 2.2 Multi-Factor Authentication (MFA)
MFA is required for:
- All SSO-protected applications
- VPN access
- Admin/root access to any system
- Email access from new devices

Approved MFA methods: hardware security keys (preferred), authenticator apps (Google Authenticator, Authy). SMS-based MFA is not permitted due to SIM-swap risks.

### 2.3 Password Managers
All employees are required to use the company-provided 1Password account for storing work credentials. Storing passwords in browsers, spreadsheets, or text files is prohibited.

---

## 3. Data Classification & Handling

### 3.1 Classification Levels

| Level | Description | Examples |
|-------|-------------|----------|
| **Public** | Information intended for public distribution | Marketing materials, press releases |
| **Internal** | General business information | Meeting notes, project plans, this policy |
| **Confidential** | Sensitive business data | Financial reports, contracts, employee records |
| **Restricted** | Highest sensitivity | PII databases, encryption keys, source code for security systems |

### 3.2 Handling Requirements

- **Public**: No restrictions on sharing
- **Internal**: Share within company only; no external distribution without manager approval
- **Confidential**: Encrypt in transit and at rest; access limited to need-to-know basis; log all access
- **Restricted**: All Confidential requirements plus: dedicated access controls, annual access reviews, DLP monitoring enabled

### 3.3 Data Retention
- Employee records: 7 years after separation
- Financial records: 7 years
- Contracts: Duration of contract + 6 years
- Email: 3 years (auto-archived after 1 year)
- Chat logs (Slack): 1 year
- Security logs: 2 years

---

## 4. Network Security

### 4.1 VPN
All remote access to internal systems must use the company VPN (Tailscale). Split-tunneling is enabled for non-work traffic. The VPN client auto-updates and cannot be disabled while connected to internal resources.

### 4.2 Wi-Fi
- **Office Wi-Fi**: WPA3 Enterprise with certificate-based authentication
- **Guest Wi-Fi**: Isolated network for visitors; requires daily registration at the front desk
- Employees must not connect to open/unsecured Wi-Fi networks while working. Use phone hotspot or VPN if no secure connection is available.

### 4.3 Firewall & Ports
All inbound connections are blocked by default. Exceptions require a Security Review Request (SRR) approved by the Security team. Approved exceptions are reviewed quarterly.

---

## 5. Incident Response

### 5.1 Reporting
All security incidents must be reported immediately via:
- **Email**: security@acmecorp.com
- **Slack**: #security-incidents channel
- **Phone**: Security hotline 1-800-555-0177 (24/7)

An "incident" includes: suspected phishing, unauthorized access, lost/stolen devices, malware infection, data exposure, or any unusual system behavior.

### 5.2 Response Timeline
| Severity | Response Time | Resolution Target |
|----------|--------------|-------------------|
| Critical (data breach, active attack) | 15 minutes | 4 hours |
| High (malware, unauthorized access) | 1 hour | 24 hours |
| Medium (phishing attempt, policy violation) | 4 hours | 72 hours |
| Low (suspicious activity, minor policy deviation) | 24 hours | 1 week |

### 5.3 Post-Incident Review
All Critical and High severity incidents trigger a post-incident review within 5 business days. Findings are documented and shared with the Leadership team. Remediation tasks are tracked in Jira with assigned owners and due dates.

---

## 6. Software & Patching

### 6.1 Approved Software
Only software from the Acme Software Catalog may be installed on company devices. Requests for new software must be submitted via the IT portal and approved by the Security team within 5 business days.

### 6.2 Patching
- **Critical patches**: Applied within 24 hours of release
- **High patches**: Applied within 7 days
- **Medium/Low patches**: Applied during the next monthly maintenance window (first Sunday of each month, 2-6 AM ET)

Devices that miss 2 consecutive patch cycles will have network access revoked until updated.

### 6.3 End-of-Life Software
Software that has reached end-of-life (no longer receiving security updates) must be decommissioned within 30 days of EOL date. Exceptions require CISO approval and quarterly risk assessment.

---

## 7. Physical Security

### 7.1 Badge Access
All employees must wear their ID badge visibly while on company premises. Tailgating (allowing others to enter through a badge-controlled door) is prohibited. Lost badges must be reported to Security within 2 hours.

### 7.2 Visitor Policy
All visitors must be pre-registered and escorted at all times by an Acme employee. Visitors receive a temporary badge that must be returned at the end of the visit.

### 7.3 Clean Desk Policy
At the end of each workday, employees must:
- Lock their workstation (Windows+L or Cmd+Ctrl+Q)
- Secure all confidential documents in locked drawers
- Remove any sensitive information from whiteboards

---

*Violations of this policy may result in disciplinary action up to and including termination. Questions should be directed to security@acmecorp.com.*
