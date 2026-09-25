import type { FetchRequest } from '../../request';
import { networkPartitionKeysEqual } from '../network-partition';
import { HTTPCachePartition, type HTTPCacheEntry } from './store';

/** Browser-owned private caches sharing a bounded, least-recently-used body budget. */
export class HTTPCachePartitions {
  /** Logical caches indexed by network partition key. */
  partitions: HTTPCachePartition[] = [];
  maxBytes = 32 * 1024 * 1024;
  maxEntryBytes = 8 * 1024 * 1024;
  maxEntries = 256;
  #entries = new Set<HTTPCacheEntry>();
  #size = 0;

  /** https://fetch.spec.whatwg.org/#determine-the-http-cache-partition */
  determine(request: FetchRequest): HTTPCachePartition | null {
    const key = request.determineNetworkPartitionKey();
    if (key === null) return null;
    const existing = this.partitions.find((partition) => networkPartitionKeysEqual(partition.key, key));
    if (existing) return existing;
    const partition = new HTTPCachePartition(key, this);
    this.partitions.push(partition);
    return partition;
  }

  /** Remove representations and validators, including incomplete writes. */
  clear(): void {
    for (const partition of this.partitions) partition.clear();
  }

  /** Reserve body space before copying a chunk; eviction never interrupts its fetch. */
  reserve(entry: HTTPCacheEntry, bytes: number): boolean {
    if (!entry.active) return false;
    this.#entries.add(entry);
    this.#size += bytes;
    entry.size += bytes;
    if (entry.size > this.maxEntryBytes) this.remove(entry);
    while (this.#entries.size > 0 && (this.#size > this.maxBytes || this.#entries.size > this.maxEntries)) {
      this.remove(this.#entries.values().next().value!);
    }
    return entry.active;
  }

  touch(entry: HTTPCacheEntry): void {
    if (!this.#entries.delete(entry)) return;
    this.#entries.add(entry);
  }

  remove(entry: HTTPCacheEntry): void {
    if (!this.#entries.delete(entry)) return;
    this.#size -= entry.size;
    entry.discard();
  }
}
