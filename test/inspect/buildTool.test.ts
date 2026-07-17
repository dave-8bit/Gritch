import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { detectBuildTools, detectBuildToolsWithInventory } from '../../src/inspect/buildTool';
import { buildFileInventory } from '../../src/inspect/inventory';

function writeFile(p: string, content = 'x') {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function setupBasePkg(root: string, pkg: any) {
  writeFile(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2));
}

describe('inspect/buildTool', () => {
  it('detects Vite (deps + config)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-bt-'));
    setupBasePkg(root, {
      name: 'x',
      version: '0.0.0',
      dependencies: { vite: '^5.0.0', react: '^18.0.0' },
      scripts: { dev: 'vite' },
    });
    writeFile(path.join(root, 'vite.config.ts'), 'export default {}');

    const res = detectBuildTools(root);
    expect(res.primary).toBe('Vite');
    expect(res.confidence).toBeGreaterThan(0.2);
    expect(res.evidence.join('\n')).toContain('vite');
  });

  it('detects Webpack (deps + config)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-bt-'));
    setupBasePkg(root, {
      name: 'x',
      version: '0.0.0',
      devDependencies: { webpack: '^5.0.0', 'webpack-cli': '^5.0.0' },
      scripts: { build: 'webpack' },
    });
    writeFile(path.join(root, 'webpack.config.js'), 'module.exports = {};');

    const res = detectBuildTools(root);
    expect(res.primary).toBe('Webpack');
    expect(res.confidence).toBeGreaterThan(0.2);
  });

  it('detects Rollup (deps + config)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-bt-'));
    setupBasePkg(root, {
      name: 'x',
      version: '0.0.0',
      devDependencies: { rollup: '^4.0.0' },
      scripts: { build: 'rollup -c' },
    });
    writeFile(path.join(root, 'rollup.config.js'), 'export default {};');

    const res = detectBuildTools(root);
    expect(res.primary).toBe('Rollup');
  });

  it('detects esbuild (package.json only)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-bt-'));
    setupBasePkg(root, {
      name: 'x',
      version: '0.0.0',
      devDependencies: { esbuild: '^0.21.0' },
      scripts: { build: 'node -e "console.log(1)" && esbuild src/index.ts --bundle"' },
    });

    const res = detectBuildTools(root);
    expect(res.primary).toBe('esbuild');
    expect(res.confidence).toBeGreaterThan(0);
  });

  it('detects tsup', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-bt-'));
    setupBasePkg(root, {
      name: 'x',
      version: '0.0.0',
      devDependencies: { tsup: '^8.0.0' },
      scripts: { build: 'tsup' },
    });
    writeFile(path.join(root, 'tsup.config.ts'), 'export default {}');

    const res = detectBuildTools(root);
    expect(res.primary).toBe('tsup');
  });

  it('detects Parcel', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-bt-'));
    setupBasePkg(root, {
      name: 'x',
      version: '0.0.0',
      devDependencies: { parcel: '^2.10.0' },
      scripts: { start: 'parcel index.html' },
    });
    writeFile(path.join(root, '.parcelrc'), JSON.stringify({}),);

    const res = detectBuildTools(root);
    expect(res.primary).toBe('Parcel');
  });

  it('detects Rspack', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-bt-'));
    setupBasePkg(root, {
      name: 'x',
      version: '0.0.0',
      devDependencies: { '@rspack/core': '^1.0.0' },
      scripts: { build: 'rspack build' },
    });
    writeFile(path.join(root, 'rspack.config.ts'), 'export default {};');

    const res = detectBuildTools(root);
    expect(res.primary).toBe('Rspack');
  });

  it('does not infer Turbopack from Next.js', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-bt-'));
    setupBasePkg(root, {
      name: 'x',
      version: '0.0.0',
      dependencies: { next: '^14.0.0', react: '^18.0.0' },
      scripts: { dev: 'next dev' },
    });

    const res = detectBuildTools(root);
    // With current strict rules, turbopack should not be detected from next.
    expect(res.primary).not.toBe('Turbopack');
  });

  it('detects Babel (deps + babel config)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-bt-'));
    setupBasePkg(root, {
      name: 'x',
      version: '0.0.0',
      devDependencies: { '@babel/core': '^7.0.0' },
      scripts: { build: 'babel src -d dist' },
    });
    writeFile(path.join(root, 'babel.config.js'), 'module.exports = {};');

    const res = detectBuildTools(root);
    expect(res.primary).toBe('Babel');
  });

  it('detects SWC (.swcrc + @swc/core)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-bt-'));
    setupBasePkg(root, {
      name: 'x',
      version: '0.0.0',
      devDependencies: { '@swc/core': '^1.0.0' },
      scripts: { build: 'swc src -d dist' },
    });
    writeFile(path.join(root, '.swcrc'), JSON.stringify({ jsc: { target: 'es2020' } }));

    const inv = buildFileInventory({ rootPath: root, maxDepth: 6, maxFiles: 10_000 });
    const res = detectBuildToolsWithInventory(root, inv);
    expect(res.primary).toBe('SWC');
    expect(res.confidence).toBeGreaterThan(0);
  });

  it('returns confidence 0 with no evidence', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-bt-'));
    setupBasePkg(root, { name: 'x', version: '0.0.0' });

    const res = detectBuildTools(root);
    expect(res.confidence).toBe(0);
    expect(res.evidence.join('\n')).toContain('No build tool evidence found');
  });

  it('populates secondary when multiple tools are evidenced', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-bt-'));
    setupBasePkg(root, {
      name: 'x',
      version: '0.0.0',
      devDependencies: { vite: '^5.0.0', webpack: '^5.0.0' },
      scripts: { dev: 'vite', build: 'webpack' },
    });
    writeFile(path.join(root, 'vite.config.ts'), 'export default {}');
    writeFile(path.join(root, 'webpack.config.js'), 'module.exports = {};');

    const res = detectBuildTools(root);
    expect([res.primary, ...res.secondary]).toEqual(expect.arrayContaining(['Vite', 'Webpack']));
    expect(res.secondary.length).toBeGreaterThanOrEqual(0);
  });
});

