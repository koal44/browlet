import { BlobData } from '../../../file/index';
import {
  calculateCacheFreshness, canStoreResponse, EntityTag, parseHTTPDate, parseVary, serializeHTTPDate,
  type CacheFields, type CacheFreshness,
} from '../../../http/index';
import type { JSEnvironment } from '../../../js-engine/index';
import { InternalError } from '../../../infra/internal-error';
import { serializeURL } from '../../../url/index';
import { FetchBody } from '../../body';
import type { FetchHeaders } from '../../headers';
import type { FetchRequest } from '../../request';
import type { CacheUsage, FetchResponse } from '../../response';
import type { ResponseBodyInfo } from '../../timing';
import { isNullBodyStatus } from '../statuses';
import type { NetworkPartitionKey } from '../network-partition';
import type { HTTPCachePartitions } from './partitions';

/** One network partition's complete HTTP representations and pending body writes. */
// RFC 9111 §§3–4. Partial responses and range combination are optional and remain unstored.
export class HTTPCachePartition {
  key: NetworkPartitionKey;
  owner: HTTPCachePartitions;
  generation = 0;
  #entries = new Map<string, HTTPCacheEntry[]>();

  constructor(key: NetworkPartitionKey, owner: HTTPCachePartitions) {
    this.key = key;
    this.owner = owner;
  }

  /** Select the newest suitable Date, preferring explicit Vary rules to missing ones. */
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
  // RFC 9111 §4.3.4. A date alone is weak without evidence about the origin's clocks.
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
  // RFC 9111 §4.3.5.
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

  constructor(cache: HTTPCachePartition, request: FetchRequest, response: FetchResponse, requestTime: number, responseTime: number) {
    this.cache = cache;
    this.url = cacheURL(request);
    this.method = request.method;
    this.requestHeaders = request.headerList.clone();
    this.response = response.clone(null);
    this.response.discardBody = null;
    this.response.headerList = storedHeaders(response.headerList, responseTime);
    this.requestTime = requestTime;
    this.responseTime = responseTime;
    this.vary = parseVary(this.response.headerList.get('Vary') ?? '')!;
  }

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

  /** Allocate each reader's stream in its own environment. */
  materialize(request: FetchRequest, usage: CacheUsage, now: number, env: JSEnvironment): FetchResponse {
    if (this.body === undefined) throw new InternalError('Incomplete cache entry cannot supply a response');
    const body = request.method === 'HEAD' || isNullBodyStatus(this.response.status)
      ? null : FetchBody.fromSource(this.body, env);
    const response = this.response.clone(body);
    response.headerList.set('Age', String(Math.floor(this.freshness(now).currentAge)));
    response.cacheUsage = usage;
    if (request.method === 'HEAD') response.bodyInfo.encodedSize = response.bodyInfo.decodedSize = 0;
    return response;
  }

  /** Merge validation fields while preserving the interpretation of retained decoded bytes. */
  // RFC 9111 §3.2 excludes Content-Length and permits retaining Content-Encoding after decoding.
  update(response: FetchResponse, requestTime: number, responseTime: number): void {
    const headers = storedHeaders(response.headerList, responseTime);
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
    if (!canStoreResponse(this.method, this.response.status, cacheFields(this.response.headerList))) this.cache.owner.remove(this);
  }
}

function cacheURL(request: FetchRequest): string {
  return serializeURL(request.currentURL, true);
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

function cacheFields(headers: FetchHeaders): CacheFields {
  return {
    cacheControl: headers.get('Cache-Control') ?? undefined, date: headers.get('Date') ?? undefined,
    age: headers.get('Age') ?? undefined, expires: headers.get('Expires') ?? undefined,
    lastModified: headers.get('Last-Modified') ?? undefined, vary: headers.get('Vary') ?? undefined,
  };
}

// RFC 9111 §3.1 and RFC 9110 §7.6.1. Unknown end-to-end fields remain ordered and intact.
function storedHeaders(headers: FetchHeaders, received: number): FetchHeaders {
  const stored = headers.clone();
  const connection = headers.getDecodeAndSplit('Connection') ?? [];
  for (const name of [...connection, ...hopByHopHeaders]) stored.delete(name);
  if (!stored.has('Date')) stored.append('Date', serializeHTTPDate(received)!);
  return stored;
}

const hopByHopHeaders = ['Connection', 'Proxy-Connection', 'Keep-Alive', 'TE', 'Trailer', 'Transfer-Encoding', 'Upgrade',
  'Proxy-Authenticate', 'Proxy-Authorization', 'Proxy-Authentication-Info'];
