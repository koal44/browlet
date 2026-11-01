import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import {
  PermissionsPolicy, PermissionsPolicyAllowlist, type PolicyControlledFeature,
} from '../../../../src/browlet/browsing/policy/permissions';
import { createOpaqueOrigin, obtainURLOrigin, parseURL, type TupleOrigin } from '../../../../src/url/index';
import { getRelevantRealm } from '../../../support/browlet-binding';
import { createTestDocument } from '../../../support/dom';

describe('Permissions Policy §§4.1–4.2: features and policy state', () => {
  it('starts the supported feature Enabled in an empty policy despite its self default allowlist', () => {
    const policy = new PermissionsPolicy();

    // Defaults govern later feature evaluation; they do not disable an empty inherited policy.
    expect([...policy.inheritedPolicy]).toEqual([
      [{ name: 'cross-origin-isolated', defaultAllowlist: 'self' }, 'Enabled'],
    ]);
    expect(policy.declaredPolicy.declarations.size).toBe(0);
    expect(policy.declaredPolicy.reportingConfiguration.size).toBe(0);
  });

  it('shares feature definitions across browsers while isolating their initial policies', () => {
    const userAgent = new UserAgent();
    const [, document] = BrowsingContext.createTopLevel(userAgent);
    const feature = isolationFeature(document.permissionsPolicyState);
    expect(document.permissionsPolicyState.inheritedPolicy.get(feature)).toBe('Enabled');

    // Permission names and policy feature names are separate registries.
    expect(userAgent.permissionStore.getFeature('persistent-storage')).toBeDefined();
    expect([...document.permissionsPolicyState.inheritedPolicy.keys()].map((entry) => entry.name))
      .not.toContain('persistent-storage');
    const [, other] = BrowsingContext.createTopLevel(new UserAgent());
    expect(isolationFeature(other.permissionsPolicyState)).toBe(feature);
    document.permissionsPolicyState.inheritedPolicy.set(feature, 'Disabled');
    expect(other.permissionsPolicyState.inheritedPolicy.get(feature)).toBe('Enabled');
  });

  it('gives detached Documents independent empty policy state', () => {
    const first = createTestDocument();
    const second = first.createDocumentNode();
    const feature = isolationFeature(first.permissionsPolicyState);

    first.permissionsPolicyState.inheritedPolicy.set(feature, 'Disabled');
    first.permissionsPolicyState.declaredPolicy.declarations.set(feature, allowlist('*'));
    first.permissionsPolicyState.declaredPolicy.reportingConfiguration.set(feature, 'reports');

    expect(second.permissionsPolicyState.inheritedPolicy.get(feature)).toBe('Enabled');
    expect(second.permissionsPolicyState.declaredPolicy.declarations.size).toBe(0);
    expect(second.permissionsPolicyState.declaredPolicy.reportingConfiguration.size).toBe(0);
  });

  it('creates fresh response policy state without changing the previous Document', async () => {
    const browser = new Browlet({ route: () => '' });
    const initial = getRelevantRealm(browser.window).env.getAssociatedDocument()!;
    const feature = isolationFeature(initial.permissionsPolicyState);
    const previous = initial.permissionsPolicyState;
    const previousAllowlist = allowlist('*');
    previous.inheritedPolicy.set(feature, 'Disabled');
    previous.declaredPolicy.declarations.set(feature, previousAllowlist);
    previous.declaredPolicy.reportingConfiguration.set(feature, 'old-reports');

    await browser.navigate('https://example.test/');
    const current = getRelevantRealm(browser.window).env.getAssociatedDocument()!.permissionsPolicyState;
    expect(current.inheritedPolicy.get(feature)).toBe('Enabled');
    expect(current.declaredPolicy.declarations.size).toBe(0);
    expect(current.declaredPolicy.reportingConfiguration.size).toBe(0);
    expect(initial.permissionsPolicyState).toBe(previous);
    expect(previous.inheritedPolicy.get(feature)).toBe('Disabled');
    expect(previous.declaredPolicy.declarations.get(feature)).toBe(previousAllowlist);
    expect(previous.declaredPolicy.reportingConfiguration.get(feature)).toBe('old-reports');
  });
});

