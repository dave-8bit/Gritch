import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { inspectRepository } from '../../src/inspect/profile';
import { detectLanguages } from '../../src/inspect/language';
import { detectFrameworks } from '../../src/inspect/framework';
import { detectBuildTools } from '../../src/inspect/buildTool';
import { detectPackageManager } from '../../src/inspect/packageManager';
import { clearDependencyCache } from '../../src/inspect/dependencies';

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-profile-'));
}

function writeFile(root: string, rel: string, content = 'x') {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function writePkg(root: string, pkg: any) {
  writeFile(root, 'package.json', JSON.stringify(pkg, null, 2));
}

/** A representative Vite + React + pnpm TypeScript repo. */
function setupViteReactRepo(root: string) {
  writePkg(root, {
    name: 'x',
    version: '0.0.0',
    packageManager: 'pnpm@9.0.0',
    dependencies: { react: '^18.0.0' },
    devDependencies: { vite: '^5.0.0', typescript: '^5.0.0' },
    scripts: { dev: 'vite', build: 'vite build' },
  });
  writeFile(root, 'pnpm-lock.yaml', 'lockfileVersion: 9');
  writeFile(root, 'vite.config.ts', 'export default {}');
  writeFile(root, 'src/main.tsx', 'export {}');
  writeFile(root, 'src/App.tsx', 'export {}');
}

describe('inspect/profile', () => {
  beforeEach(() => {
    clearDependencyCache();
  });

  it('aggregates all detector outputs into one profile', () => {
    const root = makeRoot();
    setupViteReactRepo(root);

    const profile = inspectRepository(root);

    expect(profile.root).toBe(path.resolve(root));
    expect(profile.languages.primary).toBe('TypeScript');
    expect(profile.frameworks.primary).toBe('React');
    expect(profile.buildTools.primary).toBe('Vite');
    expect(profile.packageManager.detected).toBe('pnpm');
    expect(profile.dependencies.all.has('react')).toBe(true);
    expect(profile.dependencies.all.has('vite')).toBe(true);
    expect(profile.dependencies.packageManager).toBe('pnpm@9.0.0');
  });

  it('profile fields match standalone detector outputs exactly', () => {
    const root = makeRoot();
    setupViteReactRepo(root);

    const profile = inspectRepository(root);

    expect(profile.languages).toEqual(detectLanguages(root));
    expect(profile.frameworks).toEqual(detectFrameworks(root));
    expect(profile.buildTools).toEqual(detectBuildTools(root));
    expect(profile.packageManager).toEqual(detectPackageManager(root));
  });

  it('summarizes the inventory (fileCount and totalSizeBytes)', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0' });
    writeFile(root, 'a.ts', '12345'); // 5 bytes
    writeFile(root, 'src/b.ts', '1234567890'); // 10 bytes

    const profile = inspectRepository(root);

    expect(profile.inventory.fileCount).toBe(3); // package.json + a.ts + src/b.ts
    expect(profile.inventory.totalSizeBytes).toBeGreaterThanOrEqual(15);
  });

  it('handles an empty repository without throwing', () => {
    const root = makeRoot();

    const profile = inspectRepository(root);

    expect(profile.inventory.fileCount).toBe(0);
    expect(profile.inventory.totalSizeBytes).toBe(0);
    expect(profile.languages.confidence).toBe(0);
    expect(profile.frameworks.confidence).toBe(0);
    expect(profile.buildTools.confidence).toBe(0);
    expect(profile.buildTools.primary).toBeUndefined();
    expect(profile.packageManager.detected).toBe('unknown');
    expect(profile.dependencies.all.size).toBe(0);
  });

  it('resolves the git root and reports root evidence', () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, '.git'));
    writePkg(root, { name: 'x', version: '0.0.0' });
    const nested = path.join(root, 'src', 'deep');
    fs.mkdirSync(nested, { recursive: true });

    const profile = inspectRepository(nested);

    expect(profile.root).toBe(path.resolve(root));
    expect(profile.rootEvidence).toBe(path.join(path.resolve(root), '.git'));
  });

  it('has no root evidence when no .git directory exists', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0' });

    const profile = inspectRepository(root);

    expect(profile.rootEvidence).toBeUndefined();
    expect(profile.root).toBe(path.resolve(root));
  });

  it('profiles a multi-tool repository consistently', () => {
    const root = makeRoot();
    writePkg(root, {
      name: 'x',
      version: '0.0.0',
      devDependencies: { vite: '^5.0.0', webpack: '^5.0.0' },
      scripts: { dev: 'vite', build: 'webpack' },
    });
    writeFile(root, 'vite.config.ts', 'export default {}');
    writeFile(root, 'webpack.config.js', 'module.exports = {};');
    writeFile(root, 'yarn.lock', '# yarn lockfile v1');

    const profile = inspectRepository(root);

    expect([profile.buildTools.primary, ...profile.buildTools.secondary]).toEqual(
      expect.arrayContaining(['Vite', 'Webpack']),
    );
    expect(profile.packageManager.detected).toBe('yarn');
  });
});
