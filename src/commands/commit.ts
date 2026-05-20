import { confirm } from '@inquirer/prompts';
import childProcess from 'child_process';

import { chat } from '../ai/groq';
import { commitSystemPrompt, commitUserPrompt } from '../ai/prompts';
import { getStagedDiff, validateRepo } from '../utils/git';
import {
  spinner,
  printSuccess,
  printError,
  printHeader,
  printInfo,
  printDivider,
  printWarning,
} from '../utils/display';

const { execSync } = childProcess;

export async function commitCommand(): Promise<void> {
  try {
    try {
      await validateRepo();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      printError(message);
      return;
    }

    spinner.text = 'Reading staged changes…';
    spinner.start();

    let diff: string;
    try {
      diff = await getStagedDiff();
    } catch (err) {
      spinner.fail();
      const message = err instanceof Error ? err.message : String(err);
      printError(message);
      return;
    }

    spinner.text = 'Generating commit message with AI…';
    const message = await chat(commitSystemPrompt(), commitUserPrompt(diff));
    spinner.succeed();

    printHeader('Generated Commit Message');
    printInfo(message);
    printDivider();

    const useThis = await confirm({
      message: 'Use this commit message?',
      default: true,
    });

    if (useThis) {
      try {
        execSync(`git commit -m "${message}"`, { stdio: 'inherit' });
        printSuccess('Commit created successfully!');
      } catch {
        printError('Failed to create commit.');
      }
    } else {
      printWarning('Commit cancelled. You can edit and run git commit manually.');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    printError(message);
  }
}

