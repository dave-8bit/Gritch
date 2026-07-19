import path from 'path';

import type { InventoryResult } from './types';
import { resolveRepoRoot } from './root';
import { buildFileInventory } from './inventory';
import { fileExists, normalizeToPosix, readJsonSafe } from './fs';

export type WorkspaceManagerId = 'npm' | 'pnpm' | 'yarn' | 'turbo' | 'nx' | 'rush' | 'lerna';

export interface ArchitectureDetectionResult {
  monorepo: boolean;

  workspaceManager?:
    | 'npm'
    | 'pnpm'
    | 'yarn'
    | 'turbo'
    | 'nx'
    | 'rush'
    | 'lerna';

  confidence: number;

  evidence: string[];

  directories: {
    apps: boolean;
    packages: boolean;
    libs: boolean;
    services: boolean;
    frontend: boolean;
    backend: boolean;
    api: boolean;
    functions: boolean;
  };
}

const KNOWN_DIRECTORY_RELS = [
  'apps',
  'packages',
  'libs',
  'services',
  'frontend',
  'backend',
  'api',
  'functions',
] as const;

type KnownDir = (typeof KNOWN_DIRECTORY_RELS)[number];

type DirEvidence = Record<KnownDir, boolean>;

const WORKSPACE_FILES: Array<{ id: Exclude<WorkspaceManagerId, 'npm' | 'yarn'>; file: string; evidence: string }> = [
  { id: 'pnpm', file: 'pnpm-workspace.yaml', evidence: 'pnpm-workspace.yaml' },
  { id: 'turbo', file: 'turbo.json', evidence: 'turbo.json' },
  { id: 'nx', file: 'nx.json', evidence: 'nx.json' },
  { id: 'rush', file: 'rush.json', evidence: 'rush.json' },
  { id: 'lerna', file: 'lerna.json', evidence: 'lerna.json' },
];

const WEIGHTS = {
  workspaceFile: 2.5,
  packageJsonWorkspaces: 1.7,

  knownDirs: 0.9,
  // When confidence is mostly from directory evidence, reduce slightly.
  directoryOnlyPenalty: 0.18,
} as const;

function toPosix(p: string): string {
  return normalizeToPosix(p);
}

function computeConfidence(scored: Array<{ score: number }>): number {
  if (scored.length === 0) return 0;
  const total = scored.reduce((sum, s) => sum + s.score, 0);
  if (total <= 0) return 0;

  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const primary = sorted[0];
  const primaryScore = primary.score;
  const secondScore = sorted[1]?.score ?? 0;

  const ratio = primaryScore / total;
  const closenessPenalty = secondScore > 0 && (primaryScore - secondScore) / primaryScore < 0.2 ? 0.12 : 0;
  return Math.max(0, Math.min(1, ratio - closenessPenalty));
}

function hasInvPath(invPaths: Set<string>, rel: string): boolean {
  return invPaths.has(toPosix(rel));
}

function detectDirectories(rootPath: string, inv: InventoryResult): DirEvidence {
  const invPaths = new Set(inv.files.map((f) => toPosix(f.path)));
  const evidence = {} as DirEvidence;

  for (const dir of KNOWN_DIRECTORY_RELS) {
    // Directory evidence is allowed to use repository inventory OR filesystem existence.
    const rel = dir;
    const abs = path.join(rootPath, rel);
    const existsByInv = hasInvPath(invPaths, rel);
    const existsOnFs = fileExists(abs) || (!existsByInv && fileExists(abs) === false);

    // fileExists is strict file-only; directories won't match. Use inv evidence primarily.
    // If not present in inv, we also check for a directory existence by using fs.existsSync.
    // But we must not add new parsing/AST. Using fs exists is allowed.
    const dirExists =
      existsByInv ||
      (() => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const fs = require('fs') as typeof import('fs');
          return fs.existsSync(abs) && fs.statSync(abs).isDirectory();
        } catch {
          return false;
        }
      })();

    evidence[dir] = dirExists;
  }

  return evidence;
}

