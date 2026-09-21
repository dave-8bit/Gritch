import type { RepositoryProfile } from '../../inspect/profile';
import { inspectRepository } from '../../inspect/profile';
import {
  ChangeEvidenceBuilder,
  type ChangeEvidence,
  type ChangeFileRecord,
} from './change-evidence';
import { getStagedDiff } from './change-diff';
import { normalizeRepositoryPath } from './repository.file-index';
import type { RepositoryRetriever } from './repository.retriever';
import {
  FileSystemRepositoryContentReader,
  type RepositoryContentReader,
} from './repository-content';

/**
 * Deterministic review evidence object.
 *
 * This is the single source of review context: it is assembled from the
 * change evidence packet, the repository profile, optional metadata retrieval,
 * repository file contents, and the staged diff. It is an object, not a
 * preformatted prompt, so each consumer (the prompt renderer, tests, future
 * displays) reads the same facts.
 *
 * Invariants:
 * - Every changed file in `ChangeEvidence.files` appears in `files`.
 * - Per-file metadata is never dropped to satisfy a character budget: budgets
 *   only select optional material (diff sections, contents, facts).
 * - Everything truncated or unavailable is stated explicitly in
 *   `truncation.notes` / `overview.notes`; absence of evidence is never
 *   presented as evidence of absence.
 * - Producing it is read-only: no indexing, no writes, no caching.
 */

/** Diff selection budget in characters. */
export const DIFF_BUDGET_CHARS = 12000;
/** Changed/related file content budget in characters. */
export const FILE_CONTENT_BUDGET_CHARS = 16000;
/** Per-file content slice handed to the reviewer. */
export const PER_FILE_CONTENT_CHARS = 4000;
/** Repository fact budget in characters. */
export const REPOSITORY_CONTEXT_CHARS = 800;
/** Overall budget for optional (non-mandatory) context in characters. */
export const TOTAL_CONTEXT_BUDGET_CHARS = 32000;

/** Maximum related-file content entries supplied per review. */
export const MAX_RELATED_CONTENT_FILES = 4;
/** Maximum related-file candidates reported per changed file. */
export const MAX_RELATED_FILES_PER_CHANGED_FILE = 4;
/** Maximum same-directory candidates reported per changed file. */
export const MAX_SAME_DIRECTORY_CANDIDATES = 5;

export interface ChangeContextBudgets {
  diffChars: number;
  fileContentChars: number;
  perFileContentChars: number;
  repositoryContextChars: number;
  totalContextChars: number;
}

export const DEFAULT_CHANGE_CONTEXT_BUDGETS: ChangeContextBudgets = {
  diffChars: DIFF_BUDGET_CHARS,
  fileContentChars: FILE_CONTENT_BUDGET_CHARS,
  perFileContentChars: PER_FILE_CONTENT_CHARS,
  repositoryContextChars: REPOSITORY_CONTEXT_CHARS,
  totalContextChars: TOTAL_CONTEXT_BUDGET_CHARS,
};

/** Whether an optional metadata-only related-file lookup happened. */
export type RelatedFileLookupStatus = 'performed' | 'not-performed' | 'unavailable';

/** Deterministic relationship between a changed file and a related file. */
export type RelatedFileRelation =
  | 'same-directory'
  | 'corresponding-test'
  | 'corresponding-source'
  | 'package-metadata'
  | 'configuration'
  | 'entrypoint';

export interface ChangeContextRelatedFile {
  path: string;
  relation: RelatedFileRelation;
  /** Changed file this candidate was derived from; absent for repository-level candidates. */
  relatedTo?: string;
  /** True when the optional metadata index knew this path. */
  knownToIndex: boolean;
}

export type ChangeContentStatus =
  | 'supplied'
  | 'file-deleted'
  | 'binary'
  | 'budget-exhausted'
  | 'not-supplied';

export interface ChangeContextContent {
  path: string;
  role: 'changed-file' | 'related-file';
  relation?: RelatedFileRelation;
  /** Present only when `status` is `supplied`. */
  content?: string;
  sizeBytes?: number;
  truncated?: boolean;
  status: ChangeContentStatus;
}

export interface ChangeContextFile {
  /** Deterministic metadata, preserved verbatim from the evidence packet. */
  record: ChangeFileRecord;
  contentStatus: ChangeContentStatus;
  relatedFileLookup: RelatedFileLookupStatus;
  relatedFiles: ChangeContextRelatedFile[];
}

export interface ChangeContextOverview {
  /** All deterministic evidence facts except the per-file array. */
  evidence: Omit<ChangeEvidence, 'files'>;
  fileCount: number;
  relatedFileLookup: RelatedFileLookupStatus;
  /** Deterministic provenance/degradation statements. */
  notes: string[];
}

export interface ChangeContextDiffSection {
  /** Matched changed-file path, when the section could be tied to evidence. */
  path?: string;
  previousPath?: string;
  /** Human-readable label used when reporting omissions. */
  label: string;
  header: string;
  hunks: string;
  totalHunks: number;
  includedHunks: number;
  complete: boolean;
}

export interface ChangeContextDiff {
  status: 'available' | 'unavailable';
  unavailableReason?: string;
  sections: ChangeContextDiffSection[];
  /** Labels of sections left out entirely by the budget. */
  omittedSections: string[];
  /** True only when every section was included in full. */
  complete: boolean;
  notes: string[];
}

export interface ChangeContextRepositoryFactGroup {
  /** Change signal that made this group relevant. */
  reason: string;
  facts: string[];
}

