# Implementation: Extract `getRepositoryContext()` helper

## Steps

- [x] Create `src/ai/get-repository-context.ts`
- [x] Modify `src/commands/explain.ts` — replace inline logic with helper
- [x] Modify `src/commands/review.ts` — replace inline logic with helper
- [x] Modify `src/commands/commit.ts` — replace inline logic with helper
- [x] Verify TypeScript compilation (`npx tsc --noEmit`)
- [x] Run test suite (`npx vitest run`) — 19 files, 143 tests passed
- [x] Manual verification — all three commands use the helper via single import
- [x] Regression assessment — no changes to prompts, detectors, providers, AI services, or behavior

