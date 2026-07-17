import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { resolveRepoRoot } from '../../src/inspect/root';

describe('inspect/root', () => {
  it('finds nearest parent .git directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-root-'));
    const nested = path.join(root, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(path.join(root, '.git'));

    const res = resolveRepoRoot(nested);
    expect(res.root).toBe(root);
    expect(res.evidence).toContain(path.join('.git'));
  });

  it('falls back to startPath when no .git exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-root-'));
    const nested = path.join(root, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });

    const res = resolveRepoRoot(nested);
    expect(res.root).toBe(path.resolve(nested));
  });
});