export interface ChangeContextRepositoryFacts {
  profileUnavailable: boolean;
  groups: ChangeContextRepositoryFactGroup[];
  notes: string[];
}

export interface ChangeContextTruncation {
  diffTruncated: boolean;
  contentTruncated: boolean;
  relatedContentTruncated: boolean;
  repositoryFactsTruncated: boolean;
  budgets: ChangeContextBudgets;
  mandatoryChars: number;
  suppliedChars: number;
  notes: string[];
}

export interface ChangeContext {
  overview: ChangeContextOverview;
  files: ChangeContextFile[];
  relatedFiles: ChangeContextRelatedFile[];
  contents: ChangeContextContent[];
  diffSections: ChangeContextDiff;
  repositoryFacts: ChangeContextRepositoryFacts;
  truncation: ChangeContextTruncation;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const TEST_DIRECTORIES: readonly string[] = ['test', 'tests', '__tests__', 'spec'];
const SOURCE_DIRECTORIES: readonly string[] = ['src', 'lib', 'source'];

function directoryOf(normalizedPath: string): string {
  const index = normalizedPath.lastIndexOf('/');
  return index < 0 ? '' : normalizedPath.slice(0, index);
}

function extensionOf(normalizedPath: string): string {
  const lastSlash = normalizedPath.lastIndexOf('/');
  const lastDot = normalizedPath.lastIndexOf('.');
  return lastDot <= lastSlash ? '' : normalizedPath.slice(lastDot);
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Deterministic test-path candidates for a source path (no filesystem access). */
function correspondingTestCandidates(normalizedPath: string): string[] {
  const extension = extensionOf(normalizedPath);
  if (!extension) return [];

  const firstSegment = normalizedPath.split('/')[0];
  const relative = firstSegment === 'src' && normalizedPath.includes('/')
    ? normalizedPath.slice(firstSegment.length + 1)
    : normalizedPath;
  const relativeStem = relative.slice(0, relative.length - extension.length);
  const localStem = normalizedPath.slice(0, normalizedPath.length - extension.length);

  return dedupe([
    ...TEST_DIRECTORIES.flatMap((directory) => [
      `${directory}/${relativeStem}.test${extension}`,
      `${directory}/${relativeStem}.spec${extension}`,
    ]),
    `${localStem}.test${extension}`,
    `${localStem}.spec${extension}`,
  ]);
}

/** Deterministic source candidates for a test path (no filesystem access). */
function correspondingSourceCandidates(normalizedPath: string): string[] {
  const extension = extensionOf(normalizedPath);
  if (!extension) return [];

  const firstSegment = normalizedPath.split('/')[0];
  if (!TEST_DIRECTORIES.includes(firstSegment) || !normalizedPath.includes('/')) return [];

  const relativeStem = normalizedPath
    .slice(firstSegment.length + 1)
    .slice(0, -extension.length)
    .replace(/\.(test|spec)$/i, '');

  return dedupe([
    ...SOURCE_DIRECTORIES.map((directory) => `${directory}/${relativeStem}${extension}`),
    `${relativeStem}${extension}`,
  ]);
}

/** Repository-level candidates, only consulted when the change signals justify them. */
const PACKAGE_METADATA_CANDIDATES: readonly string[] = [
  'package.json', 'package-lock.json', 'pyproject.toml', 'go.mod',
  'Cargo.toml', 'Gemfile', 'composer.json', 'requirements.txt',
];

const CONFIGURATION_CANDIDATES: readonly string[] = [
  'tsconfig.json', 'jsconfig.json', 'vitest.config.ts', 'jest.config.js',
  'eslint.config.js', '.eslintrc.json', '.prettierrc', 'gritch.config.json',
];

const ENTRYPOINT_CANDIDATES: readonly string[] = [
  'src/index.ts', 'src/main.ts', 'src/cli.ts', 'src/index.js', 'index.js',
];

/** Total related-file candidates reported per review (keeps the prompt bounded). */
export const MAX_RELATED_FILES_TOTAL = 24;

// ---------------------------------------------------------------------------
// Related-file discovery (metadata-only, optional, deterministic)
// ---------------------------------------------------------------------------

export interface RelatedFileDiscovery {
  status: RelatedFileLookupStatus;
  files: ChangeContextRelatedFile[];
  /** Deterministic statement about what was and was not looked up. */
  note: string;
  /** Paths proven to exist by the metadata index. */
  knownPaths: Set<string>;
}

const NOT_PERFORMED_NOTE =
  'Related-file lookup was not performed: no repository file metadata index was consulted. '
  + 'Related files may exist but were not searched for.';

/**
 * Discovers related files using the optional metadata-only retriever.
 *
 * Existence is only ever claimed when the index proves it: a candidate that the
 * index does not contain is dropped, and an unavailable index is reported as
 * "lookup not performed" rather than as "no related files exist".
 */
export function discoverRelatedFiles(
  evidence: ChangeEvidence,
  retriever: RepositoryRetriever | undefined,
): RelatedFileDiscovery {
  if (!retriever) {
    return { status: 'not-performed', files: [], note: NOT_PERFORMED_NOTE, knownPaths: new Set() };
  }

  const repositoryRoot = evidence.repository.root;
  const changedPaths = new Set(evidence.files.map((file) => file.path));
  const files: ChangeContextRelatedFile[] = [];
  const seen = new Set<string>();
  const knownPaths = new Set<string>();

  const pushKnown = (
    normalizedPath: string,
    relation: RelatedFileRelation,
    relatedTo?: string,
  ): boolean => {
    if (
      files.length >= MAX_RELATED_FILES_TOTAL
      || !normalizedPath
      || seen.has(normalizedPath)
      || changedPaths.has(normalizedPath)
    ) {
      return false;
    }
    seen.add(normalizedPath);
    knownPaths.add(normalizedPath);
    files.push({
      path: normalizedPath,
      relation,
      ...(relatedTo ? { relatedTo } : {}),
      knownToIndex: true,
    });
    return true;
  };

  const lookupAndPush = (path: string, relation: RelatedFileRelation, relatedTo?: string): boolean => {
    const normalizedPath = normalizeRepositoryPath(path);
    if (!normalizedPath || seen.has(normalizedPath) || changedPaths.has(normalizedPath)) return false;
    if (!retriever.findByPath(repositoryRoot, normalizedPath)) return false;
    return pushKnown(normalizedPath, relation, relatedTo);
  };

  try {
    const signals = evidence.signals;
    // Repository-level candidates are consulted first so higher-value relations
    // (package metadata, configuration, entrypoints) are not consumed by
    // same-directory siblings discovered earlier.
    if (signals.packageMetadataChanges || signals.dependencyChanges) {
      for (const candidate of PACKAGE_METADATA_CANDIDATES) lookupAndPush(candidate, 'package-metadata');
    }
    if (signals.configurationChanges || signals.testChanges || signals.cliSurfaceChanges) {
      for (const candidate of CONFIGURATION_CANDIDATES) lookupAndPush(candidate, 'configuration');
    }
    if (signals.cliSurfaceChanges || signals.apiOrInterfaceChanges) {
      for (const candidate of ENTRYPOINT_CANDIDATES) lookupAndPush(candidate, 'entrypoint');
    }

    for (const file of evidence.files) {
      let addedForFile = 0;

      const candidates: Array<{ path: string; relation: RelatedFileRelation }> = [
        ...correspondingTestCandidates(file.path).map((path) => ({ path, relation: 'corresponding-test' as const })),
        ...correspondingSourceCandidates(file.path).map((path) => ({ path, relation: 'corresponding-source' as const })),
      ];

      for (const candidate of candidates) {
        if (addedForFile >= MAX_RELATED_FILES_PER_CHANGED_FILE) break;
        if (lookupAndPush(candidate.path, candidate.relation, file.path)) addedForFile += 1;
      }

      if (addedForFile >= MAX_RELATED_FILES_PER_CHANGED_FILE) continue;

      const directory = directoryOf(file.path);
      const siblings = retriever.findByPrefix(repositoryRoot, directory);
      let sameDirectoryCount = 0;
      for (const sibling of siblings) {
        if (sameDirectoryCount >= MAX_SAME_DIRECTORY_CANDIDATES) break;
        if (addedForFile >= MAX_RELATED_FILES_PER_CHANGED_FILE) break;
        const siblingPath = normalizeRepositoryPath(sibling.relativePath);
        if (!siblingPath || directoryOf(siblingPath) !== directory) continue;
        // A changed file is never its own related file.
        if (seen.has(siblingPath) || changedPaths.has(siblingPath)) continue;
        sameDirectoryCount += 1;
        if (pushKnown(siblingPath, 'same-directory', file.path)) addedForFile += 1;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'unavailable',
      files: [],
      note: `Related-file lookup was not performed: the repository file metadata index could not be read (${message}).`,
      knownPaths: new Set(),
    };
  }

  const note = files.length === 0
    ? 'Related-file lookup was performed against the repository file metadata index and found no related files for the changed paths.'
    : `Related-file lookup was performed against the repository file metadata index; ${files.length} related file(s) were found.`;

  return { status: 'performed', files, note, knownPaths };
}

// ---------------------------------------------------------------------------
// Staged diff: deterministic file/hunk sectioning and budgeted selection
// ---------------------------------------------------------------------------

interface ParsedDiffSection {
  header: string;
  hunks: string[];
  /** Changed-file record this section belongs to, when identifiable. */
  record?: ChangeFileRecord;
  label: string;
}

/**
 * Splits a raw diff into file sections, each split into complete hunks.
 *
 * Sections are never cut in the middle: a section is either included with whole
 * hunks or reported as omitted, so a budget can never hide a later changed file
 * behind a truncated earlier one.
 */
export function splitDiffSections(rawDiff: string, files: readonly ChangeFileRecord[]): ParsedDiffSection[] {
  const lines = rawDiff.split('\n');
  const sectionStarts: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].startsWith('diff --git ')) sectionStarts.push(index);
  }

