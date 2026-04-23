# Google Search Console MCP Server Specification

## Overview

An MCP (Model Context Protocol) server that connects Claude to Google Search Console, enabling AI-powered SEO analysis, reporting, and recommendations.

## Architecture

```
┌─────────────────┐     ┌─────────────────────┐     ┌──────────────────────┐
│  Claude Code /  │────▶│   GSC MCP Server    │────▶│  Google Search       │
│  Claude Desktop │     │   (TypeScript)      │     │  Console API         │
└─────────────────┘     └─────────────────────┘     └──────────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │  Local Cache    │
                        │  (SQLite)       │
                        └─────────────────┘
```

## Authentication

### OAuth 2.0 Flow
- **Client ID/Secret**: Stored in environment variables or config file
- **Scopes Required**:
  - `https://www.googleapis.com/auth/webmasters.readonly` (read-only access)
  - `https://www.googleapis.com/auth/webmasters` (full access for sitemap management)
- **Token Storage**: Encrypted local file (`~/.gsc-mcp/tokens.json`)
- **Refresh**: Automatic token refresh before expiration

### Setup Flow
1. User runs `gsc-mcp auth` to initiate OAuth flow
2. Browser opens for Google account authorization
3. Callback captures tokens and stores securely
4. MCP server uses stored credentials for API calls

---

## MCP Tools

### 1. Site Management

#### `gsc_list_sites`
List all verified sites in the user's Search Console account.

**Parameters**: None

**Returns**:
```json
{
  "sites": [
    {
      "siteUrl": "https://example.com/",
      "permissionLevel": "siteOwner"
    }
  ]
}
```

---

### 2. Search Analytics

#### `gsc_search_analytics`
Query search performance data with flexible filtering and grouping.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `siteUrl` | string | Yes | The site URL (must match verified property) |
| `startDate` | string | Yes | Start date (YYYY-MM-DD) |
| `endDate` | string | Yes | End date (YYYY-MM-DD) |
| `dimensions` | string[] | No | Group by: `query`, `page`, `country`, `device`, `searchAppearance`, `date` |
| `filters` | object[] | No | Array of filter objects (see below) |
| `rowLimit` | number | No | Max rows (default: 1000, max: 25000) |
| `startRow` | number | No | Pagination offset |
| `dataState` | string | No | `all` or `final` (default: `all`) |
| `aggregationType` | string | No | `auto`, `byPage`, `byProperty` |

**Filter Object**:
```json
{
  "dimension": "query",
  "operator": "contains",
  "expression": "seo"
}
```
Operators: `equals`, `notEquals`, `contains`, `notContains`, `includingRegex`, `excludingRegex`

**Returns**:
```json
{
  "rows": [
    {
      "keys": ["seo tips"],
      "clicks": 1250,
      "impressions": 45000,
      "ctr": 0.0278,
      "position": 4.2
    }
  ],
  "responseAggregationType": "byProperty"
}
```

#### `gsc_compare_periods`
Compare search performance between two date ranges.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `siteUrl` | string | Yes | The site URL |
| `period1Start` | string | Yes | First period start date |
| `period1End` | string | Yes | First period end date |
| `period2Start` | string | Yes | Second period start date |
| `period2End` | string | Yes | Second period end date |
| `dimensions` | string[] | No | Dimensions to group by |
| `filters` | object[] | No | Filters to apply |

**Returns**:
```json
{
  "period1": { "clicks": 5000, "impressions": 150000 },
  "period2": { "clicks": 6200, "impressions": 180000 },
  "changes": {
    "clicks": { "absolute": 1200, "percentage": 24.0 },
    "impressions": { "absolute": 30000, "percentage": 20.0 },
    "ctr": { "absolute": 0.001, "percentage": 3.3 },
    "position": { "absolute": -0.5, "percentage": -8.3 }
  }
}
```

#### `gsc_top_queries`
Get top performing queries with optional trend data.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `siteUrl` | string | Yes | The site URL |
| `startDate` | string | Yes | Start date |
| `endDate` | string | Yes | End date |
| `limit` | number | No | Number of queries (default: 100) |
| `metric` | string | No | Sort by: `clicks`, `impressions`, `ctr`, `position` |
| `includeTrend` | boolean | No | Include 7-day trend data |

