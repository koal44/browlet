import { describe, expect, it } from 'vitest';

import { PolicyContainer } from '../../../../src/browlet/browsing/policy/index';
import { ContentSecurityPolicy, CSPDirectiveValue, CSPList } from '../../../../src/browlet/browsing/policy/csp/index';
import { areSameOrigin, createOpaqueOrigin, obtainURLOrigin, parseURL, type Origin } from '../../../../src/url/index';

describe('Policy container host snapshots', () => {
  it('preserves the distinction between an uninitialized and an empty CSP list', () => {
    const original = new PolicyContainer();
    const restored = PolicyContainer.fromSnapshot(structuredClone(original.toSnapshot()));
    expect(restored.cspList).toBeUndefined();
    expect(restored.clone()).toEqual(original);
    original.cspList = new CSPList(createOpaqueOrigin());
    const empty = PolicyContainer.fromSnapshot(structuredClone(original.toSnapshot()));
    expect(empty.cspList!.policies).toEqual([]);
    expect(areSameOrigin(empty.cspList!.selfOrigin, original.cspList.selfOrigin)).toBe(true);
  });

  it('restores parsed CSP behavior, delivery order, and diagnostics without reparsing source text', () => {
    const url = parseURL('https://[::1]:8443/worker.js').url!;
    const original = createPolicies(obtainURLOrigin(url));
    const csp = original.cspList!;
    const first = csp.policies[0]!;
    // Meta processing and other policy owners may change parsed directives after
    // retaining the original text for reports. Transport must preserve both.
    first.directives.set('worker-src', new CSPDirectiveValue(["'self'"]));
    const restored = PolicyContainer.fromSnapshot(structuredClone(original.toSnapshot()));
    const policies = restored.cspList!.policies;
    expect(policies.map((policy) => [policy.source, policy.disposition])).toEqual([
      ['header', 'enforce'], ['meta', 'enforce'], ['header', 'report'],
    ]);
    expect(policies[0]!.serialized).toBe("worker-src 'none'; worker-src *");
    expect(policies[0]!.parsingWarnings).toEqual(first.parsingWarnings);
    const directive = policies[0]!.directives.getFetchDirective('worker-src')!;
    const sources = policies[0]!.directives.get(directive)!;
    expect(sources.matchesURL(url, restored.cspList!.selfOrigin, 0)).toBe(true);
    expect(sources.matchesURL(parseURL('https://other.test/worker.js').url!, restored.cspList!.selfOrigin, 0)).toBe(false);
    expect(restored.clone()).toEqual(original);
  });

  it('detaches the captured and restored policy lists and tuple-origin records in both directions', () => {
    const origin = obtainURLOrigin(parseURL('https://[::1]:8443/').url!);
    const original = createPolicies(origin);
    const snapshot = original.toSnapshot();
    const restored = PolicyContainer.fromSnapshot(snapshot);
    original.cspList!.policies[0]!.directives.get('worker-src')!.tokens.push('*');
    original.cspList!.policies[0]!.parsingWarnings.push('later diagnostic');
    original.cspList!.policies.pop();
    if (origin.kind !== 'tuple' || origin.host.kind !== 'ipv6') throw new Error('Expected an IPv6 origin');
    origin.host.pieces[7] = 2;
    expect(snapshot.cspList!.policies[0]!.directives.get('worker-src')).toEqual(["'none'"]);
    expect(snapshot.cspList!.policies[0]!.parsingWarnings).toHaveLength(1);
    expect(snapshot.cspList!.policies).toHaveLength(3);
    expect(areSameOrigin(snapshot.cspList!.selfOrigin, origin)).toBe(false);
    snapshot.cspList!.policies[0]!.directives.get('worker-src')!.push('*');
    snapshot.cspList!.policies[0]!.parsingWarnings.push('snapshot diagnostic');
    const copiedOrigin = snapshot.cspList!.selfOrigin;
    if (copiedOrigin.kind !== 'tuple' || copiedOrigin.host.kind !== 'ipv6') throw new Error('Expected an IPv6 origin');
    copiedOrigin.host.pieces[7] = 3;
    expect(restored.cspList!.policies[0]!.directives.get('worker-src')!.tokens).toEqual(["'none'"]);
    expect(restored.cspList!.policies[0]!.parsingWarnings).toHaveLength(1);
    expect(areSameOrigin(restored.cspList!.selfOrigin, copiedOrigin)).toBe(false);
  });

  it('preserves opaque self identity without replacing it with another null-serializing origin', () => {
    const origin = createOpaqueOrigin(true);
    const original = createPolicies(origin);
    const restored = PolicyContainer.fromSnapshot(structuredClone(original.toSnapshot()));
    expect(areSameOrigin(restored.cspList!.selfOrigin, origin)).toBe(true);
    expect(areSameOrigin(restored.cspList!.selfOrigin, createOpaqueOrigin(true))).toBe(false);
    expect(restored.cspList!.selfOrigin).not.toBe(origin);
  });

  it('retains COEP, referrer, and both integrity policies with independent mutable lists', () => {
    const original = new PolicyContainer();
    original.embedderPolicy.value = 'require-corp';
    original.embedderPolicy.reportingEndpoint = 'enforced';
    original.embedderPolicy.reportOnlyValue = 'credentialless';
    original.embedderPolicy.reportOnlyReportingEndpoint = 'monitored';
    original.referrerPolicy = 'no-referrer';
    for (const name of ['integrityPolicy', 'reportOnlyIntegrityPolicy'] as const) {
      original[name].sources.push('inline');
      original[name].blockedDestinations.push(name === 'integrityPolicy' ? 'script' : 'style');
      original[name].endpoints.push(name);
    }
    const snapshot = original.toSnapshot();
    const restored = PolicyContainer.fromSnapshot(snapshot);
    expect(restored.clone()).toEqual(original);
    original.embedderPolicy.value = 'unsafe-none';
    snapshot.embedderPolicy.reportOnlyValue = 'unsafe-none';
    expect(restored.embedderPolicy.value).toBe('require-corp');
    expect(restored.embedderPolicy.reportOnlyValue).toBe('credentialless');
    expect(restored.referrerPolicy).toBe('no-referrer');
    for (const name of ['integrityPolicy', 'reportOnlyIntegrityPolicy'] as const) {
      original[name].sources.length = 0;
      original[name].blockedDestinations.length = 0;
      original[name].endpoints.length = 0;
      expect(snapshot[name].sources).toEqual(['inline']);
      expect(snapshot[name].blockedDestinations).toEqual([name === 'integrityPolicy' ? 'script' : 'style']);
      expect(snapshot[name].endpoints).toEqual([name]);
      snapshot[name].sources.length = 0;
      snapshot[name].blockedDestinations.length = 0;
      snapshot[name].endpoints.length = 0;
      expect(restored[name].sources).toEqual(['inline']);
      expect(restored[name].blockedDestinations).toEqual([name === 'integrityPolicy' ? 'script' : 'style']);
      expect(restored[name].endpoints).toEqual([name]);
    }
  });
});

function createPolicies(origin: Origin): PolicyContainer {
  const container = new PolicyContainer();
  container.cspList = new CSPList(origin);
  container.cspList.policies.push(
    ContentSecurityPolicy.parse("worker-src 'none'; worker-src *", 'header', 'enforce'),
    ContentSecurityPolicy.parse("script-src 'none'", 'meta', 'enforce'),
    ContentSecurityPolicy.parse("default-src 'none'; report-to monitor", 'header', 'report'),
  );
  return container;
}