  const sections: ParsedDiffSection[] = [];
  const preamble = sectionStarts.length > 0 ? lines.slice(0, sectionStarts[0]) : lines;
  if (preamble.some((line) => line.trim() !== '')) {
    sections.push({
      header: '',
      hunks: [preamble.join('\n')],
      label: '(diff preamble)',
    });
  }

  const byFirstHeaderLine = new Map<string, ChangeFileRecord>();
  for (const file of files) {
    byFirstHeaderLine.set(`diff --git a/${file.previousPath ?? file.path} b/${file.path}`, file);
  }

  for (let index = 0; index < sectionStarts.length; index += 1) {
    const start = sectionStarts[index];
    const end = index + 1 < sectionStarts.length ? sectionStarts[index + 1] : lines.length;
    const sectionLines = lines.slice(start, end);

    const headerLines: string[] = [];
    const hunkBlocks: string[] = [];
    let currentHunk: string[] | undefined;

    for (const line of sectionLines) {
      if (line.startsWith('@@')) {
        if (currentHunk) hunkBlocks.push(currentHunk.join('\n'));
        currentHunk = [line];
        continue;
      }
      if (currentHunk) currentHunk.push(line);
      else headerLines.push(line);
    }
    if (currentHunk) hunkBlocks.push(currentHunk.join('\n'));

    const header = headerLines.join('\n');
    const record = byFirstHeaderLine.get(sectionLines[0])
      ?? files.find((file) => header.includes(`b/${file.path}`));

    sections.push({
      header,
      hunks: hunkBlocks,
      ...(record ? { record } : {}),
      label: record ? record.path : `${headerLines[0] ?? '(diff section)'}`.replace('diff --git ', ''),
    });
  }

