import type { RequestRecord } from '../../request';
import { networkPartitionKeysEqual, type NetworkPartitionKey } from '../network-partition';

/** Browser-owned logical HTTP cache partitions; response storage is still deferred. */
export class HTTPCachePartitions {
  partitions: HTTPCachePartition[] = [];

  /** https://fetch.spec.whatwg.org/#determine-the-http-cache-partition */
  // SPEC_MISMATCH: (request) -> HTTP cache or null
  determine(request: RequestRecord): HTTPCachePartition | null {
    const key = request.determineNetworkPartitionKey();
    if (key === null) return null;
    const existing = this.partitions.find((partition) => networkPartitionKeysEqual(partition.key, key));
    if (existing) return existing;
    const partition = { key };
    this.partitions.push(partition);
    return partition;
  }
}

/** Partition identity only. Cache entries and transactions join this owner in the cache slice. */
export type HTTPCachePartition = { key: NetworkPartitionKey; };
