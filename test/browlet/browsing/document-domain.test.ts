import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { areSameOrigin, areSameOriginDomain } from '../../../src/url/origin';
import { unwrap } from '../../support/browlet-binding';

describe('Document.domain', () => {
  it.each([
    ['https://www.example.com:8443/', 'www.example.com'],
    ['https://EXAMPLE.com./', 'example.com.'],
    ['https://bücher.example/', 'xn--bcher-kva.example'],
    ['http://127.1/', '127.0.0.1'],
    ['http://[0::1]/', '[::1]'],
  ])('serializes the effective domain of %s', async (url, domain) => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate(url);
    expect(browser.document.domain).toBe(domain);
  });

  it('returns empty text and rejects assignments for opaque origins', () => {
    const browser = new Browlet({ route: () => '' });
    expect(browser.document.domain).toBe('');
    expect(() => { browser.document.domain = 'example.com'; }).toThrow(expect.objectContaining({ name: 'SecurityError' }));
  });

  it('relaxes only the domain component and requires both origins to opt in', async () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    await first.navigate('https://www.example.com:8000/');
    await second.navigate('https://shop.example.com:9000/');
    const firstOrigin = unwrap<DocumentImpl>(first.document).origin;
    const secondOrigin = unwrap<DocumentImpl>(second.document).origin;

    first.document.domain = 'EXAMPLE.com';
    expect(first.document.domain).toBe('example.com');
    expect(areSameOriginDomain(firstOrigin, secondOrigin)).toBe(false);
    second.document.domain = 'example.com';
    expect(areSameOriginDomain(firstOrigin, secondOrigin)).toBe(true);
    expect(areSameOrigin(firstOrigin, secondOrigin)).toBe(false);
    expect(firstOrigin).toMatchObject({ host: { value: 'www.example.com' }, port: 8000 });
    expect(secondOrigin).toMatchObject({ host: { value: 'shop.example.com' }, port: 9000 });
  });

  it.each(['', 'com', 'ample.com', 'other.com', 'example.com.', 'example.com:443', '\uD800'])(
    'rejects invalid relaxation to %j without changing the origin', async (value) => {
      const browser = new Browlet({ route: () => '' });
      await browser.navigate('https://www.example.com/');
      expect(() => { browser.document.domain = value; }).toThrow(expect.objectContaining({ name: 'SecurityError' }));
      expect(browser.document.domain).toBe('www.example.com');
      expect(unwrap<DocumentImpl>(browser.document).origin).toMatchObject({ domain: null });
    },
  );

  it('cannot restore a subdomain after relaxing', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://www.example.com/');
    browser.document.domain = 'example.com';
    expect(() => { browser.document.domain = 'www.example.com'; }).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    expect(browser.document.domain).toBe('example.com');
  });

  it.each([
    ['http://0.1.2.3/', '0x10203', '0.1.2.3'],
    ['http://[::1]/', '[0::1]', '[::1]'],
  ])('accepts an equal IP host for %s', async (url, value, expected) => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate(url);
    browser.document.domain = value;
    expect(browser.document.domain).toBe(expected);
    expect(unwrap<DocumentImpl>(browser.document).origin).not.toMatchObject({ domain: null });
  });

  it('rejects detached and sandboxed documents', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://www.example.com/');
    const detached = browser.document.implementation.createHTMLDocument();
    const detachedImpl = unwrap<DocumentImpl>(detached);
    detachedImpl.origin = unwrap<DocumentImpl>(browser.document).origin;
    expect(() => { detached.domain = 'example.com'; }).toThrow(expect.objectContaining({ name: 'SecurityError' }));

    unwrap<DocumentImpl>(browser.document).setActiveSandboxingFlagSet(new Set(['sandboxed-document-domain']));
    expect(() => { browser.document.domain = 'example.com'; }).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    expect(browser.document.domain).toBe('www.example.com');
  });
});