  return sections;
}

export interface SelectedDiffSections {
  sections: ChangeContextDiffSection[];
  omittedSections: string[];
  /** Character cost of the selected section text. */
  usedChars: number;
  complete: boolean;
}

/**
 * Selects diff sections within a character budget.
 *
 * Sections are ordered by the deterministic changed-file order, so a large
 * change to one file cannot crowd out a smaller changed file that follows it:
 * each section receives an equal share of the remaining budget, and only whole
 * hunks are taken. Sections that receive no room are reported as omitted.
 */
export function selectDiffSections(
  parsed: readonly ParsedDiffSection[],
  files: readonly ChangeFileRecord[],
  budgetChars: number,
): SelectedDiffSections {
  const order = new Map(files.map((file, index) => [file.path, index]));
  const ordered = parsed
    .map((section, index) => ({ section, index }))
    .sort((left, right) => {
      const leftRank = left.section.record ? order.get(left.section.record.path) ?? 0 : Number.MAX_SAFE_INTEGER;
      const rightRank = right.section.record ? order.get(right.section.record.path) ?? 0 : Number.MAX_SAFE_INTEGER;
      return leftRank === rightRank ? left.index - right.index : leftRank - rightRank;
    });

  const sections: ChangeContextDiffSection[] = [];
  const omittedSections: string[] = [];
  let remaining = budgetChars;
  let complete = true;

  for (let position = 0; position < ordered.length; position += 1) {
    const { section } = ordered[position];
    const sectionsRemaining = ordered.length - position;
    const share = Math.max(0, Math.floor(remaining / sectionsRemaining));

    const header = section.header.trimEnd();
    let used = header.length;
    let includedHunks = 0;
    const included: string[] = [];

    for (const hunk of section.hunks) {
      if (used + hunk.length > share) break;
      used += hunk.length;
      includedHunks += 1;
      included.push(hunk);
    }

    if (section.hunks.length > 0 && includedHunks === 0) {
      // Not even one whole hunk fits in this section's share: omit it so the
      // budget is not silently spent on a partial hunk, and let later sections
      // use the room.
      omittedSections.push(section.label);
      complete = false;
      continue;
    }

    if (includedHunks < section.hunks.length) complete = false;
    remaining -= used;

    sections.push({
      ...(section.record ? { path: section.record.path } : {}),
      ...(section.record?.previousPath ? { previousPath: section.record.previousPath } : {}),
      label: section.label,
      header,
      hunks: included.join('\n'),
      totalHunks: section.hunks.length,
      includedHunks,
      complete: includedHunks === section.hunks.length,
    });
  }

  return { sections, omittedSections, usedChars: budgetChars - remaining, complete };
}

// ---------------------------------------------------------------------------
// Content selection (changed files first, then related files)
// ---------------------------------------------------------------------------

/**
 * Per-category content priority. Implementation content is supplied before
 * documentation and generated output, so a tight budget still shows the code
 * that matters. Ordering is deterministic; no content is chosen semantically.
 */
const CONTENT_CATEGORY_PRIORITY: Readonly<Record<string, number>> = {
  source: 0,
  cli: 1,
  api: 1,
  persistence: 2,
  migration: 2,
  schema: 2,
  config: 2,
  database: 3,
  dependency: 3,
  test: 3,
  unknown: 4,
  documentation: 4,
  generated: 5,
};

/** Estimated per-entry rendering overhead when accounting for the budget. */
const CONTENT_ENTRY_OVERHEAD_CHARS = 160;
/** Minimum remaining budget worth reading a file into. */
const MIN_CONTENT_READ_BUDGET = 200;

export interface SelectedContents {
  contents: ChangeContextContent[];
  statusByPath: Map<string, ChangeContentStatus>;
  suppliedChars: number;
  /** True when changed-file content was limited by budget or reader rules. */
  changedTruncated: boolean;
  /** Related files whose content was actually supplied. */
  relatedSupplied: number;
  /** Related files the reader was asked about (supplied or not). */
  relatedAttempted: number;
  relatedCandidates: number;
}

