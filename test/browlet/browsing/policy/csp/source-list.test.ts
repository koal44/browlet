import { describe, expect, it } from 'vitest';
import { CSPDirectiveValue } from '../../../../../src/browlet/browsing/policy/csp/directives';
import { createOpaqueOrigin, type Origin } from '../../../../../src/url/origin';
import { obtainURLOrigin, parseURL, type URLRecord } from '../../../../../src/url/url';

const selfOrigin = obtainURLOrigin(url('https://example.test/page'));

describe('CSP URL source lists', () => {
  it('treats empty lists and none as denial, but ignores none beside a matching expression', () => {
    const target = url('https://example.test/image');
    expect(new CSPDirectiveValue([]).matchesURL(target, selfOrigin, 0)).toBe(false);
    expect(new CSPDirectiveValue(["'NoNe'"]).matchesURL(target, selfOrigin, 0)).toBe(false);
    expect(new CSPDirectiveValue(["'none'", 'https://example.test']).matchesURL(target, selfOrigin, 0)).toBe(true);
    expect(new CSPDirectiveValue(['invalid://', 'https:']).matchesURL(target, selfOrigin, 0)).toBe(true);
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
    expect(new CSPDirectiveValue([source]).matchesURL(url(target), selfOrigin, 0)).toBe(expected);
  });

  it('lets a wildcard match the protected origin scheme, without inventing one for opaque origins', () => {
    const origin: Origin = { kind: 'tuple', scheme: 'custom', host: { kind: 'domain', value: 'a.test' }, port: null, domain: null };
    expect(new CSPDirectiveValue(['*']).matchesURL(url('custom://b.test/path'), origin, 0)).toBe(true);
    expect(new CSPDirectiveValue(['*']).matchesURL(url('custom://b.test/path'), createOpaqueOrigin(), 0)).toBe(false);
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
    expect(new CSPDirectiveValue([source]).matchesURL(url(target), selfOrigin, 0)).toBe(expected);
  });

  it('inherits the self scheme for schemeless hosts, allowing secure upgrades', () => {
    const origin = obtainURLOrigin(url('http://creator.test/'));
    expect(new CSPDirectiveValue(['example.test']).matchesURL(url('https://example.test/'), origin, 0)).toBe(true);
    expect(new CSPDirectiveValue(['example.test']).matchesURL(url('https://example.test/'), createOpaqueOrigin(), 0)).toBe(false);
    expect(new CSPDirectiveValue(['https://example.test']).matchesURL(url('https://example.test/'), createOpaqueOrigin(), 0)).toBe(true);
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
    expect(new CSPDirectiveValue([source]).matchesURL(url(target), selfOrigin, 0)).toBe(expected);
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
    expect(new CSPDirectiveValue([`https://example.test${source}`]).matchesURL(url(`https://example.test${path}`), selfOrigin, 0))
      .toBe(expected);
  });

  it('ignores paths after redirects while still checking scheme, host, and port', () => {
    const source = 'https://example.test:8443/allowed/';
    expect(new CSPDirectiveValue([source]).matchesURL(url('https://example.test:8443/other/a'), selfOrigin, 1)).toBe(true);
    expect(new CSPDirectiveValue([source]).matchesURL(url('https://other.test:8443/other/a'), selfOrigin, 1)).toBe(false);
    expect(new CSPDirectiveValue([source]).matchesURL(url('http://example.test:8443/other/a'), selfOrigin, 1)).toBe(false);
    expect(new CSPDirectiveValue([source]).matchesURL(url('https://example.test/other/a'), selfOrigin, 1)).toBe(false);
  });

  it('upgrades explicit port 80 for a schemeless source when the self scheme is HTTP', () => {
    const origin = obtainURLOrigin(url('http://owner.test/'));
    expect(new CSPDirectiveValue(['example.test:80']).matchesURL(url('https://example.test/a'), origin, 0)).toBe(true);
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
    expect(new CSPDirectiveValue(["'SeLf'"]).matchesURL(url(target), obtainURLOrigin(url(source)), 0)).toBe(expected);
  });

  it('uses captured Blob origins for self, including opaque identity', () => {
    const origin = createOpaqueOrigin();
    const blob = url('blob:null/id');
    blob.blobURLEntry = { env: { origin } };
    expect(new CSPDirectiveValue(["'self'"]).matchesURL(blob, origin, 0)).toBe(true);
    expect(new CSPDirectiveValue(["'self'"]).matchesURL(blob, createOpaqueOrigin(), 0)).toBe(false);
    expect(new CSPDirectiveValue(["'self'"]).matchesURL(url('data:text/plain,hello'), origin, 0)).toBe(false);
  });
});

