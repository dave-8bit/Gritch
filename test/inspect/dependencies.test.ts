import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  loadDependencies,
  hasDependency,
  hasAnyDependency,
  getDependencies,
  clearDependencyCache,
} from '../../src/inspect/dependencies';

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-deps-'));
}

function writePkg(root: string, content: string) {
  fs.writeFileSync(path.join(root, 'package.json'), content, 'utf8');
}

describe('inspect/dependencies', () => {
  beforeEach(() => {
    clearDependencyCache();
  });

  it('loads dependencies correctly', () => {
    const root = makeRoot();
    writePkg(
      root,
      JSON.stringify({
        name: 'x',
        version: '0.0.0',
        dependencies: { react: '^18.0.0' },
        devDependencies: { vite: '^5.0.0' },
        scripts: { dev: 'vite' },
        packageManager: 'pnpm@9.0.0',
      }),
    );

    const index = loadDependencies(root);
    expect(index.dependencies).toEqual({ react: '^18.0.0' });
    expect(index.devDependencies).toEqual({ vite: '^5.0.0' });
    expect(Array.from(index.all).sort()).toEqual(['react', 'vite']);
    expect(index.packageManager).toBe('pnpm@9.0.0');
    expect(index.scripts).toEqual({ dev: 'vite' });
  });

  it('handles missing package.json', () => {
    const root = makeRoot();

    const index = loadDependencies(root);
    expect(index.dependencies).toEqual({});
    expect(index.devDependencies).toEqual({});
    expect(index.all.size).toBe(0);
    expect(index.packageManager).toBeUndefined();
    expect(index.scripts).toBeUndefined();
  });

  it('handles invalid JSON', () => {
    const root = makeRoot();
    writePkg(root, '{ this is not json ');

    expect(() => loadDependencies(root)).not.toThrow();
    const index = loadDependencies(root);
    expect(index.all.size).toBe(0);
    expect(getDependencies(index)).toEqual([]);
  });

  it('handles malformed dependency fields', () => {
    const root = makeRoot();
    writePkg(
      root,
      JSON.stringify({
        name: 'x',
        dependencies: 'not-an-object',
        devDependencies: ['also', 'wrong'],
        packageManager: 42,
      }),
    );

    const index = loadDependencies(root);
    expect(index.dependencies).toEqual({});
    expect(index.devDependencies).toEqual({});
    expect(index.packageManager).toBeUndefined();
  });

  it('dependency lookup works', () => {
    const root = makeRoot();
    writePkg(
      root,
      JSON.stringify({
        dependencies: { express: '^4.0.0' },
        devDependencies: { typescript: '^5.0.0' },
      }),
    );

    const index = loadDependencies(root);
    expect(hasDependency(index, 'express')).toBe(true);
    expect(hasDependency(index, 'typescript')).toBe(true);
    expect(hasDependency(index, 'webpack')).toBe(false);
    expect(hasAnyDependency(index, ['webpack', 'express'])).toBe(true);
    expect(hasAnyDependency(index, ['webpack', 'rollup'])).toBe(false);
    expect(hasAnyDependency(index, [])).toBe(false);
    expect(getDependencies(index).sort()).toEqual(['express', 'typescript']);
  });

  it('caches parsed results per root for the process', () => {
    const root = makeRoot();
    writePkg(root, JSON.stringify({ dependencies: { react: '^18.0.0' } }));

    const first = loadDependencies(root);
    expect(hasDependency(first, 'react')).toBe(true);

    // Change the file on disk; the cached index must still be returned.
    writePkg(root, JSON.stringify({ dependencies: { vue: '^3.0.0' } }));
    const second = loadDependencies(root);
    expect(second).toBe(first);
    expect(hasDependency(second, 'react')).toBe(true);
    expect(hasDependency(second, 'vue')).toBe(false);

    // Clearing the cache picks up the new contents.
    clearDependencyCache();
    const third = loadDependencies(root);
    expect(third).not.toBe(first);
    expect(hasDependency(third, 'vue')).toBe(true);
    expect(hasDependency(third, 'react')).toBe(false);
  });

  it('caches per resolved root (different roots are independent)', () => {
    const rootA = makeRoot();
    const rootB = makeRoot();
    writePkg(rootA, JSON.stringify({ dependencies: { react: '1' } }));
    writePkg(rootB, JSON.stringify({ dependencies: { vue: '1' } }));

    const a = loadDependencies(rootA);
    const b = loadDependencies(rootB);
    expect(a).not.toBe(b);
    expect(hasDependency(a, 'react')).toBe(true);
    expect(hasDependency(b, 'vue')).toBe(true);
  });
});
