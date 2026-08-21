import { describe, expect, it } from 'vitest';

import { parseURL, renderURL, serializeURL } from '../../../src/url/url';

function parse(input: string) {
  const result = parseURL(input);
  expect(result.url).not.toBeNull();
  return result.url!;
}

describe('URL Standard section 4.8: URL rendering', () => {
  it('renders a full URL without credentials and with a Unicode domain', () => {
    const url = parse(
      'https://user:password@xn--fa-hia.example/path?q=x#fragment',
    );

    expect(renderURL(url))
      .toBe('https://faß.example/path?q=x#fragment');
    expect(serializeURL(url))
      .toBe('https://user:password@xn--fa-hia.example/path?q=x#fragment');
  });

  it('can render only the host and non-default port', () => {
    const url = parse('https://www.example.com:8443/path');

    expect(renderURL(url, { hostOnly: true }))
      .toBe('www.example.com:8443');
  });

  it('can omit the scheme while preserving the rest of the URL', () => {
    const url = parse('https://www.example.com/path?q=x#fragment');

    expect(renderURL(url, { omitScheme: true }))
      .toBe('www.example.com/path?q=x#fragment');
  });

  it('can simplify a domain host to its registrable domain', () => {
    const url = parse('https://login.accounts.example.co.uk/path');

    expect(renderURL(url, { simplifyHost: true }))
      .toBe('https://example.co.uk/path');
    expect(renderURL(url, { hostOnly: true, simplifyHost: true }))
      .toBe('example.co.uk');
  });

  it('elides the path before security-relevant host information', () => {
    const url = parse('https://example.com/a/very/long/path?q=x#fragment');

    expect(renderURL(url, { maxLength: 25 }))
      .toBe('https://example.com/…');
  });

  it('elides domain labels from the lowest-level end', () => {
    const url = parse('https://examplecorp.com.evil.com/path');

    expect(renderURL(url, { hostOnly: true, maxLength: 14 }))
      .toBe('…com.evil.com');
    expect(renderURL(url, { maxLength: 14 }))
      .toBe('…com.evil.com');
  });

  it('does not truncate the registrable domain to honor a shorter limit', () => {
    const url = parse('https://subdomain.very-long-example.com/path');

    expect(renderURL(url, { hostOnly: true, maxLength: 8 }))
      .toBe('very-long-example.com');
  });
});
