import simpleGit from 'simple-git';
import type { SimpleGit } from 'simple-git';

import { resolveRepositoryIdentity, type RepositoryIdentity } from './repository.identity';
import {
  observeRepositoryState,
  type RepositoryState,
  type RepositoryStatusEntry,
  type RepositoryWorktreeState,
} from './repository.state';
import { normalizeRepositoryPath, repositoryPathExtension } from './repository.file-index';
import {
  classifyChangeFile,
  classifyRisk,
  createEmptyChangeSignals,
  deriveChangeSignals,
  deriveSubsystem,
} from './change-evidence.rules';

/**
 * Deterministic change evidence for the staged change (index vs HEAD).
 *
 * The packet is a pure function of repository state: it contains no
 * timestamps or other nondeterministic values, and all emitted arrays are
 * deterministically ordered. It records structural facts only and never
 * attempts semantic intent.
 *
 * The packet states its own fidelity explicitly: `identitySource` records
 * where changed-file identity came from, per-file `lineCountsAvailable`
 * records whether Git supplied statistics for that exact path, and
 * `degradations` lists closed-vocabulary reasons why the packet is less
 * than full fidelity. An empty `degradations` array means full fidelity.
 */
export const CHANGE_EVIDENCE_VERSION = 1;

export type ChangeFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type-changed'
  | 'unmerged'
  | 'unknown';

export type ChangeFileCategory =
  | 'source'
  | 'test'
  | 'config'
  | 'documentation'
  | 'dependency'
  | 'schema'
  | 'migration'
  | 'database'
  | 'persistence'
  | 'ci'
  | 'cli'
  | 'api'
  | 'generated'
  | 'unknown';

export type ChangeRiskTier = 'trivial' | 'moderate' | 'high';

export interface ChangeFileRecord {
  /** Normalized repository-relative posix path. */
  path: string;
  status: ChangeFileStatus;
  /** Rename/copy source path. */
  previousPath?: string;
  /** Git similarity score for renames/copies when reported. */
  similarity?: number;
  /**
   * True when Git supplied a statistics record for this exact path.
   * A genuine zero-line change (e.g. a rename or mode-only change) has
   * zero counts AND true availability; a statistics join miss has zero
   * counts AND false availability. Binary files have true availability
   * with zero line counts (`binary` distinguishes them).
   */
  lineCountsAvailable: boolean;
  insertions: number;
  deletions: number;
  changes: number;
  binary: boolean;
  extension: string;
  category: ChangeFileCategory;
  /** Deterministic path grouping only (see deriveSubsystem). */
  subsystem: string;
  conflicted: boolean;
}

export interface ChangeTotals {
  /** True only when every changed file has Git-provided line statistics. */
  lineCountsAvailable: boolean;
  /** Changed files for which Git provided no statistics record. */
  filesMissingLineCounts: number;
  /** Statistics records that matched no authoritative changed file. */
  unmatchedStatisticsFiles: number;
  files: number;
  insertions: number;
  deletions: number;
  binaryFiles: number;
  byStatus: Record<ChangeFileStatus, number>;
}

/**
 * Deterministic change signals. Rule-derived structural facts.
 *
 * `apiOrInterfaceChanges` and `securitySensitivePaths` are explicitly
 * path/name heuristics and are NOT semantic or AST-level understanding.
 */
export interface ChangeSignals {
  dependencyChanges: boolean;
  packageMetadataChanges: boolean;
  schemaOrMigrationChanges: boolean;
  persistenceOrStorageChanges: boolean;
  cliSurfaceChanges: boolean;
  apiOrInterfaceChanges: boolean;
  testChanges: boolean;
  configurationChanges: boolean;
  documentationChanges: boolean;
  generatedOrBuildOutputChanges: boolean;
  securitySensitivePaths: string[];
  sourceCodeChanges: boolean;
  testOnlyChange: boolean;
  deletedSourceFiles: string[];
  unstagedChangesPresent: boolean;
}