function detectWorkspaceManager(rootPath: string, inv: InventoryResult): {
  workspaceManager?: ArchitectureDetectionResult['workspaceManager'];
  workspaceEvidence: string[];
  workspaceScoreEntries: Array<{ id: Exclude<WorkspaceManagerId, 'yarn'> | 'yarn'; score: number }>;
} {
  const invPaths = new Set(inv.files.map((f) => toPosix(f.path)));
  const workspaceEvidence: string[] = [];
  const scores = new Map<WorkspaceManagerId, number>();

  const bump = (id: WorkspaceManagerId, delta: number, why: string) => {
    scores.set(id, (scores.get(id) ?? 0) + delta);
    if (workspaceEvidence.length < 20) workspaceEvidence.push(why);
  };

  // Workspace manager explicit evidence from known files.
  for (const wf of WORKSPACE_FILES) {
    if (hasInvPath(invPaths, wf.file) || fileExists(path.join(rootPath, wf.file))) {
      bump(wf.id, WEIGHTS.workspaceFile, wf.evidence);
    }
  }

  // package.json workspaces field only -> npm
  const pkg = readJsonSafe<{ workspaces?: unknown }>(path.join(rootPath, 'package.json'));
  if (scores.size === 0) {
    const hasWorkspaces = Array.isArray(pkg?.workspaces) || (pkg?.workspaces && typeof pkg?.workspaces === 'object');
    if (hasWorkspaces && (hasInvPath(invPaths, 'package.json') || fileExists(path.join(rootPath, 'package.json')))) {
      bump('npm', WEIGHTS.packageJsonWorkspaces, 'package.json workspaces field');
    }
  }

  const sorted = Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);

  if (sorted.length === 0) {
    return {
      workspaceManager: undefined,
      workspaceEvidence: workspaceEvidence.length ? workspaceEvidence : ['No workspace manager evidence found'],
      workspaceScoreEntries: [],
    };
  }

  return {
    workspaceManager: sorted[0].id,
    workspaceEvidence,
    workspaceScoreEntries: sorted.map((s) => ({ id: s.id, score: s.score })),
  };
}

export function detectArchitecture(rootPath?: string): ArchitectureDetectionResult {
  const startPath = rootPath ? path.resolve(rootPath) : process.cwd();
  const { root } = resolveRepoRoot(startPath);
  const inv = buildFileInventory({ rootPath: root, maxDepth: 8, maxFiles: 100_000 });
  return detectArchitectureWithInventory(root, inv);
}

export function detectArchitectureWithInventory(rootPath: string, inv: InventoryResult): ArchitectureDetectionResult {
  const directories = detectDirectories(rootPath, inv);

  const workspace = detectWorkspaceManager(rootPath, inv);

  const dirsPresent = Object.values(directories).filter(Boolean).length;
  const hasAnyDirEvidence = dirsPresent > 0;

  const evidence: string[] = [];
  const dirEvidence: string[] = [];
  for (const dir of KNOWN_DIRECTORY_RELS) {
    if (directories[dir]) dirEvidence.push(`dir: ${dir}/`);
  }

  // Scoring entries for confidence.
  // We treat monorepo-ness as evidence presence. Primary is computed by the ratio model.
  const scored: Array<{ score: number; source: string }> = [];

  const workspaceScoreTotal = workspace.workspaceScoreEntries.reduce((sum, s) => sum + s.score, 0);
  if (workspace.workspaceScoreEntries.length > 0) {
    scored.push({ score: workspaceScoreTotal, source: 'workspace files' });
    evidence.push(...workspace.workspaceEvidence.slice(0, 12));
  }

  if (hasAnyDirEvidence) {
    const dirScore = WEIGHTS.knownDirs * Math.min(4, dirsPresent);
    scored.push({ score: dirScore, source: 'directory structure' });
    // Directory evidence never affects workspaceManager.
    evidence.push(...dirEvidence.slice(0, 12));
  }

  if (scored.length === 0) {
    return {
      monorepo: false,
      confidence: 0,
      evidence: ['No repository architecture evidence found'],
      directories: {
        apps: false,
        packages: false,
        libs: false,
        services: false,
        frontend: false,
        backend: false,
        api: false,
        functions: false,
      },
    };
  }

  const confidenceBase = computeConfidence(scored.map((s) => ({ score: s.score })));

  // directory-only penalty: if we have no workspace evidence, reduce confidence.
  const directoryOnly = workspace.workspaceScoreEntries.length === 0 && hasAnyDirEvidence;
  const confidence = directoryOnly ? Math.max(0, confidenceBase - WEIGHTS.directoryOnlyPenalty) : confidenceBase;

  // monorepo decision: must have at least some directory or workspace evidence.
  // Confidence threshold is conservative to avoid false positives.
  const monorepo = confidence >= 0.25 && (workspace.workspaceScoreEntries.length > 0 || hasAnyDirEvidence);

  return {
    monorepo,
    workspaceManager: workspace.workspaceManager,
    confidence: Math.max(0, Math.min(1, confidence)),
    evidence: evidence.length ? evidence.slice(0, 20) : ['No repository architecture evidence found'],
    directories,
  };
}

