import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCatalogue, type WptCatalogue, type WptManifest } from '../../wpt/catalogue';
import { readSuites, selectTests, type WptSuite } from '../../wpt/suite';

describe('WPT suite configuration', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'browlet-wpt-suites-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('loads JSON suites by filename in a stable order', () => {
    const streams = { directory: '/streams/', include: [] };
    const fetch = { $schema: '../suite.schema.json', directory: '/fetch/api/' };
    writeFileSync(join(directory, 'streams.json'), JSON.stringify(streams));
    writeFileSync(join(directory, 'fetch.json'), JSON.stringify(fetch));
    const suites = readSuites(directory);
    expect(Object.keys(suites)).toEqual(['fetch', 'streams']);
    expect(suites).toEqual({ fetch, streams });
  });

  it('accepts whole-document skips and named failures with optional notes', () => {
    const suite: WptSuite = {
      directory: '/fetch/api/', include: ['**'], support: ['resources/**'],
      skip: [{ test: '**/*.any.worker.html', reason: 'harness-limitation' }],
      failing: [
        { test: 'basic.html', reason: 'implementation-bug', note: 'Awaiting a fix.' },
        { test: 'body.html', subtests: ['unfinished'], reason: 'not-implemented' },
        { test: 'body.html', subtests: ['disputed'], reason: 'contested' },
      ],
    };
    writeFileSync(join(directory, 'fetch.json'), JSON.stringify(suite));
    expect(readSuites(directory)).toEqual({ fetch: suite });
  });

  it('validates the checked-in suite definitions', () => {
    const suites = readSuites();
    expect(suites.fetch?.directory).toBe('/fetch/api/');
    expect(suites.streams?.directory).toBe('/streams/');
  });

  it.each([
    { fields: { directory: null }, message: '/directory' },
    { fields: { include: '**' }, message: '/include' },
    { fields: { includes: ['**'] }, message: 'additional properties' },
    { fields: { failing: [{ test: '**' }] }, message: 'reason' },
    { fields: { failing: [{ test: '**', reason: 'typo' }] }, message: '/reason' },
    { fields: { failing: [{ test: '**', reason: 'contested', evidence: 'obsolete' }] }, message: 'additional properties' },
    { fields: { failing: [{ test: '**', reason: 'not-implemented', subtests: [] }] }, message: '/subtests' },
    { fields: { failing: [{ test: '**', reason: 'not-implemented', subtests: ['same', 'same'] }] }, message: '/subtests' },
    { fields: { skip: [{ test: '**', reason: 'not-implemented', subtests: ['one'] }] }, message: '/skip/0/subtests' },
  ])('rejects invalid configuration with its file and field: $fields', ({ fields, message }) => {
    writeFileSync(join(directory, 'fetch.json'), JSON.stringify({ directory: '/fetch/api/', ...fields }));
    expect(() => readSuites(directory)).toThrow('fetch.json');
    expect(() => readSuites(directory)).toThrow(message);
  });
});

