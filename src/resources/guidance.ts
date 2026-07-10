/**
 * Static guidance resources encoding the semantics of the Search Console API that an
 * agent must understand to avoid producing wrong numbers. Worked examples were measured
 * live against sc-domain:seobandwagon.com (window 2026-07-01 → 2026-07-07).
 */

export interface GuidanceResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  text: string;
}

export const GUIDANCE_RESOURCES: GuidanceResource[] = [
  {
    uri: 'gsc://guidance/aggregation',
    name: 'Aggregation: byProperty vs byPage',
    description: 'What an "impression" means under each aggregation type, with a worked example. Read before comparing any two impression counts.',
    mimeType: 'text/markdown',
    text: `# byProperty vs byPage — two different units, not two estimates

An "impression" is not one thing. Its unit depends on \`aggregation_type\`:

- **byProperty** — one impression per *property* per search result page. If a query shows
  two pages from the same site, that is **1** impression.
- **byPage** — one impression per *page* per search result page. The same SERP counts as
  **2** impressions.

## Worked example (measured live, 7-day window)

| Pull | Impressions |
|---|---|
| No dimensions (byProperty) | **1,076** |
| country×device, byProperty | 1,076 (exact match) |
| country×device, byPage | **1,208** |
| page dimension, summed | 1,208 (exact match) |

Both 1,076 and 1,208 are correct. They measure different things. The 12.3% gap is not
"extra data" and not data loss — it is the unit change.

## Rules

1. **Never reconcile the two.** A byPage number can only be compared to another byPage number.
2. **Never report an impression count without its aggregation_type.** Every tool here echoes it.
3. The \`page\` dimension is **not lossy** — summing page rows exactly equals the byPage
   property total. (\`query\` IS lossy — see gsc://guidance/data-loss.)
4. As soon as \`page\` appears in dimensions or filters, the API forces byPage; byProperty
   is rejected there.
5. Position also differs by unit: byProperty uses the topmost position of any page of the
   property; byPage uses each page's own position.
`
  },
  {
    uri: 'gsc://guidance/data-loss',
    name: 'Data loss in query/page-grained pulls',
    description: 'Why detail rows under-count totals, measured coverage numbers, and why query rows are not summable across dates. Read before any query-level analysis.',
    mimeType: 'text/markdown',
    text: `# Detail pulls drop data — deterministically, by design

Google: when you group by page and/or query, "our system may drop some data in order to
be able to calculate results in a reasonable time using a reasonable amount of computing
resources." Separately, the UI-only "anonymized queries" never appear in the API at all.

## Measured coverage (same property, same 7-day window)

| Grain | Σ impressions | Coverage of true total |
|---|---|---|
| none / date / country×device | 1,076 | 100% — lossless |
| page | 1,208 (byPage unit) | 100% of the 1,208 byPage total — lossless |
| **query** | 928–931 (measured on different days) | **~86%** |
| **date×query** | 856–931 (measured on different days) | **~80–86%** |

Key observations, each load-bearing:

1. **\`page\` drops nothing; \`query\` does.** The 1,208 page sum matched the byPage
   property total exactly. The query sum never matched the 1,076 byProperty total.
2. **The dropped set is not stable.** The same window measured one day apart gave 928 and
   then 931 query-sum impressions. Coverage must be *measured at analysis time* with
   \`gsc_coverage_report\`, never assumed or reused.
3. **Coverage changes with window length** (finer/shorter grains can lose more — a
   single-day query pull measured 79.6% coverage vs 86.2% for the full week on the same
   date). Therefore **query-level rows are NOT summable across dates**: adding seven daily
   pulls under-counts vs one weekly pull. Re-query the whole window instead.
4. **Fan-out does not recover the loss.** Partitioning the query pull by device (DESKTOP +
   MOBILE, summed) recovered +0.2% once and 0% another day — noise, not a workaround.

## Protocol

- Get true totals from \`gsc_accurate_totals\` (no page/query dimensions).
- Run \`gsc_coverage_report\` for the exact window before presenting query-level analysis,
  and state the coverage next to every query-level total.
- Treat "top N" lists as reliable (the dropped rows are the small ones) but treat query
  *sums* and *shares* as underestimates.
`
  },
  {
    uri: 'gsc://guidance/quota',
    name: 'Quota: load vs QPS',
    description: 'The two quota systems, what makes a request expensive, and the remedies. Read before large or repeated pulls.',
    mimeType: 'text/markdown',
    text: `# Two quota systems

## Load quota (internal compute per query)

- **Short-term**: measured over ~10-minute windows. Remedy: wait ~15 minutes and retry, or
  spread queries out.
- **Long-term**: measured over 24 hours. If a *single* query trips quota, it is long-term
  load — waiting will not help; make the query cheaper.

What increases load:
1. Grouping or filtering by **page** or **query** — expensive; **page AND query together
   is the most expensive request the API offers** (\`gsc_query_page_pairs\`).
2. **Date-range length** — a six-month range is much more expensive than a one-day range.
   Load scales with range length.
3. **Requerying the same data.** Cache results; don't re-pull identical windows.

## QPS quota (request counting)

- Search Analytics: **1,200 queries/minute per site** and **1,200/minute per user**.
- URL Inspection: **2,000 queries/day and 600/minute per site**.
- All other resources: 20 QPS / 200 QPM per user.

## On quotaExceeded

The server returns the remedy in the error message: wait ~15 min for short-term; for
long-term, remove page/query dimensions or shorten the range. Do not blind-retry.
`
  },
  {
    uri: 'gsc://guidance/position',
    name: 'Average position is non-additive',
    description: 'How to decompose or recombine average position correctly (impression-weighted), and the sign error that misattributes ranking changes.',
    mimeType: 'text/markdown',
    text: `# Average position is an impression-weighted mean — never average it

\`position\` for any group = Σ(position × impressions) / Σ(impressions). It is **not**
additive and **not** averageable across rows. Every row from this server carries
\`sum_position\` (= impressions × position), which IS additive: to recombine any set of
rows, sum \`sum_position\`, sum \`impressions\`, and divide.

## Decomposing a sitewide average

Each entity's contribution to the sitewide average is its **position mass**:
\`sum_position / Σ sum_position\`. A page with many impressions at a deep position can
dominate the average even if it is not the "worst-ranking" page.

## The sign error to avoid (this exact mistake shipped in a real report)

Lower position = better. A page ranking **better** than the site average (e.g. page at
5.8, site at 35.9) **pulls the average down toward better values (numerically lower)**.
Removing that page makes the site average **worse (numerically higher)**. Blaming a
position-5.8 page for "dragging down" a 35.9 average has the sign backwards: it was the
only thing holding the average up.

Before attributing a change in average position:
1. Decompose by page (or query) using position mass in both periods.
2. Check whether the *mix* shifted (new impressions at deep positions) versus actual
   ranking movement of existing entities.
3. Remember byProperty vs byPage position semantics differ (gsc://guidance/aggregation).
`
  },
  {
    uri: 'gsc://schema/dimensions',
    name: 'Dimensions: validity, loss, and combination rules',
    description: 'Which dimensions exist, which combinations are valid, which are lossy, and the searchAppearance exclusivity rule.',
    mimeType: 'text/markdown',
    text: `# Dimensions

| Dimension | Lossy? | Notes |
|---|---|---|
| date | No — sums match totals exactly | Safe for time series |
| country | No | |
| device | No | DESKTOP / MOBILE / TABLET |
| page | No loss, but **changes the unit** to byPage | Forces byPage aggregation; see gsc://guidance/aggregation |
| query | **Yes — drops data** | ~86% coverage measured here; excludes anonymized queries entirely; see gsc://guidance/data-loss |
| searchAppearance | n/a | **Cannot be combined with any other dimension** in one request |

## Combination rules

- Any subset of {date, country, device, page, query} may be combined. Loss compounds at
  finer grains (query×page drops the most; also the most quota-expensive request).
- \`searchAppearance\` must be queried **alone**. To break an appearance type down by other
  dimensions, enumerate types first, then filter by each type — \`gsc_search_appearance\`
  does this two-step automatically.
- Filters count like groupings for aggregation rules: filtering by page forces byPage.
- \`aggregationType: byProperty\` + page grouping/filtering is invalid (API rejects it).

## Search types

web (default), image, video, news, discover, googleNews. Quotas and the 50k-rows/day
ceiling apply **per search type**. discover does not support the query dimension windows
the same way; expect empty results on properties without Discover traffic.
`
  }
];
