import { serializeHost } from './host';
import { serializeOrigin, type Origin } from './origin';
import {
  parseFormUrlEncodedString, serializeFormUrlEncoded, type FormTuple,
} from './form-url-encoded';
import {
  basicURLParse, obtainURLOrigin, parseURL, serializeURL, serializeURLPath,
  setURLPassword, setURLUsername, type URLRecord,
} from './url';
import {
  arg, attr, ctor, defineInterface, idlType, iter, nullable, op,
  roAttr, record, reference, sequence, stringifier, union, xattr,
  type Definition,
} from '../web-idl/declaration/index';
import { impl } from '../web-idl/index';

/*
 * Native URL delegation was evaluated against Node 22, 24, and 26. Keep this
 * implementation independent for now: current IDNA behavior would raise the
 * minimum Node version, URL semantics vary between runtime releases, and the
 * native API does not expose URL records or validation errors. It also cannot
 * replace public-suffix lookup or non-UTF-8 encoding.
 */

/*
 * [Exposed=*,
 *  LegacyWindowAlias=webkitURL]
 * interface URL {
 *   constructor(USVString url, optional USVString base);
 *
 *   static URL? parse(USVString url, optional USVString base);
 *   static boolean canParse(USVString url, optional USVString base);
 *
 *   stringifier attribute USVString href;
 *   readonly attribute USVString origin;
 *            attribute USVString protocol;
 *            attribute USVString username;
 *            attribute USVString password;
 *            attribute USVString host;
 *            attribute USVString hostname;
 *            attribute USVString port;
 *            attribute USVString pathname;
 *            attribute USVString search;
 *   [SameObject] readonly attribute URLSearchParams searchParams;
 *            attribute USVString hash;
 *
 *   USVString toJSON();
 * };
 */
export class URLImpl {
  #queryObject: URLSearchParamsImpl;
  #url: URLRecord;

  constructor(url: string | URLRecord, base?: string) {
    const parsed = typeof url === 'string'
      ? parseAPIURL(url, base)
      : url;
    if (parsed === null) throw new TypeError('Invalid URL');
    this.#url = parsed;
    this.#queryObject = new URLSearchParamsImpl('');
    this.#initialize(parsed);
  }

  static parse(url: string, base?: string): URLImpl | null {
    const parsed = parseAPIURL(url, base);
    if (parsed === null) return null;
    return URLImpl.fromRecord(parsed);
  }

  static canParse(url: string, base?: string): boolean {
    return parseAPIURL(url, base) !== null;
  }

