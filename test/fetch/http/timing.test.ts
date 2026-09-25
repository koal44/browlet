import { describe, expect, it } from 'vitest';
import { FetchRequest } from '../../../src/fetch/request';
import { FetchResponse } from '../../../src/fetch/response';
import { createOpaqueOrigin } from '../../../src/url/origin';
import { parseURL } from '../../../src/url/url';
import { createClientEnvironment } from '../client-fixture';

describe('Fetch timing permission', () => {
  it('allows basic responses, while CORS and opaque responses need explicit permission', () => {
    const { request, response } = fixture();
    expect(response.isTimingAllowed(request)).toBe(true);
    request.responseTainting = 'cors';
    expect(response.isTimingAllowed(request)).toBe(false);
    request.responseTainting = 'opaque';
    expect(response.isTimingAllowed(request)).toBe(false);
  });

  it('accepts an origin in repeated lists and a wildcard even with credentials', () => {
    const { request, response } = fixture();
    request.responseTainting = 'cors';
    request.credentialsMode = 'include';
    response.headerList.append('Timing-Allow-Origin', 'https://wrong.test');
    response.headerList.append('Timing-Allow-Origin', 'https://another.test, https://example.test');
    expect(response.isTimingAllowed(request)).toBe(true);
    response.headerList.set('Timing-Allow-Origin', '*');
    expect(response.isTimingAllowed(request)).toBe(true);
    for (const value of ['https://EXAMPLE.test', '"https://example.test"', 'https://example.test/']) {
      response.headerList.set('Timing-Allow-Origin', value);
      expect(response.isTimingAllowed(request)).toBe(false);
    }
  });

  it('keeps a failed redirect-chain check sticky despite later explicit permission', () => {
    const { request, response } = fixture();
    request.timingAllowFailed = true;
    response.headerList.append('Timing-Allow-Origin', '*');
    expect(response.isTimingAllowed(request)).toBe(false);
  });

  it('requires explicit permission for a cross-origin navigation even with basic tainting', () => {
    const { request, response } = fixture();
    request.mode = 'navigate';
    expect(response.isTimingAllowed(request)).toBe(false);
    response.headerList.append('Timing-Allow-Origin', request.serializeOrigin());
    expect(response.isTimingAllowed(request)).toBe(true);
    response.headerList.delete('Timing-Allow-Origin');
    request.urlList = [parseURL('https://example.test/').url!];
    expect(response.isTimingAllowed(request)).toBe(true);
  });

  it('uses the serialized opaque or redirect-tainted origin', () => {
    const { request, response } = fixture();
    request.responseTainting = 'cors';
    response.headerList.append('Timing-Allow-Origin', 'null');
    expect(response.isTimingAllowed(request)).toBe(false);
    request.urlList.push(parseURL('https://third.test/').url!);
    expect(response.isTimingAllowed(request)).toBe(true);
    request.origin = createOpaqueOrigin();
    expect(response.isTimingAllowed(request)).toBe(true);
  });

  it('checks each navigation redirect against the final destination origin', () => {
    const { request, response } = fixture();
    expect(response.isNavigationTimingAllowed(request.origin!)).toBe(true);
    response.navigationTimingAllowValuesList = [['*'], ['https://example.test', 'https://other.test']];
    expect(response.isNavigationTimingAllowed(request.origin!)).toBe(true);
    response.navigationTimingAllowValuesList.push([]);
    expect(response.isNavigationTimingAllowed(request.origin!)).toBe(false);
  });
});

function fixture() {
  const env = createClientEnvironment();
  const request = new FetchRequest(parseURL('https://other.test/resource').url!, env, env.userAgent);
  request.populateFromClient();
  return { request, response: new FetchResponse() };
}
