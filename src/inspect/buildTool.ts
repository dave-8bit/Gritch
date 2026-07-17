import path from 'path';

import type { InventoryResult } from './types';
import { buildFileInventory } from './inventory';
import { fileExists, readJsonSafe, normalizeToPosix } from './fs';

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
  | 'SWC'
  | 'unknown';

export interface BuildToolDetectionResult {
  primary: Exclude<BuildToolId, 'unknown'>;
  secondary: Exclude<BuildToolId, 'unknown'>[];
  confidence: number; // 0..1
  evidence: string[];
}

type Score = { tool: Exclude<BuildToolId, 'unknown'>; score: number };

type EvidenceWeight = {
  dep: number;
  script: number;
  config: number;
};

type Rule = {
  tool: Exclude<BuildToolId, 'unknown'>;
  aliasesDeps: string[]; // exact dependency names/prefixes
  aliasesScripts: string[]; // regex-ish substrings
  configFiles?: string[]; // exact paths relative to root
  configHints?: { substr: string; weight: number }[];
  weights: EvidenceWeight;
};

function toPosix(p: string): string {
  return normalizeToPosix(p);
}

function normalizeInventoryPaths(inv: InventoryResult): Set<string> {
  return new Set(inv.files.map((f) => toPosix(f.path)));
}

function hasDep(depSet: Set<string>, alias: string): boolean {
  if (depSet.has(alias)) return true;

  // Only treat aliases ending with '/' as prefix matches.
  if (alias.endsWith('/')) {
    for (const d of depSet) {
      if (d.startsWith(alias)) return true;
    }
    return false;
  }

  // For scoped-style prefixes (e.g. "@swc/") callers should pass an alias ending with '/'.
  // Otherwise do not do prefix matches to avoid false positives like "swc" matching "@swc/core".
  return false;
}

function scoreFromDepsOrDevDeps(pkgDeps: Set<string>, rule: Rule): number {
  let score = 0;
  for (const a of rule.aliasesDeps) {
    if (hasDep(pkgDeps, a)) score += rule.weights.dep;
  }
  return score;
}

