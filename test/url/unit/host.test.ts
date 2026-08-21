import { describe, expect, it } from 'vitest';

import {
  domainToUnicode, hostsEqual, isValidDomain, obtainPublicSuffix,
  obtainRegistrableDomain, parseDomain, serializeHost,
  type Domain,
} from '../../../src/url/host';
import { urlAlgorithms } from './contract';

type HostCase = {
  input: string;
  special: string | null;
  opaque: string | null;
};

const hostCases: HostCase[] = [
  { input: 'EXAMPLE.COM', special: 'example.com', opaque: 'EXAMPLE.COM' },
  { input: 'example%2Ecom', special: 'example.com', opaque: 'example%2Ecom' },
  {
    input: 'faß.example',
    special: 'xn--fa-hia.example',
    opaque: 'fa%C3%9F.example',
  },
  { input: '0', special: '0.0.0.0', opaque: '0' },
  { input: '%30', special: '0.0.0.0', opaque: '%30' },
  { input: '0x', special: '0.0.0.0', opaque: '0x' },
  {
    input: '0xffffffff',
    special: '255.255.255.255',
    opaque: '0xffffffff',
  },
  { input: '[0:0::1]', special: '[::1]', opaque: '[::1]' },
  { input: '[0:0::1%5D', special: null, opaque: null },
  { input: '[0:0::%31]', special: null, opaque: null },
  { input: '09', special: null, opaque: '09' },
  { input: 'example.255', special: null, opaque: 'example.255' },
  { input: 'example^example', special: null, opaque: null },
];

describe('URL Standard section 3: host parsing and serialization', () => {
  for (const test of hostCases) {
    it(`roundtrips special host ${JSON.stringify(test.input)}`, () => {
      expect(urlAlgorithms().parseAndSerializeHost(test.input, false).serialization)
        .toBe(test.special);
    });

    it(`roundtrips opaque host ${JSON.stringify(test.input)}`, () => {
      expect(urlAlgorithms().parseAndSerializeHost(test.input, true).serialization)
        .toBe(test.opaque);
    });
  }

  for (const [input, output, error] of [
    ['127.0.0.1.', '127.0.0.1', 'IPv4-empty-part'],
    ['1.2.3', '1.2.0.3', 'IPv4-too-few-parts'],
    ['127.0.0x0.1', '127.0.0.1', 'IPv4-non-decimal-part'],
    ['①.②.③.④', '1.2.3.4', 'IPv4-non-ASCII-input'],
    ['0300', '0.0.0.192', 'IPv4-non-decimal-part'],
    ['0x7f.1', '127.0.0.1', 'IPv4-non-decimal-part'],
  ] as const) {
    it(`parses legacy IPv4 syntax ${JSON.stringify(input)}`, () => {
      const result = urlAlgorithms().parseAndSerializeHost(input, false);

      expect(result.serialization).toBe(output);
      expect(result.validationErrors).toContain(error);
    });
  }

  for (const [input, error] of [
    ['1.2.3.4.5', 'IPv4-too-many-parts'],
    ['test.42', 'IPv4-non-numeric-part'],
    ['255.255.4000.1', 'IPv4-out-of-range-part'],
  ] as const) {
    it(`rejects invalid IPv4 host ${JSON.stringify(input)}`, () => {
      const result = urlAlgorithms().parseAndSerializeHost(input, false);

      expect(result.serialization).toBeNull();
      expect(result.validationErrors).toContain(error);
    });
  }

  for (const [input, output] of [
    ['[0:0:0:0:0:0:0:1]', '[::1]'],
    ['[2001:0db8:0000:0000:0000:ff00:0042:8329]', '[2001:db8::ff00:42:8329]'],
    ['[::ffff:192.0.2.128]', '[::ffff:c000:280]'],
    ['[0:f:0:0:f:f:0:0]', '[0:f::f:f:0:0]'],
  ] as const) {
    it(`parses and serializes IPv6 host ${input}`, () => {
      expect(urlAlgorithms().parseAndSerializeHost(input, false).serialization)
        .toBe(output);
    });
  }

  for (const [input, error] of [
    ['[::1', 'IPv6-unclosed'],
    ['[:1]', 'IPv6-invalid-compression'],
    ['[1:2:3:4:5:6:7:8:9]', 'IPv6-too-many-pieces'],
    ['[1::1::1]', 'IPv6-multiple-compression'],
    ['[1:2:3!:4]', 'IPv6-invalid-code-point'],
    ['[1:2:3:]', 'IPv6-invalid-code-point'],
    ['[1:2:3]', 'IPv6-too-few-pieces'],
    ['[1:1:1:1:1:1:1:127.0.0.1]', 'IPv4-in-IPv6-too-many-pieces'],
    ['[ffff::.0.0.1]', 'IPv4-in-IPv6-invalid-code-point'],
    ['[ffff::127.00.0.1]', 'IPv4-in-IPv6-invalid-code-point'],
    ['[ffff::127.0.0.4000]', 'IPv4-in-IPv6-out-of-range-part'],
    ['[ffff::127.0.0]', 'IPv4-in-IPv6-too-few-parts'],
  ] as const) {
    it(`rejects invalid IPv6 host ${input}`, () => {
      const result = urlAlgorithms().parseAndSerializeHost(input, false);

      expect(result.serialization).toBeNull();
      expect(result.validationErrors).toContain(error);
    });
  }

  it('records percent-encoding before special-host IDNA processing', () => {
    const result = urlAlgorithms().parseAndSerializeHost('exam%70le.org', false);

    expect(result.serialization).toBe('example.org');
    expect(result.validationErrors).toContain('domain-percent-encoded');
  });

  it('rejects forbidden code points in an opaque host', () => {
    const result = urlAlgorithms().parseAndSerializeHost('exa[mple.org', true);

    expect(result.serialization).toBeNull();
    expect(result.validationErrors).toContain('host-invalid-code-point');
  });

  it('rejects a percent-decoded forbidden domain code point', () => {
    const result = urlAlgorithms().parseAndSerializeHost('exa%23mple.org', false);

    expect(result.serialization).toBeNull();
    expect(result.validationErrors).toContain('domain-to-ASCII');
  });

  it('accepts but reports leading zeros in an IPv6 piece', () => {
    const result = urlAlgorithms().parseAndSerializeHost('[::01]', false);

    expect(result.serialization).toBe('[::1]');
    expect(result.validationErrors).toContain('IPv6-piece-leading-zero');
  });

  it('returns a compatibility domain after strict IDNA validation fails', () => {
    const result = urlAlgorithms().parseAndSerializeHost('xn--8i7caa', false);

    expect(result.serialization).toBe('xn--8i7caa');
    expect(result.validationErrors).toContain('domain-to-ASCII');
  });

  it('records invalid URL units in an otherwise valid opaque host', () => {
    const result = urlAlgorithms().parseAndSerializeHost('example%zz\u0080', true);

    expect(result.serialization).toBe('example%zz%C2%80');
    expect(result.validationErrors).toEqual(['invalid-URL-unit']);
  });

  it('compresses only the first longest IPv6 zero sequence', () => {
    expect(urlAlgorithms().parseAndSerializeHost(
      '[1:0:0:2:0:0:3:4]', false,
    ).serialization).toBe('[1::2:0:0:3:4]');
    expect(urlAlgorithms().parseAndSerializeHost('[0:0:0:0:0:0:0:0]', false)
      .serialization).toBe('[::]');
  });
});

