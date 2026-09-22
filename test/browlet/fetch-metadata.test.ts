import { describe, expect, it } from 'vitest';
import { getBindingContext, getRelevantRealm } from '../../src/browlet/bindings';
import { Browlet } from '../../src/browlet/browlet';
import { UserAgent } from '../../src/browlet/user-agent';
import { FetchRequest, RequestImpl } from '../../src/fetch/request';
import { createOpaqueOrigin } from '../../src/url/origin';
import { obtainURLOrigin, parseURL } from '../../src/url/url';

describe('Browlet Fetch Metadata integration', () => {
  it('uses projected Request inputs and keeps the outgoing headers separate from author headers', async () => {
    const browlet = new Browlet({ route: () => '' });
    await browlet.navigate('https://example.test/');
    const window = browlet.window as Window & typeof globalThis;
    const request = new window.Request('/resource', { headers: { 'Sec-Fetch-Site': 'none' } });
    const context = getBindingContext(getRelevantRealm(window));
    const source = context.unwrap(request, RequestImpl)!.getRequest();
    source.populateFromClient();
    const outgoing = source.clone();

    outgoing.appendFetchMetadataHeaders();

    expect(outgoing.client).toBe(getRelevantRealm(window).environment);
    expect(outgoing.headerList.list).toEqual([
      ['Sec-Fetch-Dest', 'empty'], ['Sec-Fetch-Mode', 'cors'], ['Sec-Fetch-Site', 'same-origin'],
    ]);
    expect(request.headers.get('Sec-Fetch-Site')).toBeNull();
    expect(source.headerList.list).toEqual([]);
  });

  it.each(['http://127.0.0.1/', 'http://[::1]/', 'http://localhost/', 'http://sub.localhost/'])(
    'uses browser trust policy for %s', (url) => {
      const request = new FetchRequest(parseURL(url).url!, null, new UserAgent());
      request.origin = createOpaqueOrigin();
      request.appendFetchMetadataHeaders();
      expect(request.headerList.get('Sec-Fetch-Dest')).toBe('empty');
      expect(request.headerList.get('Sec-Fetch-Site')).toBe('cross-site');
    },
  );

  it('honors trust exceptions only on the request-owning user agent', () => {
    const url = parseURL('http://example.test/').url!;
    const origin = obtainURLOrigin(url);
    if (origin.kind !== 'tuple') throw new Error('Expected tuple origin');
    const userAgent = new UserAgent();
    userAgent.trustworthyOrigins.push(origin);
    const trusted = new FetchRequest(url, null, userAgent);
    trusted.origin = origin;
    const ordinary = new FetchRequest(url, null, new UserAgent());
    ordinary.origin = origin;

    trusted.appendFetchMetadataHeaders();
    ordinary.appendFetchMetadataHeaders();

    expect(trusted.headerList.get('Sec-Fetch-Site')).toBe('same-origin');
    expect(ordinary.headerList.list).toEqual([]);
  });
});