/** Closed vocabulary: which Git surface produced the changed-file identity. */
export type ChangeEvidenceIdentitySource =
  /** Raw `git diff --cached --name-status` output (full fidelity). */
  | 'staged-diff'
  /** Repository status entries, used when the staged diff cannot be produced. */
  | 'repository-status'
  /** No identity was consulted (non-Git directory; `files` is empty). */
  | 'none';

/**
 * Closed vocabulary of deterministic degradation reasons.
 *
 * Reasons are structural facts about how the packet was produced — never
 * free-form diagnostics, timestamps, or random values. Emitted in
 * definition order; an empty array means a full-fidelity packet.
 */
export type ChangeEvidenceDegradationReason =
  /** The staged diff failed; identity fell back to repository status entries. */
  | 'identity-from-repository-status'
  /** Line statistics could not be produced at all. */
  | 'line-statistics-unavailable'
  /** Statistics were produced but do not cover the authoritative change set. */
  | 'line-statistics-incomplete';

const DEGRADATION_ORDER: readonly ChangeEvidenceDegradationReason[] = [
  'identity-from-repository-status',
  'line-statistics-unavailable',
  'line-statistics-incomplete',
];

export interface ChangeEvidence {
  schemaVersion: typeof CHANGE_EVIDENCE_VERSION;
  repository: {
    root: string;
    key: string;
    headRevision?: string;
    worktreeState: RepositoryWorktreeState;
  };
  /** Which Git surface produced `files`. */
  identitySource: ChangeEvidenceIdentitySource;
  /** Deterministic closed-vocabulary degradation reasons; empty = full fidelity. */
  degradations: ChangeEvidenceDegradationReason[];
  files: ChangeFileRecord[];
  totals: ChangeTotals;
  signals: ChangeSignals;
  tier: ChangeRiskTier;
  tierReasons: string[];
}

/** Identity facts produced by the raw `--name-status` parser. */
export interface ChangeFileIdentity {
  status: ChangeFileStatus;
  path: string;
  previousPath?: string;
  similarity?: number;
}

const STATUS_ORDER: readonly ChangeFileStatus[] = [
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
  'type-changed',
  'unmerged',
  'unknown',
];

const STATUS_LETTERS: Readonly<Record<string, ChangeFileStatus>> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  T: 'type-changed',
  U: 'unmerged',
  X: 'unknown',
  B: 'unknown',
};

function parseSimilarity(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parses raw `git diff --cached --name-status -z` output into identity records.
 *
 * The `-z` form is NUL-separated and quoting-immune: Git emits paths verbatim
 * (UTF-8) with no C-style quoting, regardless of `core.quotePath`. Format per
 * record: `X<NUL>path<NUL>` or `R<sim><NUL>old<NUL>new<NUL>` /
 * `C<sim><NUL>old<NUL>new<NUL>` (verified against git 2.51 via simple-git).
 *
 * Path tokens are consumed verbatim: spaces, tabs, quotes, backslashes, and
 * non-ASCII characters are preserved exactly as Git emitted them. Normalization
 * happens later, on the decoded path, never before.
 */
export function parseNameStatus(raw: string): ChangeFileIdentity[] {
  const identities: ChangeFileIdentity[] = [];
  const tokens = raw.split('\0');
  let index = 0;
  while (index < tokens.length) {
    const code = tokens[index];
    // Empty segments only occur from stray/trailing NULs; status codes are
    // never empty. Path tokens are never trimmed or filtered.
    if (!code) {
      index += 1;
      continue;
    }

    const first = code[0];
    if (first === 'R' || first === 'C') {
      const previousPath = tokens[index + 1];
      const path = tokens[index + 2];
      index += 3;
      if (!previousPath || !path) continue; // malformed record; drop it
      const similarity = parseSimilarity(code.slice(1));
      identities.push({
        status: first === 'R' ? 'renamed' : 'copied',
        path,
        previousPath,
        ...(similarity !== undefined ? { similarity } : {}),
      });
      continue;
    }

    const path = tokens[index + 1];
    index += 2;
    if (!path) continue; // malformed record; drop it
    identities.push({
      status: STATUS_LETTERS[first] ?? 'unknown',
      path,
    });
  }
  return identities;
}

export interface ChangeFileStatistics {
  insertions: number;
  deletions: number;
  changes: number;
  binary: boolean;
}

function toNonNegativeInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
}

