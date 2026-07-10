# Evaluations

Per-release evaluation suite for the MCP server. Tests whether an LLM client can use the
tools to answer realistic SEO questions **correctly** — including questions the v0.1.x
server answered wrongly.

## Suite layout

`gsc-mcp.xml` contains 10 question/answer pairs pinned to the live property
`sc-domain:seobandwagon.com` over the finalized window **2026-07-01 → 2026-07-07**.
Every answer was verified directly against the Google API on 2026-07-10.

Questions are independent, read-only, multi-call, and verifiable by string comparison.

## Old-server discriminators

Five questions are constructed so an agent on v0.1.x fails while v0.2.0 succeeds:

| # | Question | Why v0.1.x fails |
|---|---|---|
| 1 | True page-impression count (1,208) | Old `auto` aggregation silently returned byProperty (1,076) with no unit label |
| 2 | Query-dimension coverage (86%) | No `gsc_coverage_report`; the drop was invisible |
| 4 | #1 query in a top-25-by-impressions request | Old top-N ranked a clicks-then-alphabetical truncation; the true #1 (`yext local seo`) wasn't in the slice at all |
| 5 | Sitemap FILE errors + stale download date | Old `gsc_index_coverage` reported file errors as URL `error` counts and didn't surface `last_downloaded` |
| 7 | Inspect `/seo-services` | Old `gsc_inspect_url` crashed with MCP `-32602` on this exact URL |

## Answer stability

The window is finalized, and the lossless figures (1,076 / 1,208 / page rows / verdicts)
reproduce exactly across days. The one caveat: **query-grain coverage drifts** as Google
recomputes the dropped-data set (86.2% → 86.5% measured on consecutive days), so Q2's
answer is pinned to the nearest whole percent (86), which has been stable. If it ever
drifts past a rounding boundary, re-verify with `gsc_coverage_report` and update — the
drift itself is documented behavior (see `gsc://guidance/data-loss`).

## Running

Point your eval harness at `gsc-mcp.xml` with the server configured for an account that
has access to the pinned property. To re-pin to a different property/window: answer every
question yourself by calling the tools directly (MCP Inspector:
`npx @modelcontextprotocol/inspector npx @seobandwagon/gsc-mcp`), then replace the
answers. Prefer exact strings and integers; for percentages, round to the nearest whole
number.
