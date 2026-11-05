import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { PermissionsPolicy } from '../../../../src/browlet/browsing/policy/permissions-policy/policy';
import { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import type { HTMLIFrameElement, Window } from '../../../../src/browlet/platform';
import { HTML_NAMESPACE, SVG_NAMESPACE } from '../../../../src/infra/index';
import { areSameOrigin, createOpaqueOrigin, obtainURLOrigin, parseURL, serializeOrigin } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';
import { createTestDocument } from '../../../support/dom';

declare const window: Window;

const feature = PermissionsPolicy.getSupportedFeature('cross-origin-isolated')!;

describe('iframe policy attribute reflection', () => {
  it('reflects allow text and allowFullscreen presence through the existing bindings', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const iframe = window.document.createElement('iframe') as HTMLIFrameElement;
      const initial = [iframe.allow, iframe.allowFullscreen];
      Reflect.set(iframe, 'allow', { toString: () => "cross-origin-isolated 'self'" });
      iframe.allowFullscreen = true;
      const assigned = [iframe.getAttribute('allow'), iframe.getAttribute('allowfullscreen')];
      iframe.setAttribute('allow', 'cross-origin-isolated *');
      iframe.setAttribute('allowfullscreen', 'false');
      const changed = [iframe.allow, iframe.allowFullscreen];
      iframe.allowFullscreen = false;
      iframe.removeAttribute('allow');
      const removed = [iframe.allow, iframe.allowFullscreen, iframe.hasAttribute('allowfullscreen')];
      return { initial, assigned, changed, removed };
    })).toEqual({
      initial: ['', false],
      assigned: ["cross-origin-isolated 'self'", ''],
      changed: ['cross-origin-isolated *', true],
      removed: ['', false, false],
    });
  });

  it('feeds author-assigned attributes into container-policy processing', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.evaluate(() => {
      const iframe = window.document.createElement('iframe') as HTMLIFrameElement;
      iframe.allow = 'cross-origin-isolated';
      iframe.setAttribute('src', 'https://child.test/page');
      (window.document.body ?? window.document.documentElement ?? window.document).appendChild(iframe);
    });
    const iframe = unwrap<HTMLIFrameElementImpl>(browser.document.getElementsByTagName('iframe').item(0)!);
    const list = iframe.processPolicyAttributes().get(feature)!;
    expect(list.matches(obtainURLOrigin(parseURL('https://child.test/').url!))).toBe(true);
    expect(list.matches(iframe.nodeDocument.origin)).toBe(false);
  });
});

describe('iframe declared origin', () => {
  it.each([null, 'https://[invalid'])('uses the node Document origin for absent or invalid src: %j', (src) => {
    const { document, iframe } = createIframe();
    if (src !== null) iframe.setAttributeValue('src', src);
    expect(iframe.declaredOrigin).toBe(document.origin);
  });

  it.each([
    ['', 'https://parent.test'],
    ['../child', 'https://parent.test'],
    ['//child.test/page', 'https://child.test'],
    ['https://CHILD.test:443/path', 'https://child.test'],
  ])('parses %j relative to the node Document', (src, expected) => {
    const { iframe } = createIframe();
    iframe.setAttributeValue('src', src);
    expect(serializeOrigin(iframe.declaredOrigin)).toBe(expected);
  });

  it('uses the effective base URL when it differs from the Document origin', () => {
    const { document, iframe } = createIframe();
    document.url = parseURL('about:blank').url!;
    document.aboutBaseURL = parseURL('https://base.test/directory/').url!;
    iframe.setAttributeValue('src', 'child');
    expect(serializeOrigin(iframe.declaredOrigin)).toBe('https://base.test');
    iframe.setAttributeValue('srcdoc', '');
    expect(iframe.declaredOrigin).toBe(document.origin);
  });

  it('gives srcdoc presence precedence over src, including an opaque parent origin', () => {
    const { document, iframe } = createIframe();
    document.origin = createOpaqueOrigin();
    iframe.setAttributeValue('src', 'https://child.test/');
    iframe.setAttributeValue('srcdoc', '');
    expect(iframe.declaredOrigin).toBe(document.origin);
    iframe.removeAttribute('srcdoc');
    expect(serializeOrigin(iframe.declaredOrigin)).toBe('https://child.test');
  });

  it('applies the current iframe sandbox before srcdoc and src', () => {
    const { document, iframe } = createIframe();
    iframe.setAttributeValue('srcdoc', '');
    iframe.setAttributeValue('sandbox', 'allow-scripts');
    const first = iframe.declaredOrigin;
    expect(first.kind).toBe('opaque');
    expect(areSameOrigin(first, iframe.declaredOrigin)).toBe(false);
    iframe.setAttributeValue('sandbox', 'allow-same-origin');
    expect(iframe.declaredOrigin).toBe(document.origin);
    iframe.setAttributeValue('sandbox', '');
    expect(iframe.declaredOrigin.kind).toBe('opaque');
    iframe.removeAttribute('sandbox');
    expect(iframe.declaredOrigin).toBe(document.origin);
  });

  it('preserves the parent Document sandbox restriction despite allow-same-origin on the iframe', () => {
    const { document, iframe } = createIframe();
    iframe.setAttributeValue('sandbox', 'allow-same-origin');
    iframe.setAttributeValue('src', 'https://child.test/');
    document.setActiveSandboxingFlagSet(new Set(['sandboxed-origin']));
    expect(iframe.declaredOrigin.kind).toBe('opaque');
  });

  // SPEC_CLASH(permissions-policy-blank-origin): Keep the draft's URL-origin rule,
  // also observed in Firefox; Chromium and WebKit inherit for explicit about:blank.
  it.each(['about:blank', 'about:blank#fragment', 'data:text/html,hello'])(
    'retains an opaque URL origin for %s', (src) => {
      const { iframe } = createIframe();
      iframe.setAttributeValue('src', src);
      expect(iframe.declaredOrigin.kind).toBe('opaque');
    },
  );

  it('ignores namespaced src, srcdoc, and sandbox attributes', () => {
    const { document, iframe } = createIframe();
    iframe.setAttributeNS('urn:other', 'x:src', 'https://ignored.test/');
    iframe.setAttributeNS('urn:other', 'x:sandbox', '');
    expect(iframe.declaredOrigin).toBe(document.origin);
    iframe.setAttributeValue('src', 'https://child.test/');
    iframe.setAttributeNS('urn:other', 'x:srcdoc', '');
    expect(serializeOrigin(iframe.declaredOrigin)).toBe('https://child.test');
  });

  it('uses the new node Document after adoption, while retaining the original binding environment', () => {
    const { document: source, iframe } = createIframe();
    const { document: destination } = createIframe('https://destination.test/base/');
    iframe.setAttributeValue('src', 'child');
    iframe.setAttributeValue('allow', "cross-origin-isolated 'self' 'src'");
    const before = iframe.processPolicyAttributes().get(feature)!;
    destination.adoptNode(iframe);
    const after = iframe.processPolicyAttributes().get(feature)!;
    expect(iframe.env).toBe(source.env);
    expect(after.selfOrigin).toBe(destination.origin);
    expect(serializeOrigin(after.srcOrigin!)).toBe('https://destination.test');
    expect(after.matches(source.origin)).toBe(false);
    expect(before.selfOrigin).toBe(source.origin);
  });
});

