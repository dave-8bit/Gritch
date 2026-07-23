import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { detectHealth, detectHealthWithInventory } from '../../src/inspect/health';
import { buildFileInventory } from '../../src/inspect/inventory';
import { clearDependencyCache } from '../../src/inspect/dependencies';
import type { InventoryResult, RepositoryHealthResult } from '../../src/inspect/types';

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-health-'));
}

function writeFile(root: string, rel: string, content = 'x') {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function writePkg(root: string, pkg: any) {
  writeFile(root, 'package.json', JSON.stringify(pkg, null, 2));
}

/** Create the full set of 11 health assets under root. */
function setupFullAssets(root: string) {
  writePkg(root, { name: 'test', version: '0.0.0' });
  writeFile(root, 'README.md');
  writeFile(root, 'LICENSE');
  writeFile(root, 'CHANGELOG.md');
  writeFile(root, 'CONTRIBUTING.md');
  writeFile(root, 'CODE_OF_CONDUCT.md');
  writeFile(root, 'SECURITY.md');
  writeFile(root, 'Dockerfile');
  writeFile(root, 'docker-compose.yml');
  writeFile(root, '.github/workflows/ci.yml', 'name: CI\non: [push]\njobs: {}');
  writeFile(root, '.editorconfig', 'root = true\n[*]\nend_of_line = lf');
  writeFile(root, '.env.example', 'DATABASE_URL=');
}

/** Build an InventoryResult for a root dir (same params as inspectRepository). */
function inventoryFor(root: string): InventoryResult {
  return buildFileInventory({ rootPath: root, maxDepth: 8, maxFiles: 100_000 });
}

describe('inspect/health', () => {
  beforeEach(() => {
    clearDependencyCache();
  });

  it('reports all assets missing for an empty repository', () => {
    const root = makeRoot();
    const result = detectHealth(root);

    expect(result.score).toBe(0);
    expect(result.grade).toBe('Poor');
    expect(result.present).toEqual([]);
    expect(result.missing).toHaveLength(11);
    expect(result.recommendations).toHaveLength(11);
    // Every evidence line should start with 'Missing:'
    expect(result.evidence.every((e) => e.startsWith('Missing:'))).toBe(true);
  });

  it('reports all assets present for a fully-provisioned repository', () => {
    const root = makeRoot();
    setupFullAssets(root);

    const result = detectHealth(root);

    expect(result.score).toBe(100);
    expect(result.grade).toBe('Excellent');
    expect(result.missing).toEqual([]);
    expect(result.recommendations).toEqual([]);
    // Every evidence line should start with 'Found:'
    expect(result.evidence.every((e) => e.startsWith('Found:'))).toBe(true);
    // All 11 assets should be present
    const expected: string[] = [
      'README',
      'LICENSE',
      'CHANGELOG',
      'CONTRIBUTING',
      'CODE_OF_CONDUCT',
      'SECURITY',
      'Dockerfile',
      'docker-compose.yml',
      '.github/workflows',
      '.editorconfig',
      '.env.example',
    ];
    expect(result.present.sort()).toEqual(expected.sort());
  });

  it('detects a repository with only README.md and LICENSE', () => {
    const root = makeRoot();
    writePkg(root, { name: 'test', version: '0.0.0' });
    writeFile(root, 'README.md');
    writeFile(root, 'LICENSE');

    const result = detectHealth(root);

    expect(result.score).toBe(18); // 2/11 ≈ 18.18 → 18
    expect(result.grade).toBe('Poor');
    expect(result.present).toEqual(['README', 'LICENSE']);
    expect(result.missing).toHaveLength(9);
    expect(result.recommendations).toHaveLength(9);
  });

  it('recognises alternative file names for README', () => {
    const root = makeRoot();
    writePkg(root, { name: 'test', version: '0.0.0' });
    writeFile(root, 'README.rst', 'Welcome');

    const result = detectHealth(root);

    expect(result.present).toContain('README');
  });

  it('recognises alternative file names for LICENSE', () => {
    const root = makeRoot();
    writePkg(root, { name: 'test', version: '0.0.0' });
    writeFile(root, 'LICENSE.md', 'MIT');

    const result = detectHealth(root);

    expect(result.present).toContain('LICENSE');
  });

  it('recognises Dockerfile in a docker subdirectory', () => {
    const root = makeRoot();
    writePkg(root, { name: 'test', version: '0.0.0' });
    writeFile(root, 'docker/Dockerfile', 'FROM node:20');

    const result = detectHealth(root);

    expect(result.present).toContain('Dockerfile');
  });

  it('recognises docker-compose in alternate locations', () => {
    const root = makeRoot();
    writePkg(root, { name: 'test', version: '0.0.0' });
    writeFile(root, 'docker/docker-compose.yml', 'version: "3"');

    const result = detectHealth(root);

    expect(result.present).toContain('docker-compose.yml');
  });

  it('recognises .github/workflows as a directory with nested files', () => {
    const root = makeRoot();
    writePkg(root, { name: 'test', version: '0.0.0' });
    writeFile(root, '.github/workflows/deploy.yml', 'name: Deploy');

    const result = detectHealth(root);

    expect(result.present).toContain('.github/workflows');
  });

  it('recognises .env.example as present via .env.sample', () => {
    const root = makeRoot();
    writePkg(root, { name: 'test', version: '0.0.0' });
    writeFile(root, '.env.sample', 'KEY=value');

    const result = detectHealth(root);

    expect(result.present).toContain('.env.example');
  });

  it('produces deterministic output for the same repository', () => {
    const root = makeRoot();
    setupFullAssets(root);

    const result1 = detectHealth(root);
    const result2 = detectHealth(root);

    expect(result1).toEqual(result2);
  });

  it('reuses a shared inventory without duplicate walk', () => {
    const root = makeRoot();
    setupFullAssets(root);

    const inv = inventoryFor(root);
    const standalone = detectHealth(root);
    const withInventory = detectHealthWithInventory(root, inv);

    expect(withInventory.score).toBe(standalone.score);
    expect(withInventory.grade).toBe(standalone.grade);
    expect(withInventory.present.sort()).toEqual(standalone.present.sort());
    expect(withInventory.missing.sort()).toEqual(standalone.missing.sort());
    expect(withInventory.evidence.sort()).toEqual(standalone.evidence.sort());
    expect(withInventory.recommendations.sort()).toEqual(standalone.recommendations.sort());
  });

  it('scores reflect dynamic asset count — adding assets auto-updates score', () => {
    const root = makeRoot();
    writePkg(root, { name: 'test', version: '0.0.0' });

    // Only 1 present (package.json not in assets), but we only check tracked assets
    writeFile(root, 'README.md');

    const result = detectHealth(root);
    // 1 present out of 11 = 9.09 → 9
    expect(result.score).toBe(9);
  });

  it('grade mapping: Excellent (90-100), Good (75-89), Fair (50-74), Poor (0-49)', () => {
    // 0/11 → 0 → Poor
    const root = makeRoot();
    const empty = detectHealth(root);
    expect(empty.grade).toBe('Poor');
    expect(empty.score).toBe(0);

    // 10/11 → 91 → Excellent
    const root2 = makeRoot();
    setupFullAssets(root2);
    // Remove one (e.g. .env.example)
    fs.unlinkSync(path.join(root2, '.env.example'));
    const nearlyFull = detectHealth(root2);
    expect(nearlyFull.score).toBe(91);
    expect(nearlyFull.grade).toBe('Excellent');

    // 9/11 → 82 → Good
    const root3 = makeRoot();
    for (const f of ['README.md', 'LICENSE', 'CHANGELOG.md', 'CONTRIBUTING.md',
      'CODE_OF_CONDUCT.md', 'SECURITY.md', 'Dockerfile', 'docker-compose.yml',
      '.editorconfig']) {
      writeFile(root3, f);
    }
    const good = detectHealth(root3);
    expect(good.score).toBe(82);
    expect(good.grade).toBe('Good');

    // 6/11 → 55 → Fair
    const root4 = makeRoot();
    for (const f of ['README.md', 'LICENSE', 'CHANGELOG.md', 'CONTRIBUTING.md',
      'CODE_OF_CONDUCT.md', 'SECURITY.md']) {
      writeFile(root4, f);
    }
    const fair = detectHealth(root4);
    expect(fair.score).toBe(55);
    expect(fair.grade).toBe('Fair');
  });

  it('handles an empty root without throwing', () => {
    const root = makeRoot();
    expect(() => detectHealth(root)).not.toThrow();
  });
});

