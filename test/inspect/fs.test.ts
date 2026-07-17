import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { fileExists, readFileTextSafe, readJsonSafe } from '../../src/inspect/fs';

describe('inspect/fs', () => {
  it('fileExists returns false for missing paths', () => {
    const p = path.join(os.tmpdir(), 'gritch-missing-' + Date.now());
    expect(fileExists(p)).toBe(false);
  });

  it('readFileTextSafe returns undefined for missing paths', () => {
    const p = path.join(os.tmpdir(), 'gritch-missing-' + Date.now() + '.txt');
    expect(readFileTextSafe(p)).toBeUndefined();
  });

  it('readFileTextSafe and readJsonSafe read valid files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-fs-'));
    const txt = path.join(dir, 'a.txt');
    const json = path.join(dir, 'b.json');

    fs.writeFileSync(txt, 'hello', 'utf8');
    fs.writeFileSync(json, JSON.stringify({ ok: true }), 'utf8');

    expect(fileExists(txt)).toBe(true);
    expect(readFileTextSafe(txt)).toBe('hello');
    expect(readJsonSafe<{ ok: boolean }>(json)).toEqual({ ok: true });
  });

  it('readJsonSafe returns undefined for invalid JSON', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-fs-'));
    const p = path.join(dir, 'bad.json');
    fs.writeFileSync(p, '{bad json', 'utf8');

    expect(readJsonSafe(p)).toBeUndefined();
  });
});

