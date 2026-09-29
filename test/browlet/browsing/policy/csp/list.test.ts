import { describe, expect, it } from 'vitest';
import { CSPList } from '../../../../../src/browlet/browsing/policy/csp/list';
import { ContentSecurityPolicy } from '../../../../../src/browlet/browsing/policy/csp/policy';
import { FetchResponse } from '../../../../../src/fetch/response';
import { createOpaqueOrigin } from '../../../../../src/url/origin';
import { obtainURLOrigin, parseURL } from '../../../../../src/url/url';

describe('CSP lists', () => {
  it('starts with independent empty lists and a known origin', () => {
    const origin = createOpaqueOrigin();
    const first = new CSPList(origin);
    const second = new CSPList(origin);
    expect(first.policies).toEqual([]);
    expect(first.selfOrigin).toBe(origin);
    expect(first.policies).not.toBe(second.policies);
    expect(first.hasHeaderDeliveredPolicy()).toBe(false);
  });

  it('distinguishes meta-only lists from either kind of header policy', () => {
    const list = new CSPList(createOpaqueOrigin());
    list.policies.push(ContentSecurityPolicy.parse("default-src 'self'", 'meta', 'enforce'));
    expect(list.hasHeaderDeliveredPolicy()).toBe(false);
    list.policies.push(ContentSecurityPolicy.parse("script-src 'none'", 'header', 'report'));
    expect(list.hasHeaderDeliveredPolicy()).toBe(true);
    list.policies.pop();
    list.policies.push(ContentSecurityPolicy.parse("img-src 'none'", 'header', 'enforce'));
    expect(list.hasHeaderDeliveredPolicy()).toBe(true);
  });

  it('copies policy data while retaining the inherited self origin', () => {
    const origin = obtainURLOrigin(parseURL('https://creator.test:8443/document').url!);
    const list = new CSPList(origin);
    list.policies.push(ContentSecurityPolicy.parse("default-src 'self'", 'header', 'enforce'));
    const copy = list.clone();
    expect(copy).toEqual(list);
    expect(copy.selfOrigin).toBe(origin);
    copy.policies[0]!.directives.get('default-src')!.tokens.push('https://other.test');
    copy.policies.push(ContentSecurityPolicy.parse("img-src 'none'", 'header', 'report'));
    expect(list.policies).toHaveLength(1);
    expect(list.policies[0]!.directives.get('default-src')?.tokens).toEqual(["'self'"]);
  });
});

describe('Response CSP parsing', () => {
  it('parses enforcing headers before report-only headers, preserving order within each kind', () => {
    const response = responseAt('https://resource.test/page');
    response.headerList.append('Content-Security-Policy-Report-Only', "script-src 'none'");
    response.headerList.append('cOnTeNt-SeCuRiTy-PoLiCy', "default-src 'self', img-src https://images.test");
    response.headerList.append('Content-Security-Policy', 'script-src https://scripts.test');
    response.headerList.append('content-security-policy-report-only', "style-src 'none'");
    response.headerList.append('Unrelated', 'ignored');
    const list = CSPList.parse(response);
    expect(list.policies.map((policy) => [policy.disposition, [...policy.directives]])).toEqual([
      ['enforce', [['default-src', { tokens: ["'self'"] }]]],
      ['enforce', [['img-src', { tokens: ['https://images.test'] }]]],
      ['enforce', [['script-src', { tokens: ['https://scripts.test'] }]]],
      ['report', [['script-src', { tokens: ["'none'"] }]]],
      ['report', [['style-src', { tokens: ["'none'"] }]]],
    ]);
    expect(list.policies.every((policy) => policy.source === 'header')).toBe(true);
    expect(list.hasHeaderDeliveredPolicy()).toBe(true);
  });

  it('keeps policies with the same directive separate rather than merging their values', () => {
    const response = responseAt('https://resource.test/');
    response.headerList.append('Content-Security-Policy', "default-src 'self', default-src 'none'");
    const list = CSPList.parse(response);
    expect(list.policies.map((policy) => policy.directives.get('default-src')?.tokens)).toEqual([["'self'"], ["'none'"]]);
  });

  it('takes self origin from the final response URL rather than the first URL', () => {
    const response = responseAt('https://initial.test/');
    response.urlList.push(parseURL('https://final.test:8443/document').url!);
    const list = CSPList.parse(response);
    expect(list.selfOrigin).toEqual(obtainURLOrigin(response.url!));
    expect(list.selfOrigin).not.toEqual(obtainURLOrigin(response.urlList[0]!));
  });

  it('retains an origin even when no policies were supplied', () => {
    const response = responseAt('https://resource.test/');
    const list = CSPList.parse(response);
    expect(list.policies).toEqual([]);
    expect(list.selfOrigin).toEqual(obtainURLOrigin(response.url!));
    expect(list.hasHeaderDeliveredPolicy()).toBe(false);
  });

  it('omits empty or entirely malformed policies', () => {
    const response = responseAt('https://resource.test/');
    response.headerList.append('Content-Security-Policy', ', ;, img_src nope, img-src caf\u00E9.test,,');
    response.headerList.append('Content-Security-Policy-Report-Only', ' ; ');
    const list = CSPList.parse(response);
    expect(list.policies).toEqual([]);
    expect(list.hasHeaderDeliveredPolicy()).toBe(false);
  });

  it('preserves valid sibling directives and subsequent header lines around malformed text', () => {
    const response = responseAt('https://resource.test/');
    response.headerList.append('Content-Security-Policy', "script-src 'none'; img-src caf\u00E9.test; style-src 'self'");
    response.headerList.append('Content-Security-Policy', 'connect-src https://api.test');
    expect(CSPList.parse(response).policies.map((policy) => [...policy.directives.keys()])).toEqual([
      ['script-src', 'style-src'], ['connect-src'],
    ]);
  });

  it('does not treat double quotes as escaping a policy-separating comma', () => {
    const response = responseAt('https://resource.test/');
    response.headerList.append('Content-Security-Policy', 'future-directive "first, script-src https://scripts.test');
    expect(CSPList.parse(response).policies.map((policy) => [...policy.directives.keys()])).toEqual([
      ['future-directive'], ['script-src'],
    ]);
  });

  it('requires a response URL instead of manufacturing a self origin', () => {
    expect(() => CSPList.parse(new FetchResponse())).toThrow('CSP response parsing requires a response URL');
  });
});

function responseAt(url: string): FetchResponse {
  const response = new FetchResponse();
  response.urlList = [parseURL(url).url!];
  return response;
}