#### `gsc_top_pages`
Get top performing pages with metrics breakdown.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `siteUrl` | string | Yes | The site URL |
| `startDate` | string | Yes | Start date |
| `endDate` | string | Yes | End date |
| `limit` | number | No | Number of pages (default: 100) |
| `metric` | string | No | Sort by metric |
| `includeQueryBreakdown` | boolean | No | Include top queries per page |

---

### 3. URL Inspection

#### `gsc_inspect_url`
Get detailed index and crawl information for a specific URL.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `siteUrl` | string | Yes | The site URL |
| `inspectionUrl` | string | Yes | The specific URL to inspect |

**Returns**:
```json
{
  "inspectionResult": {
    "indexStatusResult": {
      "verdict": "PASS",
      "coverageState": "Indexed, not submitted in sitemap",
      "robotsTxtState": "ALLOWED",
      "indexingState": "INDEXING_ALLOWED",
      "lastCrawlTime": "2024-01-15T10:30:00Z",
      "pageFetchState": "SUCCESSFUL",
      "googleCanonical": "https://example.com/page",
      "userCanonical": "https://example.com/page"
    },
    "mobileUsabilityResult": {
      "verdict": "PASS",
      "issues": []
    },
    "richResultsResult": {
      "verdict": "PASS",
      "detectedItems": [
        {
          "richResultType": "Article",
          "items": [{ "name": "Article" }]
        }
      ]
    }
  }
}
```

#### `gsc_bulk_inspect`
Inspect multiple URLs in batch (with rate limiting).

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `siteUrl` | string | Yes | The site URL |
| `urls` | string[] | Yes | Array of URLs to inspect (max 100) |

---

### 4. Sitemaps

#### `gsc_list_sitemaps`
List all sitemaps submitted for a site.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `siteUrl` | string | Yes | The site URL |

**Returns**:
```json
{
  "sitemap": [
    {
      "path": "https://example.com/sitemap.xml",
      "lastSubmitted": "2024-01-10T08:00:00Z",
      "isPending": false,
      "isSitemapsIndex": true,
      "lastDownloaded": "2024-01-15T06:00:00Z",
      "warnings": 0,
      "errors": 0,
      "contents": [
        {
          "type": "web",
          "submitted": 500,
          "indexed": 485
        }
      ]
    }
  ]
}
```

#### `gsc_submit_sitemap`
Submit a new sitemap for indexing.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `siteUrl` | string | Yes | The site URL |
| `sitemapUrl` | string | Yes | Full URL of the sitemap |

#### `gsc_delete_sitemap`
Remove a sitemap from Search Console.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `siteUrl` | string | Yes | The site URL |
| `sitemapUrl` | string | Yes | Full URL of the sitemap to remove |

---

### 5. Index Coverage (via Search Analytics)

#### `gsc_index_coverage`
Get index coverage statistics by analyzing sitemap and inspection data.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `siteUrl` | string | Yes | The site URL |
| `sitemapUrl` | string | No | Filter to specific sitemap |

**Returns**:
```json
{
  "summary": {
    "totalUrls": 500,
    "indexed": 485,
    "excluded": 10,
    "error": 5
  },
  "exclusionReasons": {
    "duplicateWithoutCanonical": 3,
    "notFound": 2,
    "blockedByRobots": 5
  }
}
```

---

### 6. Analysis & Recommendations

#### `gsc_analyze_opportunities`
AI-powered analysis to identify SEO improvement opportunities.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `siteUrl` | string | Yes | The site URL |
| `analysisType` | string | No | `quick`, `standard`, `deep` (default: `standard`) |
| `focus` | string[] | No | Areas to focus: `rankings`, `ctr`, `coverage`, `mobile` |

**Returns**:
```json
{
  "opportunities": [
    {
      "type": "ctr_improvement",
      "priority": "high",
      "title": "Improve CTR for high-impression queries",
      "description": "15 queries have >10k impressions but <1% CTR",
      "queries": ["keyword1", "keyword2"],
      "estimatedImpact": {
        "additionalClicks": 500,
        "confidence": "medium"
      },
      "recommendations": [
        "Update title tags to include target keywords",
        "Add compelling meta descriptions",
        "Consider adding structured data for rich snippets"
      ]
    }
  ],
  "quickWins": [
    {
      "type": "ranking_improvement",
      "description": "8 queries ranking positions 4-10 with good CTR potential",
      "queries": ["keyword3", "keyword4"]
    }
  ]
}
```

