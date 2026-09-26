import { describe, expect, it } from 'vitest';
import {
  applyIntegrityAlgorithm, bytesMatchIntegrityMetadata, getStrongestIntegrityMetadata,
  parseIntegrityMetadata, type IntegrityMetadata,
} from '../../src/fetch/integrity';

// SHA-256 of the ASCII bytes "abc".
const abcDigest = 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=';

describe('SRI metadata parsing', () => {
  it('retains supported expressions and their original digest text', () => {
    expect(parseIntegrityMetadata('sha256-AbCd+/12= sha384-ABCD sha512-AB_CD-12')).toEqual([
      { algorithm: 'sha256', digest: 'AbCd+/12=' },
      { algorithm: 'sha384', digest: 'ABCD' },
      { algorithm: 'sha512', digest: 'AB_CD-12' },
    ]);
  });

  it.each([' ', '\t', '\n', '\r', '\f'])('splits on ASCII whitespace %j', (space) => {
    expect(parseIntegrityMetadata(`${space}sha256-AAAA${space}sha384-BBBB${space}`)).toEqual([
      { algorithm: 'sha256', digest: 'AAAA' }, { algorithm: 'sha384', digest: 'BBBB' },
    ]);
  });

  it('recognizes algorithm names case-insensitively', () => {
    expect(parseIntegrityMetadata('SHA256-AbCd ShA384-EfGh sHA512-IjKl')).toEqual([
      { algorithm: 'sha256', digest: 'AbCd' },
      { algorithm: 'sha384', digest: 'EfGh' },
      { algorithm: 'sha512', digest: 'IjKl' },
    ]);
  });

  it.each(['md5-AAAA', 'sha1-AAAA', 'sha-256-AAAA', 'sha256', 'sha256-', 'sha512-!', 'sha256-A===', 'sha256-A=B'])(
    'ignores unsupported or malformed expression %j', (metadata) => {
      expect(parseIntegrityMetadata(metadata)).toEqual([]);
    },
  );

  it.each(['\u000b', '\u00a0', '\u2028'])('does not split on non-ASCII-whitespace %j', (space) => {
    expect(parseIntegrityMetadata(`sha256-AAAA${space}sha384-BBBB`)).toEqual([]);
  });

  it('ignores options without treating their contents as another hash', () => {
    expect(parseIntegrityMetadata('sha256-AAAA?future=sha512-BBBB??')).toEqual([
      { algorithm: 'sha256', digest: 'AAAA' },
    ]);
  });
});

describe('strongest SRI metadata', () => {
  it('returns no expressions for an empty collection', () => {
    expect(getStrongestIntegrityMetadata([])).toEqual([]);
  });

  it('selects SHA-512 over SHA-384 and SHA-256 in either order', () => {
    const metadata: IntegrityMetadata[] = [
      { algorithm: 'sha256', digest: 'first' },
      { algorithm: 'sha384', digest: 'second' },
      { algorithm: 'sha512', digest: 'third' },
    ];
    expect(getStrongestIntegrityMetadata(metadata)).toEqual([metadata[2]]);
    expect(getStrongestIntegrityMetadata(metadata.toReversed())).toEqual([metadata[2]]);
  });

  it('preserves every strongest candidate in order without changing the input', () => {
    const metadata: IntegrityMetadata[] = [
      { algorithm: 'sha384', digest: 'first' },
      { algorithm: 'sha256', digest: 'weaker' },
      { algorithm: 'sha384', digest: 'second' },
    ];
    const result = getStrongestIntegrityMetadata(metadata);
    expect(result).toEqual([metadata[0], metadata[2]]);
    expect(result[0]).toBe(metadata[0]);
    expect(result[1]).toBe(metadata[2]);
    expect(metadata).toHaveLength(3);
    expect(result).not.toBe(metadata);
  });
});

