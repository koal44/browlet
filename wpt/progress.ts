import type { WptReport } from './harness';
import { checkReport, type WptRule } from './suite';

/** Give each target URL one unit, divided among its completed subtests. */
export function summarizeProgress(total: number, results: Iterable<WptProgressResult>): WptProgress {
  const progress = { total, passing: 0, contested: 0, failing: 0, untested: total };
  for (const { report, failing } of results) {
    progress.untested--;
    // An incomplete harness cannot establish the full set of subtests.
    if (!report || report.harness.status !== 'ok' || report.tests.length === 0) {
      progress.failing++;
      continue;
    }
    const { passed, contestedFailures } = checkReport(report, failing);
    const count = report.tests.length;
    progress.passing += passed / count;
    progress.contested += contestedFailures / count;
    progress.failing += (count - passed - contestedFailures) / count;
  }
  return progress;
}

/** Render the README's compact graphic, with colors for both GitHub themes. */
export function renderProgress(progress: WptProgress): string {
  const segments = [
    { name: 'passing', label: 'Passing', value: progress.passing, x: 0 },
    { name: 'contested', label: 'Contested', value: progress.contested, x: 86 },
    { name: 'failing', label: 'Failing', value: progress.failing, x: 188 },
    { name: 'untested', label: 'Untested', value: progress.untested, x: 269 },
  ].map((segment) => ({ ...segment, percent: formatPercent(segment.value, progress.total) }));
  const total = progress.total.toLocaleString('en-US');
  const description = segments.map(({ label, percent }) => `${label} ${percent}`).join(', ');
  let offset = 0;
  const bars = segments.map(({ name, value }) => {
    const width = progress.total === 0 ? 0 : 360 * value / progress.total;
    const rectangle = `    <rect class="${name}" x="${offset}" width="${width}" height="8" />`;
    offset += width;
    return rectangle;
  }).join('\n');
  const legend = segments.map(({ name, label, percent, x }) =>
    `    <circle class="${name}" cx="${x + 3}" cy="23" r="3" />\n` +
    `    <text x="${x + 11}" y="27">${label} ${escapeXml(percent)}</text>`,
  ).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="58" viewBox="0 0 360 58" role="img" aria-labelledby="title description">
  <title id="title">Web Platform Tests progress</title>
  <desc id="description">${escapeXml(description)}; of ${total} testharness tests. Each test URL has equal weight; completed subtests contribute fractions. Harness and loading failures count as failing tests.</desc>
  <style>
    .passing { fill: #2da44e; }
    .contested { fill: #0969da; }
    .failing { fill: #d1242f; }
    .untested { fill: #d1d9e0; }
    text { fill: #59636e; font: 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .total { font-size: 12px; }
    @media (prefers-color-scheme: dark) {
      .passing { fill: #3fb950; }
      .contested { fill: #58a6ff; }
      .failing { fill: #f85149; }
      .untested { fill: #30363d; }
      text { fill: #9198a1; }
    }
  </style>
  <defs>
    <clipPath id="bar"><rect width="360" height="8" rx="4" /></clipPath>
  </defs>
  <g clip-path="url(#bar)">
${bars}
  </g>
  <g>
${legend}
  </g>
  <text class="total" y="51">of ${total} tests</text>
</svg>
`;
}

export type WptProgress = {
  total: number;
  passing: number;
  contested: number;
  failing: number;
  untested: number;
};

export type WptProgressResult = {
  /** Absent when loading or running the document threw before a report arrived. */
  report?: WptReport;
  failing: WptRule[];
};

function formatPercent(value: number, total: number): string {
  if (total === 0) return '—';
  if (value === 0) return '0%';
  const percent = 100 * value / total;
  if (percent < 0.1) return '<0.1%';
  if (percent > 99.9 && value < total) return '>99.9%';
  return `${Number(percent.toFixed(1))}%`;
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
