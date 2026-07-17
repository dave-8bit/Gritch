import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { walkFiles } from '../../src/inspect/walker';

function write(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

describe('inspect/walker', () => {
  it('walkFiles inventories files but ignores ignored directories', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-walk-'));

    // Included
    write(path.join(root, 'src', 'a.ts'), 'export const a = 1');

    // Ignored by default ignore rules
    write(path.join(root, '.git', 'config'), 'x');
    write(path.join(root, 'node_modules', 'pkg', 'index.js'), 'x');
    write(path.join(root, 'dist', 'bundle.js'), 'x');
    write(path.join(root, '.next', 'static', 'x.js'), 'x');

    const rels = Array.from(
      walkFiles({ root, maxDepth: 5, maxFiles: 1000, followSymlinks: false })
    ).map((e) => e.relativePath.replaceAll('\\', '/'));

    expect(rels).toContain('src/a.ts');
    expect(rels.some((p) => p.startsWith('node_modules/'))).toBe(false);
    expect(rels.some((p) => p.startsWith('.git/'))).toBe(false);
    expect(rels.some((p) => p.startsWith('dist/'))).toBe(false);
    expect(rels.some((p) => p.startsWith('.next/'))).toBe(false);
  });

  it('respects maxDepth', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-walk-'));
    write(path.join(root, 'a', 'b', 'c', 'd.ts'), 'x');

    const shallow = Array.from(walkFiles({ root, maxDepth: 1, maxFiles: 1000 }));
    expect(shallow.length).toBe(0);

    const deep = Array.from(walkFiles({ root, maxDepth: 10, maxFiles: 1000 }));
    expect(deep.some((e) => e.relativePath.endsWith('d.ts'))).toBe(true);
  });
});