function scoreFromScripts(scripts: Record<string, string> | undefined, rule: Rule): { score: number; hits: string[] } {
  if (!scripts) return { score: 0, hits: [] };
  let score = 0;
  const hits: string[] = [];
  for (const [name, cmd] of Object.entries(scripts)) {
    const hay = `${name} ${cmd}`.toLowerCase();
    for (const s of rule.aliasesScripts) {
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

function scoreFromConfigFiles(invPaths: Set<string>, rootPath: string, rule: Rule): { score: number; hits: string[] } {
  if (!rule.configFiles || rule.configFiles.length === 0) return { score: 0, hits: [] };
  let score = 0;
  const hits: string[] = [];

  for (const cf of rule.configFiles) {
    if (hasConfigFile(invPaths, rootPath, cf)) {
      // Avoid adding evidence based purely on incidental presence; only score when weights.config > 0.
      if (rule.weights.config > 0) {
        score += rule.weights.config;
        if (hits.length < 10) hits.push(`config file: ${cf}`);
      }
    }
  }

  return { score, hits };
}

function computeConfidence(scored: Score[]): number {
  if (scored.length === 0) return 0;
  const total = scored.reduce((sum, s) => sum + s.score, 0);
  const primary = scored[0];
  if (total <= 0) return 0;

  const ratio = primary.score / total;
  const second = scored[1]?.score ?? 0;
  const closenessPenalty = second > 0 && (primary.score - second) / primary.score < 0.2 ? 0.12 : 0;
  return Math.max(0, Math.min(1, ratio - closenessPenalty));
}

const RULES: Rule[] = [
  {
    tool: 'Vite',
    aliasesDeps: ['vite'],
    aliasesScripts: ['vite'],
    configFiles: ['vite.config.js', 'vite.config.mjs', 'vite.config.ts'],
    weights: { dep: 1.4, script: 0.9, config: 1.2 },
  },
  {
    tool: 'Webpack',
    aliasesDeps: ['webpack', 'webpack-cli'],
    aliasesScripts: ['webpack'],
    configFiles: ['webpack.config.js', 'webpack.config.mjs', 'webpack.config.ts'],
    weights: { dep: 1.2, script: 0.9, config: 1.2 },
  },
  {
    tool: 'Rollup',
    aliasesDeps: ['rollup', '@rollup/plugin-', 'rollup-plugin-'],
    aliasesScripts: ['rollup'],
    configFiles: ['rollup.config.js', 'rollup.config.mjs', 'rollup.config.ts'],
    weights: { dep: 1.2, script: 0.8, config: 1.0 },
  },
  {
    tool: 'esbuild',
    aliasesDeps: ['esbuild'],
    aliasesScripts: ['esbuild'],
    configHints: [{ substr: 'esbuild', weight: 1 }],
    weights: { dep: 1.3, script: 0.7, config: 0 },
  },
  {
    tool: 'tsup',
    aliasesDeps: ['tsup'],
    aliasesScripts: ['tsup'],
    configFiles: ['tsup.config.js', 'tsup.config.mjs', 'tsup.config.ts'],
    weights: { dep: 1.4, script: 0.8, config: 1.1 },
  },
  {
    tool: 'Parcel',
    aliasesDeps: ['parcel'],
    aliasesScripts: ['parcel'],
    configFiles: ['.parcelrc', 'parcel.config.js', 'parcel.config.ts', 'package.json'],
    weights: { dep: 1.1, script: 0.7, config: 0.6 },
  },
  {
    tool: 'Rspack',
    aliasesDeps: ['@rspack/core', 'rspack'],
    aliasesScripts: ['rspack'],
    configFiles: ['rspack.config.js', 'rspack.config.mjs', 'rspack.config.ts'],
    weights: { dep: 1.3, script: 0.7, config: 1.0 },
  },
  {
    tool: 'Turbopack',
    // Do NOT infer from next/nextjs. Require explicit evidence.
    aliasesDeps: ['turbopack'],
    aliasesScripts: ['turbopack'],
    configFiles: ['turbopack.config.js', 'turbopack.config.ts'],
    weights: { dep: 1.3, script: 1.0, config: 1.0 },
  },
  {
    tool: 'Babel',
    aliasesDeps: ['@babel/core', '@babel/cli', 'babel-core', 'babel'],
    aliasesScripts: ['babel'],
    configFiles: ['babel.config.js', 'babel.config.mjs', 'babel.config.ts', '.babelrc', '.babelrc.js', '.babelrc.json'],
    weights: { dep: 1.1, script: 0.6, config: 1.1 },
  },
  {
    tool: 'SWC',
    aliasesDeps: ['@swc/core', '@swc/helpers', '@swc/'],
    aliasesScripts: ['swc'],
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

  const pkg = readJsonSafe<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  }>(path.join(rootPath, 'package.json'));

  const deps = new Set<string>([
    ...(pkg?.dependencies ? Object.keys(pkg.dependencies) : []),
    ...(pkg?.devDependencies ? Object.keys(pkg.devDependencies) : []),
  ]);

  const scripts = pkg?.scripts;

  const scores = new Map<Exclude<BuildToolId, 'unknown'>, number>();
  const bump = (tool: Exclude<BuildToolId, 'unknown'>, delta: number, evidence: string) => {
    scores.set(tool, (scores.get(tool) ?? 0) + delta);
    if (configEvidence.length < 50) configEvidence.push(evidence);
  };

  for (const rule of RULES) {
    // deps
    for (const a of rule.aliasesDeps) {
      if (hasDep(deps, a)) {
        bump(rule.tool, rule.weights.dep, `package.json dep: ${a}`);
      }
    }

    // scripts
    const { score, hits } = scoreFromScripts(scripts, rule);
    if (score > 0) {
      for (const h of hits) bump(rule.tool, rule.weights.script, h);
    }

    // config files
    const { score: cfgScore, hits: cfgHits } = scoreFromConfigFiles(invPaths, rootPath, rule);
    if (cfgScore > 0) {
      for (const h of cfgHits) bump(rule.tool, rule.weights.config, h);
    }
  }

  const scored = Array.from(scores.entries())
    .map(([tool, score]) => ({ tool, score }))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      primary: 'Vite',
      secondary: [],
      confidence: 0,
      evidence: ['No build tool evidence found'],
    };
  }

  // Defensive: if everything scored is 0, treat as no evidence.
  const hasPositiveScore = scored.some((s) => s.score > 0);
  if (!hasPositiveScore) {
    return {
      primary: 'Vite',
      secondary: [],
      confidence: 0,
      evidence: ['No build tool evidence found'],
    };
  }

  // If there is no evidence collected at all, confidence must be 0.
  if (configEvidence.length === 0) {
    return {
      primary: 'Vite',
      secondary: [],
      confidence: 0,
      evidence: ['No build tool evidence found'],
    };
  }

  const positive = scored.filter((s) => s.score > 0);

  // If we only have zero-score entries, treat as no evidence.
  if (positive.length === 0) {
    return {
      primary: 'Vite',
      secondary: [],
      confidence: 0,
      evidence: ['No build tool evidence found'],
    };
  }

  const primary = positive[0].tool;
  const detected = positive.filter((s) => s.score >= positive[0].score * 0.55).map((s) => s.tool);
  const secondary = positive.filter((s) => s.tool !== primary).slice(0, 4).map((s) => s.tool);

  const confidence = computeConfidence(scored);

  return {
    primary,
    secondary: detected.length > 1 ? secondary : [],
    confidence: confidence > 0 ? confidence : 0,
    evidence: configEvidence.length ? configEvidence.slice(0, 40) : ['No build tool evidence found'],
  };
}

