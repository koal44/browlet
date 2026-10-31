import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { LocationImpl } from '../../../../src/browlet/browsing/window/location';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { Location } from '../../../../src/browlet/platform';
import { createOpaqueOrigin, parseURL } from '../../../../src/url/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';
import { createSiblingWindow } from '../../../support/windows';

describe('Location document association', () => {
  it('exposes the Window Location only on fully active Documents', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(browser.document.location).toBe(browser.window.location);
    expect(browser.document.implementation.createHTMLDocument('').location).toBeNull();
    const previous = browser.document;
    await browser.navigate('https://example.test/next');
    expect(previous.location).toBeNull();
    expect(browser.document.location).toBe(browser.window.location);
    unwrap<DocumentImpl>(browser.document).browsingContext = null;
    expect(browser.document.location).toBeNull();
  });

  it('reads the live Document URL after a same-document URL update', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const location = browser.window.location;
    // History's author API is unfinished; supply the resulting Document URL directly.
    unwrap<DocumentImpl>(browser.document).url = parseURL('https://example.test:8443/second?query#fragment').url!;
    expect(readURL(location)).toEqual({
      href: 'https://example.test:8443/second?query#fragment', origin: 'https://example.test:8443',
      protocol: 'https:', host: 'example.test:8443', hostname: 'example.test', port: '8443',
      pathname: '/second', search: '?query', hash: '#fragment',
    });
    expect(String(location)).toBe(location.href);
  });

  it('forwards Document.location assignments through href conversion and rejects a null target first', async () => {
    const browser = new Browlet({ route: () => '' });
    const values: string[] = [];
    const setter = vi.spyOn(unwrap<LocationImpl>(browser.window.location), 'setHref')
      .mockImplementation((value) => { values.push(value); });
    try {
      expect(await browser.evaluate(() => {
        let conversions = 0;
        Reflect.set(document, 'location', { toString() { conversions++; return '/next'; } });
        return conversions;
      })).toBe(1);
      expect(values).toEqual(['/next']);
      const detached = browser.document.implementation.createHTMLDocument('');
      let converted = false;
      expect(() => Reflect.set(detached, 'location', {
        toString() { converted = true; return '/ignored'; },
      })).toThrow(getRelevantRealm(browser.window).TypeError);
      expect(converted).toBe(false);
    } finally {
      setter.mockRestore();
    }
  });

  it.each([
    ['https://user:pass@[2001:db8::1]:8443/p%20a?#', {
      origin: 'https://[2001:db8::1]:8443', host: '[2001:db8::1]:8443', hostname: '[2001:db8::1]',
      port: '8443', pathname: '/p%20a', search: '', hash: '',
    }],
    ['mailto:user@example.test?subject=x#frag', {
      origin: 'null', host: '', hostname: '', port: '', pathname: 'user@example.test', search: '?subject=x', hash: '#frag',
    }],
    ['blob:https://example.test/id', {
      origin: 'https://example.test', host: '', hostname: '', port: '', pathname: 'https://example.test/id', search: '', hash: '',
    }],
  ] as const)('serializes parsed URL components for %s', (href, expected) => {
    const browser = new Browlet({ route: () => '' });
    unwrap<DocumentImpl>(browser.document).url = parseURL(href).url!;
    expect(readURL(browser.window.location)).toMatchObject({ href, ...expected });
  });

  it('retains Location when an initial-about:blank navigation reuses its Window', () => {
    const browser = new Browlet({ route: () => '' });
    const location = browser.window.location;
    const window = getRelevantRealm(browser.window).windowImplementation;
    const navigable = window.navigable!;
    const params = navigable.createNavigationParamsFromSource(parseURL('about:blank?replacement').url!);
    params.origin = window.document.origin;
    const document = navigable.createAndInitializeDocument('html', 'text/html', params);
    navigable.finalizeCrossDocumentNavigation('replace', 'none', navigable.createHistoryEntry(document, params));
    expect(browser.window.location).toBe(location);
    expect(location.href).toBe('about:blank?replacement');
    expect(location.origin).toBe('null');
  });

  it('makes a retained Location follow its browsing context while keeping its own realm', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const previous = browser.document;
    const location = browser.window.location;
    const realm = getRelevantRealm(location);
    await browser.navigate('https://example.test/second');
    expect(browser.window.location).not.toBe(location);
    expect(previous.location).toBeNull();
    expect(location.href).toBe('https://example.test/second');
    expect(getRelevantRealm(location)).toBe(realm);
  });

  it('checks every retained Location getter against the current Document origin', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://first.test/');
    const location = browser.window.location;
    const DOMException = browser.window.DOMException;
    await browser.navigate('https://second.test/');
    for (const key of [
      'href', 'origin', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash', 'ancestorOrigins',
    ]) {
      expect(() => { Reflect.get(location, key); }).toThrow(DOMException);
      expect(() => { Reflect.get(location, key); }).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    }
    expect(() => String(location)).toThrow(DOMException);
  });

  it('uses entry settings independently of the getter and receiver realm', () => {
    const browser = new Browlet({ route: () => '' });
    const location = browser.window.location;
    const entryWindow = createSiblingWindow(browser);
    const entryRealm = getRelevantRealm(entryWindow);
    const document = unwrap<DocumentImpl>(entryWindow.document);
    document.origin = createOpaqueOrigin();
    const loop = entryRealm.env.responsibleEventLoop;
    expect(() => loop.runScriptEvaluation(entryRealm.env, () => location.href))
      .toThrow(expect.objectContaining({ name: 'SecurityError' }));
    document.origin = unwrap<DocumentImpl>(browser.document).origin;
    expect(loop.runScriptEvaluation(entryRealm.env, () => location.href)).toBe('about:blank');
    expect(loop.executionContextStack).toHaveLength(0);
  });

  it('allows the current Document when both origins have relaxed to the same domain', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://a.example.test/first');
    const previous = unwrap<DocumentImpl>(browser.document);
    const location = browser.window.location;
    await browser.navigate('https://b.example.test/second');
    const current = unwrap<DocumentImpl>(browser.document);
    if (previous.origin.kind !== 'tuple' || current.origin.kind !== 'tuple') throw new Error('Expected tuple origins');
    previous.origin.domain = { kind: 'domain', value: 'example.test' };
    current.origin.domain = { kind: 'domain', value: 'example.test' };
    expect(location.href).toBe('https://b.example.test/second');
  });

  it('returns about:blank components after its Window loses the browsing context', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/path?query#fragment');
    const location = browser.window.location;
    unwrap<DocumentImpl>(browser.document).browsingContext = null;
    expect(readURL(location)).toEqual({
      href: 'about:blank', origin: 'null', protocol: 'about:', host: '', hostname: '', port: '',
      pathname: 'blank', search: '', hash: '',
    });
  });

  it('preserves the current Document ancestor list identity and realm on first access through an old Location', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const location = browser.window.location;
    await browser.navigate('https://example.test/second');
    const currentRealm = getRelevantRealm(browser.window);
    const list = location.ancestorOrigins;
    expect(list).toBeInstanceOf(browser.window.DOMStringList);
    expect(list).toBe(browser.window.location.ancestorOrigins);
    expect(getRelevantRealm(list)).toBe(currentRealm);
    expect(unwrap(list)).toBe(unwrap<DocumentImpl>(browser.document).ancestorOriginsList);
  });

  it('returns a stable, separate empty ancestor list after detachment', async () => {
    const browser = new Browlet({ route: () => '' });
    const parent = new Browlet({ route: () => '' });
    await parent.navigate('https://parent.test/');
    await browser.navigate('https://example.test/');
    const document = unwrap<DocumentImpl>(browser.document);
    const location = browser.window.location;
    // Supply the creation caller's parent while automatic iframe startup is unfinished.
    document.initializeAncestry('unsafe-url', unwrap<DocumentImpl>(parent.document));
    const list = location.ancestorOrigins;
    expect([...list]).toEqual(['https://parent.test']);
    document.browsingContext = null;
    const empty = location.ancestorOrigins;
    expect(empty).not.toBe(list);
    expect(empty).toBe(location.ancestorOrigins);
    expect([...empty]).toEqual([]);
    expect([...list]).toEqual(['https://parent.test']);
    expect(getRelevantRealm(empty)).toBe(getRelevantRealm(location));
  });

  it('rejects missing ancestor initialization instead of substituting an empty list', () => {
    const browser = new Browlet({ route: () => '' });
    unwrap<DocumentImpl>(browser.document).ancestorOriginsList = null;
    expect(() => browser.window.location.ancestorOrigins).toThrow('Document ancestor origins are not initialized');
  });
});

function readURL(location: Location) {
  return {
    href: location.href, origin: location.origin, protocol: location.protocol, host: location.host,
    hostname: location.hostname, port: location.port, pathname: location.pathname,
    search: location.search, hash: location.hash,
  };
}
