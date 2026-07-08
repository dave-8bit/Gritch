import chalk from 'chalk';
import { AIService } from '../core/ai/ai.service';

import { explainSystemPrompt, explainUserPrompt } from '../ai/prompts';
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

    spinner.text = 'Analysing commit with AI…';
    const response = await AIService.chat({
      systemPrompt: explainSystemPrompt(),
      userPrompt: explainUserPrompt(diff, hash),
    });
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

