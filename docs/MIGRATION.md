# Migration: v0.1.x → v0.2.0

v0.2.0 makes Google's documented data-loss behaviors impossible to ignore. Several field
and tool names change; a live daily job depending on the old names must update per this
list. **Numbers may legitimately change too** — in several places the old values were
wrong (see "Behavioral corrections").

## Renamed / removed tools

| Old | New | Notes |
|---|---|---|
| `gsc_index_coverage` | `gsc_sitemap_indexation_summary` | The old name claimed to be the Index Coverage report; it never was. The public API does not expose that report. |

## Renamed / removed fields

### `gsc_sitemap_indexation_summary` (was `gsc_index_coverage`)

| Old field | New field | Notes |
|---|---|---|
| `summary.totalUrls` | `summary.submitted_urls` | Traces to Sitemaps API `submitted`. |
| `summary.indexed` | `summary.indexed_urls` | Traces to Sitemaps API `indexed`. |
| `summary.excluded` | **removed** | Was `totalUrls − indexed`, a subtraction artifact with **no referent in the API**. Do not attempt to reconstruct it. |
| `summary.error` | `summary.sitemap_file_errors` | Counts errors reading the sitemap **files**, not URL indexing errors. |
| `exclusionReasons` | **removed** | Mixed sitemap file warnings/errors; they are not exclusion reasons. |
| — | `summary.sitemap_file_warnings` | New. |
| — | `summary.oldest_last_downloaded` | New: staleness bound for every count in the response. |
| — | `sitemaps[]` | New: per-sitemap detail incl. `last_downloaded`. |
| — | `warnings[]` | New: includes stale-fetch warnings. |

### All search-analytics responses (`gsc_search_analytics`, `gsc_top_queries`, `gsc_top_pages`, `gsc_compare_periods`, and the new tools)

| Old field | New field | Notes |
|---|---|---|
| `responseAggregationType` | `aggregation_type` | Never `'auto'` anymore — always the effective `byPage` or `byProperty`. Store it next to every impression count. |
| — | `rows[].sum_position` | New, derived: `impressions × position`. Additive; use it to recombine positions. |
| — | `count`, `total_count`, `has_more`, `next_offset` | New pagination metadata. |
| — | `row_ceiling_reached` | New: true when Google's 50,000 rows/day/search-type exposure ceiling truncated the pull. |
| — | `warnings[]` | New: data-loss, aggregation-defaulting, and quota warnings. |

### `gsc_inspect_url` / `gsc_bulk_inspect`

| Old | New | Notes |
|---|---|---|
| `verdict` etc. constrained to `PASS/NEUTRAL/FAIL` | open strings | Unknown API values (e.g. `VERDICT_UNSPECIFIED`, `PARTIAL`) pass through verbatim instead of crashing the tool with MCP `-32602`. |
| missing fields defaulted to `NEUTRAL` / `ALLOWED` / `INDEXING_ALLOWED` / `SUCCESSFUL` | missing fields are `'UNKNOWN'` | The old defaults fabricated healthy-looking values for data the API never returned. |

## Behavioral corrections (same field names, different — correct — values)

1. **`gsc_top_queries` / `gsc_top_pages` now rank over the complete row set.** Previously
   `limit` was passed to the API as `rowLimit`, so the API pre-truncated by
   clicks-then-alphabetical order and the tool re-sorted that arbitrary slice by `metric`.
   At `limit: 25, metric: "impressions"` the old tool returned only queries starting with
   `"`, digits, `a`, or `b` and omitted the property's largest queries entirely. Expect
   different (correct) rows for the same call.
2. **Complete pagination by default.** Calls without `rowLimit`/`startRow` now loop
   `startRow += 25,000` until exhaustion instead of silently capping at 25,000 rows.
   Passing `rowLimit`/`startRow` opts into manual paging with `has_more`/`next_offset`.
3. **`aggregationType` is resolved explicitly.** Omitted/`auto` becomes `byProperty`, or
   `byPage` (with a warning) when `page`/`searchAppearance` is grouped or filtered.
   Explicit `byProperty` + `page`/`searchAppearance` now fails fast with an actionable
   error instead of the API's cryptic 400.
4. **`includeTrend` is fixed.** The old implementation sent multiple `query equals`
   filters in one AND group, which can never match more than one query; trends were
   silently missing for all but (at most) one query.
5. **Resource `gsc://site/{url}/summary` totals are now real totals** (dimensionless
   pull). Previously they were the sum of the top-10 query rows — truncated AND lossy.
6. **Default text output is markdown.** Pass `response_format: "json"` for the old
   JSON-string text content. `structuredContent` is unaffected either way.
7. **Quota errors carry the remedy** (`QUOTA_EXCEEDED` code) instead of surfacing raw
   403/429 statuses.

## New tools

`gsc_verify_data_availability`, `gsc_accurate_totals`, `gsc_coverage_report`,
`gsc_search_appearance`, `gsc_query_page_pairs`.

## New resources / prompts

Resources: `gsc://guidance/aggregation`, `gsc://guidance/data-loss`, `gsc://guidance/quota`,
`gsc://guidance/position`, `gsc://schema/dimensions`.
Prompts: `gsc_daily_pull`, `gsc_coverage_audit`, `gsc_position_decomposition`.

## Daily-job checklist

- [ ] Replace `gsc_index_coverage` calls with `gsc_sitemap_indexation_summary`; drop any
      logic consuming `excluded`/`exclusionReasons`; treat `sitemap_file_errors` as file
      errors, not indexing errors.
- [ ] Read `aggregation_type` instead of `responseAggregationType`, and store it with
      every impression figure the job records.
- [ ] Stop summing stored per-day query rows into weekly totals — re-query whole windows
      and record `coverage_pct` from `gsc_coverage_report` next to query-level numbers.
- [ ] Start each run with `gsc_verify_data_availability`; treat the trailing 10 days as
      an upsert window.
- [ ] Take report headline totals from `gsc_accurate_totals`, not from summed detail rows.
- [ ] If the job parses the text content, either switch to `structuredContent` or pass
      `response_format: "json"`.
