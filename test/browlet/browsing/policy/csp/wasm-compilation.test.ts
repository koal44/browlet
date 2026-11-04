import { describe, expect, it } from 'vitest';

import type { SecurityPolicyViolationEvent } from '../../../../../src/browlet/platform';
import { ContentSecurityPolicy } from '../../../../../src/browlet/browsing/policy/csp/policy';
import { createCSPWindow } from './fixture';

describe('CSP §4.5.1 Wasm compilation', () => {
  it.each([
    ['', false],
    ["script-src 'self'", true],
    ["default-src 'none'", true],
    ["script-src 'wasm-unsafe-eval'; default-src 'none'", false],
    ["script-src 'none'; default-src 'wasm-unsafe-eval'", true],
    ["script-src; default-src 'unsafe-eval'", true],
    ["default-src 'WaSm-UnSaFe-EvAl'", false],
    ["script-src 'UnSaFe-EvAl'", false],
    ["script-src 'unsafe-inline' 'nonce-abc' 'strict-dynamic' https://example.test", true],
    ["script-src-elem 'none'; script-src-attr 'none'", false],
    ["script-src-elem 'wasm-unsafe-eval'; default-src 'none'", true],
    ["style-src 'none'", false],
    ["script-src 'trusted-types-eval'; require-trusted-types-for 'script'", true],
  ])('checks %s (blocked: %s)', (serialized, blocked) => {
    const { document, env, runTask } = createCSPWindow(serialized);
    expect(document.policyContainer.cspList!.isWasmCompilationBlocked(env)).toBe(blocked);
    expect(runTask()).toBe(blocked);
    expect(runTask()).toBe(false);
  });

  it('reports every violated policy, using script-src and wasm-eval with an empty sample', () => {
    const { window, document, env, scope, runTask } = createCSPWindow("default-src 'none' 'report-sample'; report-to wasm");
    const policies = document.policyContainer.cspList!;
    policies.policies.push(
      ContentSecurityPolicy.parse("script-src 'self'; report-to wasm", 'header', 'report'),
      ContentSecurityPolicy.parse("script-src 'none'; report-to wasm", 'header', 'enforce'),
      ContentSecurityPolicy.parse("script-src 'wasm-unsafe-eval'", 'header', 'enforce'),
    );
    const events: SecurityPolicyViolationEvent[] = [];
    window.document.addEventListener('securitypolicyviolation', (event) => events.push(event));
    expect(policies.isWasmCompilationBlocked(env)).toBe(true);
    expect(events).toHaveLength(0);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(false);
    expect(events.map((event) => [event.effectiveDirective, event.blockedURI, event.disposition, event.sample])).toEqual([
      ['script-src', 'wasm-eval', 'enforce', ''],
      ['script-src', 'wasm-eval', 'report', ''],
      ['script-src', 'wasm-eval', 'enforce', ''],
    ]);
    expect(events.every((event) => event.isTrusted && event.target === window.document)).toBe(true);
    expect(scope.reports).toHaveLength(3);
    for (const report of scope.reports) {
      expect(report.data).toMatchObject({ blockedURL: 'wasm-eval', effectiveDirective: 'script-src', sample: '' });
    }
  });

  it('reports a monitored restriction without blocking', () => {
    const { document, env, scope, runTask } = createCSPWindow("script-src 'none' 'report-sample'; report-to wasm", 'report');
    expect(document.policyContainer.cspList!.isWasmCompilationBlocked(env)).toBe(false);
    expect(runTask()).toBe(true);
    expect(scope.reports[0]!.data).toMatchObject({ blockedURL: 'wasm-eval', disposition: 'report', sample: '' });
    expect(runTask()).toBe(false);
  });
});