#### `gsc_content_gaps`
Identify content gaps based on query data.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `siteUrl` | string | Yes | The site URL |
| `startDate` | string | Yes | Start date |
| `endDate` | string | Yes | End date |
| `minImpressions` | number | No | Minimum impressions threshold |

**Returns**:
```json
{
  "gaps": [
    {
      "queryCluster": "how to * seo",
      "queries": ["how to improve seo", "how to do seo"],
      "totalImpressions": 25000,
      "avgPosition": 15.3,
      "existingContent": null,
      "recommendation": "Create comprehensive guide targeting this query cluster"
    }
  ]
}
```

#### `gsc_cannibalization_check`
Detect keyword cannibalization issues.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `siteUrl` | string | Yes | The site URL |
| `startDate` | string | Yes | Start date |
| `endDate` | string | Yes | End date |
| `minPages` | number | No | Min pages ranking for same query (default: 2) |

**Returns**:
```json
{
  "cannibalizationIssues": [
    {
      "query": "seo tips",
      "pages": [
        { "url": "/seo-tips", "position": 5.2, "clicks": 100 },
        { "url": "/blog/seo-tips-2024", "position": 8.1, "clicks": 45 }
      ],
      "recommendation": "Consolidate content or differentiate page intent"
    }
  ]
}
```

---

## MCP Resources

### `gsc://sites`
List of all verified sites as a resource.

### `gsc://site/{siteUrl}/summary`
Quick summary of a site's recent performance.

### `gsc://site/{siteUrl}/alerts`
Active issues and alerts for a site.

---

## MCP Prompts

### `analyze-site`
**Description**: Comprehensive site analysis prompt

**Arguments**:
- `siteUrl`: The site to analyze
- `timeframe`: Analysis period (7d, 30d, 90d)

**Template**:
```
Analyze the SEO performance of {siteUrl} over the last {timeframe}:
1. Pull search analytics data
2. Identify top performing content
3. Find declining queries/pages
4. Check for indexing issues
5. Provide actionable recommendations
```

### `weekly-report`
**Description**: Generate a weekly SEO performance report

### `compare-competitors`
**Description**: Compare performance against competitor domains (requires manual competitor input)

---

## Configuration

### Environment Variables
```bash
# Required
GSC_CLIENT_ID=your-client-id
GSC_CLIENT_SECRET=your-client-secret

# Optional
GSC_REDIRECT_URI=http://localhost:3000/callback
GSC_TOKEN_PATH=~/.gsc-mcp/tokens.json
GSC_CACHE_PATH=~/.gsc-mcp/cache.db
GSC_CACHE_TTL=3600  # seconds
GSC_LOG_LEVEL=info
```

### MCP Configuration (claude_desktop_config.json)
```json
{
  "mcpServers": {
    "google-search-console": {
      "command": "npx",
      "args": ["-y", "gsc-mcp-server"],
      "env": {
        "GSC_CLIENT_ID": "your-client-id",
        "GSC_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

---

## Rate Limiting & Caching

### Google API Limits
- Search Analytics: 200 requests per minute
- URL Inspection: 600 inspections per property per day (2000 for large properties)
- Sitemaps: 100 requests per minute

### Caching Strategy
- **Search Analytics**: Cache for 1 hour (data updates daily)
- **URL Inspection**: Cache for 24 hours (crawl data changes infrequently)
- **Sitemaps**: Cache for 15 minutes

### Implementation
```typescript
interface CacheEntry {
  key: string;
  data: any;
  timestamp: number;
  ttl: number;
}

// SQLite table for caching
CREATE TABLE cache (
  key TEXT PRIMARY KEY,
  data TEXT,
  timestamp INTEGER,
  ttl INTEGER
);
```

---

## Error Handling

### Error Response Format
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "API rate limit exceeded. Retry after 60 seconds.",
    "retryAfter": 60,
    "details": {
      "endpoint": "searchAnalytics.query",
      "limit": "200/min"
    }
  }
}
```

