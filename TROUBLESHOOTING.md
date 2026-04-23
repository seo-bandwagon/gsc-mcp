# GSC MCP Server - Troubleshooting Guide

## Quick Fixes

Most issues can be resolved by re-authenticating:

```bash
cd "/Volumes/T7 Storage/GSC-Claude"
rm ~/.gsc-mcp/tokens.json
npm run auth
```

Then restart Claude Desktop.

---

## Common Errors

### `unauthorized_client`

**Symptoms:** Server fails to start with "unauthorized_client" error.

**Cause:** OAuth tokens have become invalid. This can happen if:
- Tokens expired and couldn't be refreshed
- You revoked app access in your Google account
- The OAuth consent screen configuration changed

**Fix:**
```bash
rm ~/.gsc-mcp/tokens.json
npm run auth
```

---

### `deleted_client`

**Symptoms:** Server fails with "deleted_client" or "OAuth credentials deleted" error.

**Cause:** The OAuth Client ID configured in Claude Desktop has been deleted from Google Cloud Console.

**Fix:**
1. Go to [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **+ CREATE CREDENTIALS** → **OAuth client ID**
3. Select **Desktop app** and create
4. Copy the new Client ID and Client Secret
5. Update `~/Library/Application Support/Claude/claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "google-search-console": {
         "env": {
           "GSC_CLIENT_ID": "YOUR_NEW_CLIENT_ID",
           "GSC_CLIENT_SECRET": "YOUR_NEW_CLIENT_SECRET"
         }
       }
     }
   }
   ```
6. Delete old tokens and re-authenticate:
   ```bash
   rm ~/.gsc-mcp/tokens.json
   npm run auth
   ```

---

### `invalid_grant`

**Symptoms:** Token refresh fails with "invalid_grant" error.

**Cause:** Refresh token has been revoked or expired. This can happen if:
- You revoked access in [Google Account Permissions](https://myaccount.google.com/permissions)
- The token hasn't been used for an extended period
- You've hit the limit of active refresh tokens (usually 50)

**Fix:**
```bash
rm ~/.gsc-mcp/tokens.json
npm run auth
```

---

### Empty Search Analytics Results

**Symptoms:** API calls succeed but return empty `rows: []`.

**Possible Causes:**

1. **Date range issue:** Search Console data has a ~3 day delay. Use dates at least 3 days in the past.

2. **Site not verified:** Check that you have access to the site in [Google Search Console](https://search.google.com/search-console).

3. **New site:** New sites may take weeks to accumulate enough data to appear in reports.

4. **Stale cache:** Clear the local cache:
   ```bash
   rm ~/.gsc-mcp/cache.json
   ```

5. **Wrong site URL format:** Site URLs must match exactly how they appear in Search Console:
   - Domain properties: `sc-domain:example.com`
   - URL-prefix properties: `https://example.com/` or `http://example.com/`

---

### Permission Denied (403)

**Symptoms:** API calls fail with "Permission denied" error.

**Cause:** Your Google account doesn't have sufficient permissions for the site.

**Fix:**
1. Go to [Google Search Console](https://search.google.com/search-console)
2. Verify you can access the site in the web interface
3. Check your permission level (Owner, Full, or Restricted)
4. If you don't have access, ask the site owner to add you

---

### Site Not Found (404)

**Symptoms:** API calls fail with "Site not found" error.

**Cause:** The site URL doesn't match any property in your Search Console account.

**Fix:**
1. List your available sites:
   ```bash
   # Use the gsc_list_sites tool or check the web interface
   ```
2. Verify the exact URL format matches (including http/https, www/non-www, trailing slash)
3. For domain properties, use the `sc-domain:` prefix

---

### Rate Limiting (429)

**Symptoms:** API calls fail with "Rate limited" or take a long time.

**Cause:** You've exceeded Google's API rate limits.

**What happens:**
- The server automatically waits and retries (up to 3 times)
- Wait time is determined by Google's `retry-after` header (usually 60s)

**Prevention:**
- Reduce concurrent queries
- Use caching (enabled by default)
- Batch operations when possible

---

### Configuration Errors

**Symptoms:** Server fails to start with "GSC_CLIENT_ID required" or similar.

**Fix:** Verify your Claude Desktop configuration at `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "google-search-console": {
      "command": "node",
      "args": ["/Volumes/T7 Storage/GSC-Claude/dist/index.js"],
      "env": {
        "GSC_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
        "GSC_CLIENT_SECRET": "GOCSPX-your-secret"
      }
    }
  }
}
```

---

## Debugging

### Enable Debug Logging

Add `GSC_LOG_LEVEL` to your config for more verbose output:

```json
{
  "mcpServers": {
    "google-search-console": {
      "env": {
        "GSC_CLIENT_ID": "...",
        "GSC_CLIENT_SECRET": "...",
        "GSC_LOG_LEVEL": "debug"
      }
    }
  }
}
```

Log levels: `debug`, `info`, `warn`, `error`

### Check Token Status

View your current tokens:
```bash
cat ~/.gsc-mcp/tokens.json
```

Check expiry time (expiry_date is Unix timestamp in milliseconds):
```bash
node -e "const t=require('$HOME/.gsc-mcp/tokens.json'); console.log('Expires:', new Date(t.expiry_date))"
```

### Clear Cache

If you suspect stale cached data:
```bash
rm ~/.gsc-mcp/cache.json
```

### Test API Directly

Test that authentication works:
```bash
cd "/Volumes/T7 Storage/GSC-Claude"
node -e "
import('./dist/api/client.js').then(async ({GSCClient}) => {
  const {getConfig} = await import('./dist/utils/config.js');
  const {SitesApi} = await import('./dist/api/sites.js');
  const client = new GSCClient(getConfig());
  await client.initialize();
  const sites = await new SitesApi(client).listSites();
  console.log('Sites:', sites.sites.map(s => s.siteUrl));
}).catch(e => console.error('Error:', e.message));
"
```

---

## File Locations

| File | Purpose |
|------|---------|
| `~/.gsc-mcp/tokens.json` | OAuth tokens (delete to force re-auth) |
| `~/.gsc-mcp/cache.json` | API response cache (safe to delete) |
| `~/Library/Application Support/Claude/claude_desktop_config.json` | Claude Desktop MCP configuration |

---

## Getting Help

If you're still stuck:
1. Check the [GitHub Issues](https://github.com/seo-bandwagon/gsc-mcp/issues)
2. Enable debug logging and review the output
3. Verify your setup in the Google Cloud Console
4. Looking for a hosted experience without OAuth setup? See [seobandwagon.com](https://seobandwagon.com).
