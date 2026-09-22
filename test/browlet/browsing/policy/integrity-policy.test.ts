import { describe, expect, it } from 'vitest';
import { IntegrityPolicy } from '../../../../src/browlet/browsing/policy/integrity-policy';
import { FetchHeaders } from '../../../../src/fetch/headers';

describe('Integrity Policy', () => {
  it('starts with independent empty policy lists', () => {
    const first = new IntegrityPolicy();
    const second = new IntegrityPolicy();
    expect(first).toEqual({ sources: [], blockedDestinations: [], endpoints: [] });
    expect(second).toEqual(first);
    first.sources.push('inline');
    first.blockedDestinations.push('script');
    first.endpoints.push('reports');
    expect(second).toEqual({ sources: [], blockedDestinations: [], endpoints: [] });
  });

  it('copies populated policy lists independently', () => {
    const policy = new IntegrityPolicy();
    policy.sources.push('inline');
    policy.blockedDestinations.push('script', 'style');
    policy.endpoints.push('reports');
    const copy = policy.clone();
    expect(copy).toEqual(policy);
    policy.sources.length = 0;
    policy.blockedDestinations.length = 0;
    policy.endpoints.length = 0;
    expect(copy).toEqual({ sources: ['inline'], blockedDestinations: ['script', 'style'], endpoints: ['reports'] });
  });
});

describe('Integrity Policy header parsing', () => {
  it.each(['script', 'style'])('recognizes the %s destination and defaults sources to inline', (destination) => {
    expect(parse(`blocked-destinations=(${destination})`)).toEqual({
      sources: ['inline'], blockedDestinations: [destination], endpoints: [],
    });
  });

  it('collects supported destinations once in specification order and preserves endpoint names', () => {
    expect(parse('blocked-destinations=(style script style), sources=(inline inline), endpoints=(first Second first)'))
      .toEqual({ sources: ['inline'], blockedDestinations: ['script', 'style'], endpoints: ['first', 'Second', 'first'] });
  });

  it('ignores unknown keys and unsupported tokens without rejecting valid requirements', () => {
    expect(parse('future=(extension), sources=(future inline), blocked-destinations=(image script future)'))
      .toEqual({ sources: ['inline'], blockedDestinations: ['script'], endpoints: [] });
  });

  it.each(['()', '(foo)', '(INLINE)'])('preserves an explicitly unrecognized or empty sources list: %s', (sources) => {
    expect(parse(`sources=${sources}, blocked-destinations=(script)`))
      .toEqual({ sources: [], blockedDestinations: ['script'], endpoints: [] });
  });

  it('does not treat differently cased destination tokens as recognized values', () => {
    expect(parse('blocked-destinations=(Script STYLE)')).toEqual({
      sources: ['inline'], blockedDestinations: [], endpoints: [],
    });
  });

  it('ignores syntactically valid item and list parameters', () => {
    expect(parse('sources=(inline;flag=?1);kind="source", blocked-destinations=(script;version=2), endpoints=(reports);flag'))
      .toEqual({ sources: ['inline'], blockedDestinations: ['script'], endpoints: ['reports'] });
  });

  it('leaves an absent header at the empty policy default', () => {
    expect(IntegrityPolicy.parse(new FetchHeaders(), 'Integrity-Policy')).toEqual(new IntegrityPolicy());
  });

  it('accepts an empty dictionary and applies its missing-sources default', () => {
    expect(parse('')).toEqual({ sources: ['inline'], blockedDestinations: [], endpoints: [] });
  });

  it('combines repeated header lines and uses the last duplicate dictionary member', () => {
    const headers = new FetchHeaders([
      ['INTEGRITY-POLICY', 'blocked-destinations=(script), sources=(inline)'],
      ['integrity-policy', 'sources=(), endpoints=(reports)'],
    ]);
    expect(IntegrityPolicy.parse(headers, 'Integrity-Policy')).toEqual({
      sources: [], blockedDestinations: ['script'], endpoints: ['reports'],
    });
  });

  it('reads enforcement and report-only headers independently', () => {
    const headers = new FetchHeaders([
      ['Integrity-Policy', 'blocked-destinations=(script)'],
      ['Integrity-Policy-Report-Only', 'blocked-destinations=(style), endpoints=(reports)'],
    ]);
    expect(IntegrityPolicy.parse(headers, 'Integrity-Policy')).toEqual({
      sources: ['inline'], blockedDestinations: ['script'], endpoints: [],
    });
    expect(IntegrityPolicy.parse(headers, 'Integrity-Policy-Report-Only')).toEqual({
      sources: ['inline'], blockedDestinations: ['style'], endpoints: ['reports'],
    });
  });

  it.each([
    'blocked-destinations=(script', 'blocked-destinations=(script, style)',
    'Sources=(inline)', 'blocked-destinations=(script),', 'sources=(inliné)',
  ])('rejects the entire malformed structured dictionary: %s', (value) => {
    expect(parse(value)).toEqual(new IntegrityPolicy());
  });

  it.each([
    'sources="inline"', 'sources="foo"', 'sources=inline', 'sources=?1',
    'blocked-destinations="script"', 'endpoints=reports', 'future=42',
    'sources=("foo")', 'sources=(inline "foo")', 'sources=(inline ?1)',
    'blocked-destinations=(script "style")', 'endpoints=(reports "other")',
    'future=(extension 42)',
  ])('rejects the whole policy instead of recovering a malformed field: %s', (field) => {
    const valid = 'sources=(inline), blocked-destinations=(script style), endpoints=(reports)';
    expect(parse(`${valid}, ${field}`)).toEqual(new IntegrityPolicy());
    expect(parse(`${field}, future-valid=(extension)`)).toEqual(new IntegrityPolicy());
  });

  it('does not retain a valid line when another line makes the combined policy invalid', () => {
    const headers = new FetchHeaders([
      ['Integrity-Policy', 'blocked-destinations=(script), endpoints=(reports)'],
      ['Integrity-Policy', 'sources="inline"'],
    ]);
    expect(IntegrityPolicy.parse(headers, 'Integrity-Policy')).toEqual(new IntegrityPolicy());
  });
});

function parse(value: string): IntegrityPolicy {
  return IntegrityPolicy.parse(new FetchHeaders([['Integrity-Policy', value]]), 'Integrity-Policy');
}
