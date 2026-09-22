import { describe, expect, it } from 'vitest';
import { InternalError } from '../../../src/infra/internal-error';
import { FetchRequest, type Destination, type FetchMode } from '../../../src/fetch/request';
import { createOpaqueOrigin } from '../../../src/url/origin';
import { obtainURLOrigin, parseURL } from '../../../src/url/url';
import { createClientSettings, createFetchUserAgent } from '../client-fixture';

describe('Fetch Metadata headers', () => {
  it('sets the three ordinary headers in specification order', () => {
    const request = createRequest();
    request.mode = 'cors';
    request.headerList.append('Accept', '*/*');

    request.appendFetchMetadataHeaders();

    expect(request.headerList.list).toEqual([
      ['Accept', '*/*'], ['Sec-Fetch-Dest', 'empty'],
      ['Sec-Fetch-Mode', 'cors'], ['Sec-Fetch-Site', 'same-origin'],
    ]);
    expect(request.destination).toBe('');
  });

  it.each<Destination>(['image', 'script', 'iframe', 'worker', 'serviceworker', 'webidentity'])(
    'serializes destination %s as a token', (destination) => {
      const request = createRequest();
      request.destination = destination;
      request.appendFetchMetadataHeaders();
      expect(request.headerList.get('Sec-Fetch-Dest')).toBe(destination);
    },
  );

  it.each<FetchMode>(['same-origin', 'cors', 'no-cors', 'navigate', 'websocket', 'webtransport'])(
    'serializes mode %s as a token', (mode) => {
      const request = createRequest();
      request.mode = mode;
      request.appendFetchMetadataHeaders();
      expect(request.headerList.get('Sec-Fetch-Mode')).toBe(mode);
    },
  );

  it('replaces existing metadata values and removes duplicate lines', () => {
    const request = createRequest();
    request.destination = 'document';
    request.mode = 'navigate';
    request.userActivation = true;
    request.headerList.list.push(
      ['sec-fetch-dest', 'image'], ['Sec-Fetch-Dest', 'style'],
      ['sec-fetch-mode', 'cors'], ['Sec-Fetch-Mode', 'no-cors'],
      ['sec-fetch-site', 'none'], ['Sec-Fetch-Site', 'cross-site'],
      ['sec-fetch-user', '?0'], ['Sec-Fetch-User', '?1'],
    );

    request.appendFetchMetadataHeaders();
    request.appendFetchMetadataHeaders();

    expect(request.headerList.list).toEqual([
      ['sec-fetch-dest', 'document'], ['sec-fetch-mode', 'navigate'],
      ['sec-fetch-site', 'same-origin'], ['sec-fetch-user', '?1'],
    ]);
  });
});

describe('Sec-Fetch-Site', () => {
  it.each([
    ['https://example.test/', 'https://example.test/other', 'same-origin'],
    ['https://example.test/', 'https://example.test:443/', 'same-origin'],
    ['https://example.test/', 'https://example.test:8443/', 'same-site'],
    ['https://a.example.test/', 'https://b.example.test/', 'same-site'],
    ['https://example.test/', 'https://other.test/', 'cross-site'],
    ['http://example.test/', 'https://example.test/', 'cross-site'],
    ['https://a.github.io/', 'https://b.github.io/', 'cross-site'],
    ['https://127.0.0.1/', 'https://127.0.0.1:8443/', 'same-site'],
    ['https://[::1]/', 'https://[::1]:8443/', 'same-site'],
  ])('compares origin %s with target %s as %s', (origin, target, site) => {
    const request = createRequest(target, origin);
    request.appendFetchMetadataHeaders();
    expect(request.headerList.get('Sec-Fetch-Site')).toBe(site);
  });

  it('uses the resolved request origin, independently of its client and referrer', () => {
    const request = createRequest();
    request.origin = obtainURLOrigin(parseURL('https://elsewhere.test/').url!);
    request.referrer = null;
    request.referrerPolicy = 'no-referrer';
    request.appendFetchMetadataHeaders();
    expect(request.headerList.get('Sec-Fetch-Site')).toBe('cross-site');
  });

  it('retains same-origin classification through same-origin redirects', () => {
    const request = createRequest();
    request.urlList.push(parseURL('https://example.test/final').url!);
    request.appendFetchMetadataHeaders();
    expect(request.headerList.get('Sec-Fetch-Site')).toBe('same-origin');
  });

  it('retains same-site classification after returning to the initiating origin', () => {
    const request = createRequest();
    request.urlList.push(parseURL('https://sub.example.test/').url!);
    request.appendFetchMetadataHeaders();
    expect(request.headerList.get('Sec-Fetch-Site')).toBe('same-site');
    request.urlList.push(parseURL('https://example.test/final').url!);
    request.appendFetchMetadataHeaders();
    expect(request.headerList.get('Sec-Fetch-Site')).toBe('same-site');
  });

  it('retains cross-site classification after cloning and returning to the initiating origin', () => {
    const request = createRequest();
    request.urlList.push(parseURL('https://other.test/').url!);
    request.appendFetchMetadataHeaders();
    expect(request.headerList.get('Sec-Fetch-Site')).toBe('cross-site');
    const clone = request.clone();
    clone.urlList.push(parseURL('https://example.test/final').url!);
    clone.appendFetchMetadataHeaders();
    expect(clone.headerList.get('Sec-Fetch-Site')).toBe('cross-site');
  });

  it('classifies an opaque initiating origin as cross-site', () => {
    const request = createRequest();
    request.origin = createOpaqueOrigin();
    request.appendFetchMetadataHeaders();
    expect(request.headerList.get('Sec-Fetch-Site')).toBe('cross-site');
  });

  it('requires client population to resolve the origin first', () => {
    const request = createRequest();
    request.origin = undefined;
    expect(() => request.appendFetchMetadataHeaders()).toThrow(InternalError);
  });
});

