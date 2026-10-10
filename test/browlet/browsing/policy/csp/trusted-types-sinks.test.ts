import { describe, expect, it } from 'vitest';
import type { SecurityPolicyViolationEvent } from '../../../../../src/browlet/platform';
import { ContentSecurityPolicy } from '../../../../../src/browlet/browsing/policy/csp/policy';
import { createTrustedTypesWindow } from '../trusted-types/fixture';

describe('CSP Trusted Types sink requirements', () => {
  it.each([
    ['', false],
    ['require-trusted-types-for', false],
    ['require-trusted-types-for script', false],
    ["require-trusted-types-for 'style'", false],
    ["require-trusted-types-for 'script'-invalid", false],
    ["require-trusted-types-for invalid 'script'", true],
    ["require-trusted-types-for 'SCRIPT'", true],
  ])('honors the script group in %s (required: %s)', (serialized, required) => {
    const { window, document } = createTrustedTypesWindow(serialized);
    const list = document.policyContainer.cspList!;
    expect(list.doesSinkTypeRequireTrustedTypes('script', true)).toBe(required);
    expect(list.doesSinkTypeRequireTrustedTypes('style', true)).toBe(false);
    const element = window.document.createElement('iframe');
    if (required) { expect(() => element.setAttribute('srcdoc', 'input')).toThrow(window.TypeError); }
    else {
      element.setAttribute('srcdoc', 'input');
      expect(element.getAttribute('srcdoc')).toBe('input');
    }
  });

  it('reports mismatches for all applicable policies and blocks if any enforces', () => {
    const { window, document, runTask, scope } = createTrustedTypesWindow("require-trusted-types-for 'script'; report-to violations");
    document.policyContainer.cspList!.policies.push(
      ContentSecurityPolicy.parse("require-trusted-types-for 'script'; report-to violations", 'header', 'report'),
      ContentSecurityPolicy.parse('trusted-types *', 'header', 'enforce'),
    );
    const events: SecurityPolicyViolationEvent[] = [];
    window.document.addEventListener('securitypolicyviolation', (event) => events.push(event as SecurityPolicyViolationEvent));
    const element = window.document.createElement('iframe');
    const input = 'a'.repeat(45);
    expect(() => element.setAttribute('srcdoc', input)).toThrow(window.TypeError);
    expect(events).toHaveLength(0);
    expect(element.hasAttributes()).toBe(false);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(false);
    expect(events.map((event) => [event.effectiveDirective, event.blockedURI, event.sample, event.disposition])).toEqual([
      ['require-trusted-types-for', 'trusted-types-sink', `HTMLIFrameElement srcdoc|${'a'.repeat(40)}`, 'enforce'],
      ['require-trusted-types-for', 'trusted-types-sink', `HTMLIFrameElement srcdoc|${'a'.repeat(40)}`, 'report'],
    ]);
    expect(events.every((event) => event.target === window.document && event.isTrusted)).toBe(true);
    expect(events[0]!.documentURI).toBe('https://protected.test/page');
    expect(events[0]!.statusCode).toBe(201);
    expect(scope.reports.map((report) => report.type)).toEqual(['csp-violation', 'csp-violation']);
    expect(scope.reports.map((report) => report.body)).toEqual([
      expect.objectContaining({ blockedURL: 'trusted-types-sink', sample: `HTMLIFrameElement srcdoc|${'a'.repeat(40)}` }),
      expect.objectContaining({ blockedURL: 'trusted-types-sink', disposition: 'report' }),
    ]);
  });

  it.each([false, true])('allows a report-only mismatch (rejecting default policy: %s)', (defaultPolicy) => {
    const { window, document, runTask } = createTrustedTypesWindow("require-trusted-types-for 'script'", 'report');
    expect(document.policyContainer.cspList!.doesSinkTypeRequireTrustedTypes('script', false)).toBe(false);
    const samples: string[] = [];
    window.document.addEventListener('securitypolicyviolation', (event) => samples.push((event as SecurityPolicyViolationEvent).sample));
    if (defaultPolicy) window.trustedTypes.createPolicy('default', { createScript: () => null });
    const element = window.document.createElement('main');
    element.setAttribute('onclick', 'original');
    expect(element.getAttribute('onclick')).toBe('original');
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(false);
    expect(samples).toEqual(['Element onclick|original']);
  });

  it('applies a successful report-only default conversion without generating a violation', () => {
    const { window, runTask } = createTrustedTypesWindow("require-trusted-types-for 'script'", 'report');
    window.trustedTypes.createPolicy('default', { createHTML: (value) => `checked:${value}` });
    const element = window.document.createElement('iframe');
    element.setAttribute('srcdoc', 'input');
    expect(element.getAttribute('srcdoc')).toBe('checked:input');
    expect(runTask()).toBe(false);
  });
});
