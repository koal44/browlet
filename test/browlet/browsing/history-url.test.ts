import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { createOpaqueOrigin, parseURL } from '../../../src/url/index';
import { unwrap } from '../../support/browlet-binding';

// https://html.spec.whatwg.org/multipage/nav-history-apis.html#can-have-its-url-rewritten
describe('Document URL rewrite permission', () => {
  it.each([
    ['https://example.com/home', 'https://example.com/home#about', true],
    ['https://example.com/home', 'https://example.com/home?page=shop', true],
    ['https://example.com/home', 'https://example.com/shop', true],
    ['https://example.com/home', 'https://user:pass@example.com/home', false],
    ['https://example.com/home', 'http://example.com/home', false],
    ['file:///path/to/x', 'file:///path/to/x#hash', true],
    ['file:///path/to/x', 'file:///path/to/x?search', true],
    ['file:///path/to/x', 'file:///path/to/y', false],
    ['about:blank', 'about:blank#hash', true],
    ['about:blank', 'about:blank?search', false],
    ['about:blank', 'about:srcdoc', false],
    ['data:text/html,foo', 'data:text/html,foo#hash', true],
    ['data:text/html,foo', 'data:text/html,foo?search', false],
    ['data:text/html,foo', 'data:text/html,bar', false],
    ['data:text/html,foo', 'data:bar', false],
    ['blob:https://example.com/id', 'blob:https://example.com/id#hash', true],
    ['blob:https://example.com/id', 'blob:https://example.com/id?search', false],
    ['blob:https://example.com/id', 'blob:https://example.com/anything', false],
    ['blob:https://example.com/id', 'blob:path', false],
    ['https://example.com/home', 'https://other.test/home', false],
    ['https://example.com/home', 'https://example.com:444/home', false],
    ['https://user:pass@example.com/', 'https://user:other@example.com/', false],
    ['https://user:pass@example.com/', 'https://other:pass@example.com/', false],
    ['https://[0:0:0:0:0:0:0:1]/', 'https://[::1]:443/path', true],
    ['http://127.0.0.1/', 'http://127.1/path', true],
    ['ftp://example.com/a', 'ftp://example.com/a#fragment', true],
    ['ftp://example.com/a', 'ftp://example.com/b', false],
    ['ftp://example.com/a', 'ftp://example.com/a?query', false],
    ['custom://host/a', 'custom:/a', false],
  ] as const)('%s -> %s is %s', (source, target, allowed) => {
    const document = unwrap<DocumentImpl>(new Browlet({ route: () => '' }).document);
    document.url = parseURL(source).url!;
    expect(document.canHaveURLRewritten(parseURL(target).url!)).toBe(allowed);
  });

  it('uses URL components independently of inherited, opaque, or domain-relaxed origins', () => {
    const document = unwrap<DocumentImpl>(new Browlet({ route: () => '' }).document);
    document.url = parseURL('https://sub.example.test/original').url!;
    document.origin = createOpaqueOrigin();
    expect(document.canHaveURLRewritten(parseURL('https://sub.example.test/new').url!)).toBe(true);
    document.url = parseURL('about:blank').url!;
    expect(document.canHaveURLRewritten(parseURL('https://sub.example.test/new').url!)).toBe(false);
    document.origin = {
      kind: 'tuple', scheme: 'https', host: { kind: 'domain', value: 'sub.example.test' },
      port: null, domain: { kind: 'domain', value: 'example.test' },
    };
    document.url = parseURL('https://sub.example.test/original').url!;
    expect(document.canHaveURLRewritten(parseURL('https://example.test/new').url!)).toBe(false);
  });
});