describe('SRI hashing', () => {
  const bytes = new Uint8Array([0x61, 0x62, 0x63]);

  it.each([
    ['sha256', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['sha384', 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7'],
    ['sha512', 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f'],
  ] as const)('hashes the SHA-2 abc vector with %s', (algorithm, digest) => {
    expect(Buffer.from(applyIntegrityAlgorithm(algorithm, bytes)).toString('hex')).toBe(digest);
  });

  it('hashes an empty byte sequence', () => {
    expect(Buffer.from(applyIntegrityAlgorithm('sha256', new Uint8Array())).toString('hex'))
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes exactly the supplied view without changing its backing bytes', () => {
    const backing = new Uint8Array([0, ...bytes, 0xff]);
    expect(applyIntegrityAlgorithm('sha256', backing.subarray(1, 4)))
      .toEqual(applyIntegrityAlgorithm('sha256', bytes));
    expect(backing).toEqual(new Uint8Array([0, 0x61, 0x62, 0x63, 0xff]));
  });

  it('hashes binary input without text conversion', () => {
    expect(Buffer.from(applyIntegrityAlgorithm('sha256', new Uint8Array([0]))).toString('hex'))
      .toBe('6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d');
  });
});

describe('SRI byte verification', () => {
  const bytes = new Uint8Array([0x61, 0x62, 0x63]);

  it('accepts matching bytes and rejects changed bytes', () => {
    expect(bytesMatchIntegrityMetadata(bytes, `sha256-${abcDigest}`)).toBe(true);
    expect(bytesMatchIntegrityMetadata(new Uint8Array([0x61, 0x62, 0x64]), `sha256-${abcDigest}`)).toBe(false);
  });

  it('accepts any matching candidate using the strongest algorithm', () => {
    expect(bytesMatchIntegrityMetadata(bytes, `sha256-AAAA sha256-${abcDigest}`)).toBe(true);
    expect(bytesMatchIntegrityMetadata(bytes, `sha256-${abcDigest} sha256-AAAA`)).toBe(true);
  });

  it('does not fall back to a matching weaker algorithm', () => {
    expect(bytesMatchIntegrityMetadata(bytes, `sha256-${abcDigest} sha512-AAAA`)).toBe(false);
    expect(bytesMatchIntegrityMetadata(bytes, `sha512-AAAA sha256-${abcDigest}`)).toBe(false);
  });

  it.each(['', ' \t\n\r\f', 'futurehash-AAAA', 'sha256-', 'sha512-!'])(
    'accepts bytes when %j supplies no supported, well-formed expression', (metadata) => {
      expect(bytesMatchIntegrityMetadata(bytes, metadata)).toBe(true);
    },
  );

  it.each([
    abcDigest.slice(0, -1),
    abcDigest.replaceAll('+', '-').replaceAll('/', '_'),
    abcDigest.replaceAll('+', '-').replaceAll('/', '_').slice(0, -1),
  ])('accepts an equivalent Base64 encoding: %s', (digest) => {
    expect(bytesMatchIntegrityMetadata(bytes, `sha256-${digest}`)).toBe(true);
  });

  it('normalizes algorithm casing without changing digest casing', () => {
    expect(bytesMatchIntegrityMetadata(bytes, `SHA256-${abcDigest}`)).toBe(true);
    expect(bytesMatchIntegrityMetadata(bytes, 'SHA256-AAAA')).toBe(false);
    expect(bytesMatchIntegrityMetadata(bytes, `SHA512-AAAA sha256-${abcDigest}`)).toBe(false);
    expect(bytesMatchIntegrityMetadata(bytes, `sha256-${abcDigest.toLowerCase()}`)).toBe(false);
  });

  it('ignores malformed stronger expressions but retains undecodable ones with valid syntax', () => {
    expect(bytesMatchIntegrityMetadata(bytes, `sha512-! sha256-${abcDigest}`)).toBe(true);
    expect(bytesMatchIntegrityMetadata(bytes, `sha512-A sha256-${abcDigest}`)).toBe(false);
  });

  it('ignores unrecognized options', () => {
    expect(bytesMatchIntegrityMetadata(bytes, `sha256-${abcDigest}?future=value?another`)).toBe(true);
  });
});
