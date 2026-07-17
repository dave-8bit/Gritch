import path from 'path';

import type { InventoryResult } from './types';
import { buildFileInventory } from './inventory';
import { fileExists } from './fs';
import { loadDependencies, type DependencyIndex } from './dependencies';

export type TestingFrameworkId =
  | 'Vitest'
  | 'Jest'
  | 'Playwright'
  | 'Cypress'
  | 'Mocha'
  | 'Ava'
  | 'Jasmine';

export interface TestingFrameworkDetectionResult {
  primary: TestingFrameworkId | undefined;
  secondary: TestingFrameworkId[];
  confidence: number; // 0..1
  evidence: string[];
}

type Score = { fw: TestingFrameworkId; score: number };

type Rule = {
  id: TestingFrameworkId;
  deps: string[];
  configFiles: string[];
  /** Highest-confidence signal first. */
  weightDeps: number;
  weightConfig: number;
};

const RULES: Rule[] = [
  {
    id: 'Vitest',
    deps: ['vitest'],
    configFiles: ['vitest.config.ts', 'vitest.config.js', 'vitest.workspace.ts'],
    weightDeps: 1.4,
    weightConfig: 1.1,
  },
  {
    id: 'Jest',
    deps: ['jest', '@jest/core'],
    configFiles: [
      'jest.config.js',
      'jest.config.ts',
      'jest.config.cjs',
      'jest.config.mjs',
    ],
    weightDeps: 1.3,
    weightConfig: 1.2,
  },
  {
    id: 'Playwright',
    deps: ['@playwright/test'],
    configFiles: ['playwright.config.ts', 'playwright.config.js'],
    weightDeps: 1.2,
    weightConfig: 1.1,
  },
  {
    id: 'Cypress',
    deps: ['cypress'],
    configFiles: ['cypress.config.ts', 'cypress.config.js'],
    weightDeps: 1.1,
    weightConfig: 1.15,
  },
  {
    id: 'Mocha',
    deps: ['mocha'],
    configFiles: ['.mocharc.json', '.mocharc.js', '.mocharc.cjs'],
    weightDeps: 1.05,
    weightConfig: 1.15,
  },
  {
    id: 'Ava',
    deps: ['ava'],
    configFiles: ['ava.config.js', 'ava.config.cjs'],
    weightDeps: 1.05,
    weightConfig: 1.15,
  },
  {
    id: 'Jasmine',
    deps: ['jasmine'],
    configFiles: ['spec/support/jasmine.json'],
    weightDeps: 1.05,
    weightConfig: 1.15,
  },
];

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function normalizeInventoryPaths(inv: InventoryResult): Set<string> {
  return new Set(inv.files.map((f) => toPosix(f.path)));
}

function hasDep(index: DependencyIndex, dep: string): boolean {
  // Exact framework dependency match only.
  if (index.all.has(dep)) return true;
  for (const d of index.all) {
    if (d === dep) return true;
    if (d.startsWith(dep + '/')) return true;
  }
  return false;
}

function computeConfidence(scored: Score[]): number {
  if (scored.length === 0) return 0;
  const total = scored.reduce((sum, s) => sum + s.score, 0);
  if (total <= 0) return 0;
  const ratio = scored[0].score / total;
  const second = scored[1]?.score ?? 0;
  const closenessPenalty = second > 0 && (scored[0].score - second) / scored[0].score < 0.2 ? 0.12 : 0;
  return Math.max(0, Math.min(1, ratio - closenessPenalty));
}

function hasConfigFile(invPaths: Set<string>, rootPath: string, rel: string): boolean {
  const p = toPosix(rel);
  if (invPaths.has(p)) return true;
  return fileExists(path.join(rootPath, p));
}

export function detectTestingFrameworks(rootPath?: string): TestingFrameworkDetectionResult {
  const resolvedRoot = rootPath ? path.resolve(rootPath) : process.cwd();
  const inv = buildFileInventory({ rootPath: resolvedRoot, maxDepth: 8, maxFiles: 100_000 });
  return detectTestingFrameworksWithInventory(resolvedRoot, inv);
}

export function detectTestingFrameworksWithInventory(
  rootPath: string,
  inv: InventoryResult,
): TestingFrameworkDetectionResult {
  const invPaths = normalizeInventoryPaths(inv);
  const deps = loadDependencies(rootPath);

  const scores = new Map<TestingFrameworkId, number>();
  const evidence: string[] = [];

  const bump = (fw: TestingFrameworkId, delta: number, why: string) => {
    scores.set(fw, (scores.get(fw) ?? 0) + delta);
    if (evidence.length < 40) evidence.push(why);
  };

  for (const rule of RULES) {
    for (const d of rule.deps) {
      if (hasDep(deps, d)) bump(rule.id, rule.weightDeps, `package.json dep: ${d}`);
    }

    for (const cf of rule.configFiles) {
      if (hasConfigFile(invPaths, rootPath, cf)) {
        bump(rule.id, rule.weightConfig, `config file: ${cf}`);
      }
    }
  }

  const scored = Array.from(scores.entries())
    .map(([fw, score]) => ({ fw, score }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      primary: undefined,
      secondary: [],
      confidence: 0,
      evidence: ['No testing framework evidence found'],
    };
  }

  const primary = scored[0].fw;
  const detected = scored.filter((s) => s.score >= scored[0].score * 0.55).map((s) => s.fw);

  // Match existing detector behavior: only populate secondary when there are competitors.
  const secondary = detected.length > 1 ? detected.filter((f) => f !== primary).slice(0, 4) : [];


  const confidence = computeConfidence(scored);

  return {
    primary,
    secondary,
    confidence,
    evidence: evidence.slice(0, 40),
  };
}

