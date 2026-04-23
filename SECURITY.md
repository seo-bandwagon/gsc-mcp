# Security Policy

## Reporting a vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

Email: `security@seobandwagon.com`

Include:
- A description of the issue and where it lives.
- Steps to reproduce.
- Impact assessment if you have one.

We'll acknowledge within 3 business days and aim to ship a fix or mitigation within 14 days for confirmed issues.

## Threat model

This MCP server runs locally on the user's machine and talks to Google APIs using the user's own OAuth credentials. Nothing is sent to third-party infrastructure.

### What it handles

- **Google OAuth tokens** — access + refresh tokens stored at `~/.gsc-mcp/tokens.json` with file mode `0600`.
- **OAuth client secret** — supplied via `GSC_CLIENT_SECRET` env var; never persisted by this server.
- **GSC data** — search analytics, URL inspection, sitemap metadata. Returned to the calling MCP client.

### What it does NOT do

- No telemetry.
- No outbound network calls other than to `googleapis.com` and its OAuth endpoints.
- No persistence beyond the local token and cache files under `~/.gsc-mcp/`.

## Known limitations

- **Plaintext token storage.** Tokens on disk are protected by filesystem permissions (`0600`) rather than an OS keychain. On a shared or compromised machine, root/admin access means token access. OS-keychain-backed storage is tracked for a future release.
- **OAuth scopes are broad.** The server requests `webmasters`, `analytics.readonly`, and `adwords` scopes. You can narrow these by using a custom OAuth client configured with only the scopes you need.
- **No rate-limit circuit breaker on auth failures.** If Google revokes your refresh token, the server reports the error but will retry on the next tool call. Delete `~/.gsc-mcp/tokens.json` and re-authenticate if this happens.

## Hardening suggestions for operators

- Run the server as a non-privileged user.
- Don't commit `.env` files or token files to version control (both are in `.gitignore`).
- Rotate your Google OAuth client secret if you suspect exposure.
- Revoke tokens via https://myaccount.google.com/permissions if you stop using the server.
