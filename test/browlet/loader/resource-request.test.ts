import { describe, expect, it } from 'vitest';
import { UserAgent } from '../../../src/browlet/user-agent';
import { FetchRequest } from '../../../src/fetch/request';
import { parseURL, serializeURL } from '../../../src/url/url';

describe('HTML potential-CORS requests', () => {
  it.each([
    ['no-cors', false, 'no-cors', 'include'],
    ['anonymous', false, 'cors', 'same-origin'],
    ['use-credentials', false, 'cors', 'include'],
    ['no-cors', true, 'same-origin', 'include'],
    ['anonymous', true, 'cors', 'same-origin'],
    ['use-credentials', true, 'cors', 'include'],
  ] as const)('selects modes for %s with same-origin fallback %s', (state, fallback, mode, credentials) => {
    const userAgent = new UserAgent();
    const url = parseURL('https://example.test/image.png').url!;
    const request = userAgent.createPotentialCORSRequest(url, 'image', state, fallback);

    expect(request).toBeInstanceOf(FetchRequest);
    expect(serializeURL(request.url)).toBe('https://example.test/image.png');
    expect(request.destination).toBe('image');
    expect(request.mode).toBe(mode);
    expect(request.credentialsMode).toBe(credentials);
    expect(request.useURLCredentials).toBe(true);
    expect(request.userAgent).toBe(userAgent);
    expect(request.client).toBeNull();
  });

  it('retains URL credentials and leaves client-derived fields for the calling algorithm', () => {
    const userAgent = new UserAgent();
    const url = parseURL('https://user:password@example.test/script.js').url!;
    const request = userAgent.createPotentialCORSRequest(url, 'script', 'anonymous');

    expect(serializeURL(request.url)).toBe('https://user:password@example.test/script.js');
    expect(request.destination).toBe('script');
    expect(request.origin).toBeUndefined();
    expect(request.policyContainer).toBeUndefined();
    expect(request.referrer).toBeUndefined();
  });

  it('defaults to no-CORS mode when the same-origin fallback flag is omitted', () => {
    const userAgent = new UserAgent();
    const url = parseURL('https://example.test/image.png').url!;
    const request = userAgent.createPotentialCORSRequest(url, 'image', 'no-cors');

    expect(request.mode).toBe('no-cors');
    expect(request.credentialsMode).toBe('include');
  });
});
