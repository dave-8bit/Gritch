import path from 'path';

import type { InventoryResult } from './types';
import { buildFileInventory } from './inventory';
import { fileExists, normalizeToPosix } from './fs';
import { loadDependencies, type DependencyIndex } from './dependencies';


export type DatabaseId =
  | 'PostgreSQL'
  | 'MySQL'
  | 'MariaDB'
  | 'SQLite'
  | 'MongoDB'
  | 'Redis'
  | 'CockroachDB'
  | 'SQL Server';

export interface DatabaseDetectionResult {
  primary: DatabaseId | undefined;
  secondary: DatabaseId[];
  confidence: number; // 0..1
  evidence: string[];
}

export type OrmId =
  | 'Prisma'
  | 'Drizzle'
  | 'TypeORM'
  | 'Sequelize'
  | 'MikroORM'
  | 'Mongoose'
  | 'Knex'
  | 'Kysely';

export interface OrmDetectionResult {
  primary: OrmId | undefined;
  secondary: OrmId[];
  confidence: number; // 0..1
  evidence: string[];
}

function toPosix(p: string): string {
  return normalizeToPosix(p);
}

function normalizeInventoryPaths(inv: InventoryResult): Set<string> {
  return new Set(inv.files.map((f) => toPosix(f.path)));
}

function hasDep(index: DependencyIndex, dep: string): boolean {
  // Exact + scoped-package fallback (mirrors other detectors).
  if (index.all.has(dep)) return true;
  for (const d of index.all) {
    if (d === dep) return true;
    if (d.startsWith(dep + '/')) return true;
  }
  return false;
}

function hasConfigFile(invPaths: Set<string>, rootPath: string, rel: string): boolean {
  const p = toPosix(rel);
  if (invPaths.has(p)) return true;
  return fileExists(path.join(rootPath, p));
}

function computeConfidence(scored: Array<{ tool: string; score: number }>): number {
  if (scored.length === 0) return 0;
  const total = scored.reduce((sum, s) => sum + s.score, 0);
  if (total <= 0) return 0;

  const primary = scored[0];
  const ratio = primary.score / total;
  const second = scored[1]?.score ?? 0;
  const closenessPenalty = second > 0 && (primary.score - second) / primary.score < 0.2 ? 0.12 : 0;
  return Math.max(0, Math.min(1, ratio - closenessPenalty));
}

function toSecondary<T extends string>(primary: string | undefined, scored: Array<{ tool: T; score: number }>): T[] {
  if (!primary) return [];
  const positive = scored
    .filter((s) => s.score >= (scored[0]?.score ?? 0) * 0.55)
    .map((s) => s.tool);
  if (positive.length <= 1) return [];
  return positive.filter((t) => t !== primary).slice(0, 4);
}

// ----------------------- Database detector -----------------------

type DbRule = {
  id: DatabaseId;
  deps: string[];
  weights: { dep: number };
};

const DATABASE_RULES: DbRule[] = [
  { id: 'PostgreSQL', deps: ['pg'], weights: { dep: 1.4 } },
  { id: 'MySQL', deps: ['mysql2', 'mysql'], weights: { dep: 1.35 } },
  { id: 'MariaDB', deps: ['mariadb'], weights: { dep: 1.35 } },
  { id: 'SQLite', deps: ['sqlite3', 'better-sqlite3'], weights: { dep: 1.35 } },
  { id: 'MongoDB', deps: ['mongodb'], weights: { dep: 1.35 } },
  { id: 'Redis', deps: ['redis', 'ioredis'], weights: { dep: 1.35 } },
  { id: 'CockroachDB', deps: ['cockroachdb'], weights: { dep: 1.35 } },
  { id: 'SQL Server', deps: ['mssql'], weights: { dep: 1.35 } },
];

export function detectDatabase(rootPath?: string): DatabaseDetectionResult {
  const resolvedRoot = rootPath ? path.resolve(rootPath) : process.cwd();
  const inv = buildFileInventory({ rootPath: resolvedRoot, maxDepth: 8, maxFiles: 100_000 });
  return detectDatabaseWithInventory(resolvedRoot, inv);
}


