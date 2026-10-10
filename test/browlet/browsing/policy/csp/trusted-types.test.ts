import { describe, expect, it } from 'vitest';
import type { Window as PlatformWindow } from '../../../../../src/browlet/platform';
import { ContentSecurityPolicy, type CSPDisposition } from '../../../../../src/browlet/browsing/policy/csp/policy';
import { createCSPWindow } from './fixture';

describe('CSP Trusted Types policy creation', () => {
  it.each([
    ['trusted-types app', 'app'],
    ["trusted-types 'none' app", 'app'],
    ['trusted-types app ABC _.-#=/@%09', 'ABC'],
    ['trusted-types app ABC _.-#=/@%09', '_.-#=/@%09'],
    ['trusted-types *', 'not a CSP token'],
    ['trusted-types *', ''],
    ["default-src 'none'", 'unrestricted'],
    ['trusted-types *invalid app', 'app'],
  ])('allows %s to create %s', (directive, name) => {
    const { factory, runTask } = createPolicyWindow(directive);
    expect(factory.createPolicy(name).name).toBe(name);
    expect(runTask()).toBe(false);
  });

  it.each([
    ['trusted-types app', 'App'],
    ['trusted-types', 'app'],
    ["trusted-types 'none'", 'none'],
    ["trusted-types 'NONE'", 'app'],
    ["trusted-types 'allow-duplicates'", 'app'],
    ['trusted-types *invalid', 'app'],
    ["trusted-types 'app'", "'app'"],
  ])('blocks %s from creating %s', (directive, name) => {
    const { factory, window } = createPolicyWindow(directive);
    expect(() => factory.createPolicy(name)).toThrow(window.TypeError);
  });

  it('reserves successful names, rejects duplicates, and does not reserve blocked names', () => {
    const { factory, window, document } = createPolicyWindow('trusted-types app');
    const original = factory.createPolicy('app');
    expect(() => factory.createPolicy('app')).toThrow(window.TypeError);
    expect(() => factory.createPolicy('later')).toThrow(window.TypeError);
    document.policyContainer.cspList!.policies = [ContentSecurityPolicy.parse('trusted-types later', 'header', 'enforce')];
    expect(factory.createPolicy('later').name).toBe('later');
    expect(original.name).toBe('app');
  });

  it('allows duplicate names with the keyword, while the factory still permits only one default', () => {
    const { factory, window, runTask } = createPolicyWindow("trusted-types * 'ALLOW-DUPLICATES'");
    expect(factory.createPolicy('app')).not.toBe(factory.createPolicy('app'));
    const policy = factory.createPolicy('default');
    expect(() => factory.createPolicy('default')).toThrow(window.TypeError);
    expect(factory.defaultPolicy).toBe(policy);
    // SPEC_CLASH(trusted-types-policy-creation): Spec/Firefox reject here without a CSP violation.
    expect(runTask()).toBe(false);
  });

  it('reports every violated policy with its disposition and the first 40 characters of the name', () => {
    const { factory, window, document, scope, runTask } = createPolicyWindow("trusted-types 'none'; report-to violations");
    document.policyContainer.cspList!.policies.push(
      ContentSecurityPolicy.parse('trusted-types another; report-to violations', 'header', 'report'),
      ContentSecurityPolicy.parse('trusted-types *', 'header', 'enforce'),
    );
    const events: SecurityPolicyViolationEvent[] = [];
    window.document.addEventListener('securitypolicyviolation', (event) => events.push(event));
    expect(() => factory.createPolicy('a'.repeat(45))).toThrow(window.TypeError);
    expect(events).toHaveLength(0);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(false);
    expect(events.map((event) => [event.effectiveDirective, event.blockedURI, event.sample, event.disposition])).toEqual([
      ['trusted-types', 'trusted-types-policy', 'a'.repeat(40), 'enforce'],
      ['trusted-types', 'trusted-types-policy', 'a'.repeat(40), 'report'],
    ]);
    expect(events.every((event) => event.target === window.document && event.isTrusted)).toBe(true);
    expect(scope.reports).toHaveLength(2);
    expect(scope.reports.map((report) => report.type)).toEqual(['csp-violation', 'csp-violation']);
  });

  it('reports without blocking in report-only mode, including duplicate policy creation', () => {
    const { factory, window, runTask } = createPolicyWindow('trusted-types app', 'report');
    const samples: string[] = [];
    window.document.addEventListener('securitypolicyviolation', (event) => samples.push(event.sample));
    const first = factory.createPolicy('app');
    expect(factory.createPolicy('app')).not.toBe(first);
    expect(factory.createPolicy('other').name).toBe('other');
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(false);
    expect(samples).toEqual(['app', 'other']);
  });

  it('finishes argument conversion before checking CSP, without reporting conversion errors', () => {
    const { factory, window, runTask } = createPolicyWindow("trusted-types 'none'");
    const calls: string[] = [];
    const name = { toString() { calls.push('name'); return 'app'; } };
    expect(() => factory.createPolicy(name as unknown as string, {
      get createHTML() { calls.push('callback'); return 7 as never; },
    })).toThrow(window.TypeError);
    expect(calls).toEqual(['name', 'callback']);
    expect(runTask()).toBe(false);
  });

  it('observes policy creation performed by a dictionary getter before checking duplicate names', () => {
    const { factory, window } = createPolicyWindow('trusted-types app');
    expect(() => factory.createPolicy('app', {
      get createHTML() {
        factory.createPolicy('app');
        return (value: string) => value;
      },
    })).toThrow(window.TypeError);
  });

  it('uses the receiver factory CSP and history when another realm supplies the method', () => {
    const restricted = createPolicyWindow("trusted-types 'none'");
    const open = createPolicyWindow();
    expect(() => open.factory.createPolicy.call(restricted.factory, 'app')).toThrow(open.window.TypeError);
    expect(restricted.factory.createPolicy.call(open.factory, 'app').name).toBe('app');
  });
});

/** Projected APIs from the existing CSP Window fixture, typed with Browlet's declarations. */
function createPolicyWindow(serialized = '', disposition: CSPDisposition = 'enforce') {
  const fixture = createCSPWindow(serialized, disposition);
  return { ...fixture, factory: (fixture.window as unknown as PlatformWindow).trustedTypes };
}
