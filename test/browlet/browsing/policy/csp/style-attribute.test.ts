import { assert, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import { ContentSecurityPolicy } from '../../../../../src/browlet/browsing/policy/csp/policy';
import { parseHTMLDocument } from '../../../../../src/browlet/html/parser/parse';
import { HTMLElementImpl } from '../../../../../src/browlet/dom/nodes/html/html-element';
import { SVGElementImpl } from '../../../../../src/browlet/dom/nodes/svg/element';
import { MathMLElementImpl } from '../../../../../src/browlet/dom/nodes/mathml/element';
import { createCSPWindow } from './fixture';

describe('CSP style attributes', () => {
  it.each([
    ["style-src-attr 'unsafe-inline'; style-src 'none'; default-src 'none'", true],
    ["style-src-attr; style-src 'unsafe-inline'", false],
    ["style-src 'unsafe-inline'; default-src 'none'", true],
    ["style-src 'none'; default-src 'unsafe-inline'", false],
    ["default-src 'unsafe-inline'", true],
    ["default-src 'none'", false],
    ["style-src-elem 'none'", true],
    ["script-src 'none'", true],
  ])('selects the applicable style source list in %s', (policy, allowed) => {
    const { window, runTask } = createCSPWindow(policy);
    const element = window.document.createElement('div');
    element.setAttribute('style', 'opacity: .3');
    expect(element.style.getPropertyValue('opacity')).toBe(allowed ? '0.3' : '');
    expect(runTask()).toBe(!allowed);
  });

  it('checks an attribute immediately, before CSSOM is first read', () => {
    const { window, scope, runTask } = createCSPWindow("style-src-attr 'none' 'report-sample'; report-to styles");
    const element = window.document.createElement('div');
    const source = 'opacity: .2';

    element.setAttribute('style', source);

    expect(runTask()).toBe(true);
    expect(scope.reports).toHaveLength(1);
    expect(scope.reports[0]!.data).toMatchObject({
      effectiveDirective: 'style-src-attr', blockedURL: 'inline', sample: source,
    });
    expect(element.getAttribute('style')).toBe(source);
    expect(element.style.cssText).toBe('');
    expect(runTask()).toBe(false);
  });

  it('hashes the original attribute source before CSS parsing or serialization', () => {
    const source = 'opacity: .5';
    const digest = createHash('sha256').update(source).digest('base64');
    const { window, runTask } = createCSPWindow(`style-src-attr 'unsafe-hashes' 'sha256-${digest}'`);
    const element = window.document.createElement('div');
    element.setAttribute('style', source);
    expect(element.style.getPropertyValue('opacity')).toBe('0.5');
    expect(runTask()).toBe(false);
    element.setAttribute('style', 'opacity: 0.5;');
    expect(runTask()).toBe(true);
    expect(element.style.getPropertyValue('opacity')).toBe('0.5');
  });

  it('does not allocate inline state or reparse a blocked attribute during computed-style reads', () => {
    const { window, document, runTask } = createCSPWindow("style-src-attr 'none'");
    const element = window.document.createElement('div');
    element.id = 'target';
    window.document.body.appendChild(element);
    const implementation = document.getElementById('target');
    assert.isNotNull(implementation);
    element.setAttribute('style', 'opacity: .2');
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(false);

    // Blocking the declaration leaves opacity at its initial value.
    expect(window.getComputedStyle(element).getPropertyValue('opacity')).toBe('1');
    expect(implementation.getInlineStyleBlock()).toBeNull();
    expect(runTask()).toBe(false);

    document.policyContainer.cspList!.policies.length = 0;
    expect(window.getComputedStyle(element).getPropertyValue('opacity')).toBe('1');
    expect(implementation.getInlineStyleBlock()).toBeNull();
    expect(element.getAttribute('style')).toBe('opacity: .2');
    expect(runTask()).toBe(false);

    const style = element.style;
    expect(style.cssText).toBe('');
    style.setProperty('opacity', '.6');
    expect(window.getComputedStyle(element).getPropertyValue('opacity')).toBe('0.6');
    expect(element.style).toBe(style);
  });

  it('retains accepted declarations after a blocked replacement, while CSSOM writes bypass CSP', () => {
    const { window, scope, runTask } = createCSPWindow("style-src-attr 'none'; report-to styles");
    const element = window.document.createElement('div');
    const style = element.style;
    style.setProperty('opacity', '.5');
    expect(runTask()).toBe(false);

    element.setAttribute('style', 'opacity: .8');
    expect(element.style).toBe(style);
    expect(element.getAttribute('style')).toBe('opacity: .8');
    expect(style.getPropertyValue('opacity')).toBe('0.5');
    expect(window.getComputedStyle(element).getPropertyValue('opacity')).toBe('0.5');
    expect(runTask()).toBe(true);
    expect(scope.reports[0]!.data).toMatchObject({ sample: '' });

    style.cssText = 'opacity: .7';
    expect(element.getAttribute('style')).toBe('opacity: 0.7;');
    expect(style.getPropertyValue('opacity')).toBe('0.7');
    expect(window.getComputedStyle(element).getPropertyValue('opacity')).toBe('0.7');
    element.removeAttribute('style');
    expect(style.cssText).toBe('');
    expect(runTask()).toBe(false);
  });

  it('does not defer an accepted attribute until a later policy has taken effect', () => {
    const { window, document, runTask } = createCSPWindow();
    const element = window.document.createElement('div');
    element.setAttribute('style', 'opacity: .4');
    document.policyContainer.cspList!.policies.push(
      ContentSecurityPolicy.parse("style-src-attr 'none'", 'header', 'enforce'),
    );
    expect(runTask()).toBe(false);
    element.setAttribute('style', 'opacity: .6');
    expect(window.getComputedStyle(element).getPropertyValue('opacity')).toBe('0.4');
    expect(element.style.getPropertyValue('opacity')).toBe('0.4');
    expect(runTask()).toBe(true);
  });

  it.each([false, true])('does not revive a blocked attribute after policy changes (CSSOM read first: %s)', (readFirst) => {
    const { window, document, runTask } = createCSPWindow("style-src-attr 'none'");
    const element = window.document.createElement('div');
    const initialStyle = readFirst ? element.style : undefined;
    element.setAttribute('style', 'opacity: .2');
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(false);

    document.policyContainer.cspList!.policies.length = 0;
    const style = element.style;
    if (initialStyle !== undefined) expect(style).toBe(initialStyle);
    expect(style.cssText).toBe('');
    expect(element.getAttribute('style')).toBe('opacity: .2');
    expect(runTask()).toBe(false);

    element.setAttribute('style', 'opacity: .4');
    expect(element.style).toBe(style);
    expect(style.getPropertyValue('opacity')).toBe('0.4');
    element.removeAttribute('style');
    expect(element.style).toBe(style);
    expect(style.cssText).toBe('');
    expect(runTask()).toBe(false);
  });

  it('applies report-only policy without blocking, capturing every violation and its target', () => {
    const { window, document, scope, runTask } = createCSPWindow("style-src 'none' 'report-sample'; report-to styles", 'report');
    document.policyContainer.cspList!.policies.push(
      ContentSecurityPolicy.parse("default-src 'none'; report-to styles", 'header', 'report'),
    );
    const element = window.document.createElement('div');
    window.document.body.appendChild(element);
    const events: SecurityPolicyViolationEvent[] = [];
    window.document.addEventListener('securitypolicyviolation', (event) => events.push(event));
    const source = `opacity: .4; --description: ${'x'.repeat(50)}`;
    element.setAttribute('style', source);
    expect(element.style.getPropertyValue('opacity')).toBe('0.4');
    expect(events).toHaveLength(0);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(false);
    expect(events.map((event) => [event.effectiveDirective, event.blockedURI, event.sample, event.disposition])).toEqual([
      ['style-src-attr', 'inline', source.slice(0, 40), 'report'],
      ['style-src-attr', 'inline', '', 'report'],
    ]);
    expect(events.every((event) => event.target === element && event.isTrusted)).toBe(true);
    expect(scope.reports).toHaveLength(2);
  });

  it('reports later policies even after an enforcing policy rejects the attribute', () => {
    const { window, document, scope, runTask } = createCSPWindow("style-src-attr 'none'; report-to styles");
    document.policyContainer.cspList!.policies.push(
      ContentSecurityPolicy.parse("style-src 'none'; report-to styles", 'header', 'report'),
    );
    const element = window.document.createElement('div');
    element.setAttribute('style', 'opacity: .1');
    expect(element.style.cssText).toBe('');
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(true);
    expect(scope.reports.map((report) => report.data)).toMatchObject([
      { disposition: 'enforce' }, { disposition: 'report' },
    ]);
  });

  it('checks parser-created attributes against the document global policy', () => {
    const { env, runTask } = createCSPWindow("style-src-attr 'none'");
    const parsed = parseHTMLDocument('<div id="target" style="opacity: .5"></div>', env);
    expect(runTask()).toBe(true);
    const element = parsed.getElementById('target')!;
    expect(element.getAttribute('style')).toBe('opacity: .5');
    expect(element.getInlineStyleBlock()).toBeNull();
    expect(runTask()).toBe(false);
  });

  it.each(['http://www.w3.org/1999/xhtml', 'http://www.w3.org/2000/svg', 'http://www.w3.org/1998/Math/MathML'])(
    'checks attribute input and bypasses CSSOM write-back for %s', (namespace) => {
      const { document, runTask } = createCSPWindow("style-src-attr 'none'");
      const element = document.createElementNS(namespace, 'a');
      if (!HTMLElementImpl.is(element) && !SVGElementImpl.is(element) && !MathMLElementImpl.is(element)) {
        throw new Error('Expected an HTML, SVG, or MathML element');
      }
      element.setAttributeNS('urn:unrelated', 'style', 'opacity: .1');
      expect(element.getInlineStyleBlock()).toBeNull();
      const style = element.style;
      const block = element.getInlineStyleBlock();
      expect(style.cssText).toBe('');
      expect(runTask()).toBe(false);

      style.setProperty('opacity', '.4');
      expect(element.getAttributeNS(null, 'style')).toBe('opacity: 0.4;');
      expect(element.getAttributeNS('urn:unrelated', 'style')).toBe('opacity: .1');
      expect(runTask()).toBe(false);

      element.setAttributeNS(null, 'style', 'opacity: .2');
      expect(element.getInlineStyleBlock()).toBe(block);
      expect(element.style).toBe(style);
      expect(style.cssText).toBe('opacity: 0.4;');
      expect(runTask()).toBe(true);
      expect(runTask()).toBe(false);

      style.cssText = 'opacity: .6';
      expect(element.getAttributeNS(null, 'style')).toBe('opacity: 0.6;');
      expect(style.cssText).toBe('opacity: 0.6;');
      element.removeAttributeNS(null, 'style');
      expect(element.getInlineStyleBlock()).toBe(block);
      expect(element.style).toBe(style);
      expect(style.cssText).toBe('');
      expect(element.getAttributeNS('urn:unrelated', 'style')).toBe('opacity: .1');
      expect(runTask()).toBe(false);
    },
  );

  it('uses the current document global after adoption, even with an existing declaration', () => {
    const source = createCSPWindow();
    const target = createCSPWindow("style-src-attr 'none'");
    const element = source.window.document.createElement('div');
    element.setAttribute('style', 'opacity: .4');
    target.window.document.adoptNode(element);
    element.setAttribute('style', 'opacity: .8');
    expect(element.style.getPropertyValue('opacity')).toBe('0.4');
    expect(target.runTask()).toBe(true);
    expect(source.runTask()).toBe(false);
  });
});
