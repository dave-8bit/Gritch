import path from 'path';

import type { InventoryResult } from './types';
import { buildFileInventory } from './inventory';
import { fileExists, normalizeToPosix } from './fs';
import { loadDependencies, type DependencyIndex } from './dependencies';

export type LintingId = 'ESLint' | 'Biome' | 'Oxlint' | 'TSLint';
export type FormattingId = 'Prettier' | 'Biome' | 'dprint';

export interface LintingDetectionResult {
  primary: LintingId | undefined;
  secondary: LintingId[];
  confidence: number; // 0..1
  evidence: string[];
}

export interface FormattingDetectionResult {
  primary: FormattingId | undefined;
  secondary: FormattingId[];
  confidence: number; // 0..1
  evidence: string[];
}

type Score = { tool: LintingId; score: number };
type FormattingScore = { tool: FormattingId; score: number };

type Rule<T extends string> = {
  tool: T;
  deps: string[];
  configFiles: string[];
  weights: {
    dep: number;
    config: number;
  };
};

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

const LINTING_RULES: Rule<LintingId>[] = [
  {
    tool: 'ESLint',
    deps: ['eslint'],
    configFiles: [
      'eslint.config.js',
      'eslint.config.mjs',
      'eslint.config.cjs',
      'eslint.config.ts',
      '.eslintrc',
      '.eslintrc.json',
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc.yaml',
      '.eslintrc.yml',
    ],
    weights: { dep: 1.4, config: 1.2 },
  },
  {
    tool: 'Biome',
    deps: ['@biomejs/biome'],
    configFiles: ['biome.json', 'biome.jsonc'],
    weights: { dep: 1.35, config: 1.2 },
  },
  {
    tool: 'Oxlint',
    deps: ['oxlint'],
    configFiles: ['.oxlintrc.json', 'oxlint.json'],
    weights: { dep: 1.2, config: 1.1 },
  },
  {
    tool: 'TSLint',
    deps: ['tslint'],
    configFiles: ['tslint.json'],
    weights: { dep: 1.1, config: 1.0 },
  },
];

const FORMATTING_RULES: Rule<FormattingId>[] = [
  {
    tool: 'Prettier',
    deps: ['prettier'],
    configFiles: [
      '.prettierrc',
      '.prettierrc.json',
      '.prettierrc.yml',
      '.prettierrc.yaml',
      '.prettierrc.js',
      'prettier.config.js',
      'prettier.config.cjs',
      'prettier.config.mjs',
      'prettier.config.ts',
    ],
    weights: { dep: 1.45, config: 1.2 },
  },
  {
    tool: 'Biome',
    deps: ['@biomejs/biome'],
    configFiles: ['biome.json', 'biome.jsonc'],
    weights: { dep: 1.4, config: 1.2 },
  },
  {
    tool: 'dprint',
    deps: ['dprint'],
    configFiles: ['dprint.json'],
    weights: { dep: 1.2, config: 1.1 },
  },
];

export function detectLinting(rootPath?: string): LintingDetectionResult {
  const resolvedRoot = rootPath ? path.resolve(rootPath) : process.cwd();
  const inv = buildFileInventory({ rootPath: resolvedRoot, maxDepth: 8, maxFiles: 100_000 });
  return detectLintingWithInventory(resolvedRoot, inv);
}

export function detectLintingWithInventory(rootPath: string, inv: InventoryResult): LintingDetectionResult {
  const invPaths = normalizeInventoryPaths(inv);
  const deps = loadDependencies(rootPath);

  const scores = new Map<LintingId, number>();
  const evidence: string[] = [];

  const bump = (tool: LintingId, delta: number, why: string) => {
    scores.set(tool, (scores.get(tool) ?? 0) + delta);
    if (evidence.length < 40) evidence.push(why);
  };

  for (const rule of LINTING_RULES) {
    for (const d of rule.deps) {
      if (hasDep(deps, d)) bump(rule.tool, rule.weights.dep, `package.json dep: ${d}`);
    }

    for (const cf of rule.configFiles) {
      if (hasConfigFile(invPaths, rootPath, cf)) {
        bump(rule.tool, rule.weights.config, `config file: ${cf}`);
      }
    }
  }

  const scored: Score[] = Array.from(scores.entries())
    .map(([tool, score]) => ({ tool, score }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      primary: undefined,
      secondary: [],
      confidence: 0,
      evidence: ['No linting tool evidence found'],
    };
  }

  const primary = scored[0].tool;
  const detected = scored.filter((s) => s.score >= scored[0].score * 0.55).map((s) => s.tool);
  const secondary = detected.length > 1 ? detected.filter((t) => t !== primary).slice(0, 4) : [];

  const confidence = computeConfidence(scored);

  return {
    primary,
    secondary,
    confidence,
    evidence: evidence.slice(0, 40),
  };
}

export function detectFormatting(rootPath?: string): FormattingDetectionResult {
  const resolvedRoot = rootPath ? path.resolve(rootPath) : process.cwd();
  const inv = buildFileInventory({ rootPath: resolvedRoot, maxDepth: 8, maxFiles: 100_000 });
  return detectFormattingWithInventory(resolvedRoot, inv);
}

export function detectFormattingWithInventory(rootPath: string, inv: InventoryResult): FormattingDetectionResult {
  const invPaths = normalizeInventoryPaths(inv);
  const deps = loadDependencies(rootPath);

  const scores = new Map<FormattingId, number>();
  const evidence: string[] = [];

  const bump = (tool: FormattingId, delta: number, why: string) => {
    scores.set(tool, (scores.get(tool) ?? 0) + delta);
    if (evidence.length < 40) evidence.push(why);
  };

  for (const rule of FORMATTING_RULES) {
    for (const d of rule.deps) {
      if (hasDep(deps, d)) bump(rule.tool, rule.weights.dep, `package.json dep: ${d}`);
    }

    for (const cf of rule.configFiles) {
      if (hasConfigFile(invPaths, rootPath, cf)) {
        bump(rule.tool, rule.weights.config, `config file: ${cf}`);
      }
    }
  }

  const scored: FormattingScore[] = Array.from(scores.entries())
    .map(([tool, score]) => ({ tool, score }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      primary: undefined,
      secondary: [],
      confidence: 0,
      evidence: ['No formatting tool evidence found'],
    };
  }

  const primary = scored[0].tool;
  const detected = scored.filter((s) => s.score >= scored[0].score * 0.55).map((s) => s.tool);
  const secondary = detected.length > 1 ? detected.filter((t) => t !== primary).slice(0, 4) : [];

  const confidence = computeConfidence(scored);

  return {
    primary,
    secondary,
    confidence,
    evidence: evidence.slice(0, 40),
  };
}

