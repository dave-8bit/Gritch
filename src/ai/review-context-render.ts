import type {
  ChangeContext,
  ChangeContextContent,
  ChangeContextDiff,
  ChangeContextFile,
  ChangeContextRepositoryFacts,
  ChangeContentStatus,
} from '../core/repository/change-context';
import type { ChangeFileRecord } from '../core/repository/change-evidence';

/**
 * Deterministic rendering of the review evidence object into prompt text.
 *
 * This is a pure projection of `ChangeContext`: same context in, same text
 * out. It adds no facts, invents no values, and renders every unavailable or
 * truncated item as an explicit limitation rather than omitting it. Prose is
 * limited to labels and deterministic statements; the reviewer supplies the
 * analysis.
 */

const SECTION_RULE = '================================================================';
const SUBSECTION_RULE = '----------------------------------------------------------------';

function section(title: string): string {
  return `${SECTION_RULE}\n${title}\n${SECTION_RULE}`;
}

/** A fence long enough to survive any backtick run inside the content. */
function fenceFor(content: string): string {
  const runs = content.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

/** Renders a value that may be unavailable; never invents a placeholder value. */
function orUnavailable(value: string | undefined | false): string {
  return value ? value : 'unavailable';
}

function lineCounts(record: ChangeFileRecord): string {
  if (record.lineCountsAvailable) {
    return `line counts: available (insertions ${record.insertions}, deletions ${record.deletions}, changes ${record.changes})`;
  }
  return 'line counts: unavailable (insertions/deletions/changes are unavailable, not zero)';
}

const CONTENT_STATUS_LABELS: Readonly<Record<ChangeContentStatus, string>> = {
  supplied: 'content supplied below',
  'file-deleted': 'file was deleted; no content exists to supply',
  binary: 'binary file; content not supplied',
  'budget-exhausted': 'content not supplied: the content budget was exhausted',
  'not-supplied': 'content not supplied: the file was not readable or was skipped by the text-only reader',
};

function renderChangedFile(file: ChangeContextFile): string {
  const record = file.record;
  const lines: string[] = [];

  lines.push(`- path: ${record.path}`);
  lines.push(
    `  status: ${record.status}`
    + ` | previous path: ${orUnavailable(record.previousPath)}`
    + ` | similarity: ${orUnavailable(record.similarity === undefined ? undefined : String(record.similarity))}`,
  );
  lines.push(`  ${lineCounts(record)}`);
  lines.push(
    `  binary: ${record.binary}`
    + ` | extension: ${orUnavailable(record.extension === '' ? undefined : record.extension)}`
    + ` | category: ${record.category}`
    + ` | subsystem: ${orUnavailable(record.subsystem === '' ? undefined : record.subsystem)}`
    + ` | conflicted: ${record.conflicted}`,
  );
  lines.push(`  content: ${CONTENT_STATUS_LABELS[file.contentStatus]}`);
  lines.push(`  related-file lookup for this path: ${file.relatedFileLookup}`);

  if (file.relatedFiles.length === 0) {
    lines.push('  related files: none discovered for this path');
  } else {
    lines.push('  related files:');
    for (const related of file.relatedFiles) {
      const target = related.relatedTo ? ` (derived from ${related.relatedTo})` : '';
      lines.push(`    - ${related.path} [${related.relation}]${target}`);
    }
  }
  return lines.join('\n');
}

function renderChangedFiles(files: readonly ChangeContextFile[]): string {
  return [
    section('Changed files (complete mandatory metadata)'),
    'Every changed file is listed. This list is authoritative; if a file is',
    'absent from it, it was not part of the staged change.',
    '',
    ...files.map(renderChangedFile),
  ].join('\n');
}

function renderContents(contents: readonly ChangeContextContent[]): string {
  const parts: string[] = [
    section('File contents supplied to the reviewer'),
    'Only the files below were read. The absence of a file from this section',
    'means it was not examined, not that it does not exist or is correct.',
    '',
  ];

  const supplied = contents.filter((entry) => entry.status === 'supplied');
  const notSupplied = contents.filter((entry) => entry.status !== 'supplied');

  if (supplied.length === 0) {
    parts.push('No file content was supplied.');
  }

  for (const entry of supplied) {
    const descriptor = entry.role === 'related-file'
      ? `${entry.path} [related: ${entry.relation}]`
      : entry.path;
    const truncation = entry.truncated ? ' [truncated by the per-file limit]' : '';
    const fence = fenceFor(entry.content ?? '');
    parts.push(`${SUBSECTION_RULE}`);
    parts.push(`File: ${descriptor}${truncation}`);
    parts.push(fence);
    parts.push(entry.content ?? '');
    parts.push(fence);
    parts.push('');
  }

  if (notSupplied.length > 0) {
    parts.push('Files whose content was not supplied:');
    for (const entry of notSupplied) {
      const relation = entry.role === 'related-file' ? ` [related: ${entry.relation}]` : '';
      parts.push(`- ${entry.path}${relation}: ${CONTENT_STATUS_LABELS[entry.status]}`);
    }
  }

  return parts.join('\n').trimEnd();
}

function renderDiff(diff: ChangeContextDiff): string {
  const parts: string[] = [section('Staged diff (index vs HEAD)')];

  if (diff.status === 'unavailable') {
    parts.push(`The staged diff could not be read: ${diff.unavailableReason ?? 'reason unavailable'}.`);
    for (const note of diff.notes) parts.push(note);
    return parts.join('\n');
  }

  if (diff.sections.length === 0) {
    parts.push('The staged diff was empty.');
  }

  for (const item of diff.sections) {
    parts.push(SUBSECTION_RULE);
    parts.push(item.header);
    if (item.hunks.trim() !== '') parts.push(item.hunks);
    parts.push(
      item.complete
        ? `[end of ${item.label}: complete]`
        : `[end of ${item.label}: ${item.includedHunks} of ${item.totalHunks} hunk(s) supplied; the rest was cut by the diff budget]`,
    );
  }

  if (diff.omittedSections.length > 0) {
    parts.push('');
    parts.push(`Diff sections omitted entirely by the budget: ${diff.omittedSections.join(', ')}.`);
  }
  for (const note of diff.notes) parts.push(note);

  return parts.join('\n');
}

function renderFacts(facts: ChangeContextRepositoryFacts): string {
  const parts: string[] = [section('Repository facts relevant to this change')];

  if (facts.profileUnavailable) {
    parts.push('Repository facts were unavailable: the repository profile could not be inspected.');
    for (const note of facts.notes) parts.push(note);
    return parts.join('\n');
  }

  if (facts.groups.length === 0) {
    parts.push('No repository facts were selected for the signals in this change.');
  }
  for (const group of facts.groups) {
    parts.push(`${group.reason}:`);
    for (const fact of group.facts) parts.push(`- ${fact}`);
  }
  for (const note of facts.notes) parts.push(note);

  return parts.join('\n');
}

function renderOverview(context: ChangeContext): string {
  const parts: string[] = [
    section('Change overview (deterministic evidence)'),
    'The JSON block below is the complete deterministic evidence packet for the',
    'staged change, excluding the per-file list which follows in its own section.',
    '',
    '```json',
    JSON.stringify(context.overview.evidence, null, 2),
    '```',
    '',
    `Changed files: ${context.overview.fileCount}`,
    '',
    'Notes:',
    ...context.overview.notes.map((note) => `- ${note}`),
  ];
  return parts.join('\n');
}

function renderTruncation(context: ChangeContext): string {
  return [
    section('Evidence limitations'),
    'Every limitation below applies to this review. Treat them as boundaries of',
    'the evidence, not as statements about the repository.',
    ...context.truncation.notes.map((note) => `- ${note}`),
    `- Budgets (characters): diff ${context.truncation.budgets.diffChars},`
    + ` file content ${context.truncation.budgets.fileContentChars},`
    + ` per-file ${context.truncation.budgets.perFileContentChars},`
    + ` repository facts ${context.truncation.budgets.repositoryContextChars},`
    + ` total ${context.truncation.budgets.totalContextChars}.`,
  ].join('\n');
}

/**
 * Renders the complete review evidence for the model.
 *
 * Section order is fixed: overview, changed files, related files, contents,
 * staged diff, repository facts, limitations. The renderer never enforces
 * budgets — that is the composer's job — and never mutates the context.
 */
export function renderChangeContext(context: ChangeContext): string {
  const relatedFiles = context.relatedFiles;
  const relatedParts: string[] = [
    section('Related files (deterministically discovered)'),
    'Related files were discovered from the optional repository file metadata',
    'index. The index is path metadata only; files below are candidates, not',
    'verified consumers or dependencies.',
    '',
  ];

  if (relatedFiles.length === 0) {
    relatedParts.push('No related files were discovered.');
  } else {
    for (const related of relatedFiles) {
      const target = related.relatedTo ? ` (derived from ${related.relatedTo})` : '';
      relatedParts.push(`- ${related.path} [${related.relation}]${target}`);
    }
  }

  return [
    renderOverview(context),
    '',
    renderChangedFiles(context.files),
    '',
    relatedParts.join('\n'),
    '',
    renderContents(context.contents),
    '',
    renderDiff(context.diffSections),
    '',
    renderFacts(context.repositoryFacts),
    '',
    renderTruncation(context),
    '',
  ].join('\n');
}