describe('CSP nonce matching', () => {
  it('matches nonempty nonces exactly while recognizing keyword casing', () => {
    expect(new CSPDirectiveValue(["'NoNcE-YWJj'"]).matchesNonce('YWJj')).toBe(true);
    expect(new CSPDirectiveValue(["'nonce-ywjj'"]).matchesNonce('YWJj')).toBe(false);
    expect(new CSPDirectiveValue(["'nonce-'"]).matchesNonce('')).toBe(false);
    expect(new CSPDirectiveValue(['nonce-YWJj']).matchesNonce('YWJj')).toBe(false);
    expect(new CSPDirectiveValue(["'nonce-YWJj'"]).matchesNonce('YWJj')).toBe(true);
  });

  it('does not normalize nonce encoding, padding, or whitespace', () => {
    expect(new CSPDirectiveValue(["'nonce--w=='"]).matchesNonce('+w==')).toBe(false);
    expect(new CSPDirectiveValue(["'nonce-YQ=='"]).matchesNonce('YQ')).toBe(false);
    expect(new CSPDirectiveValue(["'nonce-YQ=='"]).matchesNonce(' YQ== ')).toBe(false);
  });
});

describe('CSP external-script integrity matching', () => {
  it('requires nonempty supported metadata and a matching algorithm and digest', () => {
    expect(new CSPDirectiveValue(["'sha256-YQ=='"]).matchesIntegrityMetadata('sha256-YQ==')).toBe(true);
    expect(new CSPDirectiveValue(["'sha384-YQ=='"]).matchesIntegrityMetadata('sha256-YQ==')).toBe(false);
    expect(new CSPDirectiveValue(["'sha256-YQ=='"]).matchesIntegrityMetadata('sha256-Yg==')).toBe(false);
    expect(new CSPDirectiveValue(["'sha256-YQ=='"]).matchesIntegrityMetadata('')).toBe(false);
    expect(new CSPDirectiveValue(["'sha256-YQ=='"]).matchesIntegrityMetadata('md5-YQ==')).toBe(false);
    expect(new CSPDirectiveValue([]).matchesIntegrityMetadata('sha256-YQ==')).toBe(false);
  });

  it('accepts equivalent Base64url and omitted padding while preserving digest case', () => {
    expect(new CSPDirectiveValue(["'sHa256--w'"]).matchesIntegrityMetadata('SHA256-+w==?option')).toBe(true);
    expect(new CSPDirectiveValue(["'sha256-YQ=='"]).matchesIntegrityMetadata('sha256-YQ')).toBe(true);
    expect(new CSPDirectiveValue(["'sha256-yQ'"]).matchesIntegrityMetadata('sha256-YQ')).toBe(false);
    expect(new CSPDirectiveValue(["'sha256-a'"]).matchesIntegrityMetadata('sha256-a')).toBe(false);
  });

  it('checks every supported hash, including weaker algorithms and alternative digests', () => {
    const metadata = 'sha256-YQ== sha384-Yg==';
    expect(new CSPDirectiveValue(["'sha384-Yg=='"]).matchesIntegrityMetadata(metadata)).toBe(false);
    expect(new CSPDirectiveValue(["'sha256-YQ=='", "'sha384-Yg=='"]).matchesIntegrityMetadata(metadata)).toBe(true);
    expect(new CSPDirectiveValue(["'sha256-YQ=='"]).matchesIntegrityMetadata('sha256-YQ== sha256-Yg==')).toBe(false);
    expect(new CSPDirectiveValue(["'sha256-YQ=='"]).matchesIntegrityMetadata('garbage sha256-YQ==')).toBe(true);
  });
});

function url(input: string): URLRecord {
  return parseURL(input).url!;
}