export function selectContents(params: {
  repositoryRoot: string;
  files: readonly ChangeFileRecord[];
  related: readonly ChangeContextRelatedFile[];
  reader: RepositoryContentReader;
  budgetChars: number;
}): SelectedContents {
  const { repositoryRoot, files, related, reader } = params;
  const contents: ChangeContextContent[] = [];
  const statusByPath = new Map<string, ChangeContentStatus>();
  let remaining = params.budgetChars;
  let suppliedChars = 0;
  let changedTruncated = false;
  let relatedSupplied = 0;
  let relatedAttempted = 0;

  const ordered = [...files].sort((left, right) => {
    const leftRank = CONTENT_CATEGORY_PRIORITY[left.category] ?? 4;
    const rightRank = CONTENT_CATEGORY_PRIORITY[right.category] ?? 4;
    return leftRank === rightRank ? left.path.localeCompare(right.path) : leftRank - rightRank;
  });

  for (const record of ordered) {
    if (record.status === 'deleted') {
      contents.push({ path: record.path, role: 'changed-file', status: 'file-deleted' });
      statusByPath.set(record.path, 'file-deleted');
      continue;
    }

    if (remaining < MIN_CONTENT_READ_BUDGET) {
      contents.push({ path: record.path, role: 'changed-file', status: 'budget-exhausted' });
      statusByPath.set(record.path, 'budget-exhausted');
      changedTruncated = true;
      continue;
    }

    const content = reader.readText(repositoryRoot, record.path);
    if (!content) {
      const status: ChangeContentStatus = record.binary ? 'binary' : 'not-supplied';
      contents.push({ path: record.path, role: 'changed-file', status });
      statusByPath.set(record.path, status);
      if (!record.binary) changedTruncated = true;
      continue;
    }

    const cost = content.content.length + CONTENT_ENTRY_OVERHEAD_CHARS;
    if (cost > remaining) {
      contents.push({ path: record.path, role: 'changed-file', status: 'budget-exhausted' });
      statusByPath.set(record.path, 'budget-exhausted');
      changedTruncated = true;
      continue;
    }

    remaining -= cost;
    suppliedChars += cost;
    contents.push({
      path: content.relativePath,
      role: 'changed-file',
      content: content.content,
      sizeBytes: content.sizeBytes,
      truncated: content.truncated,
      status: 'supplied',
    });
    statusByPath.set(record.path, 'supplied');
    if (content.truncated) changedTruncated = true;
  }

  for (const candidate of related) {
    if (relatedAttempted >= MAX_RELATED_CONTENT_FILES) break;
    if (remaining < MIN_CONTENT_READ_BUDGET) break;
    relatedAttempted += 1;

    const content = reader.readText(repositoryRoot, candidate.path);
    if (!content) {
      contents.push({ path: candidate.path, role: 'related-file', relation: candidate.relation, status: 'not-supplied' });
      continue;
    }

    const cost = content.content.length + CONTENT_ENTRY_OVERHEAD_CHARS;
    if (cost > remaining) {
      contents.push({ path: candidate.path, role: 'related-file', relation: candidate.relation, status: 'budget-exhausted' });
      continue;
    }

    remaining -= cost;
    suppliedChars += cost;
    relatedSupplied += 1;
    contents.push({
      path: content.relativePath,
      role: 'related-file',
      relation: candidate.relation,
      content: content.content,
      sizeBytes: content.sizeBytes,
      truncated: content.truncated,
      status: 'supplied',
    });
  }

  return {
    contents,
    statusByPath,
    suppliedChars,
    changedTruncated,
    relatedSupplied,
    relatedAttempted,
    relatedCandidates: related.length,
  };
}

// ---------------------------------------------------------------------------
// Repository facts (filtered by change signals, bounded)
// ---------------------------------------------------------------------------

export interface CollectedRepositoryFacts {
  facts: ChangeContextRepositoryFacts;
  usedChars: number;
  truncated: boolean;
}

const MAX_LISTED_DEPENDENCIES = 12;

function listNames(values: readonly string[], limit = MAX_LISTED_DEPENDENCIES): string {
  const sorted = [...values].sort();
  if (sorted.length <= limit) return sorted.join(', ');
  return `${sorted.slice(0, limit).join(', ')} (+${sorted.length - limit} more)`;
}