### Error Codes
| Code | Description | Recovery |
|------|-------------|----------|
| `AUTH_REQUIRED` | No valid credentials | Run auth flow |
| `AUTH_EXPIRED` | Token expired | Auto-refresh or re-auth |
| `SITE_NOT_FOUND` | Site not in account | Verify site URL |
| `PERMISSION_DENIED` | Insufficient permissions | Check site permissions |
| `RATE_LIMIT_EXCEEDED` | API quota hit | Wait and retry |
| `INVALID_DATE_RANGE` | Date range issues | Check date format/range |
| `QUOTA_EXCEEDED` | Daily quota exhausted | Wait until reset |

---

## Data Models

### SearchAnalyticsRow
```typescript
interface SearchAnalyticsRow {
  keys: string[];           // Values for each dimension
  clicks: number;
  impressions: number;
  ctr: number;              // 0.0 to 1.0
  position: number;         // Average position (1.0 = top)
}
```

### InspectionResult
```typescript
interface InspectionResult {
  indexStatusResult: {
    verdict: 'PASS' | 'NEUTRAL' | 'FAIL';
    coverageState: string;
    robotsTxtState: 'ALLOWED' | 'DISALLOWED';
    indexingState: 'INDEXING_ALLOWED' | 'BLOCKED_BY_META_TAG' | 'BLOCKED_BY_HTTP_HEADER';
    lastCrawlTime?: string;
    pageFetchState: 'SUCCESSFUL' | 'SOFT_404' | 'BLOCKED_ROBOTS_TXT' | 'NOT_FOUND' | 'ACCESS_DENIED' | 'SERVER_ERROR' | 'REDIRECT_ERROR' | 'ACCESS_FORBIDDEN' | 'BLOCKED_4XX' | 'INTERNAL_CRAWL_ERROR' | 'INVALID_URL';
    googleCanonical?: string;
    userCanonical?: string;
    referringUrls?: string[];
  };
  mobileUsabilityResult?: {
    verdict: 'PASS' | 'FAIL';
    issues: MobileIssue[];
  };
  richResultsResult?: {
    verdict: 'PASS' | 'FAIL';
    detectedItems: RichResultItem[];
  };
}
```

---

## Project Structure

```
gsc-mcp-server/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── auth/
│   │   ├── oauth.ts          # OAuth 2.0 flow
│   │   └── tokens.ts         # Token management
│   ├── api/
│   │   ├── client.ts         # Google API client wrapper
│   │   ├── search-analytics.ts
│   │   ├── url-inspection.ts
│   │   └── sitemaps.ts
│   ├── tools/
│   │   ├── sites.ts
│   │   ├── analytics.ts
│   │   ├── inspection.ts
│   │   ├── sitemaps.ts
│   │   └── analysis.ts       # AI-powered analysis tools
│   ├── cache/
│   │   └── sqlite.ts         # SQLite cache implementation
│   ├── utils/
│   │   ├── rate-limiter.ts
│   │   ├── date.ts
│   │   └── errors.ts
│   └── types/
│       └── index.ts          # TypeScript interfaces
├── package.json
├── tsconfig.json
└── README.md
```

---

## Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "googleapis": "^130.0.0",
    "better-sqlite3": "^9.4.0",
    "open": "^10.0.0",
    "express": "^4.18.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/express": "^4.17.0"
  }
}
```

---

## Security Considerations

1. **Token Storage**: Encrypt OAuth tokens at rest using system keychain or encrypted file
2. **Scopes**: Request minimum required scopes; offer read-only mode
3. **Logging**: Never log access tokens or sensitive query data
4. **Input Validation**: Validate all URL inputs to prevent injection attacks
5. **Rate Limiting**: Implement client-side rate limiting to protect user's API quota

---

## Future Enhancements

1. **Multi-property dashboard**: Aggregate data across multiple properties
2. **Scheduled reports**: Automated weekly/monthly email reports
3. **Historical data storage**: Store data beyond GSC's 16-month retention
4. **Competitor tracking**: Track competitor visibility for shared keywords (via SERP data)
5. **Integration with Google Analytics**: Combine GSC data with GA4 for full funnel analysis
6. **Custom alerts**: Configurable alerts for ranking drops, traffic changes
