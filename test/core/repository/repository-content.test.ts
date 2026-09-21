import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_MAX_FILES,
  DEFAULT_PER_FILE_CHAR_LIMIT,
  FileSystemRepositoryContentReader,
  createRepositoryContentReader,
} from '../../../src/core/repository/repository-content';

const roots: string[] = [];

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-content-'));
  roots.push(root);
  return root;
}

function write(root: string, relativePath: string, content: string | Buffer): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()!;
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // Windows can briefly hold handles; the temp directory is disposable.
    }
  }
});

describe('FileSystemRepositoryContentReader — text reading', () => {
  it('reads a normal text file with its real byte size', () => {
    const root = makeRoot();
    write(root, 'src/a.ts', 'export const a = 1;\n');
    const reader = createRepositoryContentReader();

    const result = reader.readText(root, 'src/a.ts');

    expect(result).toEqual({
      relativePath: 'src/a.ts',
      content: 'export const a = 1;\n',
      sizeBytes: 20,
      truncated: false,
    });
  });

  it('returns undefined for a missing file instead of inventing content', () => {
    const root = makeRoot();
    const reader = createRepositoryContentReader();

    expect(reader.readText(root, 'src/missing.ts')).toBeUndefined();
  });

  it('reads a nested file', () => {
    const root = makeRoot();
    write(root, 'src/core/repository/deep/a.ts', 'deep\n');
    const reader = createRepositoryContentReader();

    expect(reader.readText(root, 'src/core/repository/deep/a.ts')?.content).toBe('deep\n');
  });

  it('normalizes repository-relative paths before reading', () => {
    const root = makeRoot();
    write(root, 'src/nested/a.ts', 'normalized\n');
    const reader = createRepositoryContentReader();

    const result = reader.readText(root, './src//nested/./a.ts');

    expect(result?.relativePath).toBe('src/nested/a.ts');
    expect(result?.content).toBe('normalized\n');
  });

  it('preserves non-ASCII and space-containing paths verbatim', () => {
    const root = makeRoot();
    write(root, 'src/caf\u00e9 notes/my file.ts', 'unicode\n');
    const reader = createRepositoryContentReader();

    const result = reader.readText(root, 'src/caf\u00e9 notes/my file.ts');

    expect(result?.relativePath).toBe('src/caf\u00e9 notes/my file.ts');
    expect(result?.content).toBe('unicode\n');
  });

  it('exposes the default limits', () => {
    expect(DEFAULT_PER_FILE_CHAR_LIMIT).toBe(8000);
    expect(DEFAULT_MAX_FILES).toBe(40);
  });
});

describe('FileSystemRepositoryContentReader — repository boundaries', () => {
  it('rejects path traversal that would leave the repository', () => {
    const root = makeRoot();
    const outside = makeRoot();
    write(outside, 'secret.txt', 'outside-secret\n');
    write(root, 'src/a.ts', 'inside\n');
    const reader = createRepositoryContentReader();

    expect(reader.readText(root, '../secret.txt')).toBeUndefined();
    expect(reader.readText(root, 'src/../../secret.txt')).toBeUndefined();
    expect(reader.readText(root, '..\\secret.txt')).toBeUndefined();
  });

  it('rejects absolute paths masquerading as repository-relative paths', () => {
    const root = makeRoot();
    write(root, 'src/a.ts', 'inside\n');
    const reader = createRepositoryContentReader();

    expect(reader.readText(root, path.join(root, 'src/a.ts'))).toBeUndefined();
    expect(reader.readText(root, '/etc/passwd')).toBeUndefined();
    expect(reader.readText(root, 'C:\\Windows\\win.ini')).toBeUndefined();
    expect(reader.readText(root, '\\\\server\\share\\file.ts')).toBeUndefined();
  });

  it('never reads repository metadata under .git', () => {
    const root = makeRoot();
    write(root, '.git/config', '[core]\n');
    const reader = createRepositoryContentReader();

    expect(reader.readText(root, '.git/config')).toBeUndefined();
  });

  it('resolves the repository root from a nested directory', () => {
    const root = makeRoot();
    write(root, '.git/HEAD', 'ref: refs/heads/main\n');
    write(root, 'src/a.ts', 'root-resolved\n');
    const nested = path.join(root, 'src', 'nested');
    fs.mkdirSync(nested, { recursive: true });
    const reader = createRepositoryContentReader();

    const result = reader.readText(nested, 'src/a.ts');

    expect(result?.content).toBe('root-resolved\n');
  });

  it('rejects directories', () => {
    const root = makeRoot();
    write(root, 'src/a.ts', 'inside\n');
    const reader = createRepositoryContentReader();

    expect(reader.readText(root, 'src')).toBeUndefined();
  });
});


