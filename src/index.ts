#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';

import { commitCommand } from './commands/commit';
import { reviewCommand } from './commands/review';
import { changelogCommand } from './commands/changelog';
import { explainCommand } from './commands/explain';

const program = new Command();

program
  .name('gitwise')
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

program.parse(process.argv);

