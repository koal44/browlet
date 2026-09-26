import { describe, expect, it } from 'vitest';
import { FetchRequest } from '../../../src/fetch/request';
import { FetchResponse } from '../../../src/fetch/response';
import { createOpaqueOrigin } from '../../../src/url/origin';
import { parseURL } from '../../../src/url/url';
import { createClientEnvironment } from '../client-fixture';

describe('Fetch CORS check', () => {
  it.each([
    [undefined, 'same-origin', undefined, true],
    ['https://example.test', 'same-origin', undefined, false],
    ['https://other.test', 'same-origin', undefined, true],
    ['*', 'omit', undefined, false],
    ['*', 'same-origin', undefined, false],
    ['*', 'include', 'true', true],
    ['https://example.test', 'include', 'true', false],
    ['https://example.test', 'include', undefined, true],
    ['https://example.test', 'include', 'True', true],
    ['https://example.test', 'include', 'false', true],
    ['https://example.test/', 'omit', undefined, true],
    ['https://EXAMPLE.test', 'omit', undefined, true],
    ['https://example.test, https://other.test', 'omit', undefined, true],
  ] as const)('checks origin %s, credentials %s, and permission %s', (origin, credentials, allowCredentials, blocked) => {
    const { request, response } = fixture();
    request.credentialsMode = credentials;
    if (origin !== undefined) response.headerList.append('Access-Control-Allow-Origin', origin);
    if (allowCredentials !== undefined) response.headerList.append('Access-Control-Allow-Credentials', allowCredentials);
    expect(response.isBlockedByCORS(request)).toBe(blocked);
  });

  it('rejects repeated allow-origin and allow-credentials fields', () => {
    const { request, response } = fixture();
    response.headerList.append('Access-Control-Allow-Origin', request.serializeOrigin());
    response.headerList.append('Access-Control-Allow-Origin', request.serializeOrigin());
    expect(response.isBlockedByCORS(request)).toBe(true);
    response.headerList.set('Access-Control-Allow-Origin', request.serializeOrigin());
    request.credentialsMode = 'include';
    response.headerList.append('Access-Control-Allow-Credentials', 'true');
    response.headerList.append('Access-Control-Allow-Credentials', 'true');
    expect(response.isBlockedByCORS(request)).toBe(true);
  });

  it('uses null for opaque origins and origins tainted by a cross-origin redirect', () => {
    const { request, response } = fixture();
    response.headerList.append('Access-Control-Allow-Origin', 'null');
    expect(response.isBlockedByCORS(request)).toBe(true);
    request.urlList.push(parseURL('https://third.test/').url!);
    expect(response.isBlockedByCORS(request)).toBe(false);
    request.origin = createOpaqueOrigin();
    expect(response.isBlockedByCORS(request)).toBe(false);
  });
});

function fixture() {
  const env = createClientEnvironment();
  const request = new FetchRequest(parseURL('https://other.test/resource').url!, env, env.userAgent);
  request.populateFromClient();
  return { request, response: new FetchResponse() };
}
