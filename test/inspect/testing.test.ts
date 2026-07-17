import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  detectTestingFrameworks,
  detectTestingFrameworksWithInventory,
} from '../../src/inspect/testing';
import { buildFileInventory } from '../../src/inspect/inventory';
import { inspectRepository } from '../../src/inspect/profile';

function writeFile(p: string, content = 'x') {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function setupBasePkg(root: string, pkg: any) {
  writeFile(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2));
}

describe('inspect/testing', () => {
  it('detects single-framework (Jest)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-testfw-'));
    setupBasePkg(root, {
      name: 'x',
      version: '0.0.0',
      dependencies: { jest: '^29.0.0' },
    });
    writeFile(path.join(root, 'jest.config.js'), 'module.exports = {};');

    const res = detectTestingFrameworks(root);
    expect(res.primary).toBe('Jest');
    expect(res.confidence).toBeGreaterThan(0.2);
    expect(res.evidence.join('\n')).toContain('config file');
  });

  it('detects multiple frameworks (Vitest + Playwright)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-testfw-'));
    setupBasePkg(root, {
      name: 'x',
      version: '0.0.0',
      devDependencies: { vitest: '^1.0.0', '@playwright/test': '^1.0.0' },
    });
    writeFile(path.join(root, 'vitest.config.ts'), 'export default {};');
    writeFile(path.join(root, 'playwright.config.ts'), 'export default {};');

    const res = detectTestingFrameworks(root);
    expect(['Vitest', 'Playwright']).toContain(res.primary);
    expect(res.secondary).toEqual(['Vitest', 'Playwright'].filter((f) => f !== res.primary));

  });

  it('uses config-file presence for detection (Mocha)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-testfw-'));
    setupBasePkg(root, { name: 'x', version: '0.0.0' });
    writeFile(path.join(root, '.mocharc.json'), '{ "extension": ["js"] }');

    const res = detectTestingFrameworks(root);
    expect(res.primary).toBe('Mocha');
    expect(res.confidence).toBeGreaterThan(0);
  });

  it('detects dependency evidence (Cypress)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-testfw-'));
    setupBasePkg(root, {
      name: 'x',
      version: '0.0.0',
      dependencies: { cypress: '^10.0.0' },
    });
    writeFile(path.join(root, 'cypress.config.js'), 'module.exports = {};');

    const res = detectTestingFrameworks(root);
    expect(res.primary).toBe('Cypress');
  });

  it('ambiguous evidence: Jest + Playwright, one wins as primary', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-testfw-'));
    setupBasePkg(root, {
      name: 'x',
      version: '0.0.0',
      devDependencies: { jest: '^29.0.0', '@playwright/test': '^1.0.0' },
    });

    // Give both config files evidence.
    writeFile(path.join(root, 'jest.config.js'), 'module.exports = {};');
    writeFile(path.join(root, 'playwright.config.ts'), 'export default {};');

    const res = detectTestingFrameworks(root);
    expect(['Jest', 'Playwright']).toContain(res.primary);
    expect(res.secondary).toEqual(expect.arrayContaining([res.primary === 'Jest' ? 'Playwright' : 'Jest']));
    expect(res.confidence).toBeLessThan(1);
  });

  it('returns no evidence contract when nothing is detected', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-testfw-'));
    setupBasePkg(root, { name: 'x', version: '0.0.0' });

    const res = detectTestingFrameworks(root);
    expect(res.primary).toBeUndefined();
    expect(res.secondary).toEqual([]);
    expect(res.confidence).toBe(0);
    expect(res.evidence).toEqual(['No testing framework evidence found']);
  });

  it('works with inventory-based detection', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-testfw-'));
    setupBasePkg(root, { name: 'x', version: '0.0.0', devDependencies: { ava: '^3.0.0' } });
    writeFile(path.join(root, 'ava.config.cjs'), 'module.exports = {};');

    const inv = buildFileInventory({ rootPath: root, maxDepth: 6, maxFiles: 10_000 });
    const res = detectTestingFrameworksWithInventory(root, inv);
    expect(res.primary).toBe('Ava');
  });

  it('RepositoryProfile equivalence: adds testing without breaking other fields', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-testfw-'));
    setupBasePkg(root, { name: 'x', version: '0.0.0', devDependencies: { vitest: '^1.0.0' } });
    writeFile(path.join(root, 'vitest.config.ts'), 'export default {};');

    const profile = inspectRepository(root);
    expect(profile.testing.primary).toBe('Vitest');

    // Ensure existing properties still exist.
    expect(profile.frameworks).toHaveProperty('primary');
    expect(profile.buildTools).toHaveProperty('confidence');
    expect(profile.languages).toHaveProperty('primary');
    expect(profile.packageManager).toHaveProperty('detected');
    expect(profile.dependencies).toHaveProperty('all');
  });
});

