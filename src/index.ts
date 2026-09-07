#!/usr/bin/env node
import 'dotenv/config';
import chalk from 'chalk';
import { Command } from 'commander';


import { commitCommand } from './commands/commit';
import { reviewCommand } from './commands/review';
import { changelogCommand } from './commands/changelog';
import { explainCommand } from './commands/explain';
import { inspectCommand } from './commands/inspect';
import { contextCommand } from './commands/context';
import { architectureCommand } from './commands/architecture';
import { dependenciesCommand } from './commands/dependencies';
import { statsCommand } from './commands/stats';
import { doctorCommand } from './commands/doctor';
import { treeCommand } from './commands/tree';
import { historyCommand } from './commands/history';

const program = new Command();


program
  .name('gritch')
  .version('1.0.0')
  .description('AI-powered Git assistant CLI');


program
  .command('commit')
  .description('Generate an AI commit message from staged changes')
  .action(() => {
    void commitCommand();
  });

program
  .command('review')
  .description('Review staged changes before pushing')
  .option('--language <lang>', 'Programming language of the code', 'typescript')
  .action((options: { language: string }) => {
    void reviewCommand(options.language);
  });

program
  .command('changelog <from> <to>')
  .description('Generate a changelog between two git ref or tags')
  .action((from: string, to: string) => {
    void changelogCommand(from, to);
  });

program
  .command('explain <hash>')
  .description('Explain what a commit did in plain English')
  .action((hash: string) => {
    void explainCommand(hash);
  });

program
  .command('inspect [rootPath]')
  .description('Inspect a repository and print detected technologies')
  .action((rootPath: string | undefined) => {
    inspectCommand(rootPath);
  });

program
  .command('context [rootPath]')
  .description('Show deterministic repository engineering context')
  .action((rootPath: string | undefined) => {
    contextCommand(rootPath);
  });

program
  .command('architecture [rootPath]')
  .description('Show detected repository architecture')
  .action((rootPath: string | undefined) => {
    architectureCommand(rootPath);
  });

program
  .command('dependencies [rootPath]')
  .description('Show repository dependencies')
  .action((rootPath: string | undefined) => {
    dependenciesCommand(rootPath);
  });

program
  .command('stats [rootPath]')
  .description('Show deterministic repository statistics')
  .action((rootPath: string | undefined) => {
    statsCommand(rootPath);
  });

program
  .command('doctor [rootPath]')
  .description('Show deterministic repository health and detected tooling')
  .action((rootPath: string | undefined) => {
    doctorCommand(rootPath);
  });

program
  .command('tree [rootPath]')
  .description('Show the deterministic repository file tree')
  .action((rootPath: string | undefined) => {
    treeCommand(rootPath);
  });

program
  .command('history [rootPath]')
  .description('Show recent repository commit history')
  .action((rootPath: string | undefined) => {
    void historyCommand(rootPath);
  });

program.parse(process.argv);


if (process.argv.slice(2).length === 0) {
  // Welcome banner (when running without a subcommand)
  console.log('');
  console.log(chalk.bold.cyan('⚡ gritch v1.0.0'));
  console.log(chalk.dim('AI-powered Git assistant — powered by Groq'));
  console.log('');

  console.log(chalk.bold.white('Commands:'));
  console.log(`  ${chalk.green('commit')} — ${chalk.dim('Generate an AI commit message from staged changes')}`);
  console.log(`  ${chalk.green('review')} — ${chalk.dim('Review staged changes before pushing')}`);
  console.log(`  ${chalk.green('changelog <from> <to>')} — ${chalk.dim('Generate a changelog between two refs')}`);
  console.log(`  ${chalk.green('explain <hash>')} — ${chalk.dim('Explain what a commit did in plain English')}`);
  console.log(`  ${chalk.green('inspect [rootPath]')} — ${chalk.dim('Inspect a repository and print detected technologies')}`);
  console.log(`  ${chalk.green('context [rootPath]')} — ${chalk.dim('Show deterministic repository engineering context')}`);
  console.log(`  ${chalk.green('architecture [rootPath]')} — ${chalk.dim('Show detected repository architecture')}`);
  console.log(`  ${chalk.green('dependencies [rootPath]')} — ${chalk.dim('Show repository dependencies')}`);
  console.log(`  ${chalk.green('stats [rootPath]')} — ${chalk.dim('Show deterministic repository statistics')}`);
  console.log(`  ${chalk.green('doctor [rootPath]')} — ${chalk.dim('Show deterministic repository health and detected tooling')}`);
  console.log(`  ${chalk.green('tree [rootPath]')} — ${chalk.dim('Show the deterministic repository file tree')}`);
  console.log(`  ${chalk.green('history [rootPath]')} — ${chalk.dim('Show recent repository commit history')}`);

  console.log('');
  console.log(chalk.dim('Run gritch --help for more info'));
}
