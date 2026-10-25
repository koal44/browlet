import { afterEach, expect, it, vi } from 'vitest';

import { parseURL } from '../../../src/url/index';
import * as fetching from '../../../src/fetch/index';
import { CSSStyleSheetImpl, type CSSImportRuleImpl } from '../../../src/stylelet/index';
import { createFetchedStyleSheet, fetchCSSStyleSheet, loadStyleSheetImports } from '../../../src/browlet/style/stylesheet-loading';
import { DocumentMode } from '../../../src/browlet/dom/nodes/document';
import { createTestDocument } from '../../support/dom';

afterEach(() => vi.restoreAllMocks());

it('decodes a sheet using its document encoding and captures the response policy', () => {
  const document = createTestDocument();
  document.encoding = 'windows-1252';
  const url = parseURL('https://example.test/style.css').url!;
  const response = new fetching.FetchResponse();
  response.headerList.append('Referrer-Policy', 'origin, no-referrer');
  const sheet = createFetchedStyleSheet(url, response, Buffer.from('.caf\xe9 { opacity: .5 }', 'latin1'), {
    ownerNode: null, media: '', title: '', alternate: false,
  }, document);

  expect(sheet.encoding).toBe('windows-1252');
  expect(sheet.referrerPolicy).toBe('no-referrer');
  expect(sheet.cssRules.item(0)).toMatchObject({ selectorText: '.café' });
});

it('uses the supplied document security state and reads quirks mode and encoding at response time', async () => {
  const document = createLoadingDocument();
  const env = document.env;
  const originalFetch = fetching.fetch;
  let request: fetching.FetchRequest | undefined;
  vi.spyOn(fetching, 'fetch').mockImplementation((value, options, owner) => {
    request = value.clone();
    return originalFetch(value, options, owner);
  });
  const url = parseURL('data:text/plain,.caf%E9%20%7B%20opacity:%20.5%20%7D').url!;
  const result = new Promise<CSSStyleSheetImpl | null>((resolve) => {
    fetchCSSStyleSheet(url, document.url, document, {}, (response, bytes) => {
      resolve(bytes === null ? null : createFetchedStyleSheet(url, response, bytes, {
        ownerNode: null, media: '', title: '', alternate: false,
      }, document));
    });
  });
  document.mode = DocumentMode.Quirks;
  document.encoding = 'windows-1252';

  const sheet = await result;
  expect(sheet).not.toBeNull();
  expect(sheet!.encoding).toBe('windows-1252');
  expect(sheet!.cssRules.item(0)).toMatchObject({ selectorText: '.café' });
  expect(request!.client).toBe(env);
  expect(request!.origin).toBe(document.origin);
  expect(request!.policyContainer).toBe(document.policyContainer);
  expect(request!.origin).not.toBe(env.origin);
  expect(request!.policyContainer).not.toBe(env.policyContainer);
});

it('loads nested imports using the inline document URL and current policy', async () => {
  const document = createLoadingDocument();
  const env = document.env;
  const originalFetch = fetching.fetch;
  const requests: fetching.FetchRequest[] = [];
  vi.spyOn(fetching, 'fetch').mockImplementation((request, options, owner) => {
    requests.push(request.clone());
    return originalFetch(request, options, owner);
  });
  const sheet = new CSSStyleSheetImpl({
    location: null, baseURL: env.apiBaseURL, encoding: 'UTF-8', ownerNode: null,
    parentStyleSheet: null, ownerRule: null, media: '', title: '', alternate: false, originClean: true,
  }, env);
  const leafURL = `data:text/css,${encodeURIComponent('p { opacity: .5 }')}`;
  const childURL = `data:text/css,${encodeURIComponent(`@import "${leafURL}";`)}`;
  sheet.insertRule(`@import "${childURL}";`);
  document.policyContainer.referrerPolicy = 'unsafe-url';
  const success = await new Promise<boolean>((resolve) => {
    loadStyleSheetImports(sheet, document, () => ({}), resolve);
  });

  expect(success).toBe(true);
  expect(requests).toHaveLength(2);
  expect(requests[0]!.referrer).toEqual(document.url);
  expect(requests[0]!.referrerPolicy).toBe('unsafe-url');
  expect(requests[1]!.referrerPolicy).toBe('strict-origin-when-cross-origin');
  const child = (sheet.ruleList.item(0) as CSSImportRuleImpl).styleSheet!;
  const leaf = (child.ruleList.item(0) as CSSImportRuleImpl).styleSheet!;
  expect(leaf.cssRules.item(0)).toMatchObject({ selectorText: 'p' });
});

/** A detached document whose origin and policies differ from the environment's active document. */
function createLoadingDocument() {
  const document = createTestDocument();
  document.url = parseURL('https://document.test/page').url!;
  return document;
}
