import { readFileSync, readdirSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import Ajv from 'ajv';
import type { WptCatalogue, WptTest } from './catalogue';
import type { WptReport } from './harness';

/** Load and validate each JSON suite; its filename supplies the suite name. */
export function readSuites(directory = 'wpt/suites'): Record<string, WptSuite> {
  return Object.fromEntries(readdirSync(directory).filter((name) => name.endsWith('.json')).sort().map((name) => {
    const file = resolve(directory, name);
    const suite: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!validateSuite(suite)) {
      throw new Error(`Invalid WPT suite ${file}: ${validator.errorsText(validateSuite.errors)}`);
    }
    return [name.slice(0, -5), suite];
  }));
}

/** Resolve suite-relative patterns and reject ambiguous or unused rules. */
export function selectTests(
  suites: Record<string, WptSuite>,
  catalogue: WptCatalogue,
): { tests: SelectedWptTest[]; support: string[]; } {
  const tests = new Map<string, SelectedWptTest>();
  const support = new Set<string>();
  const sources = new Set(catalogue.sources);

  for (const [name, suite] of Object.entries(suites)) {
    const prefix = suite.directory.replace(/^\//u, '').replace(/\/$/u, '');
    validatePath(prefix, `directory for ${name}`);
    const directory = `/${prefix}/`;
    const available = catalogue.tests.filter((test) => test.url.startsWith(directory));
    const included = new Set<WptTest>();
    for (const pattern of suite.include ?? ['**']) {
      const matches = matchTests(available, directory, pattern);
      requireMatches(matches, `${name}: include ${pattern}`);
      for (const test of matches) included.add(test);
    }

    const selections = [...included].map((test): SelectedWptTest => ({
      suite: name, test, failing: [],
    }));
    for (const rule of suite.skip ?? []) {
      validatePath(rule.test, 'pattern');
      if (rule.subtests !== undefined) {
        throw new Error(`Skip rules apply to whole test documents, not subtests: ${rule.test}`);
      }
      const matches = selections.filter(({ test }) => matchesPattern(test.url.slice(directory.length), rule.test));
      requireMatches(matches, `${name}: skip ${rule.test}`);
      for (const selection of matches) {
        if (selection.skip) throw new Error(`Overlapping skip rules for ${selection.test.url}`);
        selection.skip = rule;
      }
    }
    for (const rule of suite.failing ?? []) {
      validatePath(rule.test, 'pattern');
      if (rule.subtests && (rule.subtests.length === 0 || new Set(rule.subtests).size !== rule.subtests.length)) {
        throw new Error(`Empty or duplicate subtest names for ${rule.test}`);
      }
      const matches = selections.filter(({ test }) => matchesPattern(test.url.slice(directory.length), rule.test));
      requireMatches(matches, `${name}: failing ${rule.test}`);
      for (const selection of matches) {
        if (selection.skip) throw new Error(`Failure rule targets a skipped test: ${selection.test.url}`);
        for (const previous of selection.failing) {
          if (!previous.subtests || !rule.subtests || rule.subtests.some((subtest) => previous.subtests!.includes(subtest))) {
            throw new Error(`Overlapping failure rules for ${selection.test.url}`);
          }
        }
        selection.failing.push(rule);
      }
    }

    for (const selection of selections) {
      if (tests.has(selection.test.url)) {
        throw new Error(`WPT test selected by multiple suites: ${selection.test.url}`);
      }
      tests.set(selection.test.url, selection);
      if (selection.skip) continue;
      for (const script of selection.test.scripts) {
        const url = new URL(script, `http://web-platform.test${selection.test.url}`);
        if (url.origin !== 'http://web-platform.test') {
          throw new Error(`External WPT script requires server support: ${script}`);
        }
        const path = decodeURIComponent(url.pathname.slice(1));
        if (!sources.has(path)) throw new Error(`WPT support file is absent from the manifest: ${path}`);
        support.add(path);
      }
    }
    for (const pattern of suite.support ?? []) {
      const paths = catalogue.sources.filter((source) =>
        source.startsWith(`${prefix}/`) && matchesPattern(source.slice(prefix.length + 1), pattern));
      requireMatches(paths, `${name}: support ${pattern}`);
      for (const path of paths) support.add(path);
    }
  }
  return { tests: [...tests.values()], support: [...support] };
}

/** Compare raw WPT results without changing upstream assertions or statuses. */
export function checkReport(report: WptReport, rules: WptRule[]): WptAssessment {
  const result: WptAssessment = {
    passed: 0, expectedFailures: 0, contestedFailures: 0, issues: [],
  };
  if (report.harness.status !== 'ok') {
    result.issues.push(`Harness ${report.harness.status}: ${report.harness.message ?? 'no message'}`);
  }

  const wholeTest = rules.find((rule) => !rule.subtests);
  const subtests = new Map(rules.flatMap((rule) =>
    (rule.subtests ?? []).map((name): [string, WptRule] => [name, rule])));
  const observed = new Set<string>();
  for (const test of report.tests) {
    if (observed.has(test.name)) result.issues.push(`Duplicate subtest name: ${test.name}`);
    observed.add(test.name);
    const rule = subtests.get(test.name) ?? wholeTest;
    if (test.status === 'pass') {
      result.passed++;
      if (subtests.has(test.name)) {
        result.issues.push(`Unexpected pass: ${test.name} [${describeReason(rule!)}]`);
      }
    } else if (test.status === 'fail' && rule) {
      if (rule.reason === 'contested') result.contestedFailures++;
      else result.expectedFailures++;
    } else {
      result.issues.push(`${test.name}: ${test.status}\n${test.message ?? 'No failure message'}${test.stack ? `\n${test.stack}` : ''}`);
    }
  }

  for (const [name, rule] of subtests) {
    if (!observed.has(name)) result.issues.push(`Expected subtest was not reported: ${name} [${describeReason(rule)}]`);
  }
  if (wholeTest && report.harness.status === 'ok' && report.tests.every((test) => test.status === 'pass')) {
    result.issues.push(`Unexpected whole-test pass [${describeReason(wholeTest)}]`);
  }
  if (report.tests.length === 0 && report.harness.status === 'ok') {
    result.issues.push('WPT completed without reporting any subtests');
  }
  return result;
}

export function describeReason(rule: WptRule): string {
  return `${rule.reason}${rule.note ? `: ${rule.note}` : ''}`;
}

export type WptSuite = {
  $schema?: string;
  directory: string;
  include?: string[];
  /** Whole-document skips only; subtests are rejected during validation. */
  skip?: WptRule[];
  failing?: WptRule[];
  /** Additional fixture paths or globs, relative to the suite directory. */
  support?: string[];
};

export type WptRule = {
  test: string;
  /** Failure rules may name exact subtests; omit for a whole-test rule. */
  subtests?: string[];
  reason: WptReason;
  note?: string;
};

export type WptReason =
  | 'not-implemented'
  | 'implementation-bug'
  | 'harness-limitation'
  | 'contested';

export type SelectedWptTest = {
  suite: string;
  test: WptTest;
  skip?: WptRule;
  failing: WptRule[];
};

export type WptAssessment = {
  passed: number;
  expectedFailures: number;
  contestedFailures: number;
  issues: string[];
};

const validator = new Ajv({ allErrors: true });
const validateSuite = validator.compile<WptSuite>(JSON.parse(readFileSync('wpt/suite.schema.json', 'utf8')) as object);

function matchTests(tests: WptTest[], directory: string, pattern: string): WptTest[] {
  validatePath(pattern, 'pattern');
  return tests.filter((test) => matchesPattern(test.url.slice(directory.length), pattern));
}

function matchesPattern(path: string, pattern: string): boolean {
  validatePath(pattern, 'pattern');
  // A query suffix is literal: '?' must not become a glob wildcard.
  const query = pattern.indexOf('?');
  if (query !== -1) {
    const actualQuery = path.indexOf('?');
    return actualQuery !== -1 &&
      path.slice(actualQuery) === pattern.slice(query) &&
      posix.matchesGlob(path.slice(0, actualQuery), pattern.slice(0, query));
  }
  return posix.matchesGlob(path, pattern);
}

function validatePath(path: string, label: string): void {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split(/[/?]/u).includes('..')) {
    throw new Error(`WPT ${label} must stay relative to its directory: ${path}`);
  }
}

function requireMatches(matches: unknown[], label: string): void {
  if (matches.length === 0) throw new Error(`WPT rule matches no tests or support files: ${label}`);
}