function detectedSubsystem(
  detection: { primary?: string; secondary?: string[] } | undefined,
): string | undefined {
  if (!detection || !detection.primary) return undefined;
  const parts = [detection.primary, ...(detection.secondary ?? [])].filter((value) => value.trim() !== '');
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * Selects repository facts that are relevant to the actual change signals.
 * The whole profile is never dumped: dependency changes surface package facts,
 * persistence changes surface database/ORM facts, and so on. When no signal
 * matches, a small baseline is supplied instead.
 */
export function collectRepositoryFacts(params: {
  profile: RepositoryProfile | undefined;
  signals: ChangeEvidence['signals'];
  budgetChars: number;
}): CollectedRepositoryFacts {
  const { profile, signals } = params;

  if (!profile) {
    return {
      facts: {
        profileUnavailable: true,
        groups: [],
        notes: ['Repository facts were unavailable: the repository profile could not be inspected.'],
      },
      usedChars: 0,
      truncated: false,
    };
  }

  const languageFacts = detectedSubsystem(profile.languages);
  const frameworkFacts = detectedSubsystem(profile.frameworks);
  const buildToolFacts = detectedSubsystem(profile.buildTools);
  const testingFacts = detectedSubsystem(profile.testing);
  const lintingFacts = detectedSubsystem(profile.linting);
  const formattingFacts = detectedSubsystem(profile.formatting);
  const databaseFacts = detectedSubsystem(profile.database);
  const ormFacts = detectedSubsystem(profile.orm);
  const scriptNames = Object.keys(profile.dependencies.scripts ?? {}).sort();
  const packageManager = profile.packageManager.detected !== 'unknown'
    ? profile.packageManager.detected
    : undefined;

  const groups: ChangeContextRepositoryFactGroup[] = [];
  const addGroup = (reason: string, lines: Array<string | undefined>): void => {
    const facts = lines.filter((line): line is string => typeof line === 'string' && line.trim() !== '');
    if (facts.length > 0) groups.push({ reason, facts });
  };

  if (signals.dependencyChanges || signals.packageMetadataChanges) {
    addGroup('dependency/package metadata changes', [
      packageManager ? `package manager: ${packageManager}` : undefined,
      profile.dependencies.packageManager ? `packageManager field: ${profile.dependencies.packageManager}` : undefined,
      profile.dependencies.all.size > 0 ? `dependencies: ${listNames([...profile.dependencies.all])}` : undefined,
      scriptNames.length > 0 ? `scripts: ${scriptNames.join(', ')}` : undefined,
    ]);
  }
  if (signals.persistenceOrStorageChanges) {
    addGroup('persistence/storage changes', [
      databaseFacts ? `database: ${databaseFacts}` : undefined,
      ormFacts ? `orm: ${ormFacts}` : undefined,
    ]);
  }
  if (signals.schemaOrMigrationChanges) {
    addGroup('schema/migration changes', [
      databaseFacts ? `database: ${databaseFacts}` : undefined,
      ormFacts ? `orm: ${ormFacts}` : undefined,
    ]);
  }


  if (signals.cliSurfaceChanges) {
    addGroup('cli surface changes', [
      languageFacts ? `language: ${languageFacts}` : undefined,
      buildToolFacts ? `build tools: ${buildToolFacts}` : undefined,
      packageManager ? `package manager: ${packageManager}` : undefined,
      `architecture: ${profile.architecture.monorepo ? 'monorepo' : 'standard'}`,
      scriptNames.length > 0 ? `scripts: ${scriptNames.join(', ')}` : undefined,
    ]);
  }
  if (signals.apiOrInterfaceChanges) {
    addGroup('api/interface changes', [
      frameworkFacts ? `frameworks: ${frameworkFacts}` : undefined,
      `architecture: ${profile.architecture.monorepo ? 'monorepo' : 'standard'}`,
    ]);
  }
  if (signals.testChanges) {
    addGroup('test changes', [
      testingFacts ? `testing: ${testingFacts}` : undefined,
      profile.dependencies.scripts?.test ? `test script: ${profile.dependencies.scripts.test}` : undefined,
      lintingFacts ? `linting: ${lintingFacts}` : undefined,
      formattingFacts ? `formatting: ${formattingFacts}` : undefined,
    ]);
  }
  if (signals.configurationChanges) {
    addGroup('configuration changes', [
      buildToolFacts ? `build tools: ${buildToolFacts}` : undefined,
      lintingFacts ? `linting: ${lintingFacts}` : undefined,
      formattingFacts ? `formatting: ${formattingFacts}` : undefined,
      packageManager ? `package manager: ${packageManager}` : undefined,
    ]);
  }

  if (groups.length === 0) {
    addGroup('repository baseline', [
      languageFacts ? `language: ${languageFacts}` : undefined,
      frameworkFacts ? `frameworks: ${frameworkFacts}` : undefined,
      packageManager ? `package manager: ${packageManager}` : undefined,
      `health: ${profile.health.grade} (${profile.health.score}/100)`,
    ]);
  }

  const notes: string[] = [];
  const selected: ChangeContextRepositoryFactGroup[] = [];
  let usedChars = 0;
  let truncated = false;

  for (const group of groups) {
    const kept: ChangeContextRepositoryFactGroup = { reason: group.reason, facts: [] };
    for (const fact of group.facts) {
      const cost = fact.length + group.reason.length + 8;
      if (usedChars + cost > params.budgetChars) {
        truncated = true;
        break;
      }
      usedChars += cost;
      kept.facts.push(fact);
    }
    if (kept.facts.length > 0) selected.push(kept);
    if (truncated) break;
  }

  notes.push('Repository facts are filtered to the change signals present; the full repository profile was not supplied.');
  if (truncated) {
    notes.push('Repository facts were truncated by the repository-context budget.');
  }

  return {
    facts: { profileUnavailable: false, groups: selected, notes },
    usedChars,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Budget planning for optional material
// ---------------------------------------------------------------------------

interface OptionalBudgetShares {
  diff: number;
  contents: number;
  facts: number;
}

/**
 * Mandatory material (overview + every changed file's metadata) is never
 * trimmed, so the optional budgets are derived from what is left of the total
 * budget after the mandatory estimate. When the allowance cannot cover every
 * optional budget in full, each share is scaled proportionally so no optional
 * category is starved to zero while another runs at full size.
 */
export function planOptionalBudgetShares(
  budgets: ChangeContextBudgets,
  mandatoryChars: number,
): OptionalBudgetShares {
  const allowance = Math.max(0, budgets.totalContextChars - mandatoryChars);
  const requested = budgets.diffChars + budgets.fileContentChars + budgets.repositoryContextChars;

  if (requested === 0 || allowance === 0) return { diff: 0, contents: 0, facts: 0 };

  if (allowance >= requested) {
    return { diff: budgets.diffChars, contents: budgets.fileContentChars, facts: budgets.repositoryContextChars };
  }

  const scale = allowance / requested;
  const diff = Math.floor(budgets.diffChars * scale);
  const contents = Math.floor(budgets.fileContentChars * scale);
  const facts = Math.max(0, allowance - diff - contents);
  return { diff, contents, facts };
}

function degradationNote(reason: ChangeEvidence['degradations'][number]): string {
  switch (reason) {
    case 'identity-from-repository-status':
      return 'Changed-file identity came from repository status entries because the staged diff could not be used for identity; identity may be less precise.';
    case 'line-statistics-unavailable':
      return 'Git did not provide line statistics for the staged change; no line counts were fabricated.';
    case 'line-statistics-incomplete':
      return 'Git line statistics do not cover the complete staged change set.';
    default:
      return `Change evidence degradation: ${String(reason)}.`;
  }
}

function buildOverviewNotes(
  evidence: ChangeEvidence,
  discovery: RelatedFileDiscovery,
): string[] {
  const notes: string[] = [];
  notes.push(`Changed-file identity source: ${evidence.identitySource}.`);
  if (evidence.degradations.length === 0) {
    notes.push('The change evidence packet is full fidelity (no degradations).');
  } else {
    for (const degradation of evidence.degradations) notes.push(degradationNote(degradation));
  }
  notes.push(
    `Change risk tier: ${evidence.tier}${evidence.tierReasons.length > 0 ? ` (${evidence.tierReasons.join('; ')})` : ''}.`,
  );
  if (!evidence.totals.lineCountsAvailable) {
    notes.push(
      `Per-file line statistics are incomplete: ${evidence.totals.filesMissingLineCounts} changed file(s) have no Git statistics. `
      + 'Their insertions/deletions are unavailable, not zero.',
    );
  }
  if (evidence.totals.unmatchedStatisticsFiles > 0) {
    notes.push(
      `${evidence.totals.unmatchedStatisticsFiles} Git statistics record(s) matched no changed file; aggregate counts exclude them.`,
    );
  }
  if (evidence.totals.binaryFiles > 0) {
    notes.push(`${evidence.totals.binaryFiles} changed binary file(s) have no line statistics.`);
  }
  if (evidence.repository.worktreeState !== 'clean') {
    notes.push(
      `Review covers staged changes only. Worktree state is "${evidence.repository.worktreeState}"; `
      + 'unstaged and untracked changes were not reviewed.',
    );
  }
  notes.push(discovery.note);
  return notes;
}

/**
 * Deterministic estimate of the mandatory context size, used for budget
 * planning only. It is never used to drop mandatory content.
 */
export function estimateMandatoryChars(
  evidence: ChangeEvidence,
  overviewNotes: readonly string[],
): number {
  const overview = {
    evidence: { ...evidence, files: undefined },
    fileCount: evidence.files.length,
    notes: overviewNotes,
  };
  const overviewChars = JSON.stringify(overview).length;
  const fileChars = evidence.files.reduce(
    (sum, file) => sum + JSON.stringify(file).length + 40,
    0,
  );
  return overviewChars + fileChars;
}

interface BuiltDiff {
  diff: ChangeContextDiff;
  usedChars: number;
}

function unavailableDiff(reason: string): BuiltDiff {
  return {
    diff: {
      status: 'unavailable',
      unavailableReason: reason,
      sections: [],
      omittedSections: [],
      complete: false,
      notes: [
        `The staged diff could not be read (${reason}). No diff content was supplied; `
        + 'findings must not assume diff content that is not shown.',
      ],
    },
    usedChars: 0,
  };
}

function buildAvailableDiff(
  rawDiff: string,
  files: readonly ChangeFileRecord[],
  budgetChars: number,
): BuiltDiff {
  const parsed = splitDiffSections(rawDiff, files);
  const selected = selectDiffSections(parsed, files, budgetChars);
  const notes: string[] = [];

  if (selected.complete) {
    notes.push('The complete staged diff was supplied, split by file section.');
  } else {
    const partial = selected.sections.filter((section) => !section.complete).length;
    notes.push(
      `The staged diff was truncated by the diff budget: ${selected.omittedSections.length} file section(s) omitted entirely`
      + `${partial > 0 ? `, ${partial} included with only some hunks` : ''}. `
      + 'The reviewer did not see the complete diff.',
    );
    if (selected.omittedSections.length > 0) {
      notes.push(`Omitted diff sections: ${selected.omittedSections.join(', ')}.`);
    }
  }

  return {
    diff: {
      status: 'available',
      sections: selected.sections,
      omittedSections: selected.omittedSections,
      complete: selected.complete,
      notes,
    },
    usedChars: selected.usedChars,
  };
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

export interface ChangeContextComposerDependencies {
  buildEvidence: (repositoryPath?: string) => Promise<ChangeEvidence>;
  readStagedDiff: (repositoryRoot: string) => Promise<string>;
  readContents: RepositoryContentReader;
  inspect: (repositoryRoot: string) => RepositoryProfile;
  retriever?: RepositoryRetriever;
  budgets: ChangeContextBudgets;
}

export type ChangeContextComposerOptions = {
  buildEvidence?: (repositoryPath?: string) => Promise<ChangeEvidence>;
  readStagedDiff?: (repositoryRoot: string) => Promise<string>;
  contentReader?: RepositoryContentReader;
  inspect?: (repositoryRoot: string) => RepositoryProfile;
  retriever?: RepositoryRetriever;
  budgets?: Partial<ChangeContextBudgets>;
};

/**
 * Deterministic change-evidence builder (source of truth for staged-change
 * identity). Review never reimplements Git classification.
 */
function defaultBuildEvidence(repositoryPath?: string): Promise<ChangeEvidence> {
  return new ChangeEvidenceBuilder().build(repositoryPath);
}

/**
 * Assembles the review context.
 *
 * Nothing here is fatal except evidence construction itself: a missing staged
 * diff, an unavailable metadata index, unreadable file content, or a failing
 * repository inspection are all recorded as explicit limitations rather than
 * silently dropped.
 */
export class ChangeContextComposer {
  private readonly dependencies: ChangeContextComposerDependencies;

  constructor(options: ChangeContextComposerOptions = {}) {
    const budgets = { ...DEFAULT_CHANGE_CONTEXT_BUDGETS, ...options.budgets };
    this.dependencies = {
      buildEvidence: options.buildEvidence ?? defaultBuildEvidence,
      readStagedDiff: options.readStagedDiff
        ?? ((repositoryRoot: string) => getStagedDiff({ repositoryPath: repositoryRoot, renameDetection: true })),
      readContents: options.contentReader ?? new FileSystemRepositoryContentReader({
        perFileCharLimit: budgets.perFileContentChars,
      }),
      inspect: options.inspect ?? ((repositoryRoot: string) => inspectRepository(repositoryRoot)),
      ...(options.retriever ? { retriever: options.retriever } : {}),
      budgets,
    };
  }

  async build(repositoryPath?: string): Promise<ChangeContext> {
    const evidence = await this.dependencies.buildEvidence(repositoryPath);
    const repositoryRoot = evidence.repository.root;
    const budgets = this.dependencies.budgets;

    let rawDiff: string | undefined;
    let diffUnavailableReason: string | undefined;
    try {
      rawDiff = await this.dependencies.readStagedDiff(repositoryRoot);
    } catch (error) {
      diffUnavailableReason = error instanceof Error ? error.message : String(error);
    }

    const discovery = discoverRelatedFiles(evidence, this.dependencies.retriever);
    const overviewNotes = buildOverviewNotes(evidence, discovery);
    const mandatoryChars = estimateMandatoryChars(evidence, overviewNotes);
    const shares = planOptionalBudgetShares(budgets, mandatoryChars);

    const selectedContents = selectContents({
      repositoryRoot,
      files: evidence.files,
      related: discovery.files,
      reader: this.dependencies.readContents,
      budgetChars: shares.contents,
    });

    const builtDiff = rawDiff === undefined
      ? unavailableDiff(diffUnavailableReason ?? 'reason unavailable')
      : buildAvailableDiff(rawDiff, evidence.files, shares.diff);

    const collectedFacts = collectRepositoryFacts({
      profile: this.inspectProfile(repositoryRoot),
      signals: evidence.signals,
      budgetChars: shares.facts,
    });

    const files: ChangeContextFile[] = evidence.files.map((record) => ({
      record,
      contentStatus: selectedContents.statusByPath.get(record.path) ?? 'not-supplied',
      relatedFileLookup: discovery.status,
      relatedFiles: discovery.files.filter((related) => related.relatedTo === record.path),
    }));

    const truncationNotes: string[] = [];
    if (builtDiff.diff.status === 'available' && !builtDiff.diff.complete) {
      truncationNotes.push('The staged diff supplied to the reviewer is incomplete.');
    }
    if (builtDiff.diff.status === 'unavailable') {
      truncationNotes.push('No staged diff was supplied to the reviewer.');
    }
    if (selectedContents.changedTruncated) {
      truncationNotes.push(
        'Changed-file content was limited by the content budget, the per-file limit, or the reader\'s text-only rules; '
        + 'each changed file states its own content status.',
      );
    }
    if (selectedContents.relatedCandidates > selectedContents.relatedSupplied) {
      truncationNotes.push(
        `${selectedContents.relatedCandidates - selectedContents.relatedSupplied} related file(s) were discovered but their content was not supplied.`,
      );
    }
    if (collectedFacts.truncated) {
      truncationNotes.push('Repository facts were truncated by the repository-context budget.');
    }
    if (truncationNotes.length === 0) {
      truncationNotes.push('No evidence was truncated: every changed file and the complete staged diff were supplied.');
    }

    const suppliedChars = mandatoryChars
      + builtDiff.usedChars
      + selectedContents.suppliedChars
      + collectedFacts.usedChars;

    const overviewEvidence = { ...evidence } as Partial<ChangeEvidence>;
    delete overviewEvidence.files;

    return {
      overview: {
        evidence: overviewEvidence as Omit<ChangeEvidence, 'files'>,
        fileCount: evidence.files.length,
        relatedFileLookup: discovery.status,
        notes: overviewNotes,
      },
      files,
      relatedFiles: discovery.files,
      contents: selectedContents.contents,
      diffSections: builtDiff.diff,
      repositoryFacts: collectedFacts.facts,
      truncation: {
        diffTruncated: builtDiff.diff.status === 'unavailable' || !builtDiff.diff.complete,
        contentTruncated: selectedContents.changedTruncated,
        relatedContentTruncated: selectedContents.relatedCandidates > selectedContents.relatedSupplied,
        repositoryFactsTruncated: collectedFacts.truncated,
        budgets,
        mandatoryChars,
        suppliedChars,
        notes: truncationNotes,
      },
    };
  }

  private inspectProfile(repositoryRoot: string): RepositoryProfile | undefined {
    try {
      return this.dependencies.inspect(repositoryRoot);
    } catch {
      return undefined;
    }
  }
}

export function createChangeContextComposer(
  options: ChangeContextComposerOptions = {},
): ChangeContextComposer {
  return new ChangeContextComposer(options);
}

export async function composeChangeContext(
  repositoryPath?: string,
  options: ChangeContextComposerOptions = {},
): Promise<ChangeContext> {
  return new ChangeContextComposer(options).build(repositoryPath);
}
