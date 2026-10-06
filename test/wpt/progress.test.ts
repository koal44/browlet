import { describe, expect, it } from 'vitest';
import type { WptReport, WptTestResult } from '../../wpt/harness';
import { renderProgress, summarizeProgress } from '../../wpt/progress';

describe('WPT progress', () => {
  it('gives each URL equal weight and splits its unit among subtests', () => {
    const report = reported([
      ...Array<WptTestResult['status']>(11).fill('pass'), 'fail', 'fail',
    ]);
    const progress = summarizeProgress(10_000, [
      { report, failing: [] },
      { report: reported(['pass']), failing: [] },
    ]);
    expect(progress.total).toBe(10_000);
    expect(progress.passing).toBeCloseTo(1 + 11 / 13);
    expect(progress.failing).toBeCloseTo(2 / 13);
    expect(progress.contested).toBe(0);
    expect(progress.untested).toBe(9_998);
  });

  it('keeps expected failures red and colors only reviewed disputed failures blue', () => {
    const progress = summarizeProgress(1, [{
      report: reported(['pass', 'fail', 'fail', 'fail']),
      failing: [
        { test: 'example.html', subtests: ['0', '1'], reason: 'contested' },
        { test: 'example.html', subtests: ['2'], reason: 'not-implemented' },
      ],
    }]);
    // An unexpected pass is still a raw pass; expectation checking fails CI separately.
    expect(progress).toEqual({ total: 1, passing: 0.25, contested: 0.25, failing: 0.5, untested: 0 });
  });

  it.each(['error', 'timeout', 'precondition-failed'] as const)(
    'does not give passing credit to the reported prefix of a harness %s', (status) => {
      const report = reported(['pass']);
      report.harness.status = status;
      expect(summarizeProgress(2, [{ report, failing: [] }])).toEqual({
        total: 2, passing: 0, contested: 0, failing: 1, untested: 1,
      });
    },
  );

  it('counts loading failures and empty reports as failing, retaining all unrun URLs', () => {
    expect(summarizeProgress(5, [
      { failing: [] },
      { report: reported([]), failing: [] },
    ])).toEqual({ total: 5, passing: 0, contested: 0, failing: 2, untested: 3 });
  });

  it('shows small nonzero fractions without rounding them to zero', () => {
    const svg = renderProgress({ total: 10_000, passing: 1, contested: 0, failing: 0, untested: 9_999 });
    expect(svg).toContain('Passing &lt;0.1%');
    expect(svg).toContain('Untested &gt;99.9%');
    expect(svg).toContain('of 10,000 tests');
    expect(svg).not.toContain('NaN');
    expect(renderProgress({ total: 0, passing: 0, contested: 0, failing: 0, untested: 0 })).toContain('Passing —');
  });
});

function reported(statuses: WptTestResult['status'][]): WptReport {
  return {
    harness: { status: 'ok', message: null },
    tests: statuses.map((status, index) => ({ name: String(index), status, message: null, stack: null })),
  };
}
