import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export const wptOrigin = new URL('http://web-platform.test/');
export const reporterSource = readFileSync(
  resolve('wpt/testharnessreport.js'),
  'utf8',
);

export function resolveWptPath(path: string): string {
  const testsDirectory = resolve('wpt/tests');
  const relativePath = decodeURIComponent(path).replace(/^\/+|^\.\//u, '');
  const resolved = resolve(testsDirectory, relativePath);

  if (
    resolved !== testsDirectory &&
    !resolved.startsWith(`${testsDirectory}${sep}`)
  ) {
    throw new Error(`WPT path escapes the checkout: ${path}`);
  }

  return resolved;
}

export function withWptTimeout<T>(
  completion: Promise<T>,
  testPath: string,
  timeoutMs = 65_000,
): Promise<T> {
  return new Promise((resolveCompletion, rejectCompletion) => {
    const timeout = setTimeout(() => {
      rejectCompletion(new Error(`WPT runner timed out: ${testPath}`));
    }, timeoutMs);

    void completion.then(
      (result) => {
        clearTimeout(timeout);
        resolveCompletion(result);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        rejectCompletion(toError(error));
      },
    );
  });
}

export type WptReport = {
  harness: WptHarnessResult;
  tests: WptTestResult[];
};

export type WptHarnessResult = {
  status: 'ok' | 'error' | 'timeout' | 'precondition-failed';
  message: string | null;
};

export type WptTestResult = {
  name: string;
  status: 'pass' | 'fail' | 'timeout' | 'not-run' | 'precondition-failed';
  message: string | null;
  stack: string | null;
};

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
