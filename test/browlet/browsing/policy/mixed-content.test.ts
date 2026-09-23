import { describe, expect, it } from 'vitest';
import { FetchRequest, type Destination } from '../../../../src/fetch/request';
import { FetchResponse } from '../../../../src/fetch/response';
import { parseURL, serializeURL } from '../../../../src/url/url';
import { createPolicyEnvironment } from './environment-fixture';

describe('Mixed Content: environment classification', () => {
  it.each([
    ['https://example.test/', true], ['http://example.test/', false],
    ['http://localhost/', true], ['file:///example.html', true], ['data:text/html,hello', false],
  ])('classifies the origin of %s as restricting mixed content: %s', (url, expected) => {
    expect(createPolicyEnvironment(url).prohibitsMixedSecurityContexts()).toBe(expected);
  });

  it('restricts an HTTPS child even when its HTTP ancestor makes it a non-secure context', () => {
    const parent = createPolicyEnvironment('http://parent.test/');
    const child = createPolicyEnvironment('https://child.test/', parent);
    expect(child.isSecureContext).toBe(false);
    expect(child.prohibitsMixedSecurityContexts()).toBe(true);
  });

  it('checks every ancestor, including a trustworthy intermediate frame', () => {
    const top = createPolicyEnvironment('http://top.test/');
    const middle = createPolicyEnvironment('https://middle.test/', top);
    const child = createPolicyEnvironment('data:text/html,child', middle);
    expect(child.prohibitsMixedSecurityContexts()).toBe(true);
    expect(top.prohibitsMixedSecurityContexts()).toBe(false);
  });

  it('allows an entirely untrustworthy ancestor chain', () => {
    const top = createPolicyEnvironment('http://top.test/');
    const child = createPolicyEnvironment('http://child.test/', top);
    expect(child.prohibitsMixedSecurityContexts()).toBe(false);
  });
});

