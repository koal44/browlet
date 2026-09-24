import { describe, expect, it } from 'vitest';
import { ContentSecurityPolicy } from '../../../../../src/browlet/browsing/policy/csp/policy';
import { getEffectiveDirective } from '../../../../../src/browlet/browsing/policy/csp/directives';
import { UserAgent } from '../../../../../src/browlet/user-agent';
import { FetchRequest, type Destination } from '../../../../../src/fetch/request';
import { FetchResponse } from '../../../../../src/fetch/response';
import { obtainURLOrigin, parseURL } from '../../../../../src/url/url';

const selfOrigin = obtainURLOrigin(parseURL('https://owner.test/page').url!);
const userAgent = new UserAgent();

describe('CSP Fetch directive selection', () => {
  it.each<[Destination, string | null]>([
    ['', 'connect-src'], ['json', 'connect-src'], ['text', 'connect-src'], ['webidentity', 'connect-src'],
    ['manifest', 'manifest-src'], ['object', 'object-src'], ['embed', 'object-src'],
    ['frame', 'frame-src'], ['iframe', 'frame-src'], ['audio', 'media-src'],
    ['track', 'media-src'], ['video', 'media-src'], ['font', 'font-src'], ['image', 'img-src'],
    ['style', 'style-src-elem'], ['script', 'script-src-elem'], ['xslt', 'script-src-elem'],
    ['audioworklet', 'script-src-elem'], ['paintworklet', 'script-src-elem'],
    ['worker', 'worker-src'], ['sharedworker', 'worker-src'], ['serviceworker', 'worker-src'],
    ['report', null], ['document', 'connect-src'],
  ])('selects %s requests through %s', (destination, expected) => {
    expect(getEffectiveDirective(requestFor(destination))).toBe(expected);
  });

  it('uses the nearest present fallback without combining policies or ignoring empty directives', () => {
    const request = requestFor('script');
    const policy = parse("default-src https:; script-src 'none'; script-src-elem https://resource.test");
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBeUndefined();
    policy.directives.delete('script-src-elem');
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBe('script-src');
    policy.directives.set('script-src-elem', []);
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBe('script-src-elem');
  });

  it('uses worker-src, child-src, script-src, and default-src in that order', () => {
    const policy = parse("default-src 'none'; script-src 'none'; child-src 'none'; worker-src 'none'");
    const request = requestFor('worker');
    for (const name of ['worker-src', 'child-src', 'script-src', 'default-src']) {
      expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBe(name);
      policy.directives.delete(name);
    }
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBeUndefined();
  });

  it('uses child-src for frames, but not for objects', () => {
    const policy = parse("child-src 'none'");
    expect(policy.getViolatedRequestDirective(requestFor('iframe'), selfOrigin)).toBe('child-src');
    expect(policy.getViolatedRequestDirective(requestFor('object'), selfOrigin)).toBeUndefined();
  });

  it('does not apply unrelated, inline-only, or unknown directives to external requests', () => {
    const policy = parse("script-src-attr 'none'; style-src-attr 'none'; frame-ancestors 'none'; made-up-src 'none'");
    for (const destination of ['script', 'style', 'iframe', ''] as const) {
      expect(policy.getViolatedRequestDirective(requestFor(destination), selfOrigin)).toBeUndefined();
    }
    expect(parse("default-src 'none'").getViolatedRequestDirective(requestFor('report'), selfOrigin)).toBeUndefined();
  });

  it('keeps enforced and monitored policy decisions identical before their caller selects a disposition', () => {
    for (const disposition of ['enforce', 'report'] as const) {
      const policy = ContentSecurityPolicy.parse("img-src 'none'", 'header', disposition);
      expect(policy.getViolatedRequestDirective(requestFor('image'), selfOrigin)).toBe('img-src');
    }
  });
});