describe('Permissions Policy §4.7: allowlist matching', () => {
  it('allows every origin with the policy wildcard, including opaque origins', () => {
    const list = allowlist('*');
    expect(list.matches(origin('https://example.test/'))).toBe(true);
    expect(list.matches(origin('ftp://example.test/'))).toBe(true);
    expect(list.matches(createOpaqueOrigin())).toBe(true);
  });

  it('denies every origin with an empty allowlist', () => {
    expect(allowlist().matches(origin('https://example.test/'))).toBe(false);
    expect(allowlist().matches(createOpaqueOrigin())).toBe(false);
  });

  it.each(['selfOrigin', 'srcOrigin'] as const)('matches %s by origin rather than object identity', (key) => {
    const list = allowlist();
    list[key] = origin('https://example.test/page');

    expect(list.matches(origin('https://example.test:443/other'))).toBe(true);
    expect(list.matches(origin('http://example.test/'))).toBe(false);
    expect(list.matches(origin('https://example.test:8443/'))).toBe(false);
    expect(list.matches(origin('https://other.test/'))).toBe(false);
  });

  it.each(['selfOrigin', 'srcOrigin'] as const)('preserves opaque identity in %s', (key) => {
    const opaque = createOpaqueOrigin();
    const list = allowlist();
    list[key] = opaque;

    expect(list.matches({ ...opaque })).toBe(true);
    expect(list.matches(createOpaqueOrigin())).toBe(false);
    expect(list.matches(origin('https://example.test/'))).toBe(false);
  });

  it.each(['selfOrigin', 'srcOrigin'] as const)('uses same origin-domain for %s', (key) => {
    const first = origin('https://a.example.test:8443/');
    const second = origin('https://b.example.test/');
    const list = allowlist();
    list[key] = first;

    expect(list.matches(second)).toBe(false);
    first.domain = { kind: 'domain', value: 'example.test' };
    expect(list.matches(second)).toBe(false);
    second.domain = { kind: 'domain', value: 'example.test' };
    expect(list.matches(second)).toBe(true);
    expect(list.matches({ ...second, scheme: 'http' })).toBe(false);
  });

  it('accepts any matching self, src, or expression entry', () => {
    const list = allowlist(['https://unused.test', 'https://expression.test']);
    list.selfOrigin = origin('https://self.test/');
    list.srcOrigin = origin('https://src.test/');

    for (const host of ['self.test', 'src.test', 'expression.test']) {
      expect(list.matches(origin(`https://${host}/`))).toBe(true);
    }
    expect(list.matches(origin('https://unlisted.test/'))).toBe(false);
  });

  it('does not match opaque origins through source expressions, even a host wildcard', () => {
    expect(allowlist(['*', 'https:']).matches(createOpaqueOrigin())).toBe(false);
  });

  it.each([
    ['https:', 'https://anywhere.test/', true],
    ['https:', 'http://anywhere.test/', false],
    ['http:', 'https://anywhere.test/', true],
    ['https://example.test', 'https://example.test/', true],
    ['https://example.test', 'https://other.test/', false],
    ['http://example.test', 'https://example.test/', true],
    ['https://example.test', 'http://example.test/', false],
    ['https://*.example.test', 'https://a.b.example.test/', true],
    ['https://*.example.test', 'https://example.test/', false],
    ['https://*.example.test', 'https://notexample.test/', false],
    ['https://example.test:443', 'https://example.test/', true],
    ['https://example.test:8443', 'https://example.test:8443/', true],
    ['https://example.test:8443', 'https://example.test/', false],
    ['https://example.test:*', 'https://example.test:8443/', true],
    ['example.test', 'http://example.test/', true],
    ['example.test', 'https://example.test/', true],
    ['https://EXAMPLE.test', 'https://example.test/', true],
  ] as [string, string, boolean][])('matches expression %s against %s: %s', (expression, target, expected) => {
    expect(allowlist([expression]).matches(origin(target))).toBe(expected);
  });

  it('matches a serialized origin, not the original document URL or a redirect', () => {
    const target = origin('https://example.test/private/page?query#fragment');
    expect(allowlist(['https://example.test/']).matches(target)).toBe(true);
    expect(allowlist(['https://example.test/private/']).matches(target)).toBe(false);
  });

  it('matches source expressions against the actual host even after domain relaxation', () => {
    const target = origin('https://sub.example.test/');
    target.domain = { kind: 'domain', value: 'example.test' };
    expect(allowlist(['https://example.test']).matches(target)).toBe(false);
    expect(allowlist(['https://sub.example.test']).matches(target)).toBe(true);
  });
});

function isolationFeature(policy: PermissionsPolicy): PolicyControlledFeature {
  return [...policy.inheritedPolicy.keys()].find((feature) => feature.name === 'cross-origin-isolated')!;
}

function allowlist(expressions: string[] | '*' = []): PermissionsPolicyAllowlist {
  const list = new PermissionsPolicyAllowlist();
  if (expressions === '*') list.matchesAllOrigins = true;
  else for (const expression of expressions) list.expressions.add(expression);
  return list;
}

function origin(input: string): TupleOrigin {
  const result = obtainURLOrigin(parseURL(input).url!);
  if (result.kind !== 'tuple') throw new Error(`Expected a tuple origin for ${input}`);
  return result;
}
