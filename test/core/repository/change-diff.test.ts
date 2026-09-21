import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import simpleGit from 'simple-git';
import type { SimpleGit } from 'simple-git';

import {
  NO_STAGED_CHANGES_MESSAGE,
  getStagedDiff,
} from '../../../src/core/repository/change-diff';

/** Real git subprocesses can exceed the 5s default on loaded Windows machines. */
const GIT_TEST_TIMEOUT = 20_000;

const gitRoots: string[] = [];

function makeGitRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-change-diff-'));
  gitRoots.push(root);
  return root;
}

function writeRepoFile(root: string, relativePath: string, content: string): void {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function lines(count: number, prefix = 'line'): string {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`).join('\n') + '\n';
}

async function initRepo(root: string): Promise<SimpleGit> {
  const git = simpleGit(root);
  await git.init();
  await git.addConfig('core.autocrlf', 'false');
  await git.addConfig('user.email', 'gritch-test@example.com');
  await git.addConfig('user.name', 'Gritch Test');
  return git;
}

afterEach(() => {
  while (gitRoots.length > 0) {
    const root = gitRoots.pop()!;
    for (let attempt = 0; ; attempt += 1) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
        break;
      } catch {
        if (attempt >= 4) break;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
  }
});

describe('getStagedDiff (review helper, real git)', () => {
  it('returns the staged diff for a modified tracked file', async () => {
    const root = makeGitRoot();
    const git = await initRepo(root);
    writeRepoFile(root, 'src/a.ts', lines(3));
    await git.add(['.']);
    await git.commit('baseline');

    writeRepoFile(root, 'src/a.ts', lines(3) + 'added line\n');
    await git.add(['.']);

    const diff = await getStagedDiff({ repositoryPath: root });

    expect(diff).toContain('diff --git a/src/a.ts b/src/a.ts');
    expect(diff).toContain('@@');
    expect(diff).toContain('+added line');
  }, GIT_TEST_TIMEOUT);

  it('detects renames', async () => {
    const root = makeGitRoot();
    const git = await initRepo(root);
    writeRepoFile(root, 'src/a.ts', lines(20));
    await git.add(['.']);
    await git.commit('baseline');

    await git.mv('src/a.ts', 'src/b.ts');
    writeRepoFile(root, 'src/b.ts', lines(20) + 'tail\n');
    await git.add(['.']);

    const diff = await getStagedDiff({ repositoryPath: root });

    expect(diff).toContain('rename from src/a.ts');
    expect(diff).toContain('rename to src/b.ts');
  }, GIT_TEST_TIMEOUT);

  it('detects copies', async () => {
    const root = makeGitRoot();
    const git = await initRepo(root);
    writeRepoFile(root, 'src/a.ts', lines(20));
    await git.add(['.']);
    await git.commit('baseline');

    // Copy detection (-C) only considers sources modified in the same diff,
    // so the source file is edited and the copy matches the edited content.
    const edited = lines(20) + 'edited\n';
    writeRepoFile(root, 'src/a.ts', edited);
    writeRepoFile(root, 'src/b.ts', edited);
    await git.add(['.']);

    const diff = await getStagedDiff({ repositoryPath: root });

    expect(diff).toContain('copy from src/a.ts');
    expect(diff).toContain('copy to src/b.ts');
  }, GIT_TEST_TIMEOUT);

  it('emits Unicode paths verbatim instead of C-quoted', async () => {
    const root = makeGitRoot();
    const git = await initRepo(root);
    writeRepoFile(root, 'src/keep.ts', lines(2));
    await git.add(['.']);
    await git.commit('baseline');

    writeRepoFile(root, 'src/caf\u00e9.ts', lines(2, 'unicode'));
    await git.add(['.']);

    const diff = await getStagedDiff({ repositoryPath: root });

    expect(diff).toContain('b/src/caf\u00e9.ts');
    expect(diff).not.toContain('\\303');
  }, GIT_TEST_TIMEOUT);

  it('emits paths containing spaces verbatim', async () => {
    const root = makeGitRoot();
    const git = await initRepo(root);
    writeRepoFile(root, 'src/keep.ts', lines(2));
    await git.add(['.']);
    await git.commit('baseline');

    writeRepoFile(root, 'src/my file.ts', lines(2, 'spaced'));
    await git.add(['.']);

    const diff = await getStagedDiff({ repositoryPath: root });

    expect(diff).toContain('diff --git a/src/my file.ts b/src/my file.ts');
  }, GIT_TEST_TIMEOUT);

  it('fails deterministically when nothing is staged', async () => {
    const root = makeGitRoot();
    await initRepo(root);

    await expect(getStagedDiff({ repositoryPath: root })).rejects.toThrow(NO_STAGED_CHANGES_MESSAGE);
  }, GIT_TEST_TIMEOUT);

  it('supports an unborn repository with staged files', async () => {
    const root = makeGitRoot();
    const git = await initRepo(root);
    writeRepoFile(root, 'src/first.ts', lines(2));
    await git.add(['.']);

    const diff = await getStagedDiff({ repositoryPath: root });

    expect(diff).toContain('diff --git a/src/first.ts b/src/first.ts');
    expect(diff).toContain('new file mode');
  }, GIT_TEST_TIMEOUT);

  it('omits rename/copy detection when disabled', async () => {
    const root = makeGitRoot();
    const git = await initRepo(root);
    writeRepoFile(root, 'src/a.ts', lines(20));
    await git.add(['.']);
    await git.commit('baseline');

    await git.mv('src/a.ts', 'src/b.ts');
    await git.add(['.']);

    const diff = await getStagedDiff({ repositoryPath: root, renameDetection: false });

    expect(diff).not.toContain('rename from');
    expect(diff).toContain('deleted file mode');
    expect(diff).toContain('new file mode');
  }, GIT_TEST_TIMEOUT);

  it('reads the repository given by repositoryPath, not the process CWD', async () => {
    const first = makeGitRoot();
    const second = makeGitRoot();
    const firstGit = await initRepo(first);
    const secondGit = await initRepo(second);

    writeRepoFile(first, 'src/first-repo.ts', lines(2));
    await firstGit.add(['.']);
    await firstGit.commit('baseline');
    writeRepoFile(first, 'src/first-repo.ts', lines(3));

    writeRepoFile(second, 'src/second-repo.ts', lines(2));
    await secondGit.add(['.']);

    const diff = await getStagedDiff({ repositoryPath: second });

    expect(diff).toContain('src/second-repo.ts');
    expect(diff).not.toContain('first-repo.ts');
  }, GIT_TEST_TIMEOUT);
});
