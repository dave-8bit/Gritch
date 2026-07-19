import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { detectArchitecture, detectArchitectureWithInventory } from '../../src/inspect/architecture';
import { inspectRepository } from '../../src/inspect/profile';
import { buildFileInventory } from '../../src/inspect/inventory';

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-arch-'));
}

function writeFile(root: string, rel: string, content: string) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function writePkg(root: string, pkg: any) {
  writeFile(root, 'package.json', JSON.stringify(pkg, null, 2));
}

describe('inspect/architecture', () => {
  beforeEach(() => {
    // no-op
  });

  it('npm workspaces: workspaceManager = npm', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', workspaces: ['packages/*'] });
    writeFile(root, 'packages/a/package.json', '{"name":"a"}');

    const res = detectArchitecture(root);
    expect(res.workspaceManager).toBe('npm');
    expect(res.monorepo).toBe(true);
    expect(res.confidence).toBeGreaterThan(0);
  });

  it('pnpm workspace: workspaceManager = pnpm', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0' });
    writeFile(root, 'pnpm-workspace.yaml', 'packages:\n  - "packages/*"');
    writeFile(root, 'packages/a/package.json', '{"name":"a"}');

    const res = detectArchitecture(root);
    expect(res.workspaceManager).toBe('pnpm');
    expect(res.monorepo).toBe(true);
    expect(res.confidence).toBeGreaterThan(0);
  });

  it('Turborepo: workspaceManager = turbo', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0' });
    writeFile(root, 'turbo.json', '{"pipeline": {}}');
    writeFile(root, 'apps/a/package.json', '{"name":"a"}');

    const res = detectArchitecture(root);
    expect(res.workspaceManager).toBe('turbo');
    expect(res.monorepo).toBe(true);
    expect(res.confidence).toBeGreaterThan(0);
  });

  it('Nx: workspaceManager = nx', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0' });
    writeFile(root, 'nx.json', '{"projects":{}}');
    writeFile(root, 'packages/a/package.json', '{"name":"a"}');

    const res = detectArchitecture(root);
    expect(res.workspaceManager).toBe('nx');
    expect(res.monorepo).toBe(true);
  });

  it('Lerna: workspaceManager = lerna', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0' });
    writeFile(root, 'lerna.json', '{"packages": ["packages/*"]}');
    writeFile(root, 'packages/a/package.json', '{"name":"a"}');

    const res = detectArchitecture(root);
    expect(res.workspaceManager).toBe('lerna');
    expect(res.monorepo).toBe(true);
  });

  it('Rush: workspaceManager = rush', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0' });
    writeFile(root, 'rush.json', '{"projects":{}}');
    writeFile(root, 'apps/a/package.json', '{"name":"a"}');

    const res = detectArchitecture(root);
    expect(res.workspaceManager).toBe('rush');
    expect(res.monorepo).toBe(true);
  });

  it('single-package repository: no monorepo evidence', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0' });
    writeFile(root, 'src/index.ts', 'export {}');

    const res = detectArchitecture(root);
    expect(res.monorepo).toBe(false);
    expect(res.workspaceManager).toBeUndefined();
    expect(res.confidence).toBe(0);
    expect(res.evidence).toEqual(['No repository architecture evidence found']);
  });

  it('directory-only evidence: monorepo confidence increases but workspaceManager stays undefined', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0' });
    fs.mkdirSync(path.join(root, 'apps'), { recursive: true });
    fs.mkdirSync(path.join(root, 'packages'), { recursive: true });

    const res = detectArchitecture(root);
    expect(res.monorepo).toBe(true);
    expect(res.workspaceManager).toBeUndefined();
    expect(res.confidence).toBeGreaterThan(0);
  });

  it('workspaceManager is never inferred from directory names alone', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0' });
    fs.mkdirSync(path.join(root, 'apps'), { recursive: true });
    fs.mkdirSync(path.join(root, 'packages'), { recursive: true });

    const res = detectArchitecture(root);
    expect(res.workspaceManager).toBeUndefined();
  });

  it('RepositoryProfile equivalence: inspectRepository() includes architecture detection', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', workspaces: ['packages/*'] });
    fs.mkdirSync(path.join(root, 'packages/a'), { recursive: true });
    writeFile(root, 'packages/a/package.json', '{"name":"a"}');

    const profile = inspectRepository(root);
    expect(profile.architecture).toEqual(detectArchitecture(root));
  });

  it('detectArchitectureWithInventory is consistent', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', workspaces: ['packages/*'] });
    fs.mkdirSync(path.join(root, 'packages/a'), { recursive: true });
    writeFile(root, 'packages/a/package.json', '{"name":"a"}');

    const inv = buildFileInventory({ rootPath: root, maxDepth: 8, maxFiles: 100_000 });
    const byInv = detectArchitectureWithInventory(root, inv);
    const byRoot = detectArchitecture(root);

    expect(byInv).toEqual(byRoot);
  });
});

