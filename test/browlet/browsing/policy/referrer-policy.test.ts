import { describe, expect, it } from 'vitest';

import { UserAgent } from '../../../../src/browlet/user-agent';
import { determineRequestReferrer, FetchRequest } from '../../../../src/fetch/index';
import { obtainURLOrigin, parseURL, serializeURL } from '../../../../src/url/index';

describe('Host trust policy in referrer calculation', () => {
  const source = 'https://example.test/source?q=1';
  const origin = 'https://example.test/';
  const none = null;

  it.each(['http://localhost/', 'http://127.0.0.1/', 'http://[::1]/'])(
    'uses trustworthiness rather than HTTPS alone for %s', (loopback) => {
      const request = new FetchRequest(parseURL(loopback).url!, new UserAgent().sandbox);
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
    const request = new FetchRequest(parseURL('http://trusted.test/target').url!, userAgent.sandbox);
    request.referrerPolicy = 'strict-origin';
    request.referrer = parseURL(source).url!;
    expect(determineRequestReferrer(request)).toBe(none);
    const trustedOrigin = obtainURLOrigin(request.currentURL);
    if (trustedOrigin.kind !== 'tuple') throw new Error('Expected a tuple origin');
    userAgent.trustworthyOrigins.push(trustedOrigin);
    const result = determineRequestReferrer(request);
    expect(result === null ? null : serializeURL(result)).toBe(origin);
  });
});
