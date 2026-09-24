import { describe, expect, it } from 'vitest';
import { ContentSecurityPolicy } from '../../../../../src/browlet/browsing/policy/csp/policy';
import { isomorphicEncode } from '../../../../../src/js-engine/byte-string';

describe('Content Security Policy parsing', () => {
  it('retains directives, values, disposition, and delivery source', () => {
    const serialized = "default-src 'self'; script-src https://cdn.example.test/scripts/; object-src 'none'";
    const policy = ContentSecurityPolicy.parse(serialized, 'header', 'enforce');
    expect([...policy.directives]).toEqual([
      ['default-src', ["'self'"]],
      ['script-src', ['https://cdn.example.test/scripts/']],
      ['object-src', ["'none'"]],
    ]);
    expect(policy.source).toBe('header');
    expect(policy.disposition).toBe('enforce');
    expect(policy.serialized).toBe(serialized);
  });

  it('preserves report-only and meta classifications without applying delivery restrictions', () => {
    const reportOnly = ContentSecurityPolicy.parse("script-src 'self'", 'header', 'report');
    const meta = ContentSecurityPolicy.parse("frame-ancestors 'none'; sandbox", 'meta', 'enforce');
    expect(reportOnly.disposition).toBe('report');
    expect(meta.source).toBe('meta');
    // The meta processing algorithm removes unsupported directives after parsing.
    expect([...meta.directives.keys()]).toEqual(['frame-ancestors', 'sandbox']);
  });

  it('decodes bytes isomorphically', () => {
    const policy = ContentSecurityPolicy.parse(
      isomorphicEncode("default-src 'self'; img-src https://caf\u00E9.test; script-src 'none'"), 'header', 'enforce',
    );
    expect(policy.serialized).toContain('caf\u00E9.test');
    expect([...policy.directives.keys()]).toEqual(['default-src', 'script-src']);
  });

  it.each(['', ' ', ';', ';; ;\t;\n', '\r\f\t\n '])('parses an empty policy from %j', (serialized) => {
    expect(ContentSecurityPolicy.parse(serialized, 'header', 'enforce').directives.size).toBe(0);
  });

  it('uses every ASCII whitespace character as a separator without changing source spelling', () => {
    const policy = ContentSecurityPolicy.parse(
      " \t\n\f\rScRiPt-SrC\t'SELF'\nhttps://CDN.test/CaseSensitive/\f'nonce-AbC'\r;\tupgrade-insecure-requests ",
      'header', 'enforce',
    );
    expect([...policy.directives]).toEqual([
      ['script-src', ["'SELF'", 'https://CDN.test/CaseSensitive/', "'nonce-AbC'"]],
      ['upgrade-insecure-requests', []],
    ]);
  });

  it('keeps the first directive even when it has no value', () => {
    const policy = ContentSecurityPolicy.parse(
      "script-src; img-src 'self'; SCRIPT-SRC *; img-src https://other.test", 'header', 'enforce',
    );
    expect([...policy.directives]).toEqual([['script-src', []], ['img-src', ["'self'"]]]);
    expect(policy.parsingWarnings).toEqual([
      "Ignoring duplicate Content Security Policy directive 'script-src'.",
      "Ignoring duplicate Content Security Policy directive 'img-src'.",
    ]);
  });

  it('retains unknown directive data without interpreting it as another directive', () => {
    const policy = ContentSecurityPolicy.parse("future-directive KeepThis; default-src 'none'", 'header', 'enforce');
    expect([...policy.directives]).toEqual([
      ['future-directive', ['KeepThis']], ['default-src', ["'none'"]],
    ]);
  });

  it('leaves nonce, hash, wildcard, and path syntax for source matching', () => {
    const values = ["'nonce-AbC/+=_'", "'sha256-AbC/+=_'", '*.example.test:*/Path/', 'https:', "'strict-dynamic'"];
    const policy = ContentSecurityPolicy.parse(`script-src ${values.join(' ')}`, 'header', 'enforce');
    expect(policy.directives.get('script-src')).toEqual(values);
  });

  it('does not infer a missing semicolon between directives', () => {
    const policy = ContentSecurityPolicy.parse("default-src 'self' script-src 'none'", 'header', 'enforce');
    expect([...policy.directives]).toEqual([['default-src', ["'self'", 'script-src', "'none'"]]]);
  });

  it.each(['\u00A0', '\u0085', '\u2003', '\uFEFF', '\uD800'])('discards a directive containing non-ASCII %j', (character) => {
    const policy = ContentSecurityPolicy.parse(
      `default-src 'none'; ${character}script-src 'self'; img-src https://cdn.test`, 'header', 'enforce',
    );
    expect([...policy.directives.keys()]).toEqual(['default-src', 'img-src']);
  });

  it('can accept a later directive when an earlier non-ASCII directive was discarded', () => {
    const policy = ContentSecurityPolicy.parse("img-src caf\u00E9.test; img-src 'none'", 'header', 'enforce');
    expect([...policy.directives]).toEqual([['img-src', ["'none'"]]]);
  });

  it.each([
    "img_src 'none'", "img-src@ 'none'", "img-src\u000B'none'", 'img-src foo\u0000bar', 'img-src foo\u007Fbar',
  ])('discards malformed directive %j without losing valid siblings', (malformed) => {
    const policy = ContentSecurityPolicy.parse(
      `default-src 'none'; ${malformed}; script-src 'self'`, 'header', 'enforce',
    );
    expect([...policy.directives]).toEqual([['default-src', ["'none'"]], ['script-src', ["'self'"]]]);
  });

  it('copies all policy data with independently mutable directives', () => {
    const original = ContentSecurityPolicy.parse("default-src 'none'; img-src 'self'; default-src *", 'header', 'report');
    const copy = original.clone();
    expect(copy).toEqual(original);
    copy.directives.get('default-src')!.push('https://cdn.test');
    copy.directives.delete('img-src');
    copy.disposition = 'enforce';
    copy.parsingWarnings.length = 0;
    expect([...original.directives]).toEqual([['default-src', ["'none'"]], ['img-src', ["'self'"]]]);
    expect(original.disposition).toBe('report');
    expect(original.parsingWarnings).toHaveLength(1);
  });
});
