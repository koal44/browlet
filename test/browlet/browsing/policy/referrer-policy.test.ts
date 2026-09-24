import { describe, expect, it } from 'vitest';

import {
  determineRequestReferrer, parseReferrerPolicyFromHeader,
  setRequestReferrerPolicyOnRedirect, stripURLForReferrer,
} from '../../../../src/browlet/browsing/policy/referrer-policy';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { FetchRequest } from '../../../../src/fetch/request';
import { FetchResponse } from '../../../../src/fetch/response';
import type { ReferrerPolicy } from '../../../../src/fetch/environment';
import { obtainURLOrigin, parseURL, serializeURL } from '../../../../src/url/url';
import { createClientEnvironment, createFetchUserAgent } from '../../../fetch/client-fixture';

describe('Referrer-Policy header parsing', () => {
  it.each([
    'no-referrer', 'no-referrer-when-downgrade', 'same-origin', 'origin', 'strict-origin',
    'origin-when-cross-origin', 'strict-origin-when-cross-origin', 'unsafe-url',
  ])('recognizes %s', (policy) => {
    expect(parseReferrerPolicyFromHeader(createResponse(policy))).toBe(policy);
  });

  it('returns an empty policy when the header is absent', () => {
    expect(parseReferrerPolicyFromHeader(new FetchResponse())).toBe('');
  });

  it('selects the last recognized token across repeated, case-insensitive header names', () => {
    const response = createResponse('no-referrer, origin');
    response.headerList.append('referrer-policy', 'same-origin, strict-origin');
    expect(parseReferrerPolicyFromHeader(response)).toBe('strict-origin');
  });

  it('accepts HTTP spaces and tabs and the grammar\'s case-insensitive policy tokens', () => {
    expect(parseReferrerPolicyFromHeader(createResponse(' \tORIGIN\t ,\t No-Referrer '))).toBe('no-referrer');
  });

  it.each(['', ', ,\t,', 'future-policy', 'always, never, default'])(
    'returns an empty policy for %j', (value) => {
      expect(parseReferrerPolicyFromHeader(createResponse(value))).toBe('');
    },
  );

  it.each(['origin, future-policy', ',origin,,,', 'future-policy, origin, never'])(
    'ignores empty entries and unknown well-formed extension tokens in %j', (value) => {
      expect(parseReferrerPolicyFromHeader(createResponse(value))).toBe('origin');
    },
  );

  it.each(['invalid!', 'future2', '"origin"', 'same origin', 'policy/one', 'orig\u0131n', '\forigin', 'origin\r\n'])(
    'rejects the complete value when a token is malformed: %j', (invalid) => {
      expect(parseReferrerPolicyFromHeader(createResponse(`no-referrer, ${invalid}`))).toBe('');
      expect(parseReferrerPolicyFromHeader(createResponse(`${invalid}, no-referrer`))).toBe('');
    },
  );

  it('rejects all field values if a repeated header contains a malformed token', () => {
    const response = createResponse('no-referrer');
    response.headerList.append('Referrer-Policy', 'invalid!');
    response.headerList.append('Referrer-Policy', 'origin');
    expect(parseReferrerPolicyFromHeader(response)).toBe('');
  });

  it('does not mutate response headers while parsing', () => {
    const response = createResponse('ORIGIN, strict-origin');
    const before = response.headerList.clone();
    expect(parseReferrerPolicyFromHeader(response)).toBe('strict-origin');
    expect(response.headerList).toEqual(before);
  });
});