describe('URL Standard section 3: host operations', () => {
  for (const [input, suffix, registrable] of [
    ['com', 'com', null],
    ['www.example.com', 'com', 'example.com'],
    ['example.com.', 'com.', 'example.com.'],
    ['github.io', 'github.io', null],
    ['whatwg.github.io', 'github.io', 'whatwg.github.io'],
    ['example.xn--kgbechtv', 'xn--kgbechtv', 'example.xn--kgbechtv'],
  ] as const) {
    it(`obtains the public suffix and registrable domain of ${input}`, () => {
      const host: Domain = { kind: 'domain', value: input };

      expect(obtainPublicSuffix(host)?.value ?? null).toBe(suffix);
      expect(obtainRegistrableDomain(host)?.value ?? null).toBe(registrable);
    });
  }

  it('converts an ASCII domain to Unicode', () => {
    expect(domainToUnicode({ kind: 'domain', value: 'xn--fa-hia.example' }))
      .toBe('faß.example');
  });

  it('distinguishes strict valid-domain syntax from compatibility parsing', () => {
    expect(isValidDomain('example.com')).toBe(true);
    expect(isValidDomain('127.0.0.1')).toBe(false);
    expect(parseDomain('xn--8i7caa', true)).toBeNull();
  });

  it('compares represented host values rather than object identity', () => {
    const first: Domain = { kind: 'domain', value: 'example.com' };
    const second: Domain = { kind: 'domain', value: 'example.com' };

    expect(hostsEqual(first, second)).toBe(true);
    expect(hostsEqual(first, { kind: 'opaque', value: 'example.com' }))
      .toBe(false);
    expect(serializeHost({ kind: 'empty' })).toBe('');
  });
});
