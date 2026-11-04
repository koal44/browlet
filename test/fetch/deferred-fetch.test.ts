import { describe, expect, it } from 'vitest';

import { FetchBody, FetchRequest } from '../../src/fetch/index';
import { parseURL } from '../../src/url/index';
import { createClientEnvironment } from './client-fixture';

describe('deferred fetch request length', () => {
  it.each([undefined, null, 'https://source.test/page#referrer'])(
    'counts the URL, referrer, header bytes and body (referrer=%s)', (referrer) => {
      const env = createClientEnvironment();
      const request = new FetchRequest(parseURL('https://target.test/collect#ignored').url!, env);
      request.referrer = typeof referrer === 'string' ? parseURL(referrer).url! : referrer;
      request.headerList.append('X-Test', '\u00e9');
      request.headerList.append('X-Test', 'second');
      request.body = new Uint8Array(19);
      expect(request.totalRequestLength).toBe(
        'https://target.test/collect'.length + (referrer === undefined ? 'about:client'.length : referrer?.length ?? 0) +
        'X-Test'.length * 2 + 1 + 'second'.length + 19,
      );
      expect(request.url.fragment).toBe('ignored');
    },
  );

  it('counts an absent body as zero and uses the initial URL rather than a redirect', () => {
    const request = new FetchRequest(parseURL('https://target.test/').url!, createClientEnvironment());
    request.referrer = null;
    request.urlList.push(parseURL('https://redirect.test/longer').url!);
    expect(request.totalRequestLength).toBe('https://target.test/'.length);
  });

  it('reads the retained body length without consuming its stream and rejects an unknown length', () => {
    const env = createClientEnvironment();
    const request = new FetchRequest(parseURL('https://target.test/').url!, env);
    const body = FetchBody.fromBytes(new Uint8Array(23), env);
    request.body = body;
    expect(request.totalRequestLength).toBe('https://target.test/'.length + 'about:client'.length + 23);
    expect(body.stream.disturbed).toBe(false);
    body.length = null;
    expect(() => request.totalRequestLength).toThrow('Deferred fetch quota requires a known body length');
  });
});