describe('FileSystemRepositoryContentReader — non-text content', () => {
  it('skips NUL-containing content', () => {
    const root = makeRoot();
    write(root, 'assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0xff]));
    const reader = createRepositoryContentReader();

    expect(reader.readText(root, 'assets/logo.png')).toBeUndefined();
  });

  it('skips known binary extensions even when the bytes are text', () => {
    const root = makeRoot();
    write(root, 'archive.zip', 'not really a zip');
    const reader = createRepositoryContentReader();

    expect(reader.readText(root, 'archive.zip')).toBeUndefined();
  });

  it('skips content that is not valid UTF-8', () => {
    const root = makeRoot();
    write(root, 'src/broken.txt', Buffer.from([0xff, 0xfe, 0xfd, 0xfc, 0x41, 0x42]));
    const reader = createRepositoryContentReader();

    expect(reader.readText(root, 'src/broken.txt')).toBeUndefined();
  });

  it('skips content dominated by control characters', () => {
    const root = makeRoot();
    write(root, 'src/control.txt', Buffer.from(Array.from({ length: 64 }, () => 0x07)));
    const reader = createRepositoryContentReader();

    expect(reader.readText(root, 'src/control.txt')).toBeUndefined();
  });

  it('skips oversized files', () => {
    const root = makeRoot();
    write(root, 'src/big.ts', 'x'.repeat(4096));
    const reader = createRepositoryContentReader({ maxFileBytes: 128 });

    expect(reader.readText(root, 'src/big.ts')).toBeUndefined();
  });
});

describe('FileSystemRepositoryContentReader — truncation', () => {
  it('truncates at the per-file character limit and says so', () => {
    const root = makeRoot();
    write(root, 'src/long.ts', 'abcdefghijklmnopqrstuvwxyz');
    const reader = createRepositoryContentReader({ perFileCharLimit: 10 });

    const result = reader.readText(root, 'src/long.ts');

    expect(result?.content).toBe('abcdefghij');
    expect(result?.truncated).toBe(true);
    expect(result?.sizeBytes).toBe(26);
  });

  it('does not report truncation when content fits exactly', () => {
    const root = makeRoot();
    write(root, 'src/exact.ts', 'abcdefghij');
    const reader = createRepositoryContentReader({ perFileCharLimit: 10 });

    const result = reader.readText(root, 'src/exact.ts');

    expect(result?.content).toBe('abcdefghij');
    expect(result?.truncated).toBe(false);
  });
});

describe('FileSystemRepositoryContentReader — readMany', () => {
  it('reads multiple files in request order and skips unreadable ones', () => {
    const root = makeRoot();
    write(root, 'src/a.ts', 'a\n');
    write(root, 'src/b.ts', 'b\n');
    write(root, 'assets/logo.png', Buffer.from([0x00, 0x01]));
    const reader = createRepositoryContentReader();

    const results = reader.readMany(root, ['src/b.ts', 'src/missing.ts', 'assets/logo.png', 'src/a.ts']);

    expect(results.map((file) => file.relativePath)).toEqual(['src/b.ts', 'src/a.ts']);
  });

  it('reads duplicate requests once', () => {
    const root = makeRoot();
    write(root, 'src/a.ts', 'a\n');
    const reader = createRepositoryContentReader();

    const results = reader.readMany(root, ['src/a.ts', './src/a.ts', 'src//a.ts']);

    expect(results).toHaveLength(1);
  });

  it('caps the number of files read', () => {
    const root = makeRoot();
    write(root, 'src/a.ts', 'a\n');
    write(root, 'src/b.ts', 'b\n');
    write(root, 'src/c.ts', 'c\n');
    const reader = createRepositoryContentReader({ maxFiles: 2 });

    const results = reader.readMany(root, ['src/a.ts', 'src/b.ts', 'src/c.ts']);

    expect(results.map((file) => file.relativePath)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('is deterministic across repeated calls', () => {
    const root = makeRoot();
    write(root, 'src/a.ts', 'a\n');
    write(root, 'src/b.ts', 'b\n');
    const reader: FileSystemRepositoryContentReader = new FileSystemRepositoryContentReader();
    const request = ['src/b.ts', 'src/a.ts'];

    const first = reader.readMany(root, request);
    const second = reader.readMany(root, request);

    expect(first).toEqual(second);
    expect(first.map((file) => file.relativePath)).toEqual(['src/b.ts', 'src/a.ts']);
  });
});