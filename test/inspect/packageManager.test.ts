import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { detectPackageManager, detectPackageManagerWithInventory } from '../../src/inspect/packageManager';
import { buildFileInventory } from '../../src/inspect/inventory';
import { clearDependencyCache } from '../../src/inspect/dependencies';

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-pm-'));
}

function writeFile(root: string, rel: string, content = 'x') {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function writePkg(root: string, pkg: any) {
  writeFile(root, 'package.json', JSON.stringify(pkg, null, 2));
}

describe('inspect/packageManager', () => {
  beforeEach(() => {
    clearDependencyCache();
  });

  it('detects npm from package-lock.json', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0' });
    writeFile(root, 'package-lock.json', '{}');

    const res = detectPackageManager(root);
    expect(res.detected).toBe('npm');
    expect(res.confidence).toBeGreaterThan(0);
    expect(res.evidence.join('\n')).toContain('package-lock.json');
  });

  it('detects pnpm from pnpm-lock.yaml', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0' });
    writeFile(root, 'pnpm-lock.yaml', 'lockfileVersion: 9');

    const res = detectPackageManager(root);
    expect(res.detected).toBe('pnpm');
    expect(res.evidence.join('\n')).toContain('pnpm-lock.yaml');
  });

  it('detects yarn from yarn.lock', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0' });
    writeFile(root, 'yarn.lock', '# yarn lockfile v1');

    const res = detectPackageManager(root);
    expect(res.detected).toBe('yarn');
  });

  it('detects bun from bun.lockb', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0' });
    writeFile(root, 'bun.lockb', 'binary');

    const res = detectPackageManager(root);
    expect(res.detected).toBe('bun');
  });

  it('detects from package.json packageManager field alone', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', packageManager: 'pnpm@9.1.0' });

    const res = detectPackageManager(root);
    expect(res.detected).toBe('pnpm');
    expect(res.confidence).toBe(1);
    expect(res.evidence.join('\n')).toContain('packageManager: pnpm@9.1.0');
  });

  it('packageManager field outweighs a conflicting lockfile', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', packageManager: 'yarn@4.0.0' });
    writeFile(root, 'package-lock.json', '{}');

    const res = detectPackageManager(root);
    expect(res.detected).toBe('yarn');
    // Conflicting evidence lowers confidence below a clean single-signal detection.
    expect(res.confidence).toBeLessThan(1);
    expect(res.confidence).toBeGreaterThan(0);
  });

  it('agreeing field + lockfile yields full confidence', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', packageManager: 'pnpm@9.0.0' });
    writeFile(root, 'pnpm-lock.yaml', 'lockfileVersion: 9');

    const res = detectPackageManager(root);
    expect(res.detected).toBe('pnpm');
    expect(res.confidence).toBe(1);
    expect(res.evidence.length).toBe(2);
  });

  it('ignores an unknown packageManager field value', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', packageManager: 'volta@1.0.0' });

    const res = detectPackageManager(root);
    expect(res.detected).toBe('unknown');
    expect(res.confidence).toBe(0);
  });

  it('returns unknown with no evidence', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0' });

    const res = detectPackageManager(root);
    expect(res.detected).toBe('unknown');
    expect(res.confidence).toBe(0);
    expect(res.evidence.join('\n')).toContain('No package manager evidence found');
  });

  it('handles a repo with no package.json at all', () => {
    const root = makeRoot();
    writeFile(root, 'yarn.lock', '# yarn lockfile v1');

    const res = detectPackageManager(root);
    expect(res.detected).toBe('yarn');
  });

  it('multiple lockfiles: applies closeness penalty and picks deterministically', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0' });
    writeFile(root, 'package-lock.json', '{}');
    writeFile(root, 'yarn.lock', '# yarn lockfile v1');

    const res = detectPackageManager(root);
    // Tied scores: first lockfile rule (npm) wins the stable sort.
    expect(res.detected).toBe('npm');
    expect(res.confidence).toBeLessThan(0.5);
  });

  it('works with an explicit inventory (detectPackageManagerWithInventory)', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0' });
    writeFile(root, 'pnpm-lock.yaml', 'lockfileVersion: 9');

    const inv = buildFileInventory({ rootPath: root, maxDepth: 4, maxFiles: 1000 });
    const res = detectPackageManagerWithInventory(root, inv);
    expect(res.detected).toBe('pnpm');
  });
});
