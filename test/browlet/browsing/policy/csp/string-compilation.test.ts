import { describe, expect, it } from 'vitest';

import type { SecurityPolicyViolationEvent } from '../../../../../src/browlet/platform';
import { ContentSecurityPolicy } from '../../../../../src/browlet/browsing/policy/csp/policy';
import { createCSPWindow } from './fixture';

describe('CSP string-compilation source lists', () => {
  it.each([
    ['', false],
    ["script-src 'self'", true],
    ["default-src 'none'", true],
    ["script-src 'unsafe-eval'; default-src 'none'", false],
    ["script-src 'none'; default-src 'unsafe-eval'", true],
    ["script-src; default-src 'unsafe-eval'", true],
    ["default-src 'unsafe-eval'", false],
    ["script-src 'UnSaFe-EvAl'", false],
    ["script-src 'unsafe-inline' 'wasm-unsafe-eval' https://example.test", true],
    ["script-src 'nonce-abc' 'strict-dynamic'", true],
    ["script-src-elem 'none'; script-src-attr 'none'", false],
    ["script-src-elem 'unsafe-eval'; default-src 'none'", true],
    ["style-src 'none'", false],
    ["script-src 'trusted-types-eval'", true],
  ])('checks the applicable source list for %s (blocked: %s)', (serialized, blocked) => {
    const { document, env, runTask } = createCSPWindow(serialized);
    expect(document.policyContainer.cspList!.isStringCompilationBlocked('40 + 2', env)).toBe(blocked);
    expect(runTask()).toBe(blocked);
    expect(runTask()).toBe(false);
  });

  it('reports every violated policy, retaining script-src when default-src supplies the restriction', () => {
    const { window, document, env, scope, runTask } = createCSPWindow("default-src 'none' 'report-sample'; report-to scripts");
    const policies = document.policyContainer.cspList!;
    policies.policies.push(
      ContentSecurityPolicy.parse("script-src 'self'; report-to scripts", 'header', 'report'),
      ContentSecurityPolicy.parse("script-src 'none' 'report-sample'; report-to scripts", 'header', 'enforce'),
      ContentSecurityPolicy.parse("script-src 'unsafe-eval'", 'header', 'enforce'),
    );
    const events: SecurityPolicyViolationEvent[] = [];
    window.document.addEventListener('securitypolicyviolation', (event) => events.push(event));
    const source = `${'x'.repeat(45)} = 1`;
    expect(policies.isStringCompilationBlocked(source, env)).toBe(true);
    expect(events).toHaveLength(0);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(false);
    expect(events.map((event) => [event.effectiveDirective, event.blockedURI, event.disposition, event.sample])).toEqual([
      ['script-src', 'eval', 'enforce', 'x'.repeat(40)],
      ['script-src', 'eval', 'report', ''],
      ['script-src', 'eval', 'enforce', 'x'.repeat(40)],
    ]);
    expect(events.every((event) => event.isTrusted && event.target === window.document)).toBe(true);
    expect(events[0]).toMatchObject({ documentURI: 'https://protected.test/page', statusCode: 201 });
    expect(scope.reports.map((report) => report.data)).toEqual([
      expect.objectContaining({ blockedURL: 'eval', effectiveDirective: 'script-src', sample: 'x'.repeat(40) }),
      expect.objectContaining({ blockedURL: 'eval', disposition: 'report', sample: '' }),
      expect.objectContaining({ blockedURL: 'eval', disposition: 'enforce', sample: 'x'.repeat(40) }),
    ]);
  });

  it('reports a monitored restriction without blocking compilation', () => {
    const { document, env, scope, runTask } = createCSPWindow("script-src 'none' 'report-sample'; report-to scripts", 'report');
    expect(document.policyContainer.cspList!.isStringCompilationBlocked('40 + 2', env)).toBe(false);
    expect(runTask()).toBe(true);
    expect(scope.reports[0]!.data).toMatchObject({ blockedURL: 'eval', disposition: 'report', sample: '40 + 2' });
    expect(runTask()).toBe(false);
  });

  // This exercises only the source-list step, after the algorithm's separate
  // Trusted Types validation. It does not claim native eval enforces that step.
  it.each(['enforce', 'report'] as const)(
    'uses trusted-types-eval only with an enforced requirement (requirement: %s)', (disposition) => {
      const { document, env, runTask } = createCSPWindow("script-src 'TrUsTeD-TyPeS-EvAl'");
      const policies = document.policyContainer.cspList!;
      policies.policies.push(ContentSecurityPolicy.parse("require-trusted-types-for 'script'", 'header', disposition));
      expect(policies.isStringCompilationBlocked('40 + 2', env)).toBe(disposition !== 'enforce');
      expect(runTask()).toBe(disposition !== 'enforce');
      expect(runTask()).toBe(false);
    },
  );
});
