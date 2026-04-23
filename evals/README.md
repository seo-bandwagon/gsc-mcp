# Evaluations

Per-release evaluation suite for the MCP server. Exercises every tool family and tests whether an LLM client can correctly use structured tool outputs to answer realistic SEO questions.

## Why template-style?

Google Search Console data is **account-specific** and **changes daily**. A static eval that hard-codes "answer: 1,247 clicks" would be wrong tomorrow. So `gsc-mcp.xml` is a **template** — each question is parameterized against a property and a snapshot window you control.

## How to run evals (snapshot workflow)

1. **Pick a stable test property.** Ideally one you own, with at least 90 days of history and no recent major content changes. A staging site works if it has enough organic traffic.
2. **Freeze a snapshot window.** Pick a 28-day window that's at least 3 days old (so Google's data is finalized). Record `{SNAPSHOT_START}`, `{SNAPSHOT_END}`.
3. **Record the preceding window.** `{PREV_START}` = 28 days before `{SNAPSHOT_START}`; `{PREV_END}` = the day before `{SNAPSHOT_START}`.
4. **Answer each question yourself** by calling the tools directly (use MCP Inspector: `npx @modelcontextprotocol/inspector npx @seobandwagon/gsc-mcp`). Record each answer.
5. **Copy `gsc-mcp.xml` → `gsc-mcp.<property>.xml`**, substitute `{SITE}`, `{SNAPSHOT_START}`, etc., and replace each `TODO_FILL_IN` with your verified answer.
6. **Run the eval** by pointing your eval harness at the customized XML.

Tokenized placeholders in `gsc-mcp.xml`:
- `{SITE}` — property URL (e.g. `sc-domain:example.com` or `https://example.com/`)
- `{SNAPSHOT_START}`, `{SNAPSHOT_END}` — snapshot window in `YYYY-MM-DD`
- `{PREV_START}`, `{PREV_END}` — preceding window (used by the period-comparison question)

## Question coverage

| # | Tool family exercised | Tests |
|---|---|---|
| 1 | `gsc_top_queries` + filter/sort | Query-level structured output |
| 2 | `gsc_top_pages` + position filter | Page-level aggregation + threshold reasoning |
| 3 | `gsc_compare_periods` | Delta computation, sign convention |
| 4 | `gsc_inspect_url` | Index status verdict |
| 5 | `gsc_list_sitemaps` | Sitemap warning count |
| 6 | `gsc_cannibalization_check` | Multi-page query detection |
| 7 | `gsc_search_analytics` + post-filter | Dimension + metric threshold composition |
| 8 | `gsc_analyze_opportunities` | Priority breakdown |
| 9 | `gsc_top_pages` | Top-page resolution |
| 10 | `gsc_bulk_inspect` | Batch inspection verdict aggregation |

## Tips for strong answers

- Prefer **exact string answers** (query strings, URLs, API verdict enums). These verify cleanly.
- Prefer **integer counts** over floats — avoids rounding disputes.
- For percentage answers, agree on rounding ahead of time (the eval uses "nearest whole number").
- When multiple ties are possible, the question specifies how to break them (e.g. "alphabetically first").

## Future: fixture mode

A dedicated test/fixture mode for the server (returning canned `googleapis` responses) would let us ship stable, out-of-the-box evals. Tracked for v0.2+.
