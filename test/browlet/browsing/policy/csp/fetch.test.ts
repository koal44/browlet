import { describe, expect, it } from 'vitest';
import { CSPDirectiveValue } from '../../../../../src/browlet/browsing/policy/csp/directives';
import { Browlet } from '../../../../../src/browlet/browlet';
import { getRelevantRealm } from '../../../../../src/browlet/bindings';
import { CSPList } from '../../../../../src/browlet/browsing/policy/csp/list';
import { FetchRequest } from '../../../../../src/fetch/request';
import { FetchResponse } from '../../../../../src/fetch/response';
import { parseURL } from '../../../../../src/url/url';

describe('Fetch CSP integration', () => {
  it('requires populated request policies while allowing an absent or empty CSP list', () => {
    const env = getRelevantRealm(new Browlet({ route: () => '' }).window).env;
    const request = new FetchRequest(parseURL('https://resource.test/').url!, null, env.userAgent);
    expect(() => request.isBlockedByCSP()).toThrow('policy container has not been resolved');
    expect(() => request.reportCSPViolations()).toThrow('policy container has not been resolved');
    expect(() => responseAt('https://resource.test/').isBlockedByCSP(request)).toThrow('policy container has not been resolved');
    request.origin = env.origin;
    request.populateFromClient();
    expect(request.isBlockedByCSP()).toBe(false);
    expect(() => request.reportCSPViolations()).not.toThrow();
    expect(responseAt('https://resource.test/').isBlockedByCSP(request)).toBe(false);
    const clientRequest = new FetchRequest(request.url, env, env.userAgent);
    clientRequest.populateFromClient();
    expect(env.policyContainer.cspList!.selfOrigin).toBe(env.origin);
    expect(clientRequest.isBlockedByCSP()).toBe(false);
  });

  it('uses the cloned list origin and policies through the actual browser environment', () => {
    const { env, request, list } = requestWithPolicy("img-src 'self'");
    expect(list.selfOrigin).not.toEqual(env.origin);
    list.policies[0]!.directives.set('img-src', new CSPDirectiveValue(["'none'"]));
    expect(request.isBlockedByCSP()).toBe(false);
    expect(responseAt('https://resource.test/image').isBlockedByCSP(request)).toBe(false);
  });

  it('does not enforce a monitored policy in the request-blocking pass', () => {
    const { request } = requestWithPolicy("img-src 'none'", true);
    expect(request.isBlockedByCSP()).toBe(false);
  });

  it('blocks when any enforcing policy rejects the request', () => {
    const { request } = requestWithPolicy("img-src https:, img-src 'none'");
    expect(request.isBlockedByCSP()).toBe(true);
  });

  it('completes the monitored request-reporting pass without enforcing its policy', () => {
    const { request } = requestWithPolicy("img-src 'none'", true);
    expect(() => request.reportCSPViolations()).not.toThrow();
    expect(request.isBlockedByCSP()).toBe(false);
  });

  it.each([false, true])('checks a response violation with report-only=%s', (reportOnly) => {
    const { request } = requestWithPolicy("img-src 'self'", reportOnly);
    expect(responseAt('https://substituted.test/image').isBlockedByCSP(request)).toBe(!reportOnly);
  });

  it('reports a requested script hash without changing the allow decision', () => {
    const { request } = requestWithPolicy("script-src https: 'report-sha256'; report-to reports");
    request.destination = 'script';
    expect(responseAt('https://resource.test/script').isBlockedByCSP(request)).toBe(false);
  });
});

function requestWithPolicy(serialized: string, reportOnly = false) {
  const env = getRelevantRealm(new Browlet({ route: () => '' }).window).env;
  const response = responseAt('https://resource.test/page');
  response.headerList.append(reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', serialized);
  const list = CSPList.parse(response);
  env.policyContainer.cspList = list;
  const request = new FetchRequest(parseURL('https://resource.test/image').url!, env, env.userAgent);
  request.destination = 'image';
  request.populateFromClient();
  return { env, request, list };
}

function responseAt(target: string): FetchResponse {
  const response = new FetchResponse();
  response.urlList.push(parseURL(target).url!);
  return response;
}
