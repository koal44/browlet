import { describe, expect, it } from 'vitest';
import {
  readSelection, type WptReport, type WptTestResult,
} from './harness';

export function defineWptTests(
  host: string,
  runTest: WptHostRunner,
): void {
  describe(`${host} WPT`, () => {
    for (const testPath of readSelection()) {
      describe(testPath, async () => {
        let report: WptReport;

        try {
          report = await runTest(testPath);
        } catch (error) {
          it('loads and runs the test document', () => {
            throw toError(error);
          });
          return;
        }

        if (report.harness.status !== 'ok') {
          it('completes the WPT harness', () => {
            expect(
              report.harness.status,
              report.harness.message ?? undefined,
            ).toBe('ok');
          });
        }

        for (const test of report.tests) {
          it(test.name, () => {
            if (test.status !== 'pass') throw createWptFailure(test);
          });
        }
      });
    }
  });
}

type WptHostRunner = (testPath: string) => Promise<WptReport>;

function createWptFailure(test: WptTestResult): Error {
  const error = new Error(
    test.message ?? `WPT subtest ended with status ${test.status}`,
  );

  if (test.stack) {
    error.stack = test.stack.replaceAll(
      'http://web-platform.test/',
      'test/wpt/tests/',
    );
  }
  return error;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
