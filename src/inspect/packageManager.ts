import path from 'path';
import type { InventoryResult } from './types';
import { buildFileInventory } from './inventory';
import { fileExists, normalizeToPosix } from './fs';
import { loadDependencies } from './dependencies';

export type DetectedPackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';

export interface PackageManagerDetectionResult {
  detected: Exclude<DetectedPackageManager, 'unknown'> | 'unknown';
  confidence: number; // 0..1
  evidence: string[];
}

const LOCKFILES: Array<{
  manager: Exclude<DetectedPackageManager, 'unknown'>;
  file: string;
}> = [
  { manager: 'npm', file: 'package-lock.json' },
  { manager: 'pnpm', file: 'pnpm-lock.yaml' },
  { manager: 'yarn', file: 'yarn.lock' },
  { manager: 'bun', file: 'bun.lockb' },
];

const WEIGHTS = {
  /** package.json "packageManager" field is an explicit declaration. */
  packageManagerField: 2.0,
  /** A lockfile is strong but can be stale or duplicated. */
  lockfile: 1.5,
};

const KNOWN_MANAGERS: ReadonlySet<string> = new Set(['npm', 'pnpm', 'yarn', 'bun']);

/** Parses "pnpm@9.0.0" → "pnpm"; returns undefined for unknown managers. */
function parsePackageManagerField(value: string): Exclude<DetectedPackageManager, 'unknown'> | undefined {
  const name = value.split('@')[0].trim().toLowerCase();
  return KNOWN_MANAGERS.has(name) ? (name as Exclude<DetectedPackageManager, 'unknown'>) : undefined;
}

function hasRootFile(invPaths: Set<string>, rootPath: string, rel: string): boolean {
  const p = normalizeToPosix(rel);
  if (invPaths.has(p)) return true;
  return fileExists(path.join(rootPath, p));
}

export function detectPackageManager(rootPath?: string): PackageManagerDetectionResult {
  const resolvedRoot = rootPath ? path.resolve(rootPath) : process.cwd();
  const inv = buildFileInventory({ rootPath: resolvedRoot, maxDepth: 8, maxFiles: 100_000 });
  return detectPackageManagerWithInventory(resolvedRoot, inv);
}

export function detectPackageManagerWithInventory(
  rootPath: string,
  inv: InventoryResult,
): PackageManagerDetectionResult {
  const invPaths = new Set(inv.files.map((f) => normalizeToPosix(f.path)));
  const evidence: string[] = [];
  const scores = new Map<Exclude<DetectedPackageManager, 'unknown'>, number>();

  const bump = (manager: Exclude<DetectedPackageManager, 'unknown'>, delta: number, why: string) => {
    scores.set(manager, (scores.get(manager) ?? 0) + delta);
    if (evidence.length < 20) evidence.push(why);
  };

  // package.json "packageManager" field (via the shared dependency index)
  const deps = loadDependencies(rootPath);
  if (deps.packageManager) {
    const manager = parsePackageManagerField(deps.packageManager);
    if (manager) {
      bump(manager, WEIGHTS.packageManagerField, `package.json packageManager: ${deps.packageManager}`);
    }
  }

  // Lockfiles at the repository root
  for (const { manager, file } of LOCKFILES) {
    if (hasRootFile(invPaths, rootPath, file)) {
      bump(manager, WEIGHTS.lockfile, `lockfile: ${file}`);
    }
  }

  const scored = Array.from(scores.entries())
    .map(([manager, score]) => ({ manager, score }))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      detected: 'unknown',
      confidence: 0,
      evidence: ['No package manager evidence found'],
    };
  }

  const total = scored.reduce((sum, s) => sum + s.score, 0);
  const ratio = total > 0 ? scored[0].score / total : 0;
  const second = scored[1]?.score ?? 0;
  const closenessPenalty = second > 0 && (scored[0].score - second) / scored[0].score < 0.2 ? 0.12 : 0;
  const confidence = Math.max(0, Math.min(1, ratio - closenessPenalty));

  return {
    detected: scored[0].manager,
    confidence,
    evidence,
  };
}
