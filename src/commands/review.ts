import chalk from 'chalk';
import { AIService } from '../core/ai/ai.service';
import { buildAIRequest } from '../core/ai/ai.request-builder';
import { reviewSystemPrompt, reviewUserPrompt } from '../ai/prompts';

import { getStagedDiff, trimDiff, validateRepo } from '../utils/git';

import {
  spinner,
  printError,
  printHeader,
  printInfo,
  printDivider,
  printSuccess,
  printWarning,
  printReviewIssue,
} from '../utils/display';
import { loadConfig } from '../utils/config';
import type { ReviewResult } from '../types/index';

export async function reviewCommand(language: string): Promise<void> {
  try {
    const config = loadConfig();

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

    spinner.text = 'Reviewing your code with AI…';
    const response = await AIService.chat(
      buildAIRequest({
        systemPrompt: reviewSystemPrompt(),
        userPrompt: reviewUserPrompt(trimDiff(diff), language),
      })
    );

    const raw = response.content;

    spinner.succeed();


    let result: ReviewResult;

    try {
      result = JSON.parse(raw) as ReviewResult;
    } catch {
      printError('AI returned an unexpected response format.');
      return;
    }

    printHeader('Code Review Results');

    const scoreText = `Score: ${result.score}/10`;
    const scoreColor = result.score >= config.reviewThreshold ? chalk.green : chalk.red;
    console.log(scoreColor(scoreText));

    printInfo(result.summary);
    printDivider();

    for (let i = 0; i < result.issues.length; i++) {
      printReviewIssue(result.issues[i]);
      if (i < result.issues.length - 1) {
        console.log('');
      }
    }

    if (result.passed) {
      printSuccess('Review passed!');
    } else {
      printWarning('Review did not pass. Please address critical issues before pushing.');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    printError(message);
  }
}
