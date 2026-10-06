import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll, describe, it } from 'vitest';
import { runTest } from './browlet-runner';
import { readCatalogue } from './catalogue';
import { renderProgress, summarizeProgress, type WptProgressResult } from './progress';
import { checkReport, describeReason, readSuites, selectTests } from './suite';

const { revision } = JSON.parse(readFileSync('wpt/wpt-lock.json', 'utf8')) as { revision: string; };
const installed = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: 'wpt/tests', encoding: 'utf8',
}).trim();
if (installed !== revision) throw new Error('WPT checkout differs from the lock; run npm run install:wpt.');
const catalogue = readCatalogue(revision);
const { tests } = selectTests(readSuites(), catalogue);

describe('Browlet WPT', () => {
  const started = Date.now();
  const results = new Map<string, WptProgressResult & {
    suite: string;
    duration: number;
    issues: string[];
  }>();
  let completed = 0;
  let unexpected = 0;
  let passed = 0;
  let expectedFailures = 0;
  let contestedFailures = 0;
  afterAll(() => {
    const progress = summarizeProgress(catalogue.tests.length, results.values());
    mkdirSync('test-results/wpt', { recursive: true });
    writeFileSync('test-results/wpt/progress.svg', renderProgress(progress));
    writeFileSync('test-results/wpt/results.json', JSON.stringify({
      wptRevision: revision,
      browletRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      runtime: {
        node: process.version,
        base: process.env.NODE_BASE,
        backend: process.env.NODE_RUNTIME,
        platform: process.platform,
        arch: process.arch,
      },
      started: new Date(started).toISOString(),
      finished: new Date().toISOString(),
      scope: 'all testharness URLs in the pinned WPT manifest',
      progress,
      selected: tests.length,
      skipped: tests.filter((test) => test.skip).map(({ test, skip }) => ({ url: test.url, reason: skip })),
      unrun: tests.filter(({ test }) => !results.has(test.url)).map(({ test }) => test.url),
      results: [...results].map(([url, result]) => ({ url, ...result })),
    }, null, 2) + '\n');
    console.info(`[wpt] ${completed}/${tests.length} selected documents completed; ${unexpected} documents with unexpected results.\n` +
      `[wpt] Subtests: ${passed} pass, ${expectedFailures} expected fail, ${contestedFailures} contested fail.\n` +
      `[wpt] ${tests.filter((test) => test.skip).length} configured skips; ` +
      `${catalogue.tests.length - tests.length} testharness URLs outside the selection. Revision ${revision}.`);
  });

  for (const { suite, test, skip, failing } of tests) {
    const name = `${suite}: ${test.url}`;
    if (skip) {
      it.skip(`${name} [${describeReason(skip)}]`, () => {});
      continue;
    }
    it(name, async () => {
      const start = Date.now();
      try {
        const report = await runTest(test);
        const result = checkReport(report, failing);
        results.set(test.url, { suite, report, failing, duration: Date.now() - start, issues: result.issues });
        completed++;
        passed += result.passed;
        expectedFailures += result.expectedFailures;
        contestedFailures += result.contestedFailures;
        for (const rule of failing) console.info(`[wpt] ${test.url}: ${describeReason(rule)}`);
        if (result.issues.length !== 0) {
          throw new Error(result.issues.join('\n\n').replaceAll('http://web-platform.test/', 'wpt/tests/'));
        }
      } catch (error) {
        if (!results.has(test.url)) {
          results.set(test.url, {
            suite, failing, duration: Date.now() - start,
            issues: [error instanceof Error ? error.stack ?? error.message : String(error)],
          });
        }
        unexpected++;
        throw error;
      }
    }, test.timeout + 5_000);
  }
});
