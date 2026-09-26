import { describe, expect, it } from 'vitest';
import { networkPartitionKeysEqual, type NetworkPartitionKey } from '../../src/fetch/transport';
import { createOpaqueOrigin } from '../../src/url/origin';
import { parseURL } from '../../src/url/url';
import { createClientEnvironment } from './client-fixture';
import { createFetchRequest } from './fetch-fixture';

describe('Fetch network partition keys', () => {
  it('compares separately derived keys by site value rather than tuple identity', () => {
    const first = createClientEnvironment('https://a.example.com:8443/').determineNetworkPartitionKey();
    const second = createClientEnvironment('https://b.example.com/').determineNetworkPartitionKey();
    const otherScheme = createClientEnvironment('http://a.example.com/').determineNetworkPartitionKey();
    const otherSite = createClientEnvironment('https://outside.test/').determineNetworkPartitionKey();

    expect(first).not.toBe(second);
    expect(networkPartitionKeysEqual(first, second)).toBe(true);
    expect(networkPartitionKeysEqual(first, otherScheme)).toBe(false);
    expect(networkPartitionKeysEqual(first, otherSite)).toBe(false);
  });

  it('prefers the reserved environment, then the client, without using the request URL', () => {
    const client = createClientEnvironment('https://client.test/');
    const request = createFetchRequest('https://resource.test/', client);
    const reservedOrigin = createOpaqueOrigin();
    const reservedKey: NetworkPartitionKey = [reservedOrigin, null];
    const reserved = {
      userAgent: client.userAgent, topLevelOrigin: reservedOrigin,
      creationURL: parseURL('https://reserved.test/').url!,
      topLevelCreationURL: parseURL('https://reserved.test/').url!,
      determineNetworkPartitionKey: () => reservedKey,
    };
    request.reservedClient = reserved;

    expect(request.determineNetworkPartitionKey()).toBe(reservedKey);
    request.reservedClient = null;
    expect(request.determineNetworkPartitionKey()).toEqual(client.determineNetworkPartitionKey());
    request.client = null;
    expect(request.determineNetworkPartitionKey()).toBeNull();
  });
});
