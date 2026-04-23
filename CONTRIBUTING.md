# Contributing

Thanks for your interest in contributing to the GSC MCP server.

## Development setup

```bash
git clone https://github.com/seo-bandwagon/gsc-mcp.git
cd gsc-mcp
npm ci
npm run build
npm test
```

Node 18+ is required.

### Running against your own Google Search Console

1. Create an OAuth 2.0 Desktop client in Google Cloud Console.
2. Export credentials:
   ```bash
   export GSC_CLIENT_ID=your-id
   export GSC_CLIENT_SECRET=your-secret
   ```
3. Authenticate once: `npm run auth`.
4. Start the server: `npm start`.
5. Or connect via MCP Inspector: `npx @modelcontextprotocol/inspector node dist/index.js`.

## Making changes

- Open an issue first for anything larger than a small fix — it saves everyone time.
- Keep PRs focused. One logical change per PR.
- Write tests for new behavior. `npm test` must stay green.
- Follow existing code style (strict TypeScript, Zod for input validation).

## Commit style

Conventional-style prefixes are appreciated but not required:

```
feat: add gsc_bulk_inspect retry
fix: handle 429 in search analytics
docs: clarify OAuth redirect URI
```

## Releasing

Maintainers only. Tag a version (`git tag v0.x.y && git push --tags`) — the publish workflow handles npm + MCPB artifacts.

## Code of Conduct

Be kind. Assume good faith. No harassment, discrimination, or personal attacks.

## License

By contributing you agree your contributions are licensed under the MIT License.