describe('Fetch Metadata navigation and activation', () => {
  it('distinguishes an activated page link from browser-UI initiation', () => {
    const request = createRequest('https://other.test/');
    request.destination = 'document';
    request.mode = 'navigate';
    request.userActivation = true;
    request.referrer = null;
    request.appendFetchMetadataHeaders();
    expect(request.headerList.get('Sec-Fetch-Site')).toBe('cross-site');
    expect(request.headerList.get('Sec-Fetch-User')).toBe('?1');
    expect(request.headerList.getStructuredFieldValue('Sec-Fetch-User', 'item')?.bareItem)
      .toEqual({ type: 'boolean', value: true });
  });

  it('retains browser-UI initiation and activation across redirects and cloning', () => {
    const request = new FetchRequest(parseURL('https://example.test/').url!, null, createFetchUserAgent());
    request.origin = createOpaqueOrigin();
    request.destination = 'document';
    request.mode = 'navigate';
    request.userActivation = true;
    request.appendFetchMetadataHeaders();
    expect(request.headerList.get('Sec-Fetch-Site')).toBe('none');
    const clone = request.clone();
    clone.urlList.push(parseURL('https://other.test/').url!);
    clone.appendFetchMetadataHeaders();
    expect(clone.headerList.get('Sec-Fetch-Site')).toBe('none');
    expect(clone.headerList.get('Sec-Fetch-User')).toBe('?1');
  });

  it.each<Destination>(['document', 'frame', 'iframe', 'embed', 'object'])(
    'includes activation for a %s navigation', (destination) => {
      const request = createRequest();
      request.destination = destination;
      request.mode = 'navigate';
      request.userActivation = true;
      request.appendFetchMetadataHeaders();
      expect(request.headerList.get('Sec-Fetch-Site')).toBe('same-origin');
      expect(request.headerList.get('Sec-Fetch-User')).toBe('?1');
    },
  );

  it('omits Sec-Fetch-User for navigation without activation', () => {
    const request = createRequest();
    request.destination = 'document';
    request.mode = 'navigate';
    request.appendFetchMetadataHeaders();
    expect(request.headerList.get('Sec-Fetch-User')).toBeNull();
  });

  it('does not infer navigation or activation from a missing client', () => {
    const request = new FetchRequest(parseURL('https://example.test/').url!, null, createFetchUserAgent());
    request.origin = createOpaqueOrigin();
    request.userActivation = true;
    request.appendFetchMetadataHeaders();
    expect(request.headerList.get('Sec-Fetch-Site')).toBe('cross-site');
    expect(request.headerList.get('Sec-Fetch-User')).toBeNull();
  });
});

describe('Fetch Metadata target trustworthiness', () => {
  it('leaves ordinary headers unchanged for an untrustworthy target', () => {
    const request = createRequest('http://example.test/');
    request.headerList.append('Accept', '*/*');
    request.appendFetchMetadataHeaders();
    expect(request.headerList.list).toEqual([['Accept', '*/*']]);
  });

  it('uses the current redirect target for the trustworthiness gate', () => {
    const request = createRequest('http://example.test/');
    request.urlList.push(parseURL('https://example.test/final').url!);
    request.appendFetchMetadataHeaders();
    expect(request.headerList.get('Sec-Fetch-Site')).toBe('cross-site');

    const downgrade = createRequest();
    downgrade.urlList.push(parseURL('http://example.test/final').url!);
    downgrade.appendFetchMetadataHeaders();
    expect(downgrade.headerList.list).toEqual([]);
  });
});

function createRequest(target = 'https://example.test/', origin = 'https://example.test/'): FetchRequest {
  const client = createClientSettings(origin);
  const request = new FetchRequest(parseURL(target).url!, client, client.userAgent);
  request.populateFromClient();
  return request;
}
