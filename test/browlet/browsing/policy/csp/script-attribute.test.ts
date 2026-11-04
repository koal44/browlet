import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import type { ElementImpl } from '../../../../../src/browlet/dom/nodes/index';
import { ContentSecurityPolicy } from '../../../../../src/browlet/browsing/policy/csp/policy';
import { CSPDirectiveValue } from '../../../../../src/browlet/browsing/policy/csp/directives';
import { unwrap } from '../../../../support/browlet-binding';
import { createCSPWindow } from './fixture';

// Policy tests complement HTML's inline-event-handlers consumer regressions.
// Exercise decisions directly, with real Window bindings for violation delivery.
describe('CSP script attributes', () => {
  it.each([
    ['', false],
    ["script-src-attr 'none'", true],
    ["script-src-attr 'unsafe-inline'; script-src 'none'; default-src 'none'", false],
    ["script-src-attr; script-src 'unsafe-inline'", true],
    ["script-src 'unsafe-inline'; default-src 'none'", false],
    ["script-src 'none'; default-src 'unsafe-inline'", true],
    ["default-src 'unsafe-inline'", false],
    ["default-src 'none'", true],
    ["script-src-elem 'none'", false],
    ["script-src-elem 'unsafe-inline'; default-src 'none'", true],
    ["style-src-attr 'none'; style-src 'none'", false],
    ["script-src-attr 'self' https://protected.test *", true],
    ["script-src-attr 'unsafe-eval' 'trusted-types-eval' 'wasm-unsafe-eval'", true],
    ["script-src-attr 'UNSAFE-INLINE'", false],
    ["script-src-attr 'unsafe-inline' 'nonce-abc'", true],
    ["script-src-attr 'unsafe-inline' 'sha256-a'", true],
    ["script-src-attr 'unsafe-inline' 'strict-dynamic'", true],
    ["script-src 'unsafe-inline' 'STRICT-DYNAMIC'", true],
    ["script-src-attr 'unsafe-inline'; script-src 'strict-dynamic'", false],
    ["script-src-attr 'unsafe-hashes'", true],
  ])('selects the applicable source list in %s (blocked: %s)', (serialized, blocked) => {
    const { document, runTask } = createCSPWindow(serialized);
    const element = document.createElement('body');
    expect(document.policyContainer.cspList!
      .isInlineAttributeBlocked(element, 'script-attr', 'return false')).toBe(blocked);
    expect(runTask()).toBe(blocked);
    expect(runTask()).toBe(false);
  });

  it('does not let an element nonce authorize a handler attribute', () => {
    const { window, document, runTask } = createCSPWindow("script-src-attr 'nonce-abc' 'unsafe-inline'");
    const element = window.document.createElement('body');
    element.nonce = 'abc';
    expect(document.policyContainer.cspList!
      .isInlineAttributeBlocked(unwrap<ElementImpl>(element), 'script-attr', 'return false')).toBe(true);
    expect(runTask()).toBe(true);
  });

  it.each(['sha256', 'sha384', 'sha512'])('authorizes exact UTF-8 handler source using %s and unsafe-hashes', (algorithm) => {
    const source = 'globalThis.foo = "שלום 😀";\r\nreturn false;';
    const hash = `'${algorithm}-${createHash(algorithm).update(source).digest('base64')}'`;
    expect(new CSPDirectiveValue([hash]).matchesInlineSource('script-attr', source)).toBe(false);
    expect(new CSPDirectiveValue(["'unsafe-inline'", hash])
      .matchesInlineSource('script-attr', source)).toBe(false);
    const sources = new CSPDirectiveValue(["'UNSAFE-HASHES'", hash]);
    expect(sources.matchesInlineSource('script-attr', source)).toBe(true);
    expect(sources.matchesInlineSource('script-attr', `${source} `)).toBe(false);
    expect(sources.matchesInlineSource('script-attr', source.replace('\r\n', '\n'))).toBe(false);
    expect(sources.matchesInlineSource('script-attr', `function onstorage(event) {\n${source}\n}`)).toBe(false);
  });

  it('still accepts an authorized hash when strict-dynamic suppresses unsafe-inline', () => {
    const source = 'globalThis.foo = 5;';
    const hash = `'sha256-${createHash('sha256').update(source).digest('base64')}'`;
    const { document, runTask } = createCSPWindow(`script-src-attr 'unsafe-inline' 'strict-dynamic' 'unsafe-hashes' ${hash}`);
    const element = document.createElement('body');
    expect(document.policyContainer.cspList!.isInlineAttributeBlocked(element, 'script-attr', source)).toBe(false);
    expect(runTask()).toBe(false);
    expect(document.policyContainer.cspList!
      .isInlineAttributeBlocked(element, 'script-attr', 'globalThis.foo = 6;')).toBe(true);
    expect(runTask()).toBe(true);
  });

  it('reports each rejecting policy with script-src-attr even when a fallback supplied its sources', () => {
    const { window, document, scope, runTask } = createCSPWindow("default-src 'none' 'report-sample'; report-to handlers");
    const policies = document.policyContainer.cspList!;
    policies.policies.push(
      ContentSecurityPolicy.parse("script-src 'self'; report-to handlers", 'header', 'report'),
      ContentSecurityPolicy.parse("script-src-attr 'none' 'report-sample'; report-to handlers", 'header', 'enforce'),
      ContentSecurityPolicy.parse("script-src-attr 'unsafe-inline'", 'header', 'enforce'),
    );
    const element = window.document.createElement('body');
    window.document.documentElement.appendChild(element);
    const events: SecurityPolicyViolationEvent[] = [];
    element.addEventListener('securitypolicyviolation', (event) => events.push(event));
    const source = `globalThis.foo = '${'x'.repeat(60)}';`;
    expect(policies.isInlineAttributeBlocked(unwrap<ElementImpl>(element), 'script-attr', source)).toBe(true);
    expect(events).toHaveLength(0);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(false);
    expect(events.map((event) => ({
      directive: event.effectiveDirective, violated: event.violatedDirective,
      blocked: event.blockedURI, disposition: event.disposition, sample: event.sample,
      target: event.target === element, trusted: event.isTrusted, bubbles: event.bubbles, composed: event.composed,
    }))).toEqual([
      {
        directive: 'script-src-attr', violated: 'script-src-attr', blocked: 'inline', disposition: 'enforce',
        sample: source.slice(0, 40), target: true, trusted: true, bubbles: true, composed: true,
      },
      {
        directive: 'script-src-attr', violated: 'script-src-attr', blocked: 'inline', disposition: 'report',
        sample: '', target: true, trusted: true, bubbles: true, composed: true,
      },
      {
        directive: 'script-src-attr', violated: 'script-src-attr', blocked: 'inline', disposition: 'enforce',
        sample: source.slice(0, 40), target: true, trusted: true, bubbles: true, composed: true,
      },
    ]);
    expect(scope.reports.map((report) => report.data)).toMatchObject([
      { effectiveDirective: 'script-src-attr', sample: source.slice(0, 40) },
      { effectiveDirective: 'script-src-attr', sample: '' },
      { effectiveDirective: 'script-src-attr', sample: source.slice(0, 40) },
    ]);
  });

  it('reports without blocking for report-only policy and does not take samples from an unused fallback', () => {
    const { document, scope, runTask } = createCSPWindow(
      "script-src-attr 'none'; default-src 'none' 'report-sample'; report-to handlers", 'report',
    );
    expect(document.policyContainer.cspList!
      .isInlineAttributeBlocked(document.createElement('body'), 'script-attr', 'return false')).toBe(false);
    expect(runTask()).toBe(true);
    expect(scope.reports[0]!.data).toMatchObject({ disposition: 'report', effectiveDirective: 'script-src-attr', sample: '' });
    expect(runTask()).toBe(false);
  });

  it('delivers a rejected adopted element through its current Document and checks attachment at delivery', () => {
    const source = createCSPWindow();
    const target = createCSPWindow("script-src-attr 'none'; report-to handlers");
    const element = source.window.document.createElement('body');
    target.window.document.adoptNode(element);
    target.window.document.documentElement.appendChild(element);
    const events: SecurityPolicyViolationEvent[] = [];
    target.window.document.addEventListener('securitypolicyviolation', (event) => events.push(event));
    expect(target.document.policyContainer.cspList!
      .isInlineAttributeBlocked(unwrap<ElementImpl>(element), 'script-attr', 'return false')).toBe(true);
    element.remove();
    expect(source.runTask()).toBe(false);
    expect(target.runTask()).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]!.target).toBe(target.window.document);
    expect(events[0]!.effectiveDirective).toBe('script-src-attr');
  });

  it('does not apply script-only strict-dynamic restrictions to the style-attribute consumer', () => {
    const { window, document, runTask } = createCSPWindow(
      "default-src 'unsafe-inline' 'strict-dynamic'",
    );
    const element = window.document.createElement('div');
    element.setAttribute('style', 'opacity: .5');
    expect(element.style.opacity).toBe('0.5');
    expect(runTask()).toBe(false);
    expect(document.policyContainer.cspList!
      .isInlineAttributeBlocked(unwrap<ElementImpl>(element), 'script-attr', 'return false')).toBe(true);
    expect(runTask()).toBe(true);
  });
});
