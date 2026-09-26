import { BlobData } from '../file/index';
import {
  calculateCacheFreshness, canStoreResponse, EntityTag, parseHTTPDate, parseVary, serializeHTTPDate,
  type CacheFields, type CacheFreshness,
} from '../http/index';
import { InternalError } from '../infra/internal-error';
import type { JSEnvironment } from '../js-engine/index';
import { serializeURL } from '../url/index';
import { FetchBody } from './body';
import { isNullBodyStatus, type FetchHeaders } from './headers';
import type { FetchRequest } from './request';
import type { CacheUsage, FetchResponse } from './response';
import type { ResponseBodyInfo } from './timing';
import { networkPartitionKeysEqual, type NetworkPartitionKey } from './transport';

/** Browser-owned private caches sharing a bounded, least-recently-used body budget. */
export class HTTPCacheStore {
  /** Logical caches indexed by network partition key. */
  partitions: HTTPCachePartition[] = [];
  maxBytes = 32 * 1024 * 1024;
  maxEntryBytes = 8 * 1024 * 1024;
  maxEntries = 256;
  #entries = new Set<HTTPCacheEntry>();
  #size = 0;

  /** Get or create the request's cache partition; return null when it has no partition key. */
  // https://fetch.spec.whatwg.org/#determine-the-http-cache-partition
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

  /** Reserve body space before copying a chunk; return whether the entry survives eviction. */
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

/** One network partition's complete HTTP representations and pending body writes. */
// https://www.rfc-editor.org/rfc/rfc9111.html#section-3
// Partial responses and range combination are optional and remain unstored.
export class HTTPCachePartition {
  key: NetworkPartitionKey;
  owner: HTTPCacheStore;
  generation = 0;
  #entries = new Map<string, HTTPCacheEntry[]>();

  constructor(key: NetworkPartitionKey, owner: HTTPCacheStore) {
    this.key = key;
    this.owner = owner;
  }

  /** Select the newest suitable Date, preferring explicit Vary rules to missing ones. */
  // https://www.rfc-editor.org/rfc/rfc9111.html#section-4.1
  select(request: FetchRequest): HTTPCacheEntry | undefined {
    const entries = this.candidates(request);
    const varied = entries.filter((entry) => entry.response.headerList.has('Vary'));
    const selected = newest(varied.length ? varied : entries);
    if (selected) this.owner.touch(selected);
    return selected;
  }

  /** All complete representations matching the target, method, and selecting fields. */
  candidates(request: FetchRequest): HTTPCacheEntry[] {
    return (this.#entries.get(cacheURL(request)) ?? []).filter((entry) =>
      entry.body !== undefined && entry.matches(request));
  }

  /** Start retaining a cacheable response before the transport delivers any body bytes. */
  begin(request: FetchRequest, response: FetchResponse, requestTime: number, responseTime: number): HTTPCacheEntry | undefined {
    if (request.cacheMode === 'no-store' || request.headerList.has('Range') ||
      !canStoreResponse(request.method, response.status, cacheFields(response.headerList), request.headerList.get('Cache-Control') ?? '')) {
      return undefined;
    }
    const entry = new HTTPCacheEntry(this, request, response, requestTime, responseTime);
    const entries = this.#entries.get(entry.url) ?? [];
    entries.push(entry);
    this.#entries.set(entry.url, entries);
    return this.owner.reserve(entry, 0) ? entry : undefined;
  }

  /** Apply only the 304 validators that identify stored representations. */
  // https://www.rfc-editor.org/rfc/rfc9111.html#section-4.3.4
  // A date alone is weak without evidence about the origin's clocks.
  revalidate(request: FetchRequest, response: FetchResponse, requestTime: number, responseTime: number): void {
    const candidates = this.candidates(request);
    const tag = EntityTag.parse(response.headerList.get('ETag') ?? '');
    let entries: HTTPCacheEntry[];
    if (tag !== null && !tag.weak) {
      entries = candidates.filter((entry) => EntityTag.parse(entry.response.headerList.get('ETag') ?? '')?.matches(tag, 'strong'));
    } else {
      const modified = response.headerList.get('Last-Modified');
      const matching = tag !== null
        ? candidates.filter((entry) => EntityTag.parse(entry.response.headerList.get('ETag') ?? '')?.matches(tag, 'weak'))
        : modified !== null
        ? candidates.filter((entry) => entry.response.headerList.get('Last-Modified') === modified)
        : candidates.length === 1 && !candidates[0]!.response.headerList.has('ETag') &&
          !candidates[0]!.response.headerList.has('Last-Modified') ? candidates : [];
      const entry = newest(matching);
      entries = entry ? [entry] : [];
    }
    for (const entry of entries) entry.update(response, requestTime, responseTime);
  }

