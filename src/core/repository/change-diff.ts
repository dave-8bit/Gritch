import simpleGit from 'simple-git';

import { resolveRepositoryIdentity } from './repository.identity';

/**
 * Review-oriented staged diff helper.
 *
 * This exists alongside {@link import('../../utils/git').getStagedDiff} rather
 * than replacing it: the commit/explain paths keep their existing `--cached`
 * behavior untouched, while review needs a diff that lines up with the
 * deterministic change evidence.
 *
 * Two deliberate differences from the legacy helper, both required for review:
 *
 * - `-M -C` rename/copy detection, matching the flags
 *   `ChangeEvidenceBuilder` uses, so diff section paths and evidence paths
 *   describe the same change set.
 * - `-c core.quotePath=false`, so paths with non-ASCII characters or spaces are
 *   emitted verbatim instead of C-quoted (`"src/caf\303\251.ts"`). This keeps
 *   diff section identity comparable to the evidence packet, which is
 *   quoting-immune because it is read via `-z`.
 *
 * The helper is strictly read-only: it never stages, unstages, or writes.
 */

export const NO_STAGED_CHANGES_MESSAGE =
  'No staged changes found. Stage your changes with git add first.';

export interface StagedDiffOptions {
  /**
   * Detect renames and copies (`-M -C`). Defaults to `true`, because review
   * always wants rename/copy awareness.
   *
   * Passing `false` emits `--no-renames` rather than simply omitting the flags:
   * Git enables rename detection by default (`diff.renames`), so omitting them
   * would still produce rename records and depend on the user's Git config.
   */
  renameDetection?: boolean;
  /** Repository root (or any path inside it). Defaults to the process CWD. */
  repositoryPath?: string;
}

/** Disables Git's C-style path quoting so paths arrive verbatim. */
const QUOTE_PATH_ARGS = ['-c', 'core.quotePath=false'] as const;

/**
 * Returns the staged diff (`--cached`) for a repository.
 *
 * Throws {@link NO_STAGED_CHANGES_MESSAGE} when nothing is staged, so callers
 * can surface the same message the existing commands use.
 */
export async function getStagedDiff(options: StagedDiffOptions = {}): Promise<string> {
  const repositoryRoot = resolveRepositoryIdentity(options.repositoryPath).root;
  const git = simpleGit(repositoryRoot);

  const args = [...QUOTE_PATH_ARGS, 'diff', '--cached'];
  if (options.renameDetection === false) {
    args.push('--no-renames');
  } else {
    args.push('-M', '-C');
  }

  const diff = await git.raw(args);
  if (!diff || diff.trim() === '') {
    throw new Error(NO_STAGED_CHANGES_MESSAGE);
  }
  return diff;
}