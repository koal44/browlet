import { describe, expect, it, vi } from 'vitest';

import { InternalError } from '../../src/infra/index';
import { registeredStorageEndpoints, StorageEndpoint } from '../../src/storage/endpoints';
import { StorageBottle, StorageProxyMap } from '../../src/storage/bottles';
import { StorageBucket } from '../../src/storage/buckets';
import { StorageShelf } from '../../src/storage/sheds';

describe('Storage §6: storage usage', () => {
  it.each(['local', 'session'] as const)('estimates a fresh %s shelf as empty', (type) => {
    expect(StorageShelf.create(type).usage).toBe(0);
  });

  it('keeps an empty bottle at zero even when its endpoint accounts for per-map overhead', () => {
    const endpoint = new ByteStorageEndpoint();
    vi.spyOn(endpoint, 'estimateUsage').mockReturnValue(7);
    const bottle = new StorageBottle(endpoint);
    expect(bottle.usage).toBe(0);
    bottle.map.set('saved', new Uint8Array(1));
    expect(bottle.usage).toBe(7);
    bottle.map.clear();
    expect(bottle.usage).toBe(0);
  });

  it.each(['local', 'session'] as const)('counts %s Web Storage keys and values as UTF-16 bytes', (type) => {
    const shelf = StorageShelf.create(type);
    const bottle = shelf.bucketMap.get('default')!.bottleMap.get(`${type}Storage`)!;
    bottle.map.set('', '');
    expect(shelf.usage).toBe(0);
    bottle.map.set('a', 'b');
    expect(shelf.usage).toBe(4);
    bottle.map.set('\u00E9', '\u754C');
    expect(shelf.usage).toBe(8);
    bottle.map.set('\u{1F989}', '\u{1F600}');
    expect(shelf.usage).toBe(16);
    bottle.map.set('\uD800', '\uDC00');
    expect(shelf.usage).toBe(20);
    expect(bottle.usage).toBe(20);
  });

  it('tracks overwrites, deletion, clearing, and replacement without counting proxy references', () => {
    const shelf = StorageShelf.create('local');
    const bottle = shelf.bucketMap.get('default')!.bottleMap.get('localStorage')!;
    const first = new StorageProxyMap(bottle, shelf);
    const second = new StorageProxyMap(bottle, shelf);
    bottle.proxyMapReferenceSet.add(first);
    bottle.proxyMapReferenceSet.add(second);

    first.set('key', '123');
    expect(shelf.usage).toBe(12);
    second.set('key', 'x');
    expect(shelf.usage).toBe(8);
    first.set('other', '');
    expect(shelf.usage).toBe(18);
    second.delete('key');
    expect(shelf.usage).toBe(10);
    first.clear();
    expect(shelf.usage).toBe(0);

    first.set('old', 'data');
    bottle.map = new Map([['new', '']]);
    expect(shelf.usage).toBe(6);
    first.set('retained', 'old map');
    expect(shelf.usage).toBe(6);
  });

  it('totals all current buckets independently of another shelf and its bottle quotas', () => {
    const shelf = StorageShelf.create('local');
    const first = shelf.bucketMap.get('default')!.bottleMap.get('localStorage')!;
    first.map.set('a', 'bc');
    first.quota = 1;
    const extra = StorageBucket.create('local');
    extra.bottleMap.get('localStorage')!.map.set('de', 'fg');
    shelf.bucketMap.set('extra', extra);
    const other = StorageShelf.create('local');
    other.bucketMap.get('default')!.bottleMap.get('localStorage')!.map.set('other', 'shelf');

    expect(shelf.usage).toBe(14);
    expect(other.usage).toBe(20);
    shelf.bucketMap.delete('extra');
    expect(shelf.usage).toBe(6);
    shelf.bucketMap.clear();
    expect(shelf.usage).toBe(0);
    expect(other.usage).toBe(20);
  });

  it('uses an endpoint-provided estimate for non-string data alongside Web Storage', () => {
    const endpoint = new ByteStorageEndpoint();
    registeredStorageEndpoints.set(endpoint.identifier, endpoint);
    try {
      const shelf = StorageShelf.create('local');
      const bucket = shelf.bucketMap.get('default')!;
      const bottle = bucket.bottleMap.get(endpoint.identifier)!;
      bottle.map.set('record', new Uint8Array(7));
      bucket.bottleMap.get('localStorage')!.map.set('a', 'b');
      expect(bottle.usage).toBe(7);
      expect(shelf.usage).toBe(11);
      bottle.map.set('record', new Uint8Array(3));
      expect(shelf.usage).toBe(7);
    } finally {
      registeredStorageEndpoints.delete(endpoint.identifier);
    }
  });

  it('requires accounting for populated endpoints whose formats are not implemented', () => {
    const shelf = StorageShelf.create('local');
    const bottle = shelf.bucketMap.get('default')!.bottleMap.get('indexedDB')!;
    expect(shelf.usage).toBe(0);
    bottle.map.set('record', { payload: 'unmeasured' });
    expect(() => shelf.usage).toThrow('Storage usage estimation is not implemented');
    bottle.map.clear();
    expect(shelf.usage).toBe(0);
    const standalone = new StorageBottle(new StorageEndpoint('unmeasured', new Set(['local']), null));
    standalone.map.set('record', 'unmeasured');
    expect(() => standalone.usage).toThrow(InternalError);
  });

  it('does not coerce invalid Web Storage data while measuring it', () => {
    const bottle = StorageBucket.create('session').bottleMap.get('sessionStorage')!;
    const toString = vi.fn(() => 'coerced');
    const value = { toString };
    bottle.map.set('key', value);
    expect(() => bottle.usage).toThrow('Web Storage maps require string keys and values');
    bottle.map.clear();
    bottle.map.set(value, 'value');
    expect(() => bottle.usage).toThrow(InternalError);
    expect(toString).not.toHaveBeenCalled();
  });
});

class ByteStorageEndpoint extends StorageEndpoint<string, Uint8Array> {
  constructor() {
    super('test-bytes', new Set(['local']), null);
  }

  override estimateUsage(map: Map<string, Uint8Array>): number {
    let usage = 0;
    for (const bytes of map.values()) usage += bytes.byteLength;
    return usage;
  }
}