  /** Freshen matching GET metadata after HEAD, discarding contradicted representations. */
  // https://www.rfc-editor.org/rfc/rfc9111.html#section-4.3.5
  freshen(request: FetchRequest, response: FetchResponse, requestTime: number, responseTime: number): void {
    for (const entry of this.candidates(request)) {
      if (entry.method !== 'GET') continue;
      const matches = ['ETag', 'Last-Modified', 'Content-Length'].every((name) =>
        !response.headerList.has(name) || response.headerList.get(name) === entry.response.headerList.get(name));
      if (matches) entry.update(response, requestTime, responseTime);
      else this.owner.remove(entry);
    }
  }

  /** Invalidate every variant, including outstanding writes for the target URI. */
  // https://www.rfc-editor.org/rfc/rfc9111.html#section-4.4
  invalidate(request: FetchRequest): void {
    this.generation++;
    for (const entry of [...this.#entries.get(cacheURL(request)) ?? []]) this.owner.remove(entry);
  }

  clear(): void {
    this.generation++;
    for (const entries of [...this.#entries.values()]) {
      for (const entry of [...entries]) this.owner.remove(entry);
    }
  }

  remove(entry: HTTPCacheEntry): void {
    const entries = this.#entries.get(entry.url);
    if (!entries) return;
    const remaining = entries.filter((candidate) => candidate !== entry);
    if (remaining.length) this.#entries.set(entry.url, remaining);
    else this.#entries.delete(entry.url);
  }

  /** Discard complete variants superseded by this entry's method and Vary selectors. */
  replace(entry: HTTPCacheEntry): void {
    for (const other of [...this.#entries.get(entry.url) ?? []]) {
      if (other !== entry && other.body !== undefined && other.method === entry.method &&
        other.vary.length === entry.vary.length && entry.vary.every((name) => other.vary.includes(name) &&
          other.requestHeaders.get(name) === entry.requestHeaders.get(name))) {
        this.owner.remove(other);
      }
    }
  }
}

/** Retained Fetch metadata and immutable bytes, with no realm-owned stream or environment. */
export class HTTPCacheEntry {
  cache: HTTPCachePartition;
  url: string;
  method: string;
  requestHeaders: FetchHeaders;
  response: FetchResponse;
  requestTime: number;
  responseTime: number;
  vary: string[];
  body: BlobData | undefined;
  size = 0;
  active = true;
  #chunks: BlobData[] = [];

  constructor(
    cache: HTTPCachePartition, request: FetchRequest, response: FetchResponse,
    requestTime: number, responseTime: number
  ) {
    this.cache = cache;
    this.url = cacheURL(request);
    this.method = request.method;
    this.requestHeaders = request.headerList.clone();
    this.response = response.copy(null);
    this.response.discardBody = null;
    this.response.headerList = cacheHeaders(response.headerList, responseTime);
    this.requestTime = requestTime;
    this.responseTime = responseTime;
    this.vary = parseVary(this.response.headerList.get('Vary') ?? '')!;
  }

  /** Check method and Vary selectors for entries already grouped by target URL. */
  matches(request: FetchRequest): boolean {
    return (this.method === request.method || this.method === 'GET' && request.method === 'HEAD') &&
      this.vary.every((name) => this.requestHeaders.get(name) === request.headerList.get(name));
  }

  /** Copy only chunks already flowing to the consumer, within the shared cache budget. */
  append(bytes: Uint8Array): void {
    if (this.cache.owner.reserve(this, bytes.byteLength)) this.#chunks.push(BlobData.fromBytes(bytes));
  }

  /** Publish only after transport framing and content decoding both finish successfully. */
  finish(bodyInfo: ResponseBodyInfo): void {
    if (!this.active) return;
    this.body = BlobData.concatenate(this.#chunks);
    this.#chunks = [];
    Object.assign(this.response.bodyInfo, bodyInfo);
    this.cache.replace(this);
  }

  discard(): void {
    this.active = false;
    this.#chunks = [];
    this.cache.remove(this);
  }

  freshness(now: number): CacheFreshness {
    // Clamp a backwards clock before calculating elapsed age.
    const responseTime = Math.max(this.requestTime, this.responseTime);
    return calculateCacheFreshness(cacheFields(this.response.headerList), this.response.status,
      { requestTime: this.requestTime, responseTime, now: Math.max(responseTime, now) });
  }

  /** Clone a complete response with its current Age and a stream in the reader's environment. */
  materialize(request: FetchRequest, usage: CacheUsage, now: number, env: JSEnvironment): FetchResponse {
    if (this.body === undefined) throw new InternalError('Incomplete cache entry cannot supply a response');
    const body = request.method === 'HEAD' || isNullBodyStatus(this.response.status)
      ? null : FetchBody.fromSource(this.body, env);
    const response = this.response.copy(body);
    response.headerList.set('Age', String(Math.floor(this.freshness(now).currentAge)));
    response.cacheUsage = usage;
    if (request.method === 'HEAD') response.bodyInfo.encodedSize = response.bodyInfo.decodedSize = 0;
    return response;
  }

  /** Merge validation fields while preserving the interpretation of retained decoded bytes. */
  // https://www.rfc-editor.org/rfc/rfc9111.html#section-3.2
  // Excludes Content-Length and permits retaining Content-Encoding after decoding.
  update(response: FetchResponse, requestTime: number, responseTime: number): void {
    const headers = cacheHeaders(response.headerList, responseTime);
    const names = new Set(headers.list.map(([name]) => name.toLowerCase()));
    for (const name of ['content-length', 'content-encoding', 'content-range']) names.delete(name);
    for (const name of names) this.response.headerList.delete(name);
    for (const [name, value] of headers) {
      if (names.has(name.toLowerCase())) this.response.headerList.append(name, value);
    }
    // A validation response without Age starts a new age calculation at this receipt.
    if (!headers.has('Age')) this.response.headerList.delete('Age');
    this.requestTime = requestTime;
    this.responseTime = responseTime;
    this.vary = parseVary(this.response.headerList.get('Vary') ?? '') ?? ['*'];
    if (!canStoreResponse(this.method, this.response.status, cacheFields(this.response.headerList))) {
      this.cache.owner.remove(this);
    }
  }
}

function newest(entries: HTTPCacheEntry[]): HTTPCacheEntry | undefined {
  let result: HTTPCacheEntry | undefined;
  let date = -Infinity;
  for (const entry of entries) {
    const candidate = parseHTTPDate(entry.response.headerList.get('Date') ?? '', entry.responseTime) ?? entry.responseTime;
    if (candidate >= date) { result = entry; date = candidate; }
  }
  return result;
}

function cacheURL(request: FetchRequest): string {
  return serializeURL(request.currentURL, true);
}

function cacheFields(headers: FetchHeaders): CacheFields {
  return {
    cacheControl: headers.get('Cache-Control') ?? undefined,
    date: headers.get('Date') ?? undefined,
    age: headers.get('Age') ?? undefined,
    expires: headers.get('Expires') ?? undefined,
    lastModified: headers.get('Last-Modified') ?? undefined,
    vary: headers.get('Vary') ?? undefined,
  };
}

/** Copy storable fields and supply a receipt Date if absent, preserving field order. */
// https://www.rfc-editor.org/rfc/rfc9111.html#section-3
// https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.1
function cacheHeaders(headers: FetchHeaders, received: number): FetchHeaders {
  const stored = headers.clone();
  const connection = headers.getDecodeAndSplit('Connection') ?? [];
  for (const name of [...connection, ...hopByHopHeaders]) stored.delete(name);
  if (!stored.has('Date')) stored.append('Date', serializeHTTPDate(received)!);
  return stored;
}

const hopByHopHeaders = [
  'Connection', 'Proxy-Connection', 'Keep-Alive', 'TE', 'Trailer', 'Transfer-Encoding',
  'Upgrade', 'Proxy-Authenticate', 'Proxy-Authorization', 'Proxy-Authentication-Info',
];
