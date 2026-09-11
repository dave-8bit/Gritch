import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildFileInventory } from '../../src/inspect/inventory';

const roots: string[] = [];

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-inventory-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('buildFileInventory metadata', () => {
  it('returns normalized relative paths, sizes, modification times, and stable order', () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'z.ts'), '123');
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), '12');

    const inventory = buildFileInventory({ rootPath: root });

    expect(inventory.files.map((file) => file.relativePath)).toEqual(['src/a.ts', 'z.ts']);
    expect(inventory.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: 'src/a.ts', size: 2 }),
      expect.objectContaining({ relativePath: 'z.ts', size: 3 }),
    ]));
    for (const file of inventory.files) {
      expect(file.modifiedTime).toEqual(expect.any(Number));
      expect(file.relativePath).not.toContain('\\');
    }
  });

  it('retains existing ignore rules including .gritch', () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, '.gritch'), { recursive: true });
    fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(root, '.gritch', 'repository.sqlite'), 'ignored');
    fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), 'ignored');
    fs.writeFileSync(path.join(root, 'README.md'), 'included');

    expect(buildFileInventory({ rootPath: root }).files.map((file) => file.relativePath)).toEqual(['README.md']);
  });
});
