import { describe, expect, it } from 'vitest';
import {
  integrityMetadataMatchesSourceList, nonceMatchesSourceList, urlMatchesSourceExpression, urlMatchesSourceList,
} from '../../../../../src/browlet/browsing/policy/csp/source-list';
import { createOpaqueOrigin, type Origin } from '../../../../../src/url/origin';
import { obtainURLOrigin, parseURL, type URLRecord } from '../../../../../src/url/url';

const selfOrigin = obtainURLOrigin(url('https://example.test/page'));

describe('CSP URL source lists', () => {
  it('treats empty lists and none as denial, but ignores none beside a matching expression', () => {
    const target = url('https://example.test/image');
    expect(urlMatchesSourceList(target, [], selfOrigin, 0)).toBe(false);
    expect(urlMatchesSourceList(target, ["'NoNe'"], selfOrigin, 0)).toBe(false);
    expect(urlMatchesSourceList(target, ["'none'", 'https://example.test'], selfOrigin, 0)).toBe(true);
    expect(urlMatchesSourceList(target, ['invalid://', 'https:'], selfOrigin, 0)).toBe(true);
  });

  it.each([
    ['*', 'https://other.test/a', true],
    ['*', 'http://127.0.0.1/a', true],
    ['*', 'data:text/plain,hello', false],
    ['*', 'blob:https://example.test/id', false],
    ['*', 'wss://example.test/', false],
    ['data:', 'data:text/plain,hello', true],
    ['blob:', 'blob:https://example.test/id', true],
    ['HTTPS:', 'https://other.test/a', true],
    ['http:', 'https://other.test/a', true],
    ['https:', 'http://other.test/a', false],
    ['ws:', 'ws://example.test/', true],
    ['ws:', 'wss://example.test/', true],
    ['ws:', 'http://example.test/', true],
    ['ws:', 'https://example.test/', true],
    ['wss:', 'https://example.test/', true],
    ['https:', 'wss://example.test/', false],
  ])('matches scheme expression %s against %s: %s', (source, target, expected) => {
    expect(urlMatchesSourceExpression(url(target), source, selfOrigin, 0)).toBe(expected);
  });

  it('lets a wildcard match the protected origin scheme, without inventing one for opaque origins', () => {
    const origin: Origin = { kind: 'tuple', scheme: 'custom', host: { kind: 'domain', value: 'a.test' }, port: null, domain: null };
    expect(urlMatchesSourceExpression(url('custom://b.test/path'), '*', origin, 0)).toBe(true);
    expect(urlMatchesSourceExpression(url('custom://b.test/path'), '*', createOpaqueOrigin(), 0)).toBe(false);
  });

  it.each([
    ['example.test', 'https://example.test/a', true],
    ['EXAMPLE.TEST', 'https://example.test/a', true],
    ['example.test', 'http://example.test/a', false],
    ['example.test', 'https://sub.example.test/a', false],
    ['*.example.test', 'https://sub.example.test/a', true],
    ['*.example.test', 'https://a.b.example.test/a', true],
    ['*.example.test', 'https://example.test/a', false],
    ['*.example.test', 'https://badexample.test/a', false],
    ['example.test.', 'https://example.test./a', true],
    ['example.test', 'https://example.test./a', false],
    ['https://*', 'https://elsewhere.test/a', true],
    ['https://*', 'http://elsewhere.test/a', false],
    ['http://127.0.0.1', 'http://127.0.0.1/a', true],
    ['https://192.0.2.1', 'https://192.0.2.1/a', true],
    ['https://192.0.2.1', 'https://192.0.2.2/a', false],
    ['http://*', 'http://127.0.0.1/a', true],
    ['http://127.1', 'http://127.0.0.1/a', false],
    ['http://[::1]', 'http://[::1]/a', false],
    ['xn--bcher-kva.test', 'https://bücher.test/a', true],
    ['bücher.test', 'https://bücher.test/a', false],
    ['https://user@example.test', 'https://example.test/a', false],
    ['example_test', 'https://example_test/a', false],
    ['https://example.test/a?query', 'https://example.test/a?query', false],
    ['https://example.test/a#fragment', 'https://example.test/a#fragment', false],
  ])('matches host expression %s against %s: %s', (source, target, expected) => {
    expect(urlMatchesSourceExpression(url(target), source, selfOrigin, 0)).toBe(expected);
  });

  it('inherits the self scheme for schemeless hosts, allowing secure upgrades', () => {
    const origin = obtainURLOrigin(url('http://creator.test/'));
    expect(urlMatchesSourceExpression(url('https://example.test/'), 'example.test', origin, 0)).toBe(true);
    expect(urlMatchesSourceExpression(url('https://example.test/'), 'example.test', createOpaqueOrigin(), 0)).toBe(false);
    expect(urlMatchesSourceExpression(url('https://example.test/'), 'https://example.test', createOpaqueOrigin(), 0)).toBe(true);
  });

  it.each([
    ['https://example.test', 'https://example.test:443/a', true],
    ['https://example.test', 'https://example.test:8443/a', false],
    ['https://example.test:443', 'https://example.test/a', true],
    ['https://example.test:00443', 'https://example.test/a', true],
    ['https://example.test:8443', 'https://example.test:8443/a', true],
    ['https://example.test:8443', 'https://example.test/a', false],
    ['https://example.test:*', 'https://example.test:8443/a', true],
    ['http://example.test:80', 'http://example.test/a', true],
    ['http://example.test:80', 'https://example.test/a', true],
    ['ws://example.test:80', 'wss://example.test/a', true],
    ['example.test:80', 'https://example.test/a', false],
    ['https://example.test:80', 'https://example.test/a', false],
    ['http://example.test:80', 'https://example.test:8443/a', false],
    ['http://example.test:8080', 'https://example.test:8080/a', true],
    ['https://example.test:999999999999999999999', 'https://example.test/a', false],
  ])('matches port expression %s against %s: %s', (source, target, expected) => {
    expect(urlMatchesSourceExpression(url(target), source, selfOrigin, 0)).toBe(expected);
  });

  it.each([
    ['/scripts/app.js', '/scripts/app.js', true],
    ['/scripts/app.js', '/scripts/app.js?x=1#fragment', true],
    ['/scripts/app.js', '/scripts/APP.js', false],
    ['/scripts/', '/scripts/app.js', true],
    ['/scripts/', '/scripts/nested/app.js', true],
    ['/scripts/', '/scripts', false],
    ['/scripts', '/scripts/app.js', false],
    ['/scripts/', '/other/app.js', false],
    ['/scripts/%61pp.js', '/scripts/app.js', true],
    ['/scripts/a%2fb.js', '/scripts/a%2Fb.js', true],
    ['/scripts/a%2fb.js', '/scripts/a/b.js', false],
    ['/scripts/a%252fb.js', '/scripts/a%2fb.js', false],
    ['/%C3%A9.js', '/é.js', true],
    ['/a//b.js', '/a//b.js', true],
    ['/a%zz', '/a%zz', false],
  ])('matches path %s against %s: %s', (source, path, expected) => {
    expect(urlMatchesSourceExpression(url(`https://example.test${path}`), `https://example.test${source}`, selfOrigin, 0))
      .toBe(expected);
  });

  it('ignores paths after redirects while still checking scheme, host, and port', () => {
    const source = 'https://example.test:8443/allowed/';
    expect(urlMatchesSourceExpression(url('https://example.test:8443/other/a'), source, selfOrigin, 1)).toBe(true);
    expect(urlMatchesSourceExpression(url('https://other.test:8443/other/a'), source, selfOrigin, 1)).toBe(false);
    expect(urlMatchesSourceExpression(url('http://example.test:8443/other/a'), source, selfOrigin, 1)).toBe(false);
    expect(urlMatchesSourceExpression(url('https://example.test/other/a'), source, selfOrigin, 1)).toBe(false);
  });

  it('upgrades explicit port 80 for a schemeless source when the self scheme is HTTP', () => {
    const origin = obtainURLOrigin(url('http://owner.test/'));
    expect(urlMatchesSourceExpression(url('https://example.test/a'), 'example.test:80', origin, 0)).toBe(true);
  });

  it.each([
    ['https://example.test/', 'https://example.test/a', true],
    ['https://example.test/', 'https://other.test/a', false],
    ['https://example.test/', 'http://example.test/a', false],
    ['http://example.test/', 'https://example.test/a', true],
    ['http://example.test/', 'ws://example.test/a', true],
    ['https://example.test/', 'wss://example.test/a', true],
    ['https://example.test/', 'ws://example.test/a', false],
    ['http://example.test:8080/', 'https://example.test:8080/a', true],
    ['http://example.test:8080/', 'https://example.test/a', false],
    ['http://example.test/', 'https://example.test:8443/a', false],
  ])('matches self from %s against %s: %s', (source, target, expected) => {
    expect(urlMatchesSourceExpression(url(target), "'SeLf'", obtainURLOrigin(url(source)), 0)).toBe(expected);
  });

  it('uses captured Blob origins for self, including opaque identity', () => {
    const origin = createOpaqueOrigin();
    const blob = url('blob:null/id');
    blob.blobURLEntry = { env: { origin } };
    expect(urlMatchesSourceExpression(blob, "'self'", origin, 0)).toBe(true);
    expect(urlMatchesSourceExpression(blob, "'self'", createOpaqueOrigin(), 0)).toBe(false);
    expect(urlMatchesSourceExpression(url('data:text/plain,hello'), "'self'", origin, 0)).toBe(false);
  });
});

