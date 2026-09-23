import { describe, expect, it } from 'vitest';
import { determineNetworkPartitionKey, networkPartitionKeysEqual } from '../../../src/fetch/http/network-partition';
import { createOpaqueOrigin } from '../../../src/url/origin';
import { obtainURLOrigin, parseURL } from '../../../src/url/url';
import { createClientEnvironment } from '../client-fixture';
import { createFetchRequest } from '../fetch-fixture';

describe('Fetch network partition keys', () => {
  it('uses the top-level origin in preference to the creation URL', () => {
    const env = createClientEnvironment('https://fallback.test/');
    env.topLevelOrigin = obtainURLOrigin(parseURL('https://a.example.com:8443/').url!);

    expect(determineNetworkPartitionKey(env))
      .toEqual([['https', { kind: 'domain', value: 'example.com' }], null]);
  });

  it('falls back to the top-level creation URL when no top-level origin was supplied', () => {
    const env = createClientEnvironment('https://a.example.com/');
    env.topLevelOrigin = null;

    expect(determineNetworkPartitionKey(env))
      .toEqual([['https', { kind: 'domain', value: 'example.com' }], null]);
  });

  it('compares separately derived keys by site value rather than tuple identity', () => {
    const first = determineNetworkPartitionKey(createClientEnvironment('https://a.example.com:8443/'));
    const second = determineNetworkPartitionKey(createClientEnvironment('https://b.example.com/'));
    const otherScheme = determineNetworkPartitionKey(createClientEnvironment('http://a.example.com/'));
    const otherSite = determineNetworkPartitionKey(createClientEnvironment('https://outside.test/'));

    expect(first).not.toBe(second);
    expect(networkPartitionKeysEqual(first, second)).toBe(true);
    expect(networkPartitionKeysEqual(first, otherScheme)).toBe(false);
    expect(networkPartitionKeysEqual(first, otherSite)).toBe(false);
  });

  it('preserves and distinguishes opaque-origin identities', () => {
    const env = createClientEnvironment();
    env.topLevelOrigin = createOpaqueOrigin();
    const first = determineNetworkPartitionKey(env);
    const again = determineNetworkPartitionKey(env);
    env.topLevelOrigin = createOpaqueOrigin();

    expect(first[0]).toBe(again[0]);
    expect(networkPartitionKeysEqual(first, again)).toBe(true);
    expect(networkPartitionKeysEqual(first, determineNetworkPartitionKey(env))).toBe(false);
  });

  it('prefers the reserved environment, then the client, without using the request URL', () => {
    const client = createClientEnvironment('https://client.test/');
    const request = createFetchRequest('https://resource.test/', client);
    const reserved = {
      userAgent: client.userAgent, topLevelOrigin: null,
      creationURL: parseURL('https://reserved.test/').url!,
      topLevelCreationURL: parseURL('https://reserved.test/').url!,
    };
    request.reservedClient = reserved;

    expect(request.determineNetworkPartitionKey()).toEqual(determineNetworkPartitionKey(reserved));
    request.reservedClient = null;
    expect(request.determineNetworkPartitionKey()).toEqual(determineNetworkPartitionKey(client));
    request.client = null;
    expect(request.determineNetworkPartitionKey()).toBeNull();
  });
});

describe('Fetch HTTP cache partition identity', () => {
  it('returns no partition for a request without a client or reserved client', () => {
    const { httpCachePartitions } = createClientEnvironment().userAgent;

    expect(httpCachePartitions.determine(createFetchRequest())).toBeNull();
    expect(httpCachePartitions.partitions).toEqual([]);
  });

  it('shares a partition for equal sites and separates schemes, sites, and browser owners', () => {
    const client = createClientEnvironment('https://a.example.com/');
    const request = createFetchRequest(undefined, client);
    const partitions = client.userAgent.httpCachePartitions;
    const first = partitions.determine(request);
    request.client = createClientEnvironment('https://b.example.com/');

    expect(partitions.determine(request)).toBe(first);
    expect(request.client.userAgent.httpCachePartitions.determine(request)).not.toBe(first);
    request.client = createClientEnvironment('http://a.example.com/');
    expect(partitions.determine(request)).not.toBe(first);
    request.client = createClientEnvironment('https://other.test/');
    expect(partitions.determine(request)).not.toBe(first);
    expect(partitions.partitions).toHaveLength(3);
  });

  it('keeps two opaque top-level origins in different partitions', () => {
    const client = createClientEnvironment();
    const partitions = client.userAgent.httpCachePartitions;
    const request = createFetchRequest(undefined, client);
    client.topLevelOrigin = createOpaqueOrigin();
    const first = partitions.determine(request);

    expect(partitions.determine(request)).toBe(first);
    client.topLevelOrigin = createOpaqueOrigin();
    expect(partitions.determine(request)).not.toBe(first);
  });
});
