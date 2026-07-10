# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-07-10

Correctness release: makes the Search Console API's documented data losses impossible to
ignore. Several fields and one tool are renamed — see `docs/MIGRATION.md`.

### Fixed
- `gsc_top_queries` / `gsc_top_pages` ranked only a clicks-then-alphabetically truncated
  slice when `limit` was small: `metric` controlled display order, not row selection, so
  the largest rows were silently omitted. Top-N now ranks over the complete row set.
- No pagination existed anywhere; results silently capped at 25,000 rows. All
  search-analytics tools now paginate internally (`startRow += 25,000` until exhaustion)
  by default, with `count`/`total_count`/`has_more`/`next_offset` metadata and manual
  paging via explicit `rowLimit`/`startRow`.
- `gsc_inspect_url` crashed with MCP `-32602` on verdicts outside `PASS/NEUTRAL/FAIL`
  (e.g. `VERDICT_UNSPECIFIED`). Enums are now open strings with documented known values;
  missing fields report `UNKNOWN` instead of fabricated healthy defaults.
- `aggregationType` no longer defaults to `auto` (which silently changed what an
  impression means when `page` appeared): omitted values resolve to `byProperty`, or
  `byPage` (with a warning) when `page`/`searchAppearance` is grouped or filtered, and the
  effective `aggregation_type` is echoed in every response.
- `includeTrend` produced empty trends for all but one query (multiple `equals` filters
  in a single AND group can never match).
- Resource `gsc://site/<url>/summary` computed "totals" from the top-10 query rows.

### Changed
- **Renamed** `gsc_index_coverage` → `gsc_sitemap_indexation_summary`; it never was the
  Index Coverage report. The fabricated `excluded` field is removed, `error` is renamed
  `sitemap_file_errors`, and per-sitemap `last_downloaded` staleness is surfaced.
- **Renamed** `responseAggregationType` → `aggregation_type` (never `'auto'`).
- Rows carry derived, additive `sum_position` (= impressions × position).
- Text content renders as markdown by default; `response_format: "json"` restores JSON
  text. `structuredContent` unchanged.
- Quota errors return the remedy (`QUOTA_EXCEEDED`) instead of raw 403/429 statuses;
  requests grouping query+page over >30 days carry a non-fatal load warning.
- Google's 50,000 rows/day/search-type exposure ceiling is tracked: warning from 40,000
  rows, `row_ceiling_reached: true` at the ceiling naming the click-descending drop.

### Added
- Tools: `gsc_verify_data_availability` (freshness preflight), `gsc_accurate_totals`
  (ground-truth denominator; rejects lossy dimensions), `gsc_coverage_report` (measures
  what query/page grains drop), `gsc_search_appearance` (encapsulates the two-step around
  the searchAppearance exclusivity rule), `gsc_query_page_pairs` (query→page attribution
  with quota warnings).
- Resources: `gsc://guidance/aggregation`, `gsc://guidance/data-loss`,
  `gsc://guidance/quota`, `gsc://guidance/position`, `gsc://schema/dimensions`.
- Prompts: `gsc_daily_pull`, `gsc_coverage_audit`, `gsc_position_decomposition`.
- Regression tests keyed to live-verified fixtures (1,076/1,208 aggregation identity,
  86.2% query coverage, top-N full-set ranking, 25,000-row pagination boundary, verdict
  passthrough, sitemap summary shape).
- Eval suite (`evals/gsc-mcp.xml`) with 10 pinned, verified questions — five of which the
  v0.1.x server answers wrongly or crashes on.

## [0.1.1]

### Added
- Public release scaffolding: LICENSE, CONTRIBUTING, SECURITY, CHANGELOG, GitHub templates, CI.
- MCPB bundle manifest for one-click install in Claude Desktop.
- `outputSchema` and `structuredContent` on all tools.
- MCP resource `gsc://sites` exposing the user's verified property list.

### Changed
- OAuth token file now written with `0600` permissions.
- README restructured for public audience with quick-start paths for MCPB and npm.

### Security
- Token storage hardened (0600 file mode). See `SECURITY.md` for threat model.

## [0.1.0] - TBD

Initial public release.