describe('WPT suite selection', () => {
  it('selects runnable URLs beneath a directory, excluding support files', () => {
    const result = selectTests({ fetch: { directory: '/fetch/api/' } }, catalogue);
    expect(result.tests.map(({ test }) => test.url)).toEqual([
      '/fetch/api/basic.html',
      '/fetch/api/response/body.any.html',
      '/fetch/api/response/body.any.worker.html',
      '/fetch/api/response/body.any.html?variant=one',
    ]);
    expect(catalogue.counts).toEqual({ testharness: 5, support: 1 });
  });

  it('applies relative include globs and deduplicates overlapping includes', () => {
    const result = selectTests({
      fetch: {
        directory: '/fetch/api',
        include: ['response/*.any.html', 'response/body.any.html'],
      },
    }, catalogue);
    expect(result.tests.map(({ test }) => test.url)).toEqual(['/fetch/api/response/body.any.html']);
    expect(result.tests[0]?.test.source).toBe('fetch/api/response/body.any.js');
  });

  it('treats query suffixes literally, including question marks and brackets', () => {
    const variants: WptCatalogue = {
      ...catalogue,
      tests: ['body.html?a[]=1', 'body.htmlXa[]=1', 'body.html?a=1'].map((name) => ({
        source: 'fetch/body.html', url: `/fetch/${name}`, timeout: 65_000, scripts: [],
      })),
    };
    const result = selectTests({
      fetch: {
        directory: '/fetch/', include: ['body.html?a[]=1'],
      },
    }, variants);
    expect(result.tests.map(({ test }) => test.url)).toEqual(['/fetch/body.html?a[]=1']);
  });

  it('keeps skipped tests visible and does not download their script dependencies', () => {
    const result = selectTests({
      fetch: {
        directory: '/fetch/api/',
        skip: [{ test: 'response/**', reason: 'harness-limitation', note: 'Example exclusion.' }],
      },
    }, catalogue);
    expect(result.tests.filter((test) => test.skip)).toHaveLength(3);
    expect(result.tests[0]?.skip).toBeUndefined();
    expect(result.support).toEqual([]);
  });

  it('rejects subtest skips instead of silently skipping the whole document', () => {
    expect(() => selectTests({
      fetch: {
        directory: '/fetch/api/',
        skip: [{ test: 'basic.html', subtests: ['first'], reason: 'not-implemented' }],
      },
    }, catalogue)).toThrow('Skip rules apply to whole test documents');
  });

  it('obtains script dependencies and additional support globs relative to the suite', () => {
    const result = selectTests({
      fetch: {
        directory: '/fetch/api/',
        include: ['response/body.any.html'],
        support: ['resources/**'],
      },
    }, catalogue);
    expect(result.support).toEqual(['fetch/api/resources/helper.js']);
  });

  it('allows different reasons for disjoint subtests of the same test', () => {
    const suite: WptSuite = {
      directory: '/fetch/api/', include: ['basic.html'],
      failing: [
        { test: 'basic.html', subtests: ['first'], reason: 'not-implemented' },
        { test: 'basic.html', subtests: ['second'], reason: 'contested', note: 'Reviewed disagreement.' },
      ],
    };
    expect(selectTests({ fetch: suite }, catalogue).tests[0]?.failing).toEqual(suite.failing);
  });

  it.each([
    { directory: '/missing/' },
    { directory: '/fetch/api/', include: ['typo.html'] },
    { directory: '/fetch/api/', skip: [{ test: 'typo.html', reason: 'not-implemented' }] },
    { directory: '/fetch/api/', failing: [{ test: 'typo.html', reason: 'not-implemented' }] },
    { directory: '/fetch/api/', support: ['missing/**'] },
  ] satisfies WptSuite[])('rejects rules that match nothing: %j', (suite) => {
    expect(() => selectTests({ fetch: suite }, catalogue)).toThrow('matches no');
  });

  it('rejects exceptions outside the include selection', () => {
    expect(() => selectTests({
      fetch: {
        directory: '/fetch/api/', include: ['basic.html'],
        failing: [{ test: 'response/body.any.html', reason: 'not-implemented' }],
      },
    }, catalogue)).toThrow('matches no');
  });

  it('rejects overlapping failure rules rather than using their order', () => {
    const suite: WptSuite = {
      directory: '/fetch/api/',
      failing: [
        { test: '**', reason: 'not-implemented' },
        { test: 'basic.html', subtests: ['first'], reason: 'implementation-bug' },
      ],
    };
    expect(() => selectTests({ fetch: suite }, catalogue)).toThrow('Overlapping failure');
    suite.failing![0]!.subtests = ['first'];
    expect(() => selectTests({ fetch: suite }, catalogue)).toThrow('Overlapping failure');
  });

  it('rejects overlapping skip rules and failures attached to skipped tests', () => {
    const suite: WptSuite = {
      directory: '/fetch/api/',
      skip: [
        { test: '**', reason: 'not-implemented' },
        { test: 'basic.html', reason: 'harness-limitation' },
      ],
    };
    expect(() => selectTests({ fetch: suite }, catalogue)).toThrow('Overlapping skip');
    suite.skip!.pop();
    suite.failing = [{ test: 'basic.html', reason: 'implementation-bug' }];
    expect(() => selectTests({ fetch: suite }, catalogue)).toThrow('skipped test');
  });

  it.each([{ subtests: [] }, { subtests: ['first', 'first'] }])('rejects an empty or duplicated subtest list: %j', ({ subtests }) => {
    expect(() => selectTests({
      fetch: {
        directory: '/fetch/api/',
        failing: [{ test: 'basic.html', subtests, reason: 'not-implemented' }],
      },
    }, catalogue)).toThrow('Empty or duplicate');
  });

  it.each(['/basic.html', '../basic.html', 'response/../../basic.html', 'response\\body.html'])(
    'rejects paths outside the suite directory: %s', (pattern) => {
      expect(() => selectTests({
        fetch: {
          directory: '/fetch/api/', include: [pattern],
        },
      }, catalogue)).toThrow('relative to its directory');
    },
  );

  it('rejects conflicting suite ownership', () => {
    const suite: WptSuite = { directory: '/fetch/api/' };
    expect(() => selectTests({ first: suite, second: suite }, catalogue)).toThrow('multiple suites');
  });

  it('rejects an unsupported manifest version', () => {
    expect(() => parseCatalogue({ ...manifest, version: 10 })).toThrow('Unsupported WPT manifest');
  });
});

const manifest: WptManifest = {
  version: 9,
  url_base: '/',
  items: {
    testharness: {
      fetch: {
        api: {
          'basic.html': ['hash', [null, {}]],
          response: {
            'body.any.js': ['hash',
              ['fetch/api/response/body.any.html', { script_metadata: [['script', '../resources/helper.js']] }],
              ['fetch/api/response/body.any.worker.html', {}],
              ['fetch/api/response/body.any.html?variant=one', { timeout: 'long' }],
            ],
          },
        },
      },
      streams: { 'basic.html': ['hash', [null, {}]] },
    },
    support: { fetch: { api: { resources: { 'helper.js': ['hash', [null, {}]] } } } },
  },
};
const catalogue = parseCatalogue(manifest);
