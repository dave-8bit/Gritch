import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveRepositoryIdentity } from '../../../src/core/repository/repository.identity';
import { RepositoryIndexer } from '../../../src/core/repository/repository.indexer';
import { RepositoryRetriever } from '../../../src/core/repository/repository.retriever';
import type {
  RepositoryFileIndexPersistence,
  RepositoryFileRecord,
} from '../../../src/core/repository/repository.file-index';
import { SqliteRepositoryFileIndexPersistence } from '../../../src/core/storage/sqlite.repository-file-index';
import { openRepositoryDatabase } from '../../../src/core/storage/sqlite.connection';

const roots: string[] = [];

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-file-index-'));
  roots.push(root);
  return root;
}

function write(root: string, relativePath: string, content: string): void {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('RepositoryIndexer and RepositoryRetriever', () => {
  it('indexes and reconciles file metadata deterministically', () => {
    const root = makeRoot();
    write(root, 'z.ts', 'z');
    write(root, 'src/a.ts', 'a');
    const indexer = new RepositoryIndexer();

    const first = indexer.refresh(root);
    expect(first.map((record) => record.relativePath)).toEqual(['src/a.ts', 'z.ts']);
    expect(first[0]).toMatchObject({
      repositoryKey: resolveRepositoryIdentity(root).key,
      extension: '.ts',
      sizeBytes: 1,
      metadataVersion: 1,
    });

    write(root, 'new.js', 'new');
    fs.rmSync(path.join(root, 'z.ts'));
    write(root, 'src/a.ts', 'changed');
    const second = indexer.refresh(root);

    expect(second.map((record) => record.relativePath)).toEqual(['new.js', 'src/a.ts']);
    expect(second.find((record) => record.relativePath === 'src/a.ts')?.sizeBytes).toBe(7);
    expect(indexer.refresh(root)).toEqual(second);
  });

  it('updates modification time metadata without reading file contents', () => {
    const root = makeRoot();
    write(root, 'src/a.ts', 'same');
    const indexer = new RepositoryIndexer();
    const first = indexer.refresh(root);
    const firstTime = first[0].modifiedTime;

    fs.utimesSync(path.join(root, 'src/a.ts'), new Date(firstTime + 10_000), new Date(firstTime + 10_000));
    const second = indexer.refresh(root);

    expect(second[0].modifiedTime).toBe(firstTime + 10_000);
    expect(second[0].sizeBytes).toBe(first[0].sizeBytes);
  });

  it('indexes empty and non-Git repositories without Git-state dependencies', () => {
    const root = makeRoot();

    expect(new RepositoryIndexer().refresh(root)).toEqual([]);
  });

  it('supports exact, prefix, extension, substring, and empty retrieval', () => {
    const root = makeRoot();
    write(root, 'src/b.ts', 'b');
    write(root, 'src/a.ts', 'a');
    write(root, 'docs/readme.md', 'docs');
    new RepositoryIndexer().refresh(root);
    const retriever = new RepositoryRetriever();

    expect(retriever.findByPath(root, 'src\\a.ts')?.relativePath).toBe('src/a.ts');
    expect(retriever.findByPath(root, './src/a.ts')?.relativePath).toBe('src/a.ts');
    expect(retriever.findByPrefix(root, 'src')).toHaveLength(2);
    expect(retriever.findByPrefix(root, './src')).toHaveLength(2);
    expect(retriever.findByPrefix(root, 's')).toEqual([]);
    expect(retriever.findByExtension(root, 'TS').map((record) => record.relativePath))
      .toEqual(['src/a.ts', 'src/b.ts']);
    expect(retriever.searchPaths(root, 'READ').map((record) => record.relativePath))
      .toEqual(['docs/readme.md']);
    expect(retriever.searchPaths(root, '.\\src').map((record) => record.relativePath))
      .toEqual(['src/a.ts', 'src/b.ts']);
    expect(retriever.searchPaths(root, 'missing')).toEqual([]);
  });

  it('supports persistence replacement and preserves prior data on a failed replacement', () => {
    const root = makeRoot();
    const identity = resolveRepositoryIdentity(root);
    const persistence = new SqliteRepositoryFileIndexPersistence();
    const record: RepositoryFileRecord = {
      repositoryKey: identity.key,
      relativePath: 'a.ts',
      sizeBytes: 1,
      modifiedTime: 1,
      extension: '.ts',
      metadataVersion: 1,
    };

    persistence.replace(identity, [record]);
    expect(persistence.load(identity)).toEqual([record]);

    const database = openRepositoryDatabase(root);
    database.exec(`
      CREATE TRIGGER reject_file_index_replace
      BEFORE INSERT ON repository_files
      BEGIN SELECT RAISE(ABORT, 'replacement rejected'); END
    `);
    database.close();

    expect(() => persistence.replace(identity, [record])).toThrow();
    expect(persistence.load(identity)).toEqual([record]);
  });
});