describe('Request referrer policy on redirect', () => {
  it('replaces the request policy with the last recognized response policy', () => {
    const request = createRequest();
    const response = createResponse('no-referrer, origin');
    setRequestReferrerPolicyOnRedirect(request, response);
    expect(request.referrerPolicy).toBe('origin');
  });

  it.each([undefined, '', 'future-policy', 'no-referrer, invalid!'])(
    'preserves the existing policy when the response supplies %j', (value) => {
      const request = createRequest();
      const response = value === undefined ? new FetchResponse() : createResponse(value);
      setRequestReferrerPolicyOnRedirect(request, response);
      expect(request.referrerPolicy).toBe('strict-origin-when-cross-origin');
    },
  );

  it('updates policy across successive redirects without prematurely rewriting the referrer URL', () => {
    const request = createRequest();
    const referrer = parseURL('https://example.test/source?q=1').url!;
    request.referrer = referrer;
    setRequestReferrerPolicyOnRedirect(request, createResponse('no-referrer'));
    setRequestReferrerPolicyOnRedirect(request, createResponse('unsafe-url'));
    expect(request.referrerPolicy).toBe('unsafe-url');
    expect(request.referrer).toBe(referrer);
  });

  it('feeds the new policy into the request\'s Origin header algorithm', () => {
    const request = createRequest();
    request.origin = obtainURLOrigin(parseURL('https://example.test/').url!);
    request.method = 'POST';
    setRequestReferrerPolicyOnRedirect(request, createResponse('no-referrer'));
    request.appendOriginHeader();
    expect(request.headerList.get('Origin')).toBe('null');
  });
});

describe('Request referrer calculation', () => {
  const source = 'https://example.test/source?q=1';
  const origin = 'https://example.test/';
  const none = null;
  const targets = ['https://example.test/target', 'https://other.test/', 'http://other.test/'];

  it.each([
    ['no-referrer', [none, none, none]],
    ['no-referrer-when-downgrade', [source, source, none]],
    ['same-origin', [source, none, none]],
    ['origin', [origin, origin, origin]],
    ['strict-origin', [origin, origin, none]],
    ['origin-when-cross-origin', [source, origin, origin]],
    ['strict-origin-when-cross-origin', [source, origin, none]],
    ['unsafe-url', [source, source, source]],
  ] satisfies [ReferrerPolicy, (string | null)[]][])(
    'applies %s to same-origin, cross-origin, and downgraded requests', (policy, expected) => {
      for (const [i, target] of targets.entries()) {
        const request = new FetchRequest(parseURL(target).url!, null, new UserAgent());
        request.referrer = parseURL(`${source}#fragment`).url!;
        request.referrerPolicy = policy;
        const result = determineRequestReferrer(request);
        expect(result === null ? null : serializeURL(result)).toBe(expected[i]);
      }
    },
  );

  it('selects the client source without changing it', () => {
    const client = createClientEnvironment(`${source}#fragment`);
    const request = new FetchRequest(parseURL(targets[0]!).url!, client, new UserAgent());
    request.referrerPolicy = 'unsafe-url';
    const result = determineRequestReferrer(request);
    expect(result === null ? null : serializeURL(result)).toBe(source);
    const unchanged = client.getReferrerSource();
    expect(unchanged === null ? null : serializeURL(unchanged)).toBe(`${source}#fragment`);
  });

  it('allows an explicit URL with no client, and does not consult a client when one is present', () => {
    const request = new FetchRequest(parseURL(targets[0]!).url!, null, new UserAgent());
    request.referrerPolicy = 'origin';
    request.referrer = parseURL(source).url!;
    const result = determineRequestReferrer(request);
    expect(result === null ? null : serializeURL(result)).toBe(origin);
    request.client = createClientEnvironment();
    request.client.getReferrerSource = () => { throw new Error('A resolved referrer does not use the client'); };
    expect(determineRequestReferrer(request)).toEqual(result);
    request.referrer = null;
    expect(determineRequestReferrer(request)).toBeNull();
  });

  it('suppresses referrers for an absent client or a client prohibiting disclosure', () => {
    const request = createRequest();
    expect(determineRequestReferrer(request)).toBe(none);
    request.client = createClientEnvironment();
    request.client.getReferrerSource = () => null;
    expect(determineRequestReferrer(request)).toBe(none);
  });

  it.each(['about:blank', 'about:srcdoc', 'data:text/html,hello', 'blob:https://example.test/id'])(
    'never discloses a local source: %s', (url) => {
      const request = createRequest();
      request.referrerPolicy = 'unsafe-url';
      request.referrer = parseURL(url).url!;
      expect(determineRequestReferrer(request)).toBe(none);
    },
  );

  it.each([4096, 4097])('limits a stripped referrer of length %i', (length) => {
    const request = createRequest();
    request.referrerPolicy = 'unsafe-url';
    const full = origin + 'a'.repeat(length - origin.length);
    request.referrer = parseURL(`${full}#ignored`).url!;
    const result = determineRequestReferrer(request);
    expect(result === null ? null : serializeURL(result)).toBe(length === 4096 ? full : origin);
    expect(serializeURL(request.referrer)).toBe(`${full}#ignored`);
  });

  it.each(['http://localhost/', 'http://127.0.0.1/', 'http://[::1]/'])(
    'uses trustworthiness rather than HTTPS alone for %s', (loopback) => {
      const request = new FetchRequest(parseURL(loopback).url!, null, new UserAgent());
      request.referrerPolicy = 'strict-origin';
      request.referrer = parseURL(source).url!;
      const result = determineRequestReferrer(request);
      expect(result === null ? null : serializeURL(result)).toBe(origin);

      request.referrer = parseURL(loopback).url!;
      request.urlList.push(parseURL('http://other.test/').url!);
      expect(determineRequestReferrer(request)).toBe(none);
    },
  );

  it('uses the owning user agent\'s configured trust policy', () => {
    const userAgent = new UserAgent();
    const request = new FetchRequest(parseURL('http://trusted.test/target').url!, null, userAgent);
    request.referrerPolicy = 'strict-origin';
    request.referrer = parseURL(source).url!;
    expect(determineRequestReferrer(request)).toBe(none);
    const trustedOrigin = obtainURLOrigin(request.currentURL);
    if (trustedOrigin.kind !== 'tuple') throw new Error('Expected a tuple origin');
    userAgent.trustworthyOrigins.push(trustedOrigin);
    const result = determineRequestReferrer(request);
    expect(result === null ? null : serializeURL(result)).toBe(origin);
  });

  it('uses the current redirect URL and the updated policy', () => {
    const request = new FetchRequest(parseURL(targets[0]!).url!, null, new UserAgent());
    request.referrerPolicy = 'same-origin';
    request.referrer = parseURL(source).url!;
    const result = determineRequestReferrer(request);
    expect(result === null ? null : serializeURL(result)).toBe(source);
    request.urlList.push(parseURL(targets[1]!).url!);
    expect(determineRequestReferrer(request)).toBe(none);
    setRequestReferrerPolicyOnRedirect(request, createResponse('origin'));
    const redirected = determineRequestReferrer(request);
    expect(redirected === null ? null : serializeURL(redirected)).toBe(origin);
  });
});

