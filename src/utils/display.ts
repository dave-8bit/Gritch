import chalk from 'chalk';
import ora from 'ora';
import type { ReviewIssue } from '../types/index';

export const spinner = ora('');

export function printSuccess(message: string): void {
  console.log(chalk.green(`✔ ${message}`));
}

export function printError(message: string): void {
  console.log(chalk.red(`✖ ${message}`));
}

export function printWarning(message: string): void {
  console.log(chalk.yellow(`⚠ ${message}`));
}

export function printInfo(message: string): void {
  console.log(chalk.blue(`ℹ ${message}`));
}

export function printDivider(): void {
  console.log(chalk.dim('-'.repeat(50)));
}

export function printHeader(title: string): void {
  console.log('');
  console.log(chalk.bold.cyan(title));
  printDivider();
}

export function printReviewIssue(issue: ReviewIssue): void {
  const severityColor =
    issue.severity === 'critical'
      ? chalk.red
      : issue.severity === 'warning'
        ? chalk.yellow
        : chalk.blue;

  console.log(`${severityColor(issue.severity)} ${chalk.dim(`(${issue.category})`)}\n${issue.description}`);
  console.log(chalk.dim(`${'→ Fix:'} ${issue.suggestion}`));
}