describe('CSP nonce matching', () => {
  it('matches nonempty nonces exactly while recognizing keyword casing', () => {
    expect(nonceMatchesSourceList('YWJj', ["'NoNcE-YWJj'"])).toBe(true);
    expect(nonceMatchesSourceList('YWJj', ["'nonce-ywjj'"])).toBe(false);
    expect(nonceMatchesSourceList('', ["'nonce-'"])).toBe(false);
    expect(nonceMatchesSourceList('YWJj', ['nonce-YWJj'])).toBe(false);
    expect(nonceMatchesSourceList('YWJj', ["'nonce-YWJj'"])).toBe(true);
  });

  it('does not normalize nonce encoding, padding, or whitespace', () => {
    expect(nonceMatchesSourceList('+w==', ["'nonce--w=='"])).toBe(false);
    expect(nonceMatchesSourceList('YQ', ["'nonce-YQ=='"])).toBe(false);
    expect(nonceMatchesSourceList(' YQ== ', ["'nonce-YQ=='"])).toBe(false);
  });
});

describe('CSP external-script integrity matching', () => {
  it('requires nonempty supported metadata and a matching algorithm and digest', () => {
    expect(integrityMetadataMatchesSourceList('sha256-YQ==', ["'sha256-YQ=='"])).toBe(true);
    expect(integrityMetadataMatchesSourceList('sha256-YQ==', ["'sha384-YQ=='"])).toBe(false);
    expect(integrityMetadataMatchesSourceList('sha256-Yg==', ["'sha256-YQ=='"])).toBe(false);
    expect(integrityMetadataMatchesSourceList('', ["'sha256-YQ=='"])).toBe(false);
    expect(integrityMetadataMatchesSourceList('md5-YQ==', ["'sha256-YQ=='"])).toBe(false);
    expect(integrityMetadataMatchesSourceList('sha256-YQ==', [])).toBe(false);
  });

  it('accepts equivalent Base64url and omitted padding while preserving digest case', () => {
    expect(integrityMetadataMatchesSourceList('SHA256-+w==?option', ["'sHa256--w'"])).toBe(true);
    expect(integrityMetadataMatchesSourceList('sha256-YQ', ["'sha256-YQ=='"])).toBe(true);
    expect(integrityMetadataMatchesSourceList('sha256-YQ', ["'sha256-yQ'"])).toBe(false);
    expect(integrityMetadataMatchesSourceList('sha256-a', ["'sha256-a'"])).toBe(false);
  });

  it('checks every supported hash, including weaker algorithms and alternative digests', () => {
    const metadata = 'sha256-YQ== sha384-Yg==';
    expect(integrityMetadataMatchesSourceList(metadata, ["'sha384-Yg=='"])).toBe(false);
    expect(integrityMetadataMatchesSourceList(metadata, ["'sha256-YQ=='", "'sha384-Yg=='"])).toBe(true);
    expect(integrityMetadataMatchesSourceList('sha256-YQ== sha256-Yg==', ["'sha256-YQ=='"])).toBe(false);
    expect(integrityMetadataMatchesSourceList('garbage sha256-YQ==', ["'sha256-YQ=='"])).toBe(true);
  });
});

function url(input: string): URLRecord {
  return parseURL(input).url!;
}