describe('Mixed Content: request upgrading', () => {
  const env = createPolicyEnvironment('https://page.test/');

  it.each<Destination>(['image', 'audio', 'video'])('upgrades ordinary %s content before blocking', (destination) => {
    const request = new FetchRequest(parseURL('http://resource.test/').url!, env, env.userAgent);
    request.destination = destination;
    request.upgradeMixedContent();
    expect(serializeURL(request.currentURL)).toBe('https://resource.test/');
    expect(request.isBlockedByMixedContent()).toBe(false);
  });

  it('also upgrades CORS-enabled images', () => {
    const request = new FetchRequest(parseURL('http://resource.test/image.png').url!, env, env.userAgent);
    request.destination = 'image';
    request.mode = 'cors';
    request.upgradeMixedContent();
    expect(request.currentURL.scheme).toBe('https');
    expect(request.mode).toBe('cors');
  });

  it.each<Destination>(['', 'script', 'style', 'iframe', 'document'])(
    'does not automatically upgrade destination %s', (destination) => {
      const request = new FetchRequest(parseURL('http://resource.test/').url!, env, env.userAgent);
      request.destination = destination;
      request.upgradeMixedContent();
      expect(request.currentURL.scheme).toBe('http');
    },
  );

  it('blocks imageset requests unless an explicit UIR policy upgrades them first', () => {
    const client = createPolicyEnvironment('https://page.test/');
    const request = new FetchRequest(parseURL('http://resource.test/image.png').url!, client, client.userAgent);
    request.destination = 'image';
    request.initiator = 'imageset';
    request.upgradeMixedContent();
    expect(request.currentURL.scheme).toBe('http');
    expect(request.isBlockedByMixedContent()).toBe(true);
    client.insecureRequestsPolicy.enableFor(client.creationURL);
    request.upgradeInsecureRequest();
    request.upgradeMixedContent();
    expect(request.currentURL.scheme).toBe('https');
    expect(request.isBlockedByMixedContent()).toBe(false);
  });

  it.each(['http://192.0.2.1/', 'http://[2001:db8::1]/'])(
    'blocks IP-host images without automatic upgrading: %s', (input) => {
      const request = new FetchRequest(parseURL(input).url!, env, env.userAgent);
      request.destination = 'image';
      request.upgradeMixedContent();
      expect(serializeURL(request.currentURL)).toBe(input);
      expect(request.isBlockedByMixedContent()).toBe(true);
    },
  );

  it('leaves requests without a restricting client unchanged', () => {
    const client = createPolicyEnvironment('http://page.test/');
    const request = new FetchRequest(parseURL('http://resource.test/').url!, client, client.userAgent);
    request.destination = 'image';
    request.upgradeMixedContent();
    expect(request.currentURL.scheme).toBe('http');
    request.client = null;
    request.upgradeMixedContent();
    expect(request.currentURL.scheme).toBe('http');
  });

  it.each(['http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'https://resource.test/'])(
    'preserves potentially trustworthy targets: %s', (input) => {
      const request = new FetchRequest(parseURL(input).url!, env, env.userAgent);
      request.destination = 'image';
      request.upgradeMixedContent();
      expect(serializeURL(request.currentURL)).toBe(input);
    },
  );

  it.each([
    ['http://resource.test:80/', 'https://resource.test/'],
    ['http://resource.test:443/', 'https://resource.test/'],
    ['http://resource.test:8080/', 'https://resource.test:8080/'],
  ])('preserves explicit ports and canonicalizes default ports: %s', (input, expected) => {
    const request = new FetchRequest(parseURL(input).url!, env, env.userAgent);
    request.destination = 'image';
    request.upgradeMixedContent();
    expect(serializeURL(request.currentURL)).toBe(expected);
  });

  it('upgrades the current redirect target while retaining earlier hops', () => {
    const request = new FetchRequest(parseURL('http://resource.test/first').url!, env, env.userAgent);
    request.urlList.push(parseURL('http://redirect.test/image.png').url!);
    request.destination = 'image';
    request.upgradeMixedContent();
    expect(request.urlList.map((url) => serializeURL(url))).toEqual([
      'http://resource.test/first', 'https://redirect.test/image.png',
    ]);
  });
});

describe('Mixed Content: request blocking', () => {
  const env = createPolicyEnvironment('https://page.test/');

  it.each<Destination>(['', 'script', 'style', 'image', 'audio', 'video', 'iframe', 'frame', 'object', 'embed'])(
    'blocks unupgraded HTTP for destination %s', (destination) => {
      const request = new FetchRequest(parseURL('http://resource.test/').url!, env, env.userAgent);
      request.destination = destination;
      expect(request.isBlockedByMixedContent()).toBe(true);
    },
  );

  it.each(['https://resource.test/', 'http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'data:,hello'])(
    'allows a potentially trustworthy target: %s', (url) => {
      const request = new FetchRequest(parseURL(url).url!, env, env.userAgent);
      expect(request.isBlockedByMixedContent()).toBe(false);
    },
  );

  it('allows top-level navigation, a non-restricting client, and a clientless request', () => {
    const request = new FetchRequest(parseURL('http://resource.test/').url!, env, env.userAgent);
    request.destination = 'document';
    expect(request.isBlockedByMixedContent()).toBe(false);
    request.destination = '';
    request.client = createPolicyEnvironment('http://page.test/');
    expect(request.isBlockedByMixedContent()).toBe(false);
    request.client = null;
    expect(request.isBlockedByMixedContent()).toBe(false);
  });

  it('checks the current redirect target rather than the original URL', () => {
    const request = new FetchRequest(parseURL('https://resource.test/').url!, env, env.userAgent);
    request.urlList.push(parseURL('http://redirect.test/').url!);
    expect(request.isBlockedByMixedContent()).toBe(true);
  });
});

describe('Mixed Content: response and download checks', () => {
  const env = createPolicyEnvironment('https://page.test/');

  it('checks the final internal response URL even when the request URL was trustworthy', () => {
    const request = new FetchRequest(parseURL('https://resource.test/').url!, env, env.userAgent);
    const response = new FetchResponse();
    response.urlList = [parseURL('http://resource.test/').url!];
    expect(response.isBlockedByMixedContent(request)).toBe(true);
    response.urlList.push(parseURL('https://final.test/').url!);
    expect(response.isBlockedByMixedContent(request)).toBe(false);
  });

  it('preserves the request-side exemptions when checking a response', () => {
    const request = new FetchRequest(parseURL('http://resource.test/').url!, env, env.userAgent);
    const response = new FetchResponse();
    response.urlList = [...request.urlList];
    request.destination = 'document';
    expect(response.isBlockedByMixedContent(request)).toBe(false);
    request.destination = '';
    request.client = createPolicyEnvironment('http://page.test/');
    expect(response.isBlockedByMixedContent(request)).toBe(false);
    request.client = null;
    expect(response.isBlockedByMixedContent(request)).toBe(false);
  });

  it('requires Fetch to populate the response URL list before checking it', () => {
    const request = new FetchRequest(parseURL('https://resource.test/').url!, env, env.userAgent);
    expect(() => new FetchResponse().isBlockedByMixedContent(request)).toThrow('requires a response URL');
  });

  it('blocks a mixed download if any redirect hop was untrustworthy', () => {
    const response = new FetchResponse();
    const source = parseURL('https://page.test/current-document').url!;
    response.urlList = [parseURL('https://download.test/').url!];
    expect(response.isMixedDownload(source, env)).toBe(false);
    response.urlList.push(parseURL('http://redirect.test/').url!, parseURL('https://final.test/').url!);
    expect(response.isMixedDownload(source, env)).toBe(true);
    expect(response.isMixedDownload(parseURL('http://page.test/').url!, env)).toBe(false);
  });
});