describe('URL stripping for referrers', () => {
  it('removes credentials and fragments without mutating the source', () => {
    const url = parseURL('https://user:password@example.test:8443/path?q=1#fragment').url!;
    const full = stripURLForReferrer(url);
    const origin = stripURLForReferrer(url, true);
    expect(full === null ? null : serializeURL(full)).toBe('https://example.test:8443/path?q=1');
    expect(origin === null ? null : serializeURL(origin)).toBe('https://example.test:8443/');
    expect(serializeURL(url)).toBe('https://user:password@example.test:8443/path?q=1#fragment');
  });

  it.each(['about:blank', 'data:,hello', 'blob:https://example.test/id'])(
    'omits the local URL %s with either flag', (source) => {
      const url = parseURL(source).url!;
      expect(stripURLForReferrer(url)).toBeNull();
      expect(stripURLForReferrer(url, true)).toBeNull();
    },
  );
});

function createResponse(policy: string): FetchResponse {
  const response = new FetchResponse();
  response.headerList.append('Referrer-Policy', policy);
  return response;
}

function createRequest(): FetchRequest {
  const request = new FetchRequest(parseURL('https://other.test/').url!, null, createFetchUserAgent());
  request.referrerPolicy = 'strict-origin-when-cross-origin';
  return request;
}
