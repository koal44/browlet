import { describe, expect, it } from 'vitest';
import type { WptReport, WptTestResult } from '../../wpt/harness';
import { checkReport, type WptRule } from '../../wpt/suite';

describe('WPT result expectations', () => {
  it('expects ordinary subtests to pass', () => {
    expect(checkReport(report(['basic', 'pass']), [])).toEqual({
      passed: 1, expectedFailures: 0, contestedFailures: 0, issues: [],
    });
    expect(checkReport(report(['basic', 'fail']), []).issues[0]).toContain('basic: fail');
  });

  it('permits only the named failures and reports their unexpected passes', () => {
    const rule: WptRule = {
      test: 'example.html', subtests: ['unfinished'], reason: 'not-implemented',
    };
    expect(checkReport(report(['basic', 'pass'], ['unfinished', 'fail']), [rule])).toEqual({
      passed: 1, expectedFailures: 1, contestedFailures: 0, issues: [],
    });
    expect(checkReport(report(['basic', 'fail'], ['unfinished', 'fail']), [rule]).issues[0]).toContain('basic: fail');
    expect(checkReport(report(['unfinished', 'pass']), [rule]).issues[0]).toContain('Unexpected pass: unfinished');
  });

  it('counts contested failures separately without changing the raw results', () => {
    const raw = report(['disputed', 'fail']);
    const result = checkReport(raw, [{
      test: 'example.html', subtests: ['disputed'], reason: 'contested', note: 'Reviewed disagreement.',
    }]);
    expect(result).toEqual({ passed: 0, expectedFailures: 0, contestedFailures: 1, issues: [] });
    expect(raw.tests[0]?.status).toBe('fail');
  });

  it('allows a coarse whole-test failure without requiring every subtest to fail', () => {
    const rules: WptRule[] = [{ test: 'example.html', reason: 'implementation-bug' }];
    expect(checkReport(report(['basic', 'pass'], ['broken', 'fail']), rules).issues).toEqual([]);
    expect(checkReport(report(['basic', 'pass'], ['broken', 'pass']), rules).issues[0]).toContain('Unexpected whole-test pass');
  });

  it.each(['timeout', 'not-run', 'precondition-failed'] as const)('never hides a %s behind an expected assertion failure', (status) => {
    const raw = report(['unfinished', status]);
    for (const subtests of [undefined, ['unfinished']]) {
      const result = checkReport(raw, [{ test: 'example.html', subtests, reason: 'not-implemented' }]);
      expect(result.expectedFailures).toBe(0);
      expect(result.issues[0]).toContain(status);
    }
  });

  it.each(['error', 'timeout', 'precondition-failed'] as const)('never hides a harness %s behind a whole-test failure', (status) => {
    const raw = report(['unfinished', 'fail']);
    raw.harness = { status, message: 'Harness stopped.' };
    expect(checkReport(raw, [{ test: 'example.html', reason: 'not-implemented' }]).issues[0]).toContain(`Harness ${status}`);
  });

  it('rejects stale subtest expectations, duplicate names, and empty reports', () => {
    expect(checkReport(report(['renamed', 'pass']), [{
      test: 'example.html', subtests: ['original'], reason: 'not-implemented',
    }]).issues[0]).toContain('Expected subtest was not reported: original');
    expect(checkReport(report(['same', 'pass'], ['same', 'pass']), []).issues[0]).toContain('Duplicate subtest');
    expect(checkReport(report(), []).issues[0]).toContain('without reporting any subtests');
  });
});

function report(...tests: [string, WptTestResult['status']][]): WptReport {
  return {
    harness: { status: 'ok', message: null },
    tests: tests.map(([name, status]) => ({ name, status, message: null, stack: null })),
  };
}
