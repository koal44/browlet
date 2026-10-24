import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { fetchStyleResource, resolveStyleResourceURL, styleResourceBaseURL } from '../../../src/browlet/style/url-processing';
import type { WindowEnvironment } from '../../../src/browlet/environment';
import * as fetching from '../../../src/fetch/index';
import { serializeURL } from '../../../src/url/index';
import { CSSStyleSheetImpl } from '../../../src/stylelet/cssom/css-stylesheet';
import { CSSStyleDeclarationImpl } from '../../../src/stylelet/cssom/declarations/style-declaration';
import { CSSImportRuleImpl } from '../../../src/stylelet/cssom/rules/import';
import { MediaListImpl } from '../../../src/stylelet/cssom/media/media-list';
import { UrlValue } from '../../../src/stylelet/values/url';
import { getRelevantRealm } from '../../support/browlet-binding';

let env: WindowEnvironment;
beforeEach(async () => {
  const browser = new Browlet({ route: () => '<!doctype html><html><head><base href="/document-base/"></head></html>' });
  await browser.navigate('https://example.test/page');
  env = getRelevantRealm(browser.window).env;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await env.userAgent.httpTransport.close();
});

describe('CSS URL processing', () => {
  it('selects the stylesheet base, then location, then the relevant environment base', () => {
    const rule = createRule();
    const declaration = new CSSStyleDeclarationImpl({ parentRule: rule }, env);
    const sheet = rule.parentStyleSheet!;
    for (const owner of [rule, declaration]) {
      expect(serializeURL(styleResourceBaseURL(owner, env))).toBe('https://example.test/sheet-base/');
      sheet.baseURL = undefined;
      expect(serializeURL(styleResourceBaseURL(owner, env))).toBe('https://example.test/sheet.css');
      sheet.location = null;
      expect(serializeURL(styleResourceBaseURL(owner, env))).toBe('https://example.test/document-base/');
      sheet.baseURL = new env.userAgent.URL('https://example.test/sheet-base/');
      sheet.location = new env.userAgent.URL('https://example.test/sheet.css');
    }
    rule.setParentStyleSheet(null);
    expect(serializeURL(styleResourceBaseURL(rule, env))).toBe('https://example.test/document-base/');
    expect(serializeURL(styleResourceBaseURL(new CSSStyleDeclarationImpl({}, env), env)))
      .toBe('https://example.test/document-base/');
  });

  it('resolves URL values and URL records, using UTF-8 regardless of the sheet encoding', () => {
    const rule = createRule();
    rule.parentStyleSheet!.encoding = 'windows-1252';
    const value = UrlValue.fromString('url', 'café.css', {});
    expect(serializeURL(resolveStyleResourceURL(value, rule, env)!)).toBe('https://example.test/sheet-base/caf%C3%A9.css');
    expect(value.repr.href).toBe('café.css');
    const absolute = env.parseURL('https://other.test/style.css').url!;
    expect(serializeURL(resolveStyleResourceURL(absolute, rule, env)!)).toBe('https://other.test/style.css');
    expect(resolveStyleResourceURL(UrlValue.fromString('url', 'http://[', {}), rule, env)).toBeNull();
  });

  it.each([
    { mode: 'no-cors' as const, modifier: '', credentials: 'include', requestMode: 'no-cors', clean: true, attached: true },
    { mode: 'cors' as const, modifier: '', credentials: 'same-origin', requestMode: 'cors', clean: true, attached: true },
    { mode: 'no-cors' as const, modifier: 'cross-origin(anonymous)', credentials: 'same-origin', requestMode: 'cors', clean: false, attached: true },
    { mode: 'no-cors' as const, modifier: 'cross-origin(use-credentials)', credentials: 'include', requestMode: 'cors', clean: true, attached: true },
    { mode: 'cors' as const, modifier: '', credentials: 'same-origin', requestMode: 'cors', clean: true, attached: false },
  ])('fetches with mode=$mode modifier=$modifier clean=$clean attached=$attached', async ({ mode, modifier, credentials, requestMode, clean, attached }) => {
    const rule = createRule(clean);
    if (!attached) rule.setParentStyleSheet(null);
    const value = UrlValue.parse(`url("data:text/plain,resource" ${modifier} referrer-policy(no-referrer))`, {})!;
    const originalFetch = fetching.fetch;
    let initialRequest: fetching.FetchRequest | undefined;
    vi.spyOn(fetching, 'fetch').mockImplementation((request, options, requestEnv) => {
      initialRequest = request.clone();
      return originalFetch(request, options, requestEnv);
    });
    const body = await new Promise<Uint8Array | null | 'failure'>((resolve) => {
      const controller = fetchStyleResource(value, rule, 'style', mode, (_response, bytes) => resolve(bytes), env);
      expect(controller).not.toBeNull();
    });
    expect(body).toEqual(new TextEncoder().encode('resource'));
    expect(initialRequest).toMatchObject({
      destination: 'style', mode: requestMode, credentialsMode: credentials, useURLCredentials: true,
      referrerPolicy: 'no-referrer', initiatorType: clean && attached ? 'css' : null,
    });
    expect(initialRequest!.client).toBe(env);
    expect(initialRequest!.origin).toEqual(env.origin);
    expect(initialRequest!.referrer === undefined ? undefined : serializeURL(initialRequest!.referrer!))
      .toBe(requestMode === 'cors' && attached ? 'https://example.test/sheet-base/' : undefined);
  });

  it('does not fetch or invoke the response callback when URL parsing fails', () => {
    const fetch = vi.spyOn(fetching, 'fetch');
    const response = vi.fn();
    expect(fetchStyleResource(UrlValue.fromString('url', 'http://[', {}), createRule(), 'style', 'no-cors', response, env))
      .toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(response).not.toHaveBeenCalled();
  });
});

function createRule(originClean = true): CSSImportRuleImpl {
  const sheet = new CSSStyleSheetImpl({
    location: new env.userAgent.URL('https://example.test/sheet.css'),
    baseURL: new env.userAgent.URL('https://example.test/sheet-base/'),
    ownerNode: null, parentStyleSheet: null, ownerRule: null, media: '', title: '', alternate: false, originClean,
  }, env);
  const rule = new CSSImportRuleImpl(UrlValue.fromString('url', 'theme.css', {}), new MediaListImpl(''), env);
  rule.setParentStyleSheet(sheet);
  return rule;
}
