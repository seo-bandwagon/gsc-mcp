# Google Search Console MCP

[![npm version](https://img.shields.io/npm/v/@seobandwagon/gsc-mcp.svg)](https://www.npmjs.com/package/@seobandwagon/gsc-mcp)
[![CI](https://github.com/seo-bandwagon/gsc-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/seo-bandwagon/gsc-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) server that brings Google Search Console into Claude and other MCP clients. Query performance, inspect URLs, manage sitemaps, and surface SEO opportunities — all with your own Google OAuth credentials. No third-party proxy.

> **Looking for a no-setup hosted experience?** Skip the OAuth dance and use the platform at [seobandwagon.com](https://seobandwagon.com) — GSC, GA4, keyword research, and more, integrated in one place.

---

## Install in Claude Desktop (one-click)

1. Download `gsc-mcp-<version>.mcpb` from the [latest release](https://github.com/seo-bandwagon/gsc-mcp/releases).
2. Double-click the `.mcpb` file — Claude Desktop opens and asks for your Google OAuth Client ID and Secret ([get them here](#1-get-google-oauth-credentials)).
3. Pre-authenticate once via `npx -p @seobandwagon/gsc-mcp gsc-mcp-auth` (opens a browser to authorize your Google account).
4. Restart Claude Desktop. Ask: "What are my top 10 queries for the last 30 days?"

That's it.

## Install via npm (any MCP client)

```bash
# Install globally, or use npx in your client config
npm install -g @seobandwagon/gsc-mcp
```

Set credentials and authenticate once:

```bash
export GSC_CLIENT_ID="your-client-id"
export GSC_CLIENT_SECRET="your-client-secret"
gsc-mcp-auth
```

Add to your MCP client config (Claude Desktop example — `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "google-search-console": {
      "command": "npx",
      "args": ["-y", "@seobandwagon/gsc-mcp"],
      "env": {
        "GSC_CLIENT_ID": "your-client-id",
        "GSC_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

Restart your client.

---

## What this does

**20 tools across 7 surfaces:**

| Surface | Tools |
|---|---|
| Sites | `gsc_list_sites` |
| Search analytics | `gsc_search_analytics`, `gsc_top_queries`, `gsc_top_pages`, `gsc_compare_periods` |
| Accuracy & coverage | `gsc_verify_data_availability`, `gsc_accurate_totals`, `gsc_coverage_report`, `gsc_search_appearance`, `gsc_query_page_pairs` |
| URL inspection | `gsc_inspect_url`, `gsc_bulk_inspect` |
| Sitemaps | `gsc_list_sitemaps`, `gsc_submit_sitemap`, `gsc_delete_sitemap`, `gsc_sitemap_indexation_summary` |
| SEO analysis | `gsc_analyze_opportunities`, `gsc_content_gaps`, `gsc_cannibalization_check` |
| Cache | `gsc_clear_cache` |

All read-only tools are annotated with `readOnlyHint` + `idempotentHint`. `gsc_delete_sitemap` is flagged `destructiveHint` and asks for confirmation. Every tool emits `structuredContent` matching a declared `outputSchema`, so clients that support structured tool output can filter and compose results directly.

**Built so an agent cannot silently produce wrong numbers.** Google's Search Console API loses data in specific, documented, deterministic ways; this server surfaces those losses instead of letting them hide:

- Every impression count carries its `aggregation_type` (`byProperty` vs `byPage` count different units — 1,076 vs 1,208 on the same week of the same property).
- Complete internal pagination by default (`startRow += 25,000` until exhaustion); top-N tools rank over the *full* row set before applying `limit`.
- `gsc_coverage_report` measures the rows Google drops from query/page-grained pulls (~86% query coverage is typical) so analyses state what they're blind to.
- Rows carry additive `sum_position` so average position can be decomposed/recombined correctly.
- The 50,000 rows/day/search-type exposure ceiling sets `row_ceiling_reached` plus a warning naming the dropped tail.
- Quota errors return the remedy, not just the status.

**Prompts included** for one-line workflows: `gsc_daily_pull`, `gsc_coverage_audit`, `gsc_position_decomposition`, `analyze-site`, `weekly-report`, `find-quick-wins`.

**Resources exposed**: guidance at `gsc://guidance/aggregation`, `gsc://guidance/data-loss`, `gsc://guidance/quota`, `gsc://guidance/position`, and `gsc://schema/dimensions`; plus `gsc://sites`, `gsc://site/<url>/summary`, `gsc://site/<url>/alerts`.

Migrating from v0.1.x? Field/tool renames are listed in [docs/MIGRATION.md](docs/MIGRATION.md).

## What this does NOT do

- No GA4. Google Analytics scope is requested but not exposed as tools yet.
- No keyword research, backlink analysis, or SERP scraping. Use the hosted platform for those.
- No writes beyond sitemap submit/delete.
- No telemetry. No data leaves your machine except to Google's APIs.

## Setup in detail

### 1. Get Google OAuth credentials

1. Open [Google Cloud Console](https://console.cloud.google.com/) → create or select a project.
2. **APIs & Services → Library** → enable **Google Search Console API**.
3. **APIs & Services → Credentials** → Create credentials → **OAuth client ID** → application type **Desktop app**.
4. **APIs & Services → OAuth consent screen** → add your Google account as a test user (unless the app is published).
5. Note the **Client ID** and **Client Secret**.

### 2. Authenticate

Run `gsc-mcp-auth` (after `npm install -g @seobandwagon/gsc-mcp`). A browser window opens, you grant access, and a refresh token is written to `~/.gsc-mcp/tokens.json` with file mode `0600`.

> **Note on MCPB:** The one-click installer configures the server, but the auth flow still has to run in a terminal (it needs a browser callback). Install the npm package globally for the `gsc-mcp-auth` binary, run it once, then the MCPB-installed server uses the stored tokens.

### 3. Configure your MCP client

See above for Claude Desktop. For other clients, point their MCP config at `npx -y @seobandwagon/gsc-mcp` with the two env vars.

## Example questions to try

- "List my Search Console sites."
- "Top 20 queries for `https://example.com/` in the last 28 days, sorted by impressions."
- "Compare this week vs last week for `sc-domain:example.com`."
- "Inspect `https://example.com/pricing` — is it indexed?"
- "Find cannibalization issues on my site over the last 90 days."
- "What quick wins can I ship this week?"

## Configuration

| Env var | Required | Default | Purpose |
|---|---|---|---|
| `GSC_CLIENT_ID` | Yes | — | Google OAuth Client ID |
| `GSC_CLIENT_SECRET` | Yes | — | Google OAuth Client Secret |
| `GSC_REDIRECT_URI` | No | `http://localhost:3000/callback` | OAuth callback URL (must match Cloud Console) |
| `GSC_TOKEN_PATH` | No | `~/.gsc-mcp/tokens.json` | Token file location |
| `GSC_CACHE_PATH` | No | `~/.gsc-mcp/cache.db` | Cache file location |
| `GSC_CACHE_TTL` | No | `3600` | Cache TTL in seconds |
| `GSC_LOG_LEVEL` | No | `info` | `debug` / `info` / `warn` / `error` |

## Rate limits & caching

The server respects GSC quotas and caches responses to stay under them:

- Search analytics: 200 req/min, responses cached 1h
- URL inspection: 600/day (2000 for large properties), cached 24h
- Sitemaps: 100 req/min, cached 15min

Clear the cache manually via the `gsc_clear_cache` tool when you need fresh data.

## Security

See [SECURITY.md](SECURITY.md) for the threat model and vulnerability reporting process.

Short version: tokens are stored plaintext on disk with file mode `0600`. Nothing leaves your machine except to `googleapis.com`. No telemetry.

## Troubleshooting

Common issues and fixes: [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Development

```bash
git clone https://github.com/seo-bandwagon/gsc-mcp.git
cd gsc-mcp
npm ci
npm run build
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow and PR expectations.

Build an MCPB bundle locally:

```bash
npm run bundle   # → gsc-mcp-<version>.mcpb
```

## License

[MIT](LICENSE) © SEO Bandwagon
