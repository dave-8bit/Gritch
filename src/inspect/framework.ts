import path from 'path';

import type { InventoryResult } from './types';
import { buildFileInventory } from './inventory';
import { fileExists, readJsonSafe } from './fs';

export type FrameworkCategory = 'frontend' | 'backend' | 'fullstack';

export type FrameworkId =
  | 'React'
  | 'Next.js'
  | 'Vue'
  | 'Nuxt'
  | 'Svelte'
  | 'SvelteKit'
  | 'Angular'
  | 'Astro'
  | 'SolidJS'
  | 'Remix'
  | 'Express'
  | 'NestJS'
  | 'Fastify'
  | 'Hono'
  | 'Koa'
  | 'unknown';

export interface FrameworkDetectionResult {
  primary: Exclude<FrameworkId, 'unknown'>;
  secondary: Exclude<FrameworkId, 'unknown'>[];
  category: FrameworkCategory;
  confidence: number; // 0..1
  evidence: string[];
}

type Score = { fw: Exclude<FrameworkId, 'unknown'>; score: number };

const FRONTEND: Exclude<FrameworkId, 'unknown'>[] = [
  'React',
  'Next.js',
  'Vue',
  'Nuxt',
  'Svelte',
  'SvelteKit',
  'Angular',
  'Astro',
  'SolidJS',
  'Remix',
];

const BACKEND: Exclude<FrameworkId, 'unknown'>[] = [
  'Express',
  'NestJS',
  'Fastify',
  'Hono',
  'Koa',
];

type Rule = {
  id: Exclude<FrameworkId, 'unknown'>;
  categoryHints: FrameworkCategory[];
  deps: string[]; // dependency names / prefixes
  configFiles?: string[]; // exact file names/paths relative to root
  dirPrefixes?: string[]; // prefixes relative to root
  entryFiles?: string[]; // exact entry file names/paths relative to root
  weight: number;
};

const RULES: Rule[] = [
  // Frontend
  {
    id: 'React',
    categoryHints: ['frontend', 'fullstack'],
    deps: ['react'],
    entryFiles: ['src/main.tsx', 'src/index.tsx', 'src/App.tsx'],
    weight: 0.9,
  },
  {
    id: 'Next.js',
    categoryHints: ['frontend', 'fullstack'],
    deps: ['next'],
    configFiles: ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next-env.d.ts'],
    dirPrefixes: ['.next/'],
    weight: 1.0,
  },
  {
    id: 'Vue',
    categoryHints: ['frontend'],
    deps: ['vue'],
    configFiles: ['nuxt.config.ts', 'nuxt.config.js', 'vite.config.ts'],
    weight: 0.85,
  },
  {
    id: 'Nuxt',
    categoryHints: ['frontend', 'fullstack'],
    deps: ['nuxt'],
    configFiles: ['nuxt.config.ts', 'nuxt.config.js'],
    weight: 1.0,
  },
  {
    id: 'Svelte',
    categoryHints: ['frontend'],
    deps: ['svelte'],
    configFiles: ['svelte.config.js', 'svelte.config.ts'],
    dirPrefixes: ['src/lib/'],
    weight: 0.85,
  },
  {
    id: 'SvelteKit',
    categoryHints: ['frontend', 'fullstack'],
    deps: ['@sveltejs/kit'],
    configFiles: ['svelte.config.js', 'svelte.config.ts'],
    weight: 1.0,
  },
  {
    id: 'Angular',
    categoryHints: ['frontend'],
    deps: ['@angular/core', '@angular/common'],
    configFiles: ['angular.json'],
    weight: 1.0,
  },
  {
    id: 'Astro',
    categoryHints: ['frontend', 'fullstack'],
    deps: ['astro'],
    configFiles: ['astro.config.mjs', 'astro.config.js', 'astro.config.ts'],
    weight: 1.0,
  },
  {
    id: 'SolidJS',
    categoryHints: ['frontend', 'fullstack'],
    deps: ['solid-js'],
    configFiles: ['solid.config.ts', 'solid.config.js'],
    weight: 0.9,
  },
  {
    id: 'Remix',
    categoryHints: ['frontend', 'fullstack'],
    deps: ['@remix-run/react', '@remix-run/node', 'remix'],
    configFiles: ['remix.config.js', 'remix.config.ts'],
    weight: 1.0,
  },

  // Backend
  {
    id: 'Express',
    categoryHints: ['backend', 'fullstack'],
    deps: ['express'],
    entryFiles: ['src/index.ts', 'src/server.ts', 'src/index.js', 'src/server.js'],
    weight: 1.0,
  },
  {
    id: 'NestJS',
    categoryHints: ['backend', 'fullstack'],
    deps: ['@nestjs/core', '@nestjs/common'],
    configFiles: ['nest-cli.json'],
    entryFiles: ['src/main.ts', 'src/main.js'],
    weight: 1.0,
  },
  {
    id: 'Fastify',
    categoryHints: ['backend', 'fullstack'],
    deps: ['fastify'],
    configFiles: ['fastify.config.ts', 'fastify.config.js'],
    entryFiles: ['src/server.ts', 'src/index.ts'],
    weight: 1.0,
  },
  {
    id: 'Hono',
    categoryHints: ['backend', 'fullstack'],
    deps: ['hono'],
    entryFiles: ['src/index.ts', 'src/server.ts', 'src/app.ts'],
    weight: 0.9,
  },
  {
    id: 'Koa',
    categoryHints: ['backend', 'fullstack'],
    deps: ['koa'],
    entryFiles: ['src/server.ts', 'src/index.ts'],
    weight: 0.85,
  },
];

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function normalizeInventoryPaths(inv: InventoryResult): Set<string> {
  return new Set(inv.files.map((f) => toPosix(f.path)));
}

