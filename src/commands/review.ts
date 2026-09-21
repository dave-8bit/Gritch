import chalk from 'chalk';
import { AIService } from '../core/ai/ai.service';
import { buildAIRequest } from '../core/ai/ai.request-builder';
import {
  REVIEW_TRUNCATED_MESSAGE,
  isReviewPassed,
  isReviewResponseIncomplete,
  parseReviewResult,
} from '../core/ai/helpers/review-result';
import { composeChangeContext } from '../core/repository/change-context';
import { createExistingIndexRetriever } from '../core/repository/repository.retriever';
import { reviewSystemPrompt, reviewUserPrompt } from '../ai/prompts';
import { validateRepo } from '../utils/git';
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

/**
 * Compact user-facing summary of the evidence boundaries the reviewer was
 * told about. The full deterministic limitation notes are part of the prompt
 * evidence; here only the top-level flags are surfaced so the user knows the
 * review ran on partial material.
 */
function evidenceLimitationLine(context: Awaited<ReturnType<typeof composeChangeContext>>): string | undefined {
  const parts: string[] = [];
  if (context.truncation.diffTruncated) parts.push('staged diff incomplete');
  if (context.truncation.contentTruncated) parts.push('some file contents not supplied');
  if (context.truncation.relatedContentTruncated) parts.push('some related-file contents not supplied');
  if (context.truncation.repositoryFactsTruncated) parts.push('repository facts truncated');
  if (context.repositoryFacts.profileUnavailable) parts.push('repository profile unavailable');
  if (context.overview.relatedFileLookup === 'not-performed') parts.push('related-file lookup not performed');
  if (context.overview.relatedFileLookup === 'unavailable') parts.push('related-file lookup unavailable');
  return parts.length > 0 ? `Review ran on partial evidence: ${parts.join('; ')}.` : undefined;
}

export async function reviewCommand(_language = 'typescript'): Promise<void> {
  try {
    const config = loadConfig();

    try {
      await validateRepo();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      printError(message);
      return;
    }

    spinner.text = 'Collecting staged-change evidence…';
    spinner.start();

    let context: Awaited<ReturnType<typeof composeChangeContext>>;
    try {
      // Metadata-only retrieval is used only when an index already exists;
      // review never builds or populates one.
      const retriever = createExistingIndexRetriever();
      context = await composeChangeContext(undefined, { retriever });
    } catch (err) {
      spinner.fail();
      const message = err instanceof Error ? err.message : String(err);
      printError(message);
      return;
    }

    spinner.text = 'Reviewing your code with AI…';
    const response = await AIService.chatWithFallback(
      buildAIRequest({
        systemPrompt: reviewSystemPrompt(),
        userPrompt: reviewUserPrompt(context),
      }),
    );

    spinner.succeed();

    // A response stopped at the output-length limit is an incomplete review,
    // not a valid final result.
    if (isReviewResponseIncomplete(response)) {
      printError(`${REVIEW_TRUNCATED_MESSAGE} The review is incomplete and was not evaluated.`);
      return;
    }

    // The model is never trusted: the response is validated field by field,
    // and pass/fail is derived here, deterministically.
    const validation = parseReviewResult(response.content);
    if (!validation.ok) {
      printError(`AI returned an invalid review response: ${validation.error}`);
      return;
    }

    const result: ReviewResult = {
      ...validation.result,
      passed: isReviewPassed(validation.result.score, config.reviewThreshold),
    };

    printHeader('Code Review Results');

    const limitation = evidenceLimitationLine(context);
    if (limitation) {
      printWarning(limitation);
      console.log('');
    }

    const scoreText = `Score: ${result.score}/10`;
    const scoreColor = result.passed ? chalk.green : chalk.red;
    console.log(scoreColor(scoreText));

    printInfo(result.summary);
    printDivider();

    for (let i = 0; i < result.issues.length; i++) {
      printReviewIssue(result.issues[i]);
      if (i < result.issues.length - 1) {
        console.log('');
      }
    }

    if (result.issues.length === 0) {
      printInfo('No issues met the evidence bar for reporting.');
    }

    if (result.passed) {
      printSuccess('Review passed!');
    } else {
      printWarning('Review did not pass. Please address critical issues before pushing.');
    }
  } catch (err) {
    spinner.stop();
    const message = err instanceof Error ? err.message : String(err);
    printError(message);
  }
}