export function detectDatabaseWithInventory(
  rootPath: string,
  inv: InventoryResult,
): DatabaseDetectionResult {

  const invPaths = normalizeInventoryPaths(inv);
  void invPaths; // config files not used for DB detector in this phase.

  const deps = loadDependencies(rootPath);

  const scores = new Map<DatabaseId, number>();
  const evidence: string[] = [];

  const bump = (db: DatabaseId, delta: number, why: string) => {
    scores.set(db, (scores.get(db) ?? 0) + delta);
    if (evidence.length < 40) evidence.push(why);
  };

  for (const rule of DATABASE_RULES) {
    for (const d of rule.deps) {
      if (hasDep(deps, d)) bump(rule.id, rule.weights.dep, `package.json dep: ${d}`);
    }
  }

  const scored = Array.from(scores.entries())
    .map(([tool, score]) => ({ tool, score }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      primary: undefined,
      secondary: [],
      confidence: 0,
      evidence: ['No database evidence found'],
    };
  }

  const primary = scored[0].tool;
  const secondary = toSecondary(primary, scored);
  const confidence = computeConfidence(scored as Array<{ tool: string; score: number }>);

  return {
    primary,
    secondary,
    confidence,
    evidence: evidence.slice(0, 40),
  };
}

// ----------------------- ORM detector -----------------------

type OrmRule = {
  id: OrmId;
  deps: string[];
  configFiles: string[];
  weights: { dep: number; config: number };
};

const ORM_RULES: OrmRule[] = [
  {
    id: 'Prisma',
    deps: ['prisma', '@prisma/client'],
    configFiles: ['prisma/schema.prisma'],
    weights: { dep: 1.35, config: 1.25 },
  },
  {
    id: 'Drizzle',
    deps: ['drizzle-orm'],
    configFiles: ['drizzle.config.ts', 'drizzle.config.js', 'drizzle.config.mjs'],
    weights: { dep: 1.35, config: 1.15 },
  },
  {
    id: 'TypeORM',
    deps: ['typeorm'],
    configFiles: ['ormconfig.json', 'ormconfig.js', 'ormconfig.ts'],
    weights: { dep: 1.3, config: 1.1 },
  },
  {
    id: 'Sequelize',
    deps: ['sequelize'],
    configFiles: [],
    weights: { dep: 1.2, config: 0.9 },
  },
  {
    id: 'MikroORM',
    deps: ['@mikro-orm/core'],
    configFiles: ['mikro-orm.config.ts', 'mikro-orm.config.js'],
    weights: { dep: 1.25, config: 1.15 },
  },
  {
    id: 'Mongoose',
    deps: ['mongoose'],
    configFiles: [],
    weights: { dep: 1.2, config: 0.9 },
  },
  {
    id: 'Knex',
    deps: ['knex'],
    configFiles: [],
    weights: { dep: 1.1, config: 0.9 },
  },
  {
    id: 'Kysely',
    deps: ['kysely'],
    configFiles: [],
    weights: { dep: 1.1, config: 0.9 },
  },
];

export function detectOrm(rootPath?: string): OrmDetectionResult {
  const resolvedRoot = rootPath ? path.resolve(rootPath) : process.cwd();
  const inv = buildFileInventory({ rootPath: resolvedRoot, maxDepth: 8, maxFiles: 100_000 });
  return detectOrmWithInventory(resolvedRoot, inv);
}

export function detectOrmWithInventory(

  rootPath: string,
  inv: InventoryResult,
): OrmDetectionResult {
  const invPaths = normalizeInventoryPaths(inv);
  const deps = loadDependencies(rootPath);

  const scores = new Map<OrmId, number>();
  const evidence: string[] = [];

  const bump = (orm: OrmId, delta: number, why: string) => {
    scores.set(orm, (scores.get(orm) ?? 0) + delta);
    if (evidence.length < 40) evidence.push(why);
  };

  for (const rule of ORM_RULES) {
    for (const d of rule.deps) {
      if (hasDep(deps, d)) bump(rule.id, rule.weights.dep, `package.json dep: ${d}`);
    }

    for (const cf of rule.configFiles) {
      if (hasConfigFile(invPaths, rootPath, cf)) {
        bump(rule.id, rule.weights.config, `config file: ${cf}`);
      }
    }
  }

  const scored = Array.from(scores.entries())
    .map(([tool, score]) => ({ tool, score }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      primary: undefined,
      secondary: [],
      confidence: 0,
      evidence: ['No ORM evidence found'],
    };
  }

  const primary = scored[0].tool;
  const secondary = toSecondary(primary, scored);
  const confidence = computeConfidence(scored as Array<{ tool: string; score: number }>);

  return {
    primary,
    secondary,
    confidence,
    evidence: evidence.slice(0, 40),
  };
}