  get href(): string {
    return serializeURL(this.#url);
  }

  set href(value: string) {
    const parsed = parseURL(value).url;
    if (parsed === null) throw new TypeError('Invalid URL');
    this.#initialize(parsed);
  }

  get origin(): string {
    return serializeOrigin(obtainURLOrigin(this.#url));
  }

  get protocol(): string {
    return `${this.#url.scheme}:`;
  }

  set protocol(value: string) {
    basicURLParse(`${value}:`, {
      stateOverride: 'scheme start',
      url: this.#url,
    });
  }

  get username(): string {
    return this.#url.username;
  }

  set username(value: string) {
    if (cannotHaveUsernamePasswordPort(this.#url)) return;
    setURLUsername(this.#url, value);
  }

  get password(): string {
    return this.#url.password;
  }

  set password(value: string) {
    if (cannotHaveUsernamePasswordPort(this.#url)) return;
    setURLPassword(this.#url, value);
  }

  get host(): string {
    if (this.#url.host === null) return '';
    const host = serializeHost(this.#url.host);
    return this.#url.port === null ? host : `${host}:${this.#url.port}`;
  }

  set host(value: string) {
    if (hasOpaquePath(this.#url)) return;
    basicURLParse(value, {
      stateOverride: 'host',
      url: this.#url,
    });
  }

  get hostname(): string {
    return this.#url.host === null ? '' : serializeHost(this.#url.host);
  }

  set hostname(value: string) {
    if (hasOpaquePath(this.#url)) return;
    basicURLParse(value, {
      stateOverride: 'hostname',
      url: this.#url,
    });
  }

  get port(): string {
    return this.#url.port === null ? '' : String(this.#url.port);
  }

  set port(value: string) {
    if (cannotHaveUsernamePasswordPort(this.#url)) return;
    if (value === '') this.#url.port = null;
    else basicURLParse(value, { stateOverride: 'port', url: this.#url });
  }

  get pathname(): string {
    return serializeURLPath(this.#url);
  }

  set pathname(value: string) {
    if (hasOpaquePath(this.#url)) return;
    this.#url.path = [];
    basicURLParse(value, { stateOverride: 'path start', url: this.#url });
  }

  get search(): string {
    const query = this.#url.query;
    return query === null || query === '' ? '' : `?${query}`;
  }

  set search(value: string) {
    if (value === '') {
      this.#url.query = null;
      URLSearchParamsImpl.replaceList(this.#queryObject, []);
      return;
    }

    const input = value.startsWith('?') ? value.slice(1) : value;
    this.#url.query = '';
    basicURLParse(input, { stateOverride: 'query', url: this.#url });
    URLSearchParamsImpl.replaceList(
      this.#queryObject,
      parseFormUrlEncodedString(input),
    );
  }

  get searchParams(): URLSearchParamsImpl {
    return this.#queryObject;
  }

  get hash(): string {
    const fragment = this.#url.fragment;
    return fragment === null || fragment === '' ? '' : `#${fragment}`;
  }

  set hash(value: string) {
    if (value === '') {
      this.#url.fragment = null;
      return;
    }

    const input = value.startsWith('#') ? value.slice(1) : value;
    this.#url.fragment = '';
    basicURLParse(input, { stateOverride: 'fragment', url: this.#url });
  }

  toJSON(): string {
    return serializeURL(this.#url);
  }

  toString(): string {
    return serializeURL(this.#url);
  }

  static fromRecord(record: URLRecord): URLImpl {
    return new URLImpl(record);
  }

  static setQuery(url: URLImpl, query: string | null): void {
    url.#url.query = query;
  }

  static extractOrigin(value: unknown): Origin | undefined {
    return value !== null && typeof value === 'object' && #url in value
      ? obtainURLOrigin(value.#url)
      : undefined;
  }

  #initialize(record: URLRecord): void {
    const query = record.query ?? '';
    this.#url = record;
    URLSearchParamsImpl.replaceList(
      this.#queryObject,
      parseFormUrlEncodedString(query),
    );
    URLSearchParamsImpl.associateURL(this.#queryObject, this);
  }
}

// -- Web IDL ------------------------------------------------------------

export const urlIDL = defineInterface({
  name: 'URL',
  exposed: '*',
  ...xattr(['LegacyWindowAlias', 'webkitURL']),
  implementation: impl(URLImpl),
  members: [
    ctor([
      arg('url', idlType.USVString),
      arg('base', idlType.USVString, { optional: true }),
    ]),
    op('parse', nullable(reference('URL')), [
      arg('url', idlType.USVString),
      arg('base', idlType.USVString, { optional: true }),
    ], {
      static: true,
    }),
    op('canParse', idlType.boolean, [
      arg('url', idlType.USVString),
      arg('base', idlType.USVString, { optional: true }),
    ], {
      static: true,
    }),
    attr('href', idlType.USVString, { stringifier: true }),
    roAttr('origin', idlType.USVString),
    ...[
      'protocol', 'username', 'password', 'host', 'hostname', 'port',
      'pathname', 'search',
    ].map((name) => attr(name, idlType.USVString)),
    roAttr(
      'searchParams',
      reference('URLSearchParams'),
      xattr('SameObject'),
    ),
    attr('hash', idlType.USVString),
    op('toJSON', idlType.USVString),
  ],
});

/*
 * [Exposed=*]
 * interface URLSearchParams {
 *   constructor(optional (sequence<sequence<USVString>> or record<USVString, USVString> or USVString) init = "");
 *
 *   readonly attribute unsigned long size;
 *
 *   undefined append(USVString name, USVString value);
 *   undefined delete(USVString name, optional USVString value);
 *   USVString? get(USVString name);
 *   sequence<USVString> getAll(USVString name);
 *   boolean has(USVString name, optional USVString value);
 *   undefined set(USVString name, USVString value);
 *
 *   undefined sort();
 *
 *   iterable<USVString, USVString>;
 *   stringifier;
 * };
 */
export class URLSearchParamsImpl implements URLSearchParams {
  #list: FormTuple[] = [];
  #urlObject: URLImpl | null = null;

  constructor(init: URLSearchParamsInit) {
    this.#initialize(init);
  }

  get size(): number {
    return this.#list.length;
  }

  append(name: string, value: string): void {
    this.#list.push([name, value]);
    this.#update();
  }

  delete(name: string, value?: string): void {
    removeMatching(this.#list, (tuple) =>
      tuple[0] === name &&
      (value === undefined || tuple[1] === value));
    this.#update();
  }

  get(name: string): string | null {
    return this.#list.find((tuple) => tuple[0] === name)?.[1] ?? null;
  }

  getAll(name: string): string[] {
    return this.#list
      .filter((tuple) => tuple[0] === name)
      .map((tuple) => tuple[1]);
  }

  has(name: string, value?: string): boolean {
    return this.#list.some((tuple) =>
      tuple[0] === name &&
      (value === undefined || tuple[1] === value));
  }

  set(name: string, value: string): void {
    const first = this.#list.findIndex((tuple) => tuple[0] === name);

    if (first === -1) {
      this.#list.push([name, value]);
    } else {
      this.#list[first] = [name, value];
      for (let index = this.#list.length - 1; index > first; index--) {
        if (this.#list[index]![0] === name) this.#list.splice(index, 1);
      }
    }
    this.#update();
  }

  sort(): void {
    this.#list.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    this.#update();
  }

  *entries(): URLSearchParamsIterator<[string, string]> {
    for (let index = 0; index < this.#list.length; index++) {
      yield [...this.#list[index]!] as [string, string];
    }
  }

  *keys(): URLSearchParamsIterator<string> {
    for (let index = 0; index < this.#list.length; index++) {
      yield this.#list[index]![0];
    }
  }

  *values(): URLSearchParamsIterator<string> {
    for (let index = 0; index < this.#list.length; index++) {
      yield this.#list[index]![1];
    }
  }

  forEach(
    callback: (
      value: string,
      key: string,
      parent: URLSearchParamsImpl,
    ) => void,
    thisArg?: unknown,
  ): void {
    for (let index = 0; index < this.#list.length; index++) {
      const [name, value] = this.#list[index]!;
      callback.call(thisArg, value, name, this);
    }
  }

  [Symbol.iterator](): URLSearchParamsIterator<[string, string]> {
    return this.entries();
  }

  toString(): string {
    return serializeFormUrlEncoded(this.#list);
  }

  static associateURL(query: URLSearchParamsImpl, url: URLImpl): void {
    query.#urlObject = url;
  }

  static replaceList(query: URLSearchParamsImpl, list: FormTuple[]): void {
    query.#list.splice(0, query.#list.length, ...list);
  }

  #initialize(init: URLSearchParamsInit): void {
    this.#list.length = 0;
    if (typeof init === 'string') {
      const input = init.startsWith('?') ? init.slice(1) : init;
      URLSearchParamsImpl.replaceList(
        this,
        parseFormUrlEncodedString(input),
      );
      return;
    }

    const iterator = Reflect.get(init, Symbol.iterator);
    if (iterator !== undefined && iterator !== null) {
      for (const entry of init as Iterable<Iterable<string>>) {
        const values = Array.from(entry);
        if (values.length !== 2) {
          throw new TypeError('Sequence entry must contain exactly two items');
        }
        this.#list.push([values[0]!, values[1]!]);
      }
      return;
    }

    for (const key of Reflect.ownKeys(init)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(init, key);
      if (!descriptor?.enumerable) continue;
      this.#list.push([key as string, Reflect.get(init, key) as string]);
    }
  }

  #update(): void {
    if (this.#urlObject === null) return;
    const serialized = serializeFormUrlEncoded(this.#list);
    URLImpl.setQuery(this.#urlObject, serialized === '' ? null : serialized);
  }
}

// -- Web IDL ------------------------------------------------------------

export const urlSearchParamsIDL = defineInterface({
  name: 'URLSearchParams',
  exposed: '*',
  implementation: impl(URLSearchParamsImpl),
  members: [
    ctor([
      arg(
        'init',
        union(
          sequence(sequence(idlType.USVString)),
          record(idlType.USVString, idlType.USVString),
          idlType.USVString,
        ),
        {
          default: '',
          optional: true,
        },
      ),
    ]),
    roAttr('size', idlType.unsignedLong),
    op('append', idlType.undefined, [
      arg('name', idlType.USVString),
      arg('value', idlType.USVString),
    ]),
    op('delete', idlType.undefined, [
      arg('name', idlType.USVString),
      arg('value', idlType.USVString, { optional: true }),
    ]),
    op('get', nullable(idlType.USVString), [
      arg('name', idlType.USVString),
    ]),
    op('getAll', sequence(idlType.USVString), [
      arg('name', idlType.USVString),
    ]),
    op('has', idlType.boolean, [
      arg('name', idlType.USVString),
      arg('value', idlType.USVString, { optional: true }),
    ]),
    op('set', idlType.undefined, [
      arg('name', idlType.USVString),
      arg('value', idlType.USVString),
    ]),
    op('sort', idlType.undefined),
    iter(idlType.USVString, {
      key: idlType.USVString,
    }),
    stringifier(),
  ],
});

export const urlIDLDefinitions: Definition[] = [
  urlIDL,
  urlSearchParamsIDL,
];

export type URLSearchParamsInit =
  | Iterable<Iterable<string>>
  | Record<PropertyKey, string>
  | string;

export function parseAPIURL(input: string, base?: string): URLRecord | null {
  let parsedBase: URLRecord | null = null;
  if (base !== undefined) {
    parsedBase = parseURL(base).url;
    if (parsedBase === null) return null;
  }
  return parseURL(input, parsedBase).url;
}

function cannotHaveUsernamePasswordPort(url: URLRecord): boolean {
  return url.host === null || url.host.kind === 'empty' || url.scheme === 'file';
}

function hasOpaquePath(url: URLRecord): boolean {
  return typeof url.path === 'string';
}

function removeMatching(
  list: FormTuple[],
  matches: (tuple: FormTuple) => boolean,
): void {
  for (let index = list.length - 1; index >= 0; index--) {
    if (matches(list[index]!)) list.splice(index, 1);
  }
}
