import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { BrowletEnvironmentBase } from '../../../src/browlet/environment';
import { FetchResponse } from '../../../src/fetch/response';
import { parseURL } from '../../../src/url/url';
import { unwrap } from '../../support/browlet-binding';

describe('origin-keyed agent clusters', () => {
  it('reports opaque initial documents as origin-keyed', () => {
    const browser = new Browlet({ route: () => '' });
    expect(browser.window.originAgentCluster).toBe(true);
  });

  it.each([
    [null, false], ['?1', true], ['?0', false], ['true', false], ['1', false],
    ['"?1"', false], ['?1; hint=token', true], [' ?1 ', true],
    ['?1, ?1', false], ['(?1)', false], ['?2', false], ['', false],
  ])('processes the structured header %j', (header, expected) => {
    const browser = new Browlet({ route: () => '' });
    navigateResponse(browser, 'https://www.example.com/', header);
    expect(browser.window.originAgentCluster).toBe(expected);
  });

  it.each([
    ['http://example.com/', false], ['http://localhost/', true],
    ['https://example.com/', true],
  ])('gates the header on the secure-context decision for %s', (url, expected) => {
    const browser = new Browlet({ route: () => '' });
    navigateResponse(browser, url, '?1');
    expect(browser.window.originAgentCluster).toBe(expected);
  });

  it('honors the reserved environment security decision', () => {
    const browser = new Browlet({ route: () => '' });
    navigateResponse(browser, 'https://example.com/', '?1', false);
    expect(browser.window.originAgentCluster).toBe(false);
    expect(browser.window.isSecureContext).toBe(false);
  });

  it.each([false, true])('retains an initial origin-keying decision of %s', (firstKeyed) => {
    const browser = new Browlet({ route: () => '' });
    navigateResponse(browser, 'https://www.example.com/first', firstKeyed ? '?1' : null);
    const agent = unwrap<DocumentImpl>(browser.document).env.realm.agent;
    if (!firstKeyed) browser.document.domain = 'example.com';
    navigateResponse(browser, 'https://www.example.com/second', firstKeyed ? null : '?1');
    expect(browser.window.originAgentCluster).toBe(firstKeyed);
    expect(unwrap<DocumentImpl>(browser.document).env.realm.agent).toBe(agent);
  });

  it('validates document.domain before an origin-keyed no-op', () => {
    const browser = new Browlet({ route: () => '' });
    navigateResponse(browser, 'https://www.example.com/', '?1');
    browser.document.domain = 'example.com';
    expect(browser.document.domain).toBe('www.example.com');
    expect(() => { browser.document.domain = 'com'; }).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    expect(unwrap<DocumentImpl>(browser.document).origin).toMatchObject({ domain: null });
  });

  it('origin-keys cross-origin-isolated groups without the header', () => {
    const browser = new Browlet({ route: () => '' });
    const initial = unwrap<DocumentImpl>(browser.document);
    initial.browsingContext!.group!.crossOriginIsolationMode = 'logical';
    navigateResponse(browser, 'https://www.example.com/', null);
    expect(browser.window.originAgentCluster).toBe(true);
    browser.document.domain = 'example.com';
    expect(browser.document.domain).toBe('www.example.com');
  });
});

function navigateResponse(browser: Browlet, url: string, header: string | null, secureContext?: boolean): void {
  const initial = unwrap<DocumentImpl>(browser.document);
  const navigable = initial.getNodeNavigable()!;
  const response = new FetchResponse();
  response.urlList.push(parseURL(url).url!);
  if (header !== null) response.headerList.append('Origin-Agent-Cluster', header);
  const params = navigable.createNavigationParams(response);
  if (secureContext !== undefined) {
    params.reservedEnv = new BrowletEnvironmentBase({
      userAgent: initial.env.userAgent, creationURL: params.url,
      topLevelCreationURL: params.url, topLevelOrigin: params.origin,
      targetBrowsingContext: initial.browsingContext,
      isSecureContext: secureContext,
    });
  }
  const document = navigable.createAndInitializeDocument('html', 'text/html', params);
  const entry = navigable.createHistoryEntry(document, params);
  navigable.finalizeCrossDocumentNavigation('push', 'browser UI', entry);
}