function isCountField(value: string): boolean {
  return /^\d+$/.test(value);
}

/**
 * Parses raw `git diff --cached --numstat -z` output into a
 * normalized-path → statistics map keyed by the new path.
 *
 * The `-z` form is NUL-separated and quoting-immune: Git emits paths verbatim
 * (UTF-8) with no C-style quoting, regardless of `core.quotePath`. Verified
 * record shapes (git 2.51):
 * - plain:      `<ins>\t<del>\t<path><NUL>`
 * - rename/copy: `<ins>\t<del>\t<NUL>old<NUL>new<NUL>` (empty path slot marks it)
 * - binary:     `-\t-\t<path><NUL>` (counts are dashes, not numbers)
 *
 * Everything after the second tab is the path, so paths containing tabs are
 * preserved verbatim. Path tokens are never trimmed; normalization happens
 * here on the decoded path, never on an escaped representation.
 */
export function parseNumStat(raw: string): Map<string, ChangeFileStatistics> {
  const statistics = new Map<string, ChangeFileStatistics>();
  const tokens = raw.split('\0');
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    index += 1;
    // Empty segments only occur from stray/trailing NULs.
    if (!token) continue;

    const firstTab = token.indexOf('\t');
    const secondTab = firstTab < 0 ? -1 : token.indexOf('\t', firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue; // malformed; drop it

    const insertionsField = token.slice(0, firstTab);
    const deletionsField = token.slice(firstTab + 1, secondTab);
    const pathSlot = token.slice(secondTab + 1);
    const binary = insertionsField === '-' && deletionsField === '-';
    if (!binary && !(isCountField(insertionsField) && isCountField(deletionsField))) continue;

    let path: string | undefined;
    if (pathSlot === '') {
      // Rename/copy form: the empty path slot is followed by old<NUL>new.
      const previousPath = tokens[index];
      path = tokens[index + 1];
      index += 2;
      if (!previousPath || !path) continue; // malformed record; drop it
    } else {
      path = pathSlot;
    }

    const normalized = normalizeRepositoryPath(path);
    if (!normalized) continue;

    const insertions = binary ? 0 : toNonNegativeInteger(insertionsField);
    const deletions = binary ? 0 : toNonNegativeInteger(deletionsField);
    statistics.set(normalized, {
      insertions,
      deletions,
      changes: insertions + deletions,
      binary,
    });
  }
  return statistics;
}

/**
 * Fallback identity facts from repository status entries, used only when the
 * staged diff cannot be produced (e.g. a git that refuses an unborn HEAD).
 * Index codes map deterministically to `ChangeFileStatus`; unstaged-only and
 * untracked entries are skipped.
 */
export function identityFromStatusEntries(entries: readonly RepositoryStatusEntry[]): ChangeFileIdentity[] {
  const identities: ChangeFileIdentity[] = [];
  for (const entry of entries) {
    const index = entry.index.trim();
    if (index === '' || index === '?' || index === ' ') continue;
    const first = index[0];
    if (first === 'R' || first === 'C') {
      identities.push({
        status: first === 'R' ? 'renamed' : 'copied',
        path: entry.path,
        ...(entry.from ? { previousPath: entry.from } : {}),
      });
      continue;
    }
    identities.push({
      status: STATUS_LETTERS[first] ?? 'unknown',
      path: entry.path,
    });
  }
  return identities;
}

function emptyByStatus(): Record<ChangeFileStatus, number> {
  const byStatus = {} as Record<ChangeFileStatus, number>;
  for (const status of STATUS_ORDER) byStatus[status] = 0;
  return byStatus;
}

