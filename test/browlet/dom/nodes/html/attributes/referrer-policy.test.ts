import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../../../src/browlet/browlet';
import { parseReferrerPolicyFromHeader } from '../../../../../../src/browlet/browsing/policy/referrer-policy';
import { referrerPolicyAttribute } from '../../../../../../src/browlet/dom/nodes/html/attributes/referrer-policy';
import { FetchHeaders } from '../../../../../../src/fetch/headers';
import { FetchRequest } from '../../../../../../src/fetch/request';
import { FetchResponse } from '../../../../../../src/fetch/response';
import { mockHTTPTransport } from '../../../../../fetch/transport-fixture';
import { getRelevantRealm } from '../../../../../support/browlet-binding';
import { createFetchOperation } from '../../../../fetch-fixture';

describe('HTML referrer policy attributes', () => {
  it.each([
    '', 'no-referrer', 'no-referrer-when-downgrade', 'same-origin', 'origin',
    'strict-origin', 'origin-when-cross-origin', 'strict-origin-when-cross-origin', 'unsafe-url',
  ])('recognizes the %j keyword and its ASCII case variants', (keyword) => {
    for (const value of [keyword, keyword.toUpperCase()]) {
      const state = referrerPolicyAttribute.getState(value)!;
      expect(state).toBe(keyword);
      expect(referrerPolicyAttribute.getCanonicalKeyword(state)).toBe(keyword);
      expect(referrerPolicyAttribute.isValidValue(value)).toBe(true);
    }
  });

  it.each([
    null, 'invalid', ' origin ', '\torigin', 'origin\n', 'origin, no-referrer',
    'always', 'never', 'default', 'ſame-origin',
  ])('defers policy selection for %j without accepting it as a keyword', (value) => {
    expect(referrerPolicyAttribute.getState(value)).toBe('');
    if (value !== null) expect(referrerPolicyAttribute.isValidValue(value)).toBe(false);
  });

  it.each([
    ['origin, no-referrer', 'no-referrer'],
    [' origin ', 'origin'],
  ])('keeps the attribute rule distinct from header parsing for %j', (value, headerPolicy) => {
    const response = new FetchResponse();
    response.headerList.append('Referrer-Policy', value);
    expect(parseReferrerPolicyFromHeader(response)).toBe(headerPolicy);
    expect(referrerPolicyAttribute.getState(value)).toBe('');
  });

  // Exercise the request boundary directly; element loading does not exist yet.
  it.each([
    [null, 'https://example.test/'],
    ['', 'https://example.test/'],
    ['invalid', 'https://example.test/'],
    ['origin, no-referrer', 'https://example.test/'],
    ['NO-REFERRER', null],
    ['unsafe-url', 'https://example.test/page?q=1'],
  ])('lets Fetch apply the interpreted %j policy to the outgoing Referer header', async (value, expected) => {
    const browser = new Browlet({ route: () => '', reporting: false });
    await browser.navigate('https://example.test/page?q=1#fragment');
    const env = getRelevantRealm(browser.window).env;
    env.policyContainer.referrerPolicy = 'origin';
    const request = new FetchRequest(env.parseURL('https://example.test/resource').url!, env, env.userAgent);
    request.allowServiceWorkerInterception = false;
    request.referrerPolicy = referrerPolicyAttribute.getState(value)!;
    const sent: (string | null)[] = [];
    mockHTTPTransport(env.userAgent, (wire, listener) => {
      sent.push(wire.headers.get('Referer'));
      listener.onHeaders(200, '', new FetchHeaders(), false);
      listener.onEnd();
    });
    const response = await createFetchOperation(request, env).start();
    expect(response.status).toBe(200);
    expect(sent).toEqual([expected]);
  });
});
