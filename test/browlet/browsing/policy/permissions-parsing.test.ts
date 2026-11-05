import { describe, expect, it } from 'vitest';

import { PermissionsPolicy, type PermissionsPolicyAllowlist } from '../../../../src/browlet/browsing/policy/permissions-policy/policy';
import { createOpaqueOrigin, obtainURLOrigin, parseURL, type Origin } from '../../../../src/url/index';

const containerOrigin = origin('https://parent.test/');
const targetOrigin = origin('https://child.test/');
const feature = [...new PermissionsPolicy().inheritedPolicy.keys()]
  .find((entry) => entry.name === 'cross-origin-isolated')!;

describe('Permissions Policy §5.1 / §9.3: attribute parsing', () => {
  it.each(['', ' ; \t\n; ', 'not-a-feature *', 'Cross-origin-isolated *', 'persistent-storage *'])(
    'ignores empty or unsupported declarations: %j', (value) => {
      expect(PermissionsPolicy.parseDirective(value, containerOrigin, targetOrigin).size).toBe(0);
    },
  );

  it('splits declarations on semicolons and tokens on ASCII whitespace', () => {
    const directive = PermissionsPolicy.parseDirective(
      " ; not-a-feature *; \t cross-origin-isolated\n'SELF'\fhttps://other.test/\r ; ",
      containerOrigin, targetOrigin,
    );
    expect([...directive.keys()]).toEqual([feature]);
    expect(directive.get(feature)!.selfOrigin).toBe(containerOrigin);
    expect([...directive.get(feature)!.expressions]).toEqual(['https://other.test']);
  });

  it.each(['\u00a0', '\v', ','])('does not treat %j as a token separator', (separator) => {
    expect(PermissionsPolicy.parseDirective(`cross-origin-isolated${separator}*`, containerOrigin).size).toBe(0);
  });

  it('keeps the first recognized declaration, even when it allows no origins', () => {
    const list = parseAllowlist("cross-origin-isolated 'none'; cross-origin-isolated *", targetOrigin);
    expect(list.matchesAllOrigins).toBe(false);
    expect(list.matches(containerOrigin)).toBe(false);
    expect(list.matches(targetOrigin)).toBe(false);
  });

  it('retains the first wildcard rather than applying a later restriction', () => {
    const list = parseAllowlist("cross-origin-isolated *; cross-origin-isolated 'none'");
    expect(list.matches(createOpaqueOrigin())).toBe(true);
  });

  it('uses the declared target origin when a feature has no listed origins', () => {
    const list = parseAllowlist('cross-origin-isolated', targetOrigin);
    expect(list.srcOrigin).toBe(targetOrigin);
    expect(list.selfOrigin).toBeNull();
    expect(list.matches(targetOrigin)).toBe(true);
    expect(list.matches(containerOrigin)).toBe(false);
  });

  it.each(['cross-origin-isolated', "cross-origin-isolated 'src'"])(
    'has no implicit target when none is supplied: %s', (value) => {
      const list = parseAllowlist(value);
      expect(list.srcOrigin).toBeNull();
      expect(list.matches(containerOrigin)).toBe(false);
      expect(list.matches(targetOrigin)).toBe(false);
    },
  );

  it('resolves self and src keywords case-insensitively to their distinct origins', () => {
    const list = parseAllowlist("cross-origin-isolated 'SeLf' 'sRc'", targetOrigin);
    expect(list.selfOrigin).toBe(containerOrigin);
    expect(list.srcOrigin).toBe(targetOrigin);
    expect(list.expressions.size).toBe(0);
    expect(list.matches(containerOrigin)).toBe(true);
    expect(list.matches(targetOrigin)).toBe(true);
  });

  it.each(['cross-origin-isolated', "cross-origin-isolated 'src'"])(
    'preserves a supplied opaque target identity: %s', (value) => {
      const opaque = createOpaqueOrigin();
      const list = parseAllowlist(value, opaque);
      expect(list.srcOrigin).toBe(opaque);
      expect(list.matches(opaque)).toBe(true);
      expect(list.matches(createOpaqueOrigin())).toBe(false);
    },
  );

  it('preserves an opaque container identity for self', () => {
    const opaque = createOpaqueOrigin();
    const list = PermissionsPolicy.parseDirective("cross-origin-isolated 'self'", opaque).get(feature)!;
    expect(list.selfOrigin).toBe(opaque);
    expect(list.matches(opaque)).toBe(true);
    expect(list.matches(createOpaqueOrigin())).toBe(false);
  });

  it('lets the wildcard dominate the remaining allowlist values', () => {
    const list = parseAllowlist("cross-origin-isolated 'none' 'self' https://other.test * 'src'", targetOrigin);
    expect(list.matchesAllOrigins).toBe(true);
    expect(list.expressions.size).toBe(0);
    expect(list.selfOrigin).toBeNull();
    expect(list.srcOrigin).toBeNull();
    expect(list.matches(createOpaqueOrigin())).toBe(true);
  });

  it('ignores none beside valid entries without replacing them', () => {
    const list = parseAllowlist("cross-origin-isolated 'none' 'self' https://other.test/");
    expect(list.matches(containerOrigin)).toBe(true);
    expect(list.matches(origin('https://other.test/'))).toBe(true);
    expect(list.matches(targetOrigin)).toBe(false);
  });

  it('stores unique serialized origins after URL parsing, in insertion order', () => {
    const list = parseAllowlist('cross-origin-isolated https://EXAMPLE.test:443/path?query#fragment ' +
      'https://other.test/ https://example.test/ https://example.test:8443/ https://[::1]/path');
    expect([...list.expressions]).toEqual([
      'https://example.test', 'https://other.test', 'https://example.test:8443', 'https://[::1]',
    ]);
    expect(list.matches(origin('https://example.test/unrelated'))).toBe(true);
  });

  it('uses URL normalization for internationalized hostnames, as required by the draft', () => {
    const list = parseAllowlist('cross-origin-isolated https://bücher.test/path');
    expect([...list.expressions]).toEqual(['https://xn--bcher-kva.test']);
    expect(list.matches(origin('https://xn--bcher-kva.test/'))).toBe(true);
  });

  it.each([
    'not-a-url', '/relative', 'https:', 'https://', '"https://other.test"',
    'https://user@other.test/', 'https://:password@other.test/',
    'blob:https://other.test/id', 'data:text/plain,hello', 'file:///tmp/page', 'javascript:1',
  ])('ignores %j without falling back to the target or losing a valid sibling', (invalid) => {
    const list = parseAllowlist(`cross-origin-isolated ${invalid} https://allowed.test/`, targetOrigin);
    expect([...list.expressions]).toEqual(['https://allowed.test']);
    expect(list.srcOrigin).toBeNull();
    expect(list.matches(targetOrigin)).toBe(false);
    expect(list.matches(origin('https://allowed.test/'))).toBe(true);
  });

  it('returns independent maps and allowlists for separate parses', () => {
    const first = PermissionsPolicy.parseDirective("cross-origin-isolated 'self'", containerOrigin);
    const second = PermissionsPolicy.parseDirective("cross-origin-isolated 'self'", containerOrigin);
    first.get(feature)!.matchesAllOrigins = true;
    first.get(feature)!.expressions.add('https://other.test');
    first.clear();
    expect(second.get(feature)!.matches(targetOrigin)).toBe(false);
    expect(second.get(feature)!.expressions.size).toBe(0);
  });
});

function parseAllowlist(value: string, target?: Origin): PermissionsPolicyAllowlist {
  const list = PermissionsPolicy.parseDirective(value, containerOrigin, target).get(feature);
  expect(list).toBeDefined();
  return list!;
}

function origin(input: string): Origin {
  return obtainURLOrigin(parseURL(input).url!);
}
