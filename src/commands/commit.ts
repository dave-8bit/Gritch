import { confirm } from '@inquirer/prompts';
import childProcess from 'child_process';

import { AIService } from '../core/ai/ai.service';
import { buildAIRequest } from '../core/ai/ai.request-builder';
import { commitSystemPrompt, commitUserPrompt } from '../ai/prompts';
import { buildRepositoryContext } from '../ai/profile-context';
import { inspectRepository } from '../inspect/profile';

import { getStagedDiff, trimDiff, validateRepo } from '../utils/git';

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

    let repoContext: string | undefined;
    try {
      const profile = inspectRepository();
      repoContext = buildRepositoryContext(profile);
    } catch {
      // Inspection failure is non-fatal — fall back to current behavior
    }

    spinner.text = 'Generating commit message with AI…';
    const response = await AIService.chat(
      buildAIRequest({
        systemPrompt: commitSystemPrompt(),
        userPrompt: commitUserPrompt(trimDiff(diff), repoContext),
      })
    );

    const message = response.content;

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

