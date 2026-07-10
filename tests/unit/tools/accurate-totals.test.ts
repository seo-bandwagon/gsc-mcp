/**
 * Tool-layer contract for gsc_accurate_totals: lossy dimensions are rejected with an
 * actionable error before any API call, and aggregationType is required.
 */
import { describe, it, expect, vi } from 'vitest';
import { createAnalyticsTools } from '../../../src/tools/analytics.js';
import type { SearchAnalyticsApi } from '../../../src/api/search-analytics.js';

function makeHandlers() {
  const accurateTotals = vi.fn().mockResolvedValue({
    totals: { clicks: 1, impressions: 1076, ctr: 1 / 1076, position: 45.57, sum_position: 49033 },
    aggregation_type: 'byProperty',
    warnings: []
  });
  const api = { accurateTotals } as unknown as SearchAnalyticsApi;
  const { handlers } = createAnalyticsTools(api);
  return { handlers, accurateTotals };
}

const BASE = { siteUrl: 'sc-domain:example.com', startDate: '2026-07-01', endDate: '2026-07-07' };

describe('gsc_accurate_totals handler', () => {
  it("rejects 'query' in dimensions with the remedy, without calling the API", async () => {
    const { handlers, accurateTotals } = makeHandlers();
    const result = await handlers.get('gsc_accurate_totals')!({
      ...BASE,
      aggregationType: 'byProperty',
      dimensions: ['query']
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('gsc_coverage_report');
    expect(result.text).toContain('gsc_search_analytics');
    expect(accurateTotals).not.toHaveBeenCalled();
  });

  it("rejects 'page' in dimensions the same way", async () => {
    const { handlers, accurateTotals } = makeHandlers();
    const result = await handlers.get('gsc_accurate_totals')!({
      ...BASE,
      aggregationType: 'byPage',
      dimensions: ['page']
    });

    expect(result.isError).toBe(true);
    expect(accurateTotals).not.toHaveBeenCalled();
  });

  it('requires an explicit aggregationType', async () => {
    const { handlers, accurateTotals } = makeHandlers();
    const result = await handlers.get('gsc_accurate_totals')!({ ...BASE });

    expect(result.isError).toBe(true);
    expect(accurateTotals).not.toHaveBeenCalled();
  });

  it('returns totals with the aggregation type attached', async () => {
    const { handlers } = makeHandlers();
    const result = await handlers.get('gsc_accurate_totals')!({
      ...BASE,
      aggregationType: 'byProperty',
      response_format: 'json'
    });

    expect(result.isError).toBeFalsy();
    const structured = result.structured as { totals: { impressions: number }; aggregation_type: string };
    expect(structured.totals.impressions).toBe(1076);
    expect(structured.aggregation_type).toBe('byProperty');
  });
});
