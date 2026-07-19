import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  detectDatabaseWithInventory,
  detectOrmWithInventory,
  detectDatabase,
  detectOrm,
} from '../../src/inspect/database';
import { buildFileInventory } from '../../src/inspect/inventory';
import { clearDependencyCache } from '../../src/inspect/dependencies';

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-db-'));
}

function writeFile(root: string, rel: string, content = 'x') {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function writePkg(root: string, pkg: any) {
  writeFile(root, 'package.json', JSON.stringify(pkg, null, 2));
}

function inv(root: string) {
  return buildFileInventory({ rootPath: root, maxDepth: 6, maxFiles: 10_000 });
}

function reset() {
  clearDependencyCache();
}

describe('inspect/database', () => {
  beforeEach(() => reset());

  it('detects PostgreSQL via pg', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', dependencies: { pg: '^8.0.0' } });

    const db = detectDatabase(root);
    const orm = detectOrm(root);

    expect(db.primary).toBe('PostgreSQL');
    expect(db.confidence).toBeGreaterThan(0);

    // Evidence must be independent: pg should not imply any ORM.
    expect(orm.primary).toBeUndefined();
  });

  it('detects MySQL via mysql2', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', dependencies: { mysql2: '^3.0.0' } });

    const db = detectDatabase(root);
    expect(db.primary).toBe('MySQL');
  });

  it('detects MongoDB via mongodb', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', dependencies: { mongodb: '^6.0.0' } });

    const db = detectDatabase(root);
    expect(db.primary).toBe('MongoDB');
  });

  it('detects Redis via redis', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', dependencies: { redis: '^4.0.0' } });

    const db = detectDatabase(root);
    expect(db.primary).toBe('Redis');
  });

  it('detects SQLite via better-sqlite3', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', dependencies: { 'better-sqlite3': '^10.0.0' } });

    const db = detectDatabase(root);
    expect(db.primary).toBe('SQLite');
  });

  it('detects Prisma via prisma + @prisma/client and prisma/schema.prisma', () => {
    const root = makeRoot();
    writePkg(root, {
      name: 'x',
      version: '0.0.0',
      dependencies: { prisma: '^5.0.0', '@prisma/client': '^5.0.0' },
    });
    writeFile(root, 'prisma/schema.prisma', 'model User { id String @id }');

    const db = detectDatabase(root);
    const o = detectOrm(root);

    expect(o.primary).toBe('Prisma');
    expect(o.evidence.join('\n')).toContain('config file: prisma/schema.prisma');

    // Evidence must be independent: Prisma should not imply a DB driver.
    expect(db.primary).toBeUndefined();
  });

  it('detects Drizzle via drizzle-orm and drizzle.config.ts', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', dependencies: { 'drizzle-orm': '^0.30.0' } });
    writeFile(root, 'drizzle.config.ts', 'export default {}');

    const o = detectOrm(root);
    expect(o.primary).toBe('Drizzle');
  });

  it('Database-only: pg installed, no ORM → database detected, ORM unknown', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', dependencies: { pg: '^8.0.0' } });

    const db = detectDatabase(root);
    const o = detectOrm(root);

    expect(db.primary).toBe('PostgreSQL');
    expect(o.primary).toBeUndefined();
  });

  it('ORM-only: prisma + @prisma/client + prisma/schema.prisma, no database driver → ORM detected, database unknown', () => {
    const root = makeRoot();
    writePkg(root, {
      name: 'x',
      version: '0.0.0',
      dependencies: { prisma: '^5.0.0', '@prisma/client': '^5.0.0' },
    });
    writeFile(root, 'prisma/schema.prisma', 'model User { id String @id }');

    const db = detectDatabase(root);
    const o = detectOrm(root);

    expect(o.primary).toBe('Prisma');
    expect(db.primary).toBeUndefined();
  });

  it('withInventory entry points are consistent with standalone detectors', () => {
    const root = makeRoot();
    writePkg(root, { name: 'x', version: '0.0.0', dependencies: { pg: '^8.0.0' } });

    const model = inv(root);
    const db1 = detectDatabase(root);
    const db2 = detectDatabaseWithInventory(root, model);

    const o1 = detectOrm(root);
    const o2 = detectOrmWithInventory(root, model);

    expect(db2).toEqual(db1);
    expect(o2).toEqual(o1);
  });
});