describe('Permissions Policy §§6.2–6.3 / §9.4: container-policy inputs', () => {
  it('returns an empty map for non-iframe elements, including a foreign-namespace iframe', () => {
    const { document } = createIframe();
    for (const [name, namespace] of [['div', HTML_NAMESPACE], ['iframe', SVG_NAMESPACE]]) {
      const element = document.createElementNode(name!, namespace!);
      element.setAttributeValue('allow', 'cross-origin-isolated *');
      expect(element.processPolicyAttributes().size).toBe(0);
    }
  });

  it('uses the declared origin as the default and preserves self as the container origin', () => {
    const { document, iframe } = createIframe();
    iframe.setAttributeValue('src', 'https://child.test/');
    iframe.setAttributeValue('allow', 'cross-origin-isolated');
    const target = iframe.processPolicyAttributes().get(feature)!;
    expect(serializeOrigin(target.srcOrigin!)).toBe('https://child.test');
    expect(target.matches(document.origin)).toBe(false);
    iframe.setAttributeValue('allow', "cross-origin-isolated 'self'");
    const self = iframe.processPolicyAttributes().get(feature)!;
    expect(self.matches(document.origin)).toBe(true);
    expect(self.matches(target.srcOrigin!)).toBe(false);
  });

  it('recomputes after mutations without rewriting an earlier map or the Document policy', () => {
    const { document, iframe } = createIframe();
    const documentPolicy = document.permissionsPolicyState;
    iframe.setAttributeValue('src', 'https://child.test/');
    iframe.setAttributeValue('allow', 'cross-origin-isolated');
    const first = iframe.processPolicyAttributes();
    iframe.setAttributeValue('src', 'https://other.test/');
    const second = iframe.processPolicyAttributes();
    expect(serializeOrigin(first.get(feature)!.srcOrigin!)).toBe('https://child.test');
    expect(serializeOrigin(second.get(feature)!.srcOrigin!)).toBe('https://other.test');
    iframe.removeAttribute('allow');
    iframe.setAttributeNS('urn:other', 'x:allow', 'cross-origin-isolated *');
    expect(iframe.processPolicyAttributes().size).toBe(0);
    expect(document.permissionsPolicyState).toBe(documentPolicy);
    expect(documentPolicy.declaredPolicy.declarations.size).toBe(0);
  });

  it('does not advertise the unimplemented Fullscreen feature through its legacy attribute', () => {
    const { iframe } = createIframe();
    iframe.setAttributeValue('allowfullscreen', '');
    iframe.setAttributeValue('allow', 'fullscreen *; cross-origin-isolated');
    expect([...iframe.processPolicyAttributes().keys()]).toEqual([feature]);
    expect(PermissionsPolicy.getSupportedFeatureNames()).not.toContain('fullscreen');
    // TODO(Fullscreen): Exercise allowfullscreen fallback and explicit allow precedence
    // when Fullscreen adds its definition to the supported feature catalog.
  });
});

function createIframe(url = 'https://parent.test/directory/page') {
  const document = createTestDocument();
  document.url = parseURL(url).url!;
  document.origin = obtainURLOrigin(document.url);
  const iframe = document.createElementNode('iframe', HTML_NAMESPACE);
  if (!HTMLIFrameElementImpl.is(iframe)) throw new Error('Expected iframe implementation');
  return { document, iframe };
}
