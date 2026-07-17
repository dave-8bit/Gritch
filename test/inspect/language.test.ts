import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { detectLanguagesWithInventory, detectLanguages } from '../../src/inspect/language';
import { buildFileInventory } from '../../src/inspect/inventory';

function writeFile(p: string, content = 'x') {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

describe('inspect/language', () => {
  it('detects single-language TypeScript', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-lang-'));
    writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 1');
    writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }));

    const res = detectLanguages(root);
    expect(res.primary).toBe('TypeScript');
    expect(res.confidence).toBeGreaterThan(0.6);
  });

  it('detects single-language Python', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-lang-'));
    writeFile(path.join(root, 'app.py'), 'print("hi")');

    const res = detectLanguages(root);
    expect(res.primary).toBe('Python');
    expect(res.confidence).toBeGreaterThan(0.6);
  });

  it('detects mixed languages with weighted scoring', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-lang-'));
    writeFile(path.join(root, 'src', 'a.tsx'), 'export const x = 1'); // higher weight
    writeFile(path.join(root, 'src', 'b.ts'), 'export const y = 2');
    writeFile(path.join(root, 'util.py'), 'print(1)');
    writeFile(path.join(root, 'util2.py'), 'print(2)');

    const inv = buildFileInventory({ rootPath: root, maxDepth: 6, maxFiles: 10_000 });
    const res = detectLanguagesWithInventory(root, inv);

    expect(res.primary).toBe('TypeScript');
    expect(res.secondary).toContain('Python');
    expect(res.confidence).toBeGreaterThan(0.4);
  });

  it('handles empty repositories', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-lang-'));
    const res = detectLanguages(root);
    expect(res.confidence).toBe(0);
  });

  it('handles ambiguous repositories (close scores)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-lang-'));
    // 1 JS file and 1 TS file: close scoring, should lower confidence
    writeFile(path.join(root, 'a.js'), 'console.log(1)');
    writeFile(path.join(root, 'b.ts'), 'export const b = 1');

    const res = detectLanguages(root);
    expect(['TypeScript', 'JavaScript']).toContain(res.primary);
    expect(res.confidence).toBeLessThan(0.8);
  });
});

