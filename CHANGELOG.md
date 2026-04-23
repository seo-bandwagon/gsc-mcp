# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
