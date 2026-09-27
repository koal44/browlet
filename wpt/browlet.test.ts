import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterAll, describe, it } from 'vitest';
import { runTest } from './browlet-runner';
import { readCatalogue } from './catalogue';
import { checkReport, describeReason, readSuites, selectTests } from './suite';

const { revision } = JSON.parse(readFileSync('wpt/wpt-lock.json', 'utf8')) as { revision: string; };
const installed = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: 'wpt/tests', encoding: 'utf8',
}).trim();
if (installed !== revision) throw new Error('WPT checkout differs from the lock; run npm run install:wpt.');
const catalogue = readCatalogue(revision);
const { tests } = selectTests(readSuites(), catalogue);

describe('Browlet WPT', () => {
  let completed = 0;
  let unexpected = 0;
  let passed = 0;
  let expectedFailures = 0;
  let contestedFailures = 0;
  afterAll(() => {
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
      try {
        const report = await runTest(test);
        const result = checkReport(report, failing);
        completed++;
        passed += result.passed;
        expectedFailures += result.expectedFailures;
        contestedFailures += result.contestedFailures;
        for (const rule of failing) console.info(`[wpt] ${test.url}: ${describeReason(rule)}`);
        if (result.issues.length !== 0) {
          throw new Error(result.issues.join('\n\n').replaceAll('http://web-platform.test/', 'wpt/tests/'));
        }
      } catch (error) {
        unexpected++;
        throw error;
      }
    }, test.timeout + 5_000);
  }
});
