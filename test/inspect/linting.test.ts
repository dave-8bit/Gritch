import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { detectLinting, detectLintingWithInventory, detectFormatting, detectFormattingWithInventory } from '../../src/inspect/linting';
import { buildFileInventory } from '../../src/inspect/inventory';
import { inspectRepository } from '../../src/inspect/profile';
import { clearDependencyCache } from '../../src/inspect/dependencies';

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-lint-'));
}

function writeFile(root: string, rel: string, content = 'x') {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function writePkg(root: string, pkg: any) {
  writeFile(root, 'package.json', JSON.stringify(pkg, null, 2));
}

function setupEmpty(root: string) {
  writePkg(root, { name: 'x', version: '0.0.0' });
}

function setupESLintAndPrettierRepo(root: string) {
  writePkg(root, {
    name: 'x',
    version: '0.0.0',
    devDependencies: {
      eslint: '^9.0.0',
      prettier: '^3.0.0',
    },
  });
  writeFile(root, 'eslint.config.js', 'export default [];');
  writeFile(root, '.prettierrc', JSON.stringify({ singleQuote: true }));
}

describe('inspect/linting', () => {
  beforeEach(() => {
    clearDependencyCache();
  });

  it('ESLint + Prettier are detected independently (primary routing)', () => {
    const root = makeRoot();
    setupESLintAndPrettierRepo(root);

    const linting = detectLinting(root);
    const formatting = detectFormatting(root);

    expect(linting.primary).toBe('ESLint');
    expect(formatting.primary).toBe('Prettier');
  });

  it('detects ESLint (dependency-only)', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', devDependencies: { eslint: '^9.0.0' } });

    const res = detectLinting(root);
    expect(res.primary).toBe('ESLint');
    expect(res.confidence).toBeGreaterThan(0);
  });

  it('detects ESLint (config-only)', () => {
    const root = makeRoot();
    setupEmpty(root);
    writeFile(root, 'eslint.config.mjs', 'export default [];');

    const res = detectLinting(root);
    expect(res.primary).toBe('ESLint');
  });

  it('detects Prettier (dependency-only)', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', devDependencies: { prettier: '^3.0.0' } });

    const res = detectFormatting(root);
    expect(res.primary).toBe('Prettier');
  });

  it('detects Prettier (config-only)', () => {
    const root = makeRoot();
    setupEmpty(root);
    writeFile(root, 'prettier.config.ts', 'export default {};');

    const res = detectFormatting(root);
    expect(res.primary).toBe('Prettier');
  });

  it('detects Biome (dependency-only) for both linting and formatting', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', devDependencies: { '@biomejs/biome': '^1.8.0' } });

    const linting = detectLinting(root);
    const formatting = detectFormatting(root);

    expect(linting.primary).toBe('Biome');
    expect(formatting.primary).toBe('Biome');
  });

  it('detects Biome (config-only) for both linting and formatting', () => {
    const root = makeRoot();
    setupEmpty(root);
    writeFile(root, 'biome.json', '{ }');

    const linting = detectLinting(root);
    const formatting = detectFormatting(root);

    expect(linting.primary).toBe('Biome');
    expect(formatting.primary).toBe('Biome');
  });

  it('detects Oxlint (dependency-only)', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', devDependencies: { oxlint: '^1.2.0' } });

    const res = detectLinting(root);
    expect(res.primary).toBe('Oxlint');
  });

  it('detects Oxlint (config-only)', () => {
    const root = makeRoot();
    setupEmpty(root);
    writeFile(root, 'oxlint.json', '{ }');

    const res = detectLinting(root);
    expect(res.primary).toBe('Oxlint');
  });

  it('detects TSLint (dependency-only) for legacy linting', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', devDependencies: { tslint: '^6.1.0' } });

    const res = detectLinting(root);
    expect(res.primary).toBe('TSLint');
  });

  it('detects TSLint (config-only)', () => {
    const root = makeRoot();
    setupEmpty(root);
    writeFile(root, 'tslint.json', '{ }');

    const res = detectLinting(root);
    expect(res.primary).toBe('TSLint');
  });

  it('detects dprint (dependency-only) for formatting', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', devDependencies: { dprint: '^0.45.0' } });

    const res = detectFormatting(root);
    expect(res.primary).toBe('dprint');
  });

  it('detects dprint (config-only)', () => {
    const root = makeRoot();
    setupEmpty(root);
    writeFile(root, 'dprint.json', '{ }');

    const res = detectFormatting(root);
    expect(res.primary).toBe('dprint');
  });

  it('supports multiple linting tools (secondary populated)', () => {
    const root = makeRoot();
    writePkg(root, {
      name: 'x',
      version: '0.0.0',
      devDependencies: {
        eslint: '^9.0.0',
        tslint: '^6.1.0',
      },
    });
    writeFile(root, 'eslint.config.js', 'export default [];');
    writeFile(root, 'tslint.json', '{ }');

    const res = detectLinting(root);
    expect(res.secondary).toContain('TSLint');
  });

  it('ambiguous evidence: Biome vs ESLint for linting', () => {
    const root = makeRoot();
    writePkg(root, {
      name: 'x',
      version: '0.0.0',
      devDependencies: {
        eslint: '^9.0.0',
        '@biomejs/biome': '^1.8.0',
      },
    });
    writeFile(root, 'eslint.config.js', 'export default [];');
    writeFile(root, 'biome.json', '{ }');

    const res = detectLinting(root);
    expect(['ESLint', 'Biome']).toContain(res.primary);
    expect(res.confidence).toBeGreaterThan(0);
  });

  it('returns no-evidence contract when nothing is detected', () => {
    const root = makeRoot();
    setupEmpty(root);

    const linting = detectLinting(root);
    const formatting = detectFormatting(root);

    expect(linting.primary).toBeUndefined();
    expect(linting.secondary).toEqual([]);
    expect(linting.confidence).toBe(0);
    expect(linting.evidence).toEqual(['No linting tool evidence found']);

    expect(formatting.primary).toBeUndefined();
    expect(formatting.secondary).toEqual([]);
    expect(formatting.confidence).toBe(0);
    expect(formatting.evidence).toEqual(['No formatting tool evidence found']);
  });

  it('works with inventory-based detection', () => {
    const root = makeRoot();
    setupEmpty(root);
    writeFile(root, 'eslint.config.cjs', 'module.exports = [];');

    const inv = buildFileInventory({ rootPath: root, maxDepth: 6, maxFiles: 10_000 });
    const res = detectLintingWithInventory(root, inv);
    expect(res.primary).toBe('ESLint');

    const fmtInv = buildFileInventory({ rootPath: root, maxDepth: 6, maxFiles: 10_000 });
    const resFmt = detectFormattingWithInventory(root, fmtInv);
    expect(resFmt.primary).toBeUndefined();
  });

  it('RepositoryProfile equivalence: linting + formatting are aggregated exactly', () => {
    const root = makeRoot();
    setupESLintAndPrettierRepo(root);

    const profile = inspectRepository(root);
    expect(profile.linting).toEqual(detectLinting(root));
    expect(profile.formatting).toEqual(detectFormatting(root));
  });
});

