#!/usr/bin/env node
import 'dotenv/config';
import chalk from 'chalk';
import { Command } from 'commander';


import { commitCommand } from './commands/commit';
import { reviewCommand } from './commands/review';
import { changelogCommand } from './commands/changelog';
import { explainCommand } from './commands/explain';
import { inspectCommand } from './commands/inspect';

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

  console.log('');
  console.log(chalk.dim('Run gritch --help for more info'));
}


