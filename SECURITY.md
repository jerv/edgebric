# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Edgebric, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email **support@edgebric.com** with:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation within 7 days for critical issues.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.9.x   | Yes       |
| < 0.9   | No        |

## Scope

The following are in scope for security reports:
- Authentication and session management
- Access control bypass (data source ACLs, mesh networking)
- Encryption implementation (vault mode, cloud token storage)
- Command injection (llama-server lifecycle, file operations)
- Path traversal (document upload/download)
- Cross-site scripting (XSS) in the web frontend
- CSRF bypass
- Information disclosure (audit logs, error messages, embeddings)

## Out of Scope

- Social engineering attacks
- Denial of service (DoS)
- Issues in dependencies (report these upstream, but let us know)
- Issues requiring physical access to the machine (Edgebric is a local-first application)

## Recognition

We appreciate responsible disclosure. Security researchers who report valid vulnerabilities will be credited in the release notes (unless they prefer to remain anonymous).
