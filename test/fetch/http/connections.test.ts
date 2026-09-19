import { describe, expect, it } from 'vitest';
import { ConnectionPool, resolveOrigin, type Connection } from '../../../src/fetch/http/connections';
import type { NetworkPartitionKey } from '../../../src/fetch/http/network-partition';
import { ConnectionTimingInfo } from '../../../src/fetch/timing';
import { serializeHost } from '../../../src/url/host';
import { obtainURLOrigin, parseURL } from '../../../src/url/url';

describe('Fetch origin resolution', () => {
  const key: NetworkPartitionKey = [['https', { kind: 'domain', value: 'example.test' }], null];

  it.each([
    ['https://192.0.2.1/', '192.0.2.1'],
    ['https://[2001:db8::1]/', '[2001:db8::1]'],
    ['http://127.1/', '127.0.0.1'],
  ])('uses the parsed IP address directly for %s', (url, address) => {
    const origin = originFor(url);
    const addresses = resolveOrigin(key, origin)!;

    expect(addresses.map(serializeHost)).toEqual([address]);
    expect(addresses[0]).toBe(origin.host);
  });

  it.each([
    'localhost', 'localhost.', 'sub.localhost', 'sub.localhost.', 'LOCALHOST',
  ])('resolves %s to both loopback addresses without DNS', (host) => {
    const addresses = resolveOrigin(key, originFor(`https://${host}/`))!;

    expect(addresses.map(serializeHost)).toEqual(['[::1]', '127.0.0.1']);
  });

  it.each(['example.test', 'localhost.example.test', 'notlocalhost'])(
    'reaches the external-resolution placeholder for %s', (host) => {
      expect(() => resolveOrigin(key, originFor(`https://${host}/`)))
        .toThrow('External origin resolution is not implemented');
    },
  );
});

describe('Fetch connection reuse', () => {
  const key: NetworkPartitionKey = [['https', { kind: 'domain', value: 'example.test' }], null];
  const url = parseURL('https://resource.test/').url!;

  function createConnection(): Connection {
    return { key, origin: obtainURLOrigin(url), credentials: false, timingInfo: new ConnectionTimingInfo(), supportsUnreliable: false };
  }

  it('reuses the same connection for an equal partition key and origin', () => {
    const pool = new ConnectionPool();
    const connection = createConnection();
    pool.connections.add(connection);
    const equalKey: NetworkPartitionKey = [['https', { kind: 'domain', value: 'example.test' }], null];

    expect(pool.obtain(equalKey, parseURL('https://resource.test:443/other').url!, false)).toBe(connection);
    expect(pool.connections.size).toBe(1);
  });

  it.each([
    ['https://other.test/', false], ['http://resource.test/', false],
    ['https://resource.test:8443/', false], ['https://resource.test/', true],
  ] as const)('does not reuse a connection for %s with credentials %s', (target, credentials) => {
    const pool = new ConnectionPool();
    pool.connections.add(createConnection());

    expect(() => pool.obtain(key, parseURL(target).url!, credentials))
      .toThrow('New connection establishment is not implemented');
  });

  it('does not reuse an otherwise matching connection from another partition', () => {
    const pool = new ConnectionPool();
    pool.connections.add(createConnection());
    const otherKey: NetworkPartitionKey = [['https', { kind: 'domain', value: 'other.test' }], null];

    expect(() => pool.obtain(otherKey, url, false)).toThrow('New connection establishment is not implemented');
  });

  it('requires unreliable-transport support when requested', () => {
    const pool = new ConnectionPool();
    const ordinary = createConnection();
    const unreliable = createConnection();
    unreliable.supportsUnreliable = true;
    pool.connections.add(ordinary);
    pool.connections.add(unreliable);

    expect(pool.obtain(key, url, false)).toBe(ordinary);
    expect(pool.obtain(key, url, false, 'no', true)).toBe(unreliable);
    pool.connections.delete(unreliable);
    expect(() => pool.obtain(key, url, false, 'no', true)).toThrow('New connection establishment is not implemented');
  });

  it.each(['yes', 'yes-and-dedicated'] as const)('bypasses reuse for the %s setting', (setting) => {
    const pool = new ConnectionPool();
    const connection = createConnection();
    pool.connections.add(connection);

    expect(() => pool.obtain(key, url, false, setting)).toThrow('New connection establishment is not implemented');
    expect([...pool.connections]).toEqual([connection]);
  });

  it('rejects certificate hashes with the reuse setting', () => {
    const pool = new ConnectionPool();
    pool.connections.add(createConnection());

    expect(() => pool.obtain(key, url, false, 'no', true, [{ algorithm: 'sha-256', value: new Uint8Array(32) }]))
      .toThrow('Certificate hashes require a new connection');
  });
});

function originFor(url: string) {
  const origin = obtainURLOrigin(parseURL(url).url!);
  if (origin.kind !== 'tuple') throw new Error('Expected a tuple origin in the fixture');
  return origin;
}
