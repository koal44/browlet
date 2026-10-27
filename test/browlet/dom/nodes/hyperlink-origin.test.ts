import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { HTMLAnchorElement, HTMLAreaElement } from '../../../../src/browlet/platform';
import { HyperlinkElementUtilsMixin } from '../../../../src/browlet/dom/nodes/html/text/hyperlink';
import { areSameOrigin } from '../../../../src/url/origin';
import { obtainURLOrigin, parseURL } from '../../../../src/url/url';

describe('hyperlink origin extraction', () => {
  it('extracts only the retained URL record', () => {
    const hyperlink = new HyperlinkElementUtilsMixin();
    expect(hyperlink.extractOrigin()).toBeNull();
    const url = parseURL('https://example.com/path').url!;
    hyperlink.url = url;
    expect(hyperlink.extractOrigin()).toEqual(obtainURLOrigin(url));
    hyperlink.url = null;
    expect(hyperlink.extractOrigin()).toBeNull();
  });

  it('uses URL origin rules for opaque URLs', () => {
    const hyperlink = new HyperlinkElementUtilsMixin();
    hyperlink.url = parseURL('data:text/plain,hello').url;
    const first = hyperlink.extractOrigin()!;
    const second = hyperlink.extractOrigin()!;
    expect(first.kind).toBe('opaque');
    expect(areSameOrigin(first, second)).toBe(false);
  });
});

describe('hyperlink mixin declarations', () => {
  it.each(['a', 'area'])('reflects shared hyperlink attributes on %s', (tag) => {
    const browser = new Browlet({ route: () => '' });
    const element = browser.document.createElement(tag) as HTMLAnchorElement | HTMLAreaElement;
    for (const name of ['hreflang', 'type', 'target'] as const) {
      expect(element[name]).toBe('');
      element[name] = 'first';
      expect(element.getAttribute(name)).toBe('first');
      element.setAttribute(name, 'second');
      expect(element[name]).toBe('second');
    }
  });
});
