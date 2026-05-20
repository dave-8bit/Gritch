import fs from 'fs';
import path from 'path';

import { chat } from '../ai/groq';
import { changelogSystemPrompt, changelogUserPrompt } from '../ai/prompts';
import { getCommitsBetween, validateRepo } from '../utils/git';
import {
  spinner,
  printError,
  printHeader,
  printSuccess,
  printInfo,
  printDivider,
} from '../utils/display';

export async function changelogCommand(from: string, to: string): Promise<void> {
  try {
    try {
      await validateRepo();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      printError(message);
      return;
    }

    spinner.text = `Fetching commits between \`${from}\` and \`${to}\`…`;
    spinner.start();

    let commits: string;
    try {
      commits = await getCommitsBetween(from, to);
    } catch (err) {
      spinner.fail();
      const message = err instanceof Error ? err.message : String(err);
      printError(message);
      return;
    }

    spinner.text = 'Generating changelog with AI…';
    const changelog = await chat(
      changelogSystemPrompt(),
      changelogUserPrompt(commits, from, to),
    );
    spinner.succeed();

    printHeader('Generated Changelog');
    printInfo(changelog);
    printDivider();

    const changelogPath = path.join(process.cwd(), 'CHANGELOG.md');
    fs.writeFileSync(changelogPath, `# Changelog\n\n${changelog}`);

    printSuccess('CHANGELOG.md written to your project root!');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    printError(message);
  }
}

