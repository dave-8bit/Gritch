import path from 'path';

import type { InventoryResult } from './types';
import { buildFileInventory } from './inventory';
import { fileExists, normalizeToPosix } from './fs';
import { loadDependencies, hasDependency, type DependencyIndex } from './dependencies';

export type BuildToolId =
  | 'Vite'
  | 'Webpack'
  | 'Rollup'
  | 'esbuild'
  | 'tsup'
  | 'Parcel'
  | 'Rspack'
  | 'Turbopack'
  | 'Babel'
  | 'SWC';

export interface BuildToolDetectionResult {
  primary?: BuildToolId;
  secondary: BuildToolId[];
  confidence: number; // 0..1
  evidence: string[];
}

type Rule = {
  tool: BuildToolId;
  deps: string[];
  scripts: string[];
  configFiles: string[];
  /** Score weights; evidence comes only from rules with actual matches. */
  weights: {
    dep: number;
    script: number;
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
  return hasDependency(index, dep);
}

function scoreFromScripts(scripts: Record<string, string> | undefined, rule: Rule): { score: number; hits: string[] } {
  if (!scripts) return { score: 0, hits: [] };

  let score = 0;
  const hits: string[] = [];
  for (const [name, cmd] of Object.entries(scripts)) {
    const hay = `${name} ${cmd}`.toLowerCase();
    for (const s of rule.scripts) {
      const needle = s.toLowerCase();
      if (hay.includes(needle)) {
        score += rule.weights.script;
        if (hits.length < 10) hits.push(`script: ${name} contains ${s}`);
      }
    }
  }

  return { score, hits };
}

function hasConfigFile(invPaths: Set<string>, rootPath: string, rel: string): boolean {
  const p = toPosix(rel);
  if (invPaths.has(p)) return true;
  return fileExists(path.join(rootPath, p));
}

function scoreFromConfigFiles(
  invPaths: Set<string>,
  rootPath: string,
  rule: Rule,
): { score: number; hits: string[] } {
  let score = 0;
  const hits: string[] = [];

  for (const cf of rule.configFiles) {
    if (hasConfigFile(invPaths, rootPath, cf)) {
      score += rule.weights.config;
      if (hits.length < 10) hits.push(`config file: ${cf}`);
    }
  }

  return { score, hits };
}

function computeConfidence(scored: Array<{ tool: BuildToolId; score: number }>): number {
  if (scored.length === 0) return 0;
  const total = scored.reduce((sum, s) => sum + s.score, 0);
  if (total <= 0) return 0;

  const primary = scored[0];
  const ratio = primary.score / total;
  const second = scored[1]?.score ?? 0;
  const closenessPenalty = second > 0 && (primary.score - second) / primary.score < 0.2 ? 0.12 : 0;
  return Math.max(0, Math.min(1, ratio - closenessPenalty));
}

const RULES: Rule[] = [
  {
    tool: 'Vite',
    deps: ['vite'],
    scripts: ['vite'],
    configFiles: ['vite.config.js', 'vite.config.mjs', 'vite.config.ts'],
    weights: { dep: 1.4, script: 0.9, config: 1.2 },
  },
  {
    tool: 'Webpack',
    deps: ['webpack', 'webpack-cli'],
    scripts: ['webpack'],
    configFiles: ['webpack.config.js', 'webpack.config.mjs', 'webpack.config.ts'],
    weights: { dep: 1.2, script: 0.9, config: 1.2 },
  },
  {
    tool: 'Rollup',
    deps: ['rollup'],
    scripts: ['rollup'],
    configFiles: ['rollup.config.js', 'rollup.config.mjs', 'rollup.config.ts'],
    weights: { dep: 1.2, script: 0.8, config: 1.0 },
  },
  {
    tool: 'esbuild',
    deps: ['esbuild'],
    scripts: ['esbuild'],
    configFiles: [],
    weights: { dep: 1.3, script: 0.7, config: 0 },
  },
  {
    tool: 'tsup',
    deps: ['tsup'],
    scripts: ['tsup'],
    configFiles: ['tsup.config.js', 'tsup.config.mjs', 'tsup.config.ts'],
    weights: { dep: 1.4, script: 0.8, config: 1.1 },
  },
  {
    tool: 'Parcel',
    deps: ['parcel'],
    scripts: ['parcel'],
    configFiles: ['.parcelrc', 'parcel.config.js', 'parcel.config.ts'],
    weights: { dep: 1.1, script: 0.7, config: 0.6 },
  },
  {
    tool: 'Rspack',
    deps: ['rspack', '@rspack/core'],
    scripts: ['rspack'],
    configFiles: ['rspack.config.js', 'rspack.config.mjs', 'rspack.config.ts'],
    weights: { dep: 1.3, script: 0.7, config: 1.0 },
  },
  {
    tool: 'Turbopack',
    deps: ['turbopack'],
    scripts: ['turbopack'],
    configFiles: ['turbopack.config.js', 'turbopack.config.ts'],
    weights: { dep: 1.3, script: 1.0, config: 1.0 },
  },
  {
    tool: 'Babel',
    deps: ['@babel/core', '@babel/cli'],
    scripts: ['babel'],
    configFiles: [
      'babel.config.js',
      'babel.config.mjs',
      'babel.config.ts',
      '.babelrc',
      '.babelrc.js',
      '.babelrc.json',
    ],
    weights: { dep: 1.1, script: 0.6, config: 1.1 },
  },
  {
    tool: 'SWC',
    deps: ['@swc/core', '@swc/helpers'],
    scripts: ['swc'],
    configFiles: ['.swcrc'],
    weights: { dep: 1.2, script: 0.6, config: 1.2 },
  },
];

export function detectBuildTools(rootPath?: string): BuildToolDetectionResult {
  const resolvedRoot = rootPath ? path.resolve(rootPath) : process.cwd();
  const inv = buildFileInventory({ rootPath: resolvedRoot, maxDepth: 8, maxFiles: 100_000 });
  return detectBuildToolsWithInventory(resolvedRoot, inv);
}

export function detectBuildToolsWithInventory(rootPath: string, inv: InventoryResult): BuildToolDetectionResult {
  const invPaths = normalizeInventoryPaths(inv);
  const configEvidence: string[] = [];

  const deps = loadDependencies(rootPath);
  const scripts = deps.scripts;

  const scores = new Map<BuildToolId, number>();
  let evidenceFound = false;
  const bump = (tool: BuildToolId, delta: number, evidence: string) => {
    evidenceFound = true;
    scores.set(tool, (scores.get(tool) ?? 0) + delta);
    if (configEvidence.length < 50) configEvidence.push(evidence);
  };


  for (const rule of RULES) {
    for (const d of rule.deps) {
      if (hasDep(deps, d)) {
        bump(rule.tool, rule.weights.dep, `package.json dep: ${d}`);
      }
    }

    const { score: scriptScore, hits } = scoreFromScripts(scripts, rule);
    if (scriptScore > 0) {
      for (const h of hits) bump(rule.tool, rule.weights.script, h);
    }

    const { score: cfgScore, hits: cfgHits } = scoreFromConfigFiles(invPaths, rootPath, rule);
    if (cfgScore > 0) {
      for (const h of cfgHits) bump(rule.tool, rule.weights.config, h);
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
      evidence: ['No build tool evidence found'],
    };
  }

  const positive = scored;
  const primary = positive[0].tool;
  const detected = positive.filter((s) => s.score >= positive[0].score * 0.55).map((s) => s.tool);
  const secondary = positive.filter((s) => s.tool !== primary).slice(0, 4).map((s) => s.tool);

  const confidence = computeConfidence(scored);

  // Evidence must correspond to actual evidence bumps.
  return {
    primary,
    secondary: detected.length > 1 ? secondary : [],
    confidence,
    evidence: configEvidence.slice(0, 40),
  };
}

