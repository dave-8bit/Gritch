import { getRecentCommits } from '../utils/git';
import { formatRepositoryHistory } from '../inspect/formatter';
import { printError } from '../utils/display';
import { resolveRepoRoot } from '../inspect/root';

export async function historyCommand(rootPath?: string): Promise<void> {
  try {
    const commits = await getRecentCommits(rootPath, 10);
    const root = resolveRepoRoot(rootPath).root;
    console.log(formatRepositoryHistory(root, commits));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printError(message);
  }
}
