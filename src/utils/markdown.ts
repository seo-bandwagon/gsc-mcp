import type { SearchAnalyticsRow } from '../types/index.js';

/** Escape pipes so values can't break table layout. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString('en-US');
  return value.toFixed(2);
}

export function warningsBlock(warnings: string[] | undefined): string {
  if (!warnings || warnings.length === 0) return '';
  return warnings.map((w) => `> ⚠️ ${w}`).join('\n>\n') + '\n\n';
}

/** Render an array of flat objects as a GFM table. */
export function tableFromObjects(items: Array<Record<string, unknown>>): string {
  if (items.length === 0) return '_No rows._\n';
  const columns = [...new Set(items.flatMap((item) => Object.keys(item)))];
  const header = `| ${columns.map(cell).join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const rows = items.map(
    (item) =>
      `| ${columns
        .map((c) => {
          const v = item[c];
          return typeof v === 'number' ? formatNumber(v) : cell(v);
        })
        .join(' | ')} |`
  );
  return [header, divider, ...rows].join('\n') + '\n';
}

/** Render search-analytics rows as a table with dimension columns spelled out. */
export function analyticsRowsTable(rows: SearchAnalyticsRow[], dimensions: string[]): string {
  return tableFromObjects(
    rows.map((row) => {
      const entry: Record<string, unknown> = {};
      dimensions.forEach((dim, i) => {
        entry[dim] = row.keys[i] ?? '';
      });
      if (dimensions.length === 0 && row.keys.length > 0) entry.keys = row.keys.join(' | ');
      entry.clicks = row.clicks;
      entry.impressions = row.impressions;
      entry.ctr = `${(row.ctr * 100).toFixed(2)}%`;
      entry.position = Number(row.position.toFixed(2));
      return entry;
    })
  );
}

/**
 * Generic markdown rendering for arbitrary structured payloads: arrays of flat objects
 * become tables, nested objects become sections, scalars become bullet lists.
 */
export function toMarkdown(data: unknown, depth = 2): string {
  if (data === null || data === undefined) return '_none_\n';
  if (typeof data !== 'object') return `${cell(data)}\n`;

  if (Array.isArray(data)) {
    if (data.length === 0) return '_No items._\n';
    if (data.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))) {
      const flat = (data as Array<Record<string, unknown>>).map((item) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(item)) {
          out[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
        }
        return out;
      });
      return tableFromObjects(flat);
    }
    return data.map((item) => `- ${cell(typeof item === 'object' ? JSON.stringify(item) : item)}`).join('\n') + '\n';
  }

  const entries = Object.entries(data as Record<string, unknown>);
  const scalars = entries.filter(([, v]) => v === null || typeof v !== 'object');
  const complex = entries.filter(([, v]) => v !== null && typeof v === 'object');

  let out = '';
  if (scalars.length > 0) {
    out += scalars.map(([k, v]) => `- **${cell(k)}**: ${cell(v)}`).join('\n') + '\n';
  }
  for (const [key, value] of complex) {
    out += `\n${'#'.repeat(Math.min(depth, 6))} ${cell(key)}\n\n${toMarkdown(value, depth + 1)}`;
  }
  return out;
}