function hasDep(depSet: Set<string>, dep: string): boolean {
  if (depSet.has(dep)) return true;
  for (const d of depSet) {
    if (d === dep) return true;
    if (d.startsWith(dep + '/')) return true;
  }
  return false;
}

function categorize(detected: Set<FrameworkId>): FrameworkCategory {
  const hasFrontend = Array.from(detected).some((f) => FRONTEND.includes(f as any));
  const hasBackend = Array.from(detected).some((f) => BACKEND.includes(f as any));
  if (hasFrontend && hasBackend) return 'fullstack';
  if (hasBackend) return 'backend';
  return 'frontend';
}

function computeConfidence(scored: Score[]): number {
  if (scored.length === 0) return 0;
  const total = scored.reduce((sum, s) => sum + s.score, 0);
  const ratio = total > 0 ? scored[0].score / total : 0;
  const second = scored[1]?.score ?? 0;
  const closenessPenalty = second > 0 && (scored[0].score - second) / scored[0].score < 0.2 ? 0.12 : 0;
  return Math.max(0, Math.min(1, ratio - closenessPenalty));
}

export function detectFrameworks(rootPath?: string): FrameworkDetectionResult {
  const resolvedRoot = rootPath ? path.resolve(rootPath) : process.cwd();
  const inv = buildFileInventory({ rootPath: resolvedRoot, maxDepth: 8, maxFiles: 100_000 });
  return detectFrameworksWithInventory(resolvedRoot, inv);
}

export function detectFrameworksWithInventory(rootPath: string, inv: InventoryResult): FrameworkDetectionResult {
  const invPaths = normalizeInventoryPaths(inv);
  const configEvidence: string[] = [];

  const pkg = readJsonSafe<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(
    path.join(rootPath, 'package.json')
  );

  const deps = new Set<string>([
    ...(pkg?.dependencies ? Object.keys(pkg.dependencies) : []),
    ...(pkg?.devDependencies ? Object.keys(pkg.devDependencies) : []),
  ]);

  const scores = new Map<Exclude<FrameworkId, 'unknown'>, number>();

  const bump = (fw: Exclude<FrameworkId, 'unknown'>, delta: number, evidence: string) => {
    scores.set(fw, (scores.get(fw) ?? 0) + delta);
    if (configEvidence.length < 40) configEvidence.push(evidence);
  };

  for (const rule of RULES) {
    // deps
    let matched = false;
    for (const d of rule.deps) {
      if (hasDep(deps, d)) {
        bump(rule.id, rule.weight, `package.json dep: ${d}`);
        matched = true;
      }
    }

    // config files
    if (rule.configFiles) {
      for (const cf of rule.configFiles) {
        const cfPosix = toPosix(cf);
        if (invPaths.has(cfPosix) || fileExists(path.join(rootPath, cfPosix))) {
          bump(rule.id, rule.weight * 0.45, `config file: ${cf}`);
          matched = true;
        }
      }
    }

    // dir prefixes
    if (rule.dirPrefixes) {
      for (const dp of rule.dirPrefixes) {
        const dpPosix = toPosix(dp);
        for (const p of invPaths) {
          if (p.startsWith(dpPosix)) {
            bump(rule.id, rule.weight * 0.25, `dir prefix: ${dp}`);
            matched = true;
            break;
          }
        }
      }
    }

    // entry files
    if (rule.entryFiles) {
      for (const ef of rule.entryFiles) {
        const efPosix = toPosix(ef);
        if (invPaths.has(efPosix) || fileExists(path.join(rootPath, efPosix))) {
          bump(rule.id, rule.weight * 0.35, `entry file: ${ef}`);
          matched = true;
        }
      }
    }

    void matched;
  }

  const scored: Score[] = Array.from(scores.entries())
    .map(([fw, score]) => ({ fw, score }))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      primary: 'React',
      secondary: [],
      category: 'frontend',
      confidence: 0,
      evidence: ['No framework evidence found'],
    };
  }

  const primary = scored[0].fw;
  const detected = scored.filter((s) => s.score >= scored[0].score * 0.55).map((s) => s.fw);
  const secondary = scored.filter((s) => s.fw !== primary).slice(0, 4).map((s) => s.fw);

  const category = categorize(new Set<FrameworkId>(detected));
  const confidence = computeConfidence(scored);

  return {
    primary,
    secondary,
    category,
    confidence,
    evidence: configEvidence.slice(0, 40),
  };
}

export function detectFrameworksFromInventory(rootPath: string, inv: InventoryResult): FrameworkDetectionResult {
  return detectFrameworksWithInventory(rootPath, inv);
}

