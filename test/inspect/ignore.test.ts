import { describe, it, expect } from 'vitest';

import { shouldIgnorePath, defaultIgnoreRules, shouldIgnoreDir, shouldIgnoreFile } from '../../src/inspect/ignore';

describe('inspect/ignore', () => {
  it('ignores common directory segments', () => {
    expect(shouldIgnorePath('node_modules/pkg/index.js', defaultIgnoreRules)).toBe(true);
    expect(shouldIgnorePath('src/.next/build/whatever.js', defaultIgnoreRules)).toBe(true);
    expect(shouldIgnorePath('.git/config', defaultIgnoreRules)).toBe(true);
  });

  it('does not ignore non-ignored paths', () => {
    expect(shouldIgnorePath('src/app/index.ts', defaultIgnoreRules)).toBe(false);
    expect(shouldIgnorePath('docs/readme.md', defaultIgnoreRules)).toBe(false);
  });

  it('basic helpers work', () => {
    expect(shouldIgnoreDir('.git')).toBe(true);
    expect(shouldIgnoreDir('src')).toBe(false);

    expect(shouldIgnoreFile('package-lock.json')).toBe(false);
    expect(shouldIgnoreFile('some-random-file.txt')).toBe(false);
  });
});


