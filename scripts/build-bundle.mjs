#!/usr/bin/env node
// Build an MCPB bundle: a zip containing dist/, production node_modules, and
// manifest.json. Output: gsc-mcp-<version>.mcpb at repo root.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, cpSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE_DIR = resolve(ROOT, 'bundle');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
const BUNDLE_NAME = `gsc-mcp-${pkg.version}.mcpb`;
const BUNDLE_OUT = resolve(ROOT, BUNDLE_NAME);

// execFileSync instead of execSync/exec — no shell, no interpolation risk.
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function npm(args, cwd = ROOT) {
  execFileSync(npmCmd, args, { cwd, stdio: 'inherit' });
}

console.log('→ Cleaning previous bundle');
rmSync(BUNDLE_DIR, { recursive: true, force: true });
rmSync(BUNDLE_OUT, { force: true });
mkdirSync(BUNDLE_DIR, { recursive: true });

console.log('→ Building TypeScript');
npm(['run', 'build']);

console.log('→ Staging files');
for (const file of ['dist', 'package.json', 'manifest.json', 'README.md', 'LICENSE', 'CHANGELOG.md']) {
  const src = resolve(ROOT, file);
  if (!existsSync(src)) {
    console.warn(`  (skipping missing: ${file})`);
    continue;
  }
  cpSync(src, resolve(BUNDLE_DIR, file), { recursive: true });
}

for (const icon of ['icon.png', 'icon-light.png', 'icon-dark.png']) {
  const src = resolve(ROOT, icon);
  if (existsSync(src)) {
    cpSync(src, resolve(BUNDLE_DIR, icon));
  }
}

console.log('→ Installing production dependencies into bundle');
npm(['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], BUNDLE_DIR);

console.log('→ Creating .mcpb zip');
if (process.platform === 'win32') {
  execFileSync(
    'powershell',
    ['-Command', `Compress-Archive -Path bundle/* -DestinationPath "${BUNDLE_OUT}" -Force`],
    { cwd: ROOT, stdio: 'inherit' }
  );
} else {
  execFileSync('zip', ['-r', '-q', BUNDLE_OUT, '.'], { cwd: BUNDLE_DIR, stdio: 'inherit' });
}

console.log('→ Cleaning staging dir');
rmSync(BUNDLE_DIR, { recursive: true, force: true });

console.log(`\n✓ Built ${BUNDLE_NAME}`);