describe('CSP request and response checks', () => {
  it('checks the current redirect target rather than the original request URL', () => {
    const request = requestFor('image', 'https://resource.test/allowed/image');
    const policy = parse('img-src https://resource.test/allowed/');
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBeUndefined();
    request.urlList.push(parseURL('https://elsewhere.test/image').url!);
    request.redirectCount++;
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBe('img-src');
    request.urlList.push(parseURL('https://resource.test/elsewhere/image').url!);
    request.redirectCount++;
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBeUndefined();
  });

  it('checks the actual response URL when a service worker substitutes another resource', () => {
    const policy = parse('img-src https://resource.test/allowed/');
    const request = requestFor('image', 'https://resource.test/allowed/image');
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBeUndefined();
    expect(policy.getViolatedResponseDirective(request, responseAt('https://elsewhere.test/image'), selfOrigin)).toBe('img-src');
    expect(policy.getViolatedResponseDirective(request, responseAt('https://resource.test/other/image'), selfOrigin)).toBe('img-src');
    request.redirectCount = 1;
    expect(policy.getViolatedResponseDirective(request, responseAt('https://resource.test/other/image'), selfOrigin)).toBeUndefined();
  });

  it('uses nonces to authorize scripts and styles even when their final URL differs', () => {
    const policy = parse("default-src 'nonce-YQ=='");
    const response = responseAt('https://otherwise-blocked.test/resource');
    for (const destination of ['script', 'style'] as const) {
      const request = requestFor(destination);
      request.cryptographicNonceMetadata = 'YQ==';
      expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBeUndefined();
      expect(policy.getViolatedResponseDirective(request, response, selfOrigin)).toBeUndefined();
      request.cryptographicNonceMetadata = 'Yg==';
      expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBe('default-src');
    }
    const image = requestFor('image');
    image.cryptographicNonceMetadata = 'YQ==';
    expect(policy.getViolatedRequestDirective(image, selfOrigin)).toBe('default-src');
  });

  it('uses every external-script integrity digest and leaves response byte verification to SRI', () => {
    const policy = parse("default-src 'sha256-YQ==' 'sha384-Yg=='");
    const request = requestFor('script');
    request.integrityMetadata = 'sha256-YQ== sha384-Yg==';
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBeUndefined();
    expect(policy.getViolatedResponseDirective(request, responseAt('https://elsewhere.test/script'), selfOrigin)).toBeUndefined();
    request.integrityMetadata += ' sha512-Yw==';
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBe('default-src');
    request.destination = 'style';
    request.integrityMetadata = 'sha256-YQ==';
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBe('default-src');
  });

  it('lets nonce and hash matches precede strict-dynamic, which ignores host allowlists for parser-inserted scripts', () => {
    const policy = parse("script-src https: 'strict-dynamic' 'nonce-YQ==' 'sha256-Yg=='");
    const request = requestFor('script');
    request.parserInserted = true;
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBe('script-src');
    request.cryptographicNonceMetadata = 'YQ==';
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBeUndefined();
    request.cryptographicNonceMetadata = '';
    request.integrityMetadata = 'sha256-Yg==';
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBeUndefined();
    request.integrityMetadata = '';
    request.parserInserted = false;
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBeUndefined();
    request.parserInserted = undefined;
    expect(policy.getViolatedResponseDirective(request, responseAt('https://elsewhere.test/script'), selfOrigin)).toBeUndefined();
  });

  it('only applies script authorization to workers when script-src is the selected fallback', () => {
    const request = requestFor('worker');
    request.cryptographicNonceMetadata = 'YQ==';
    const policy = parse("default-src 'nonce-YQ=='; script-src 'nonce-YQ=='; child-src 'nonce-YQ=='; worker-src 'nonce-YQ=='");
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBe('worker-src');
    policy.directives.delete('worker-src');
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBe('child-src');
    policy.directives.delete('child-src');
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBeUndefined();
    policy.directives.delete('script-src');
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBe('default-src');
  });

  it('requires WebTransport hash opt-in instead of accepting a matching host', () => {
    const request = requestFor('');
    request.mode = 'webtransport';
    request.webTransportHashList = [{ algorithm: 'sha-256', value: new Uint8Array([1]) }];
    const policy = parse('connect-src https:');
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBe('connect-src');
    const response = responseAt('https://resource.test/');
    expect(policy.getViolatedResponseDirective(request, response, selfOrigin)).toBe('connect-src');
    policy.directives.set('connect-src', ["'UNSAFE-WEBTRANSPORT-HASHES'"]);
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBeUndefined();
    expect(policy.getViolatedResponseDirective(request, response, selfOrigin)).toBeUndefined();
    request.webTransportHashList = [];
    expect(policy.getViolatedRequestDirective(request, selfOrigin)).toBe('connect-src');
  });
});

describe('CSP resource hints', () => {
  it('leaves prefetch unrestricted without default-src', () => {
    const request = requestFor('');
    request.initiator = 'prefetch';
    expect(getEffectiveDirective(request)).toBe('default-src');
    expect(parse("img-src 'none'").getViolatedRequestDirective(request, selfOrigin)).toBeUndefined();
  });

  it('allows a prefetch that matches default-src or another fetch source list', () => {
    const request = requestFor('');
    request.initiator = 'prefetch';
    expect(parse('default-src https:').getViolatedRequestDirective(request, selfOrigin)).toBeUndefined();
    expect(parse("default-src 'none'; img-src https:").getViolatedRequestDirective(request, selfOrigin)).toBeUndefined();
    expect(parse("default-src 'none'; style-src-elem https:").getViolatedRequestDirective(request, selfOrigin)).toBeUndefined();
    expect(parse("default-src 'none'; script-src-attr https:").getViolatedRequestDirective(request, selfOrigin)).toBe('default-src');
    expect(parse("default-src 'none'; img-src https://elsewhere.test").getViolatedRequestDirective(request, selfOrigin)).toBe('default-src');
  });
});

function parse(serialized: string): ContentSecurityPolicy {
  return ContentSecurityPolicy.parse(serialized, 'header', 'enforce');
}

function requestFor(destination: Destination, target = 'https://resource.test/file'): FetchRequest {
  const request = new FetchRequest(parseURL(target).url!, null, userAgent);
  request.destination = destination;
  return request;
}

function responseAt(target: string): FetchResponse {
  const response = new FetchResponse();
  response.urlList.push(parseURL(target).url!);
  return response;
}
