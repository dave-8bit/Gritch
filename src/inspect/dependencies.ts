import path from 'path';

import { readJsonSafe } from './fs';

export interface DependencyIndex {
  /** package.json "dependencies" ({} when absent or malformed). */
  dependencies: Readonly<Record<string, string>>;
  /** package.json "devDependencies" ({} when absent or malformed). */
  devDependencies: Readonly<Record<string, string>>;
  /** Combined set of dependency + devDependency names. */
  all: ReadonlySet<string>;
  /** package.json "packageManager" field, if present (e.g. "pnpm@9.0.0"). */
  packageManager?: string;
  /** package.json "scripts", if present. Raw data only — no detection logic. */
  scripts?: Readonly<Record<string, string>>;
}

const cache = new Map<string, DependencyIndex>();

function asRecord(value: unknown): Record<string, string> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, string>;
  }
  return undefined;
}

/**
 * Loads and indexes package.json dependencies for a repository root.
 * Never throws; missing or invalid package.json yields an empty index.
 * Results are cached per resolved root for the duration of the process.
 */
export function loadDependencies(rootPath: string): DependencyIndex {
  const resolvedRoot = path.resolve(rootPath);
  const cached = cache.get(resolvedRoot);
  if (cached) return cached;

  const pkg = readJsonSafe<{
    dependencies?: unknown;
    devDependencies?: unknown;
    scripts?: unknown;
    packageManager?: unknown;
  }>(path.join(resolvedRoot, 'package.json'));

  const dependencies = asRecord(pkg?.dependencies) ?? {};
  const devDependencies = asRecord(pkg?.devDependencies) ?? {};
  const scripts = asRecord(pkg?.scripts);
  const packageManager = typeof pkg?.packageManager === 'string' ? pkg.packageManager : undefined;

  const index: DependencyIndex = {
    dependencies,
    devDependencies,
    all: new Set<string>([...Object.keys(dependencies), ...Object.keys(devDependencies)]),
    packageManager,
    scripts,
  };

  cache.set(resolvedRoot, index);
  return index;
}

export function hasDependency(index: DependencyIndex, name: string): boolean {
  return index.all.has(name);
}

export function hasAnyDependency(index: DependencyIndex, names: string[]): boolean {
  return names.some((n) => hasDependency(index, n));
}

export function getDependencies(index: DependencyIndex): readonly string[] {
  return Array.from(index.all);
}

/** Clears the per-process cache (intended for tests). */
export function clearDependencyCache(): void {
  cache.clear();
}
