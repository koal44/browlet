import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import { CSPList } from '../../../../src/browlet/browsing/policy/csp/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { FetchResponse } from '../../../../src/fetch/index';
import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';

describe('navigation response X-Frame-Options', () => {
  it.each([
    [[], true],
    [[''], true],
    [['DENY'], false],
    [[' \tDeNy\t '], false],
    [['DENY', 'deny'], false],
    [['SAMEORIGIN'], true],
    [['SAMEORIGIN', 'sameorigin'], true],
    [[' \tSameOrigin, SAMEORIGIN\t '], true],
    [['SAMEORIGIN,'], false],
    [[',SAMEORIGIN'], false],
    [['DENY, SAMEORIGIN'], false],
    [['SAMEORIGIN', 'invalid'], false],
    [['DENY, invalid'], false],
    [['invalid, other'], true],
    [['invalid', 'INVALID'], true],
    [['ALLOWALL'], true],
    [['ALLOWALL', 'allowall'], true],
    [['ALLOWALL, invalid'], false],
    [['ALLOW-FROM https://elsewhere.test/'], true],
    [['SAMEORIGIN; DENY'], true],
    [['"DENY"'], true],
    // SPEC_CLASH(x-frame-options-quoted-values): HTML/Chromium ignore this single invalid value.
    [['"INVALID,SAMEORIGIN,INVALID"'], true],
  ] as const)('headers %j are allowed: %s', async (headers, allowed) => {
    const { child } = await fixture();
    expect(child.checkResponseFrameOptions(response(headers), undefined)).toBe(allowed);
  });

  it.each([
    ['frame-ancestors *', null, true],
    ["frame-ancestors 'none'", null, true],
    ['frame-ancestors', null, true],
    ['default-src *', null, false],
    ['frame-src *', null, false],
    [null, 'frame-ancestors *', false],
    ['default-src *', 'frame-ancestors *', false],
    ['default-src *; frame-ancestors *', "frame-ancestors 'none'", true],
  ] as const)('enforced CSP %s / report-only CSP %s overrides DENY: %s', async (enforced, reported, allowed) => {
    const { child } = await fixture();
    const result = response(['DENY']);
    if (enforced !== null) result.headerList.append('Content-Security-Policy', enforced);
    if (reported !== null) result.headerList.append('Content-Security-Policy-Report-Only', reported);
    // This is only XFO precedence; CSP must independently enforce empty/'none' ancestor lists.
    expect(child.checkResponseFrameOptions(result, CSPList.parse(result))).toBe(allowed);
  });

  it('finds an enforced frame-ancestors directive after unrelated policies', async () => {
    const { child } = await fixture();
    const result = response(['DENY']);
    result.headerList.append('Content-Security-Policy', 'default-src *');
    result.headerList.append('Content-Security-Policy', 'frame-ancestors *');
    expect(child.checkResponseFrameOptions(result, CSPList.parse(result))).toBe(true);
  });

  it('does not restrict top-level navigation', async () => {
    const { document } = await fixture();
    const result = response(['DENY']);
    result.urlList = [];
    expect(document.getNodeNavigable()!.checkResponseFrameOptions(result, undefined)).toBe(true);
  });

  it.each([
    ['https://elsewhere.test/next', false],
    ['http://example.test/next', false],
    ['https://example.test:8443/next', false],
    ['https://example.test:443/next', true],
  ])('compares the response origin strictly for %s: %s', async (url, allowed) => {
    const { child } = await fixture();
    expect(child.checkResponseFrameOptions(response(['SAMEORIGIN'], url), undefined)).toBe(allowed);
  });

  it('checks the final response URL after redirects', async () => {
    const { child } = await fixture();
    const result = response(['SAMEORIGIN'], 'https://elsewhere.test/redirect');
    result.urlList.push(parseURL('https://example.test/final').url!);
    expect(child.checkResponseFrameOptions(result, undefined)).toBe(true);
    result.urlList.push(parseURL('https://elsewhere.test/final').url!);
    expect(child.checkResponseFrameOptions(result, undefined)).toBe(false);
  });

  it('checks intermediate ancestors even when the top and response have the same origin', async () => {
    const { childDocument } = await fixture();
    childDocument.origin = obtainURLOrigin(parseURL('https://elsewhere.test/').url!);
    const { child } = createChild(childDocument);
    expect(child.checkResponseFrameOptions(response(['SAMEORIGIN']), undefined)).toBe(false);
  });

  it('checks the top ancestor even when the direct container and response have the same origin', async () => {
    const { document, childDocument } = await fixture();
    const { child } = createChild(childDocument);
    document.origin = obtainURLOrigin(parseURL('https://elsewhere.test/').url!);
    expect(child.checkResponseFrameOptions(response(['SAMEORIGIN']), undefined)).toBe(false);
  });

  it('admits a response whose origin matches every ancestor', async () => {
    const { childDocument } = await fixture();
    const { child } = createChild(childDocument);
    expect(child.checkResponseFrameOptions(response(['SAMEORIGIN']), undefined)).toBe(true);
  });

  it('rejects an opaque ancestor', async () => {
    const { document, child } = await fixture();
    document.origin = createOpaqueOrigin();
    expect(child.checkResponseFrameOptions(response(['SAMEORIGIN']), undefined)).toBe(false);
  });

  it('ignores document.domain relaxation', async () => {
    const { document, child } = await fixture();
    const origin = obtainURLOrigin(parseURL('https://sub.example.test/').url!);
    if (origin.kind !== 'tuple') throw new Error('Expected a tuple origin');
    origin.domain = { kind: 'domain', value: 'example.test' };
    document.origin = origin;
    expect(child.checkResponseFrameOptions(response(['SAMEORIGIN']), undefined)).toBe(false);
  });

  it('still admits matching origins when the ancestor has set document.domain', async () => {
    const { document, child } = await fixture();
    if (document.origin.kind !== 'tuple') throw new Error('Expected a tuple origin');
    document.origin.domain = { kind: 'domain', value: 'test' };
    expect(child.checkResponseFrameOptions(response(['SAMEORIGIN']), undefined)).toBe(true);
  });

  it('uses the response origin even when the incoming Document will be sandboxed to an opaque origin', async () => {
    const { child } = await fixture();
    const result = response(['SAMEORIGIN']);
    const target = child.snapshotTargetParams();
    target.sandboxingFlags.add('sandboxed-origin');
    const params = child.createNavigationParams(result, target);
    expect(params.origin.kind).toBe('opaque');
    expect(child.checkResponseFrameOptions(result, params.policyContainer.cspList)).toBe(true);
  });

  it('does not use the departing child Document origin', async () => {
    const { child, childDocument } = await fixture();
    childDocument.origin = obtainURLOrigin(parseURL('https://departing.test/').url!);
    expect(child.checkResponseFrameOptions(response(['SAMEORIGIN']), undefined)).toBe(true);
  });

  it('follows the container Document after adoption', async () => {
    const original = await fixture();
    const target = await fixture();
    target.document.origin = obtainURLOrigin(parseURL('https://elsewhere.test/').url!);
    target.document.adoptNode(original.iframe);
    expect(original.child.containerDocument).toBe(target.document);
    expect(original.child.checkResponseFrameOptions(response(['SAMEORIGIN']), undefined)).toBe(false);
  });

  it('requires a response URL only when SAMEORIGIN needs comparison', async () => {
    const { child } = await fixture();
    const result = new FetchResponse();
    expect(child.checkResponseFrameOptions(result, undefined)).toBe(true);
    result.headerList.append('X-Frame-Options', 'SAMEORIGIN');
    expect(() => child.checkResponseFrameOptions(result, undefined)).toThrow('SAMEORIGIN requires a response URL');
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/parent');
  const document = unwrap<DocumentImpl>(browser.document);
  return { document, ...createChild(document) };
}

function createChild(document: DocumentImpl) {
  const navigable = document.getNodeNavigable()!;
  const iframe = document.createElement('iframe') as HTMLIFrameElementImpl;
  const group = document.browsingContext!.topLevelBrowsingContext!.group!;
  const [, childDocument] = BrowsingContext.create(document, iframe, group);
  const child = new Navigable(DocumentState.create(childDocument), navigable);
  iframe.contentNavigable = child;
  document.body!.appendChild(iframe);
  return { child, childDocument, iframe };
}

function response(headers: readonly string[], url = 'https://example.test/next'): FetchResponse {
  const result = new FetchResponse();
  result.urlList.push(parseURL(url).url!);
  for (const value of headers) result.headerList.append('X-Frame-Options', value);
  return result;
}