/**
 * Aggregates totals from records. Never fabricates counts.
 *
 * `lineCountsAvailable` is strict completeness: true only when every changed
 * file has Git-provided statistics. `unmatchedStatisticsFiles` counts
 * statistics records that matched no authoritative changed file, so aggregate
 * insertions/deletions (which only sum authoritative per-file counts) cannot
 * silently undercount without the packet saying so.
 */
export function computeChangeTotals(
  files: readonly ChangeFileRecord[],
  unmatchedStatisticsFiles = 0,
): ChangeTotals {
  const byStatus = emptyByStatus();
  let insertions = 0;
  let deletions = 0;
  let binaryFiles = 0;
  let filesMissingLineCounts = 0;
  for (const file of files) {
    byStatus[file.status] += 1;
    if (!file.lineCountsAvailable) filesMissingLineCounts += 1;
    insertions += file.insertions;
    deletions += file.deletions;
    if (file.binary) binaryFiles += 1;
  }
  return {
    lineCountsAvailable: files.every((file) => file.lineCountsAvailable),
    filesMissingLineCounts,
    unmatchedStatisticsFiles,
    files: files.length,
    insertions,
    deletions,
    binaryFiles,
    byStatus,
  };
}

function toChangeFileRecord(
  entry: ChangeFileIdentity,
  statistics: ReadonlyMap<string, ChangeFileStatistics>,
  conflictedPaths: ReadonlySet<string>,
): ChangeFileRecord {
  const path = normalizeRepositoryPath(entry.path);
  const stats = statistics.get(path);

  const record: ChangeFileRecord = {
    path,
    status: entry.status,
    lineCountsAvailable: stats !== undefined,
    insertions: stats?.insertions ?? 0,
    deletions: stats?.deletions ?? 0,
    changes: stats?.changes ?? 0,
    binary: stats?.binary ?? false,
    extension: repositoryPathExtension(path),
    category: classifyChangeFile(path),
    subsystem: deriveSubsystem(path),
    conflicted: entry.status === 'unmerged' || conflictedPaths.has(path),
  };

  if (entry.previousPath !== undefined) record.previousPath = normalizeRepositoryPath(entry.previousPath);
  if (entry.similarity !== undefined) record.similarity = entry.similarity;

  return record;
}

export interface ChangeEvidenceBuilderDependencies {
  resolveIdentity: (repositoryPath?: string) => RepositoryIdentity;
  observeState: (repositoryPath?: string) => Promise<RepositoryState>;
  git: (baseDir: string) => SimpleGit;
}

export type ChangeEvidenceBuilderOptions = Partial<ChangeEvidenceBuilderDependencies>;

/**
 * Both Git reads use `-z` NUL-separated output, which is quoting-immune: Git
 * emits paths verbatim regardless of `core.quotePath`, so C-quoted escapes
 * such as `"src/caf\303\251.ts"` can never enter the pipeline. Verified
 * byte-for-byte against simple-git 3.36.0 / git 2.51 (`SimpleGit.diff` passes
 * the output through untouched).
 *
 * Both commands share the same rename/copy flags so the statistics join keys
 * cover exactly the authoritative name-status identity set.
 */
const NAME_STATUS_ARGS = ['--cached', '--name-status', '-M', '-C', '-z'] as const;
const NUM_STAT_ARGS = ['--cached', '--numstat', '-M', '-C', '-z'] as const;

/**
 * Builds deterministic change evidence for the staged change.
 *
 * Git sources of truth:
 * - name-status (`-z`) supplies the authoritative changed-path/status identity.
 * - numstat (`-z`) supplies per-file line/binary statistics where available.
 * - repository status supplies conflict/worktree state.
 *
 * The packet never degrades silently: every shortfall is recorded in
 * `degradations` (closed vocabulary), `identitySource` states where identity
 * came from, and per-file/total `lineCountsAvailable` state exactly which
 * files have Git-provided statistics. Counts are never fabricated.
 */
