import chalk from 'chalk';
import { AIService } from '../core/ai/ai.service';
import { buildAIRequest } from '../core/ai/ai.request-builder';

import { explainSystemPrompt, explainUserPrompt } from '../ai/prompts';
import { buildRepositoryContext } from '../ai/profile-context';
import { inspectRepository } from '../inspect/profile';

import { getCommitDiff, validateRepo } from '../utils/git';
import { spinner, printError, printHeader, printInfo, printDivider } from '../utils/display';

export async function explainCommand(hash: string): Promise<void> {
  try {
    try {
      await validateRepo();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      printError(message);
      return;
    }

    spinner.text = 'Fetching commit diff…';
    spinner.start();

    let diff: string;
    try {
      diff = await getCommitDiff(hash);
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

    spinner.text = 'Analysing commit with AI…';
    const response = await AIService.chat(
      buildAIRequest({
        systemPrompt: explainSystemPrompt(),
        userPrompt: explainUserPrompt(diff, hash, repoContext),
      })
    );

    const explanation = response.content;

    spinner.succeed();

    printHeader('Commit Explanation');
    console.log(chalk.dim(hash));

    printDivider();
    printInfo(explanation);
    printDivider();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    printError(message);
  }
}

