import { describe, expect, it } from 'vitest';

import {
  DeclaredPermissionsPolicy, PermissionsPolicy, type PermissionsPolicyAllowlist,
} from '../../../../src/browlet/browsing/policy/permissions-policy/policy';
import { FetchResponse } from '../../../../src/fetch/response';
import { createOpaqueOrigin, obtainURLOrigin, parseURL, type Origin } from '../../../../src/url/index';

const responseOrigin = origin('https://parent.test/');
const otherOrigin = origin('https://other.test/');
const feature = [...new PermissionsPolicy().inheritedPolicy.keys()]
  .find((entry) => entry.name === 'cross-origin-isolated')!;

describe('Permissions Policy §§5.2, 6.1, 9.1–9.2: response headers', () => {
  it.each([
    null, '', 'cross-origin-isolated=(', 'cross-origin-isolated=*;',
    'cross-origin-isolated=*, unsupported=(unclosed',
    'cross-origin-isolated="https://bücher.test"',
  ])('returns an empty declared policy for an absent, empty, or malformed field: %j', (value) => {
    const policy = parsePolicy(value);
    expect(policy.declarations.size).toBe(0);
    expect(policy.reportingConfiguration.size).toBe(0);
  });

  it('selects enforced and report-only headers independently', () => {
    const response = new FetchResponse();
    response.headerList.append('permissions-policy', 'cross-origin-isolated=();report-to=enforced');
    response.headerList.append('Permissions-Policy-Report-Only', 'cross-origin-isolated=*;report-to=observed');
    const enforced = DeclaredPermissionsPolicy.fromResponse(response, responseOrigin, false);
    const observed = DeclaredPermissionsPolicy.fromResponse(response, responseOrigin, true);
    expect(enforced.declarations.get(feature)!.matches(responseOrigin)).toBe(false);
    expect(observed.declarations.get(feature)!.matches(responseOrigin)).toBe(true);
    expect(enforced.reportingConfiguration.get(feature)).toBe('enforced');
    expect(observed.reportingConfiguration.get(feature)).toBe('observed');
  });

  it('ignores unsupported feature names and their reporting destinations', () => {
    const policy = parsePolicy('unknown=*;report-to=unused, persistent-storage=(), cross-origin-isolated=self');
    expect([...policy.declarations.keys()]).toEqual([feature]);
    expect(policy.reportingConfiguration.size).toBe(0);
  });

  it('combines repeated fields and uses the last dictionary member for duplicate names', () => {
    const response = new FetchResponse();
    response.headerList.append('Permissions-Policy', 'cross-origin-isolated=*;report-to=first');
    response.headerList.append('Permissions-Policy', 'cross-origin-isolated=()');
    const policy = DeclaredPermissionsPolicy.fromResponse(response, responseOrigin, false);
    expect(policy.declarations.get(feature)!.matches(responseOrigin)).toBe(false);
    expect(policy.reportingConfiguration.size).toBe(0);
  });

  it.each(['self', '(self)'])('captures the response origin for %s', (value) => {
    const list = parseAllowlist(value);
    expect(list.matches(responseOrigin)).toBe(true);
    expect(list.matches(otherOrigin)).toBe(false);
  });

  it('retains the identity of an opaque self origin', () => {
    const opaque = createOpaqueOrigin();
    const list = parseAllowlist('self', opaque);
    expect(list.matches(opaque)).toBe(true);
    expect(list.matches(createOpaqueOrigin())).toBe(false);
  });

  it.each(['*', '(self "https://other.test" * ?0)'])('lets the wildcard dominate: %s', (value) => {
    const list = parseAllowlist(value);
    expect(list.matches(responseOrigin)).toBe(true);
    expect(list.matches(createOpaqueOrigin())).toBe(true);
    expect(list.selfOrigin).toBeNull();
    expect(list.expressions.size).toBe(0);
  });

  it.each(['"https://other.test"', '("https://other.test")'])(
    'accepts source strings both alone and in lists: %s', (value) => {
      const list = parseAllowlist(value);
      expect(list.matches(otherOrigin)).toBe(true);
      expect(list.matches(responseOrigin)).toBe(false);
    },
  );

  it('accepts scheme and host expressions without converting them to URL origins', () => {
    const list = parseAllowlist('(self "https://*.allowed.test:*" "http:" "https://xn--bcher-kva.test")');
    expect(list.matches(responseOrigin)).toBe(true);
    expect(list.matches(origin('https://sub.allowed.test:8443/'))).toBe(true);
    expect(list.matches(origin('http://another.test/'))).toBe(true);
    expect(list.matches(origin('https://bücher.test/'))).toBe(true);
    expect(list.matches(origin('ftp://other.test/'))).toBe(false);
  });

  it('keeps strings named self and * distinct from the special tokens', () => {
    const self = parseAllowlist('"self"');
    expect(self.selfOrigin).toBeNull();
    expect(self.matches(responseOrigin)).toBe(false);
    expect(self.matches(origin('https://self/'))).toBe(true);
    const wildcard = parseAllowlist('"*"');
    expect(wildcard.matchesAllOrigins).toBe(false);
    expect(wildcard.matches(otherOrigin)).toBe(true);
    expect(wildcard.matches(createOpaqueOrigin())).toBe(false);
  });

  // SPEC_CLASH(permissions-policy-header-values): §5.2 ignores invalid single values;
  // Chromium instead retains an empty allowlist for these members.
  it.each(['?1', '42', '1.5', ':aGk=:', '@0', '%"self"', 'unknown', 'Self', '"not a source"', '"\'self\'"'])(
    'ignores the entire invalid member, including its endpoint: %s', (value) => {
      const policy = parsePolicy(`cross-origin-isolated=${value};report-to=unused`);
      expect(policy.declarations.has(feature)).toBe(false);
      expect(policy.reportingConfiguration.has(feature)).toBe(false);
    },
  );

  it.each(['()', '(?1 42 unknown "not a source")'])(
    'retains an empty allowlist when a list has no valid items: %s', (value) => {
      const list = parseAllowlist(value);
      expect(list.matches(responseOrigin)).toBe(false);
      expect(list.matches(otherOrigin)).toBe(false);
      expect(list.matches(createOpaqueOrigin())).toBe(false);
    },
  );

  it('discards invalid list entries without losing valid siblings', () => {
    const list = parseAllowlist('(?1 42 src "\'self\'" self "https://other.test")');
    expect(list.matches(responseOrigin)).toBe(true);
    expect(list.matches(otherOrigin)).toBe(true);
    expect(list.matches(origin('https://unlisted.test/'))).toBe(false);
    expect(list.srcOrigin).toBeNull();
  });

  it.each([
    'https://user@other.test', 'https://other.test?query', 'https://other.test#fragment',
    'https://other.test/a;b', 'https://other.test/a,b', 'https://other.test/%ZZ',
    'https://other.test//path', 'https://[::1]',
  ])('ignores strings outside the scheme/host grammar: %s', (invalid) => {
    const list = parseAllowlist(`("${invalid}" self)`);
    expect([...list.expressions]).toEqual([]);
    expect(list.matches(responseOrigin)).toBe(true);
  });

  it('retains permitted source paths and case instead of normalizing them as URLs', () => {
    const expression = 'https://*.EXAMPLE.test.:8443/a%20b/c/';
    expect([...parseAllowlist(`"${expression}"`).expressions]).toEqual([expression]);
  });

  it.each([
    ['self;report-to=reports', 'reports'],
    ['();report-to=reports', 'reports'],
    ['"https://other.test";report-to=reports', 'reports'],
    ['self;report-to=first;report-to=last', 'last'],
    ['self;report-to="reports"', undefined],
    ['self;report-to=?1', undefined],
    ['(self;report-to=inner)', undefined],
    ['(self;report-to=inner);report-to=outer;ignored=value', 'outer'],
  ])('uses only a token-valued member report-to parameter: %s', (value, endpoint) => {
    const policy = parsePolicy(`cross-origin-isolated=${value}`);
    expect(policy.reportingConfiguration.get(feature)).toBe(endpoint);
    expect(policy.declarations.has(feature)).toBe(true);
  });

  it('returns independent policy maps and allowlists for repeated parses', () => {
    const first = parsePolicy('cross-origin-isolated=self;report-to=reports');
    const second = parsePolicy('cross-origin-isolated=self;report-to=reports');
    first.declarations.get(feature)!.matchesAllOrigins = true;
    first.declarations.clear();
    first.reportingConfiguration.clear();
    expect(second.declarations.get(feature)!.matches(otherOrigin)).toBe(false);
    expect(second.reportingConfiguration.get(feature)).toBe('reports');
  });
});

function parsePolicy(value: string | null, sourceOrigin = responseOrigin): DeclaredPermissionsPolicy {
  const response = new FetchResponse();
  if (value !== null) response.headerList.append('Permissions-Policy', value);
  return DeclaredPermissionsPolicy.fromResponse(response, sourceOrigin, false);
}

function parseAllowlist(value: string, sourceOrigin = responseOrigin): PermissionsPolicyAllowlist {
  const list = parsePolicy(`cross-origin-isolated=${value}`, sourceOrigin).declarations.get(feature);
  expect(list).toBeDefined();
  return list!;
}

function origin(input: string): Origin {
  return obtainURLOrigin(parseURL(input).url!);
}