export class ChangeEvidenceBuilder {
  private readonly dependencies: Required<ChangeEvidenceBuilderDependencies>;

  constructor(options: ChangeEvidenceBuilderOptions = {}) {
    this.dependencies = {
      resolveIdentity: options.resolveIdentity ?? resolveRepositoryIdentity,
      observeState: options.observeState ?? observeRepositoryState,
      git: options.git ?? simpleGit,
    };
  }

  async build(repositoryPath?: string): Promise<ChangeEvidence> {
    const identity = this.dependencies.resolveIdentity(repositoryPath);
    const state = await this.dependencies.observeState(repositoryPath);

    if (state.worktreeState === 'non-git') {
      return this.emptyEvidence(identity, state);
    }

    const git = this.dependencies.git(identity.root);
    const conflictedPaths = new Set(state.status.conflicted.map(normalizeRepositoryPath));

    let identities: ChangeFileIdentity[];
    let identitySource: ChangeEvidenceIdentitySource = 'staged-diff';
    const degradations = new Set<ChangeEvidenceDegradationReason>();
    let statistics = new Map<string, ChangeFileStatistics>();
    let statisticsProduced = false;

    try {
      identities = parseNameStatus(await git.diff([...NAME_STATUS_ARGS]));
      try {
        statistics = parseNumStat(await git.diff([...NUM_STAT_ARGS]));
        statisticsProduced = true;
      } catch {
        degradations.add('line-statistics-unavailable');
      }
    } catch {
      identities = identityFromStatusEntries(state.status.entries);
      identitySource = 'repository-status';
      degradations.add('identity-from-repository-status');
      degradations.add('line-statistics-unavailable');
    }

    const files = identities.map((entry) => toChangeFileRecord(entry, statistics, conflictedPaths));
    files.sort((left, right) => left.path.localeCompare(right.path));

    // Statistics join fidelity, in both directions: authoritative files
    // without a statistics record, and statistics records matching no
    // authoritative file. Either one means the aggregate counts undercount
    // the staged change, which the packet must communicate.
    const filesMissingLineCounts = files.filter((file) => !file.lineCountsAvailable).length;
    const authoritativePaths = new Set(files.map((file) => file.path));
    let unmatchedStatisticsFiles = 0;
    for (const key of statistics.keys()) {
      if (!authoritativePaths.has(key)) unmatchedStatisticsFiles += 1;
    }
    if (statisticsProduced && (filesMissingLineCounts > 0 || unmatchedStatisticsFiles > 0)) {
      degradations.add('line-statistics-incomplete');
    }

    const totals = computeChangeTotals(files, unmatchedStatisticsFiles);
    const signals = deriveChangeSignals(files, state.status);
    const { tier, tierReasons } = classifyRisk(files, signals);

    return {
      schemaVersion: CHANGE_EVIDENCE_VERSION,
      repository: {
        root: identity.root,
        key: identity.key,
        headRevision: state.headRevision,
        worktreeState: state.worktreeState,
      },
      identitySource,
      degradations: DEGRADATION_ORDER.filter((reason) => degradations.has(reason)),
      files,
      totals,
      signals,
      tier,
      tierReasons,
    };
  }

  private emptyEvidence(identity: RepositoryIdentity, state: RepositoryState): ChangeEvidence {
    return {
      schemaVersion: CHANGE_EVIDENCE_VERSION,
      repository: {
        root: identity.root,
        key: identity.key,
        headRevision: state.headRevision,
        worktreeState: state.worktreeState,
      },
      identitySource: 'none',
      degradations: [],
      files: [],
      totals: computeChangeTotals([]),
      signals: createEmptyChangeSignals(),
      tier: 'trivial',
      tierReasons: ['non-git repository'],
    };
  }
}

export function createChangeEvidenceBuilder(options: ChangeEvidenceBuilderOptions = {}): ChangeEvidenceBuilder {
  return new ChangeEvidenceBuilder(options);
}