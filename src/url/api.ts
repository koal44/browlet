import { serializeHost } from './host';
import { serializeOrigin } from './origin';
import {
  parseFormUrlEncodedString, serializeFormUrlEncoded, type FormTuple,
} from './form-url-encoded';
import {
  basicURLParse, obtainURLOrigin, parseURL, serializeURL, serializeURLPath,
  setURLPassword, setURLUsername, type URLRecord,
} from './url';

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

  constructor(url: unknown, base?: unknown) {
    if (url === urlBindingConstruction) {
      const record = parseURL('about:blank').url;
      if (record === null) throw new Error('Could not create an empty URL');
      this.#url = record;
      this.#queryObject = new URLSearchParamsImpl();
      URLSearchParamsImpl.associateURL(this.#queryObject, this);
      return;
    }

    const parsed = parseAPIURL(toUSVString(url), optionalUSVString(base));
    if (parsed === null) throw new TypeError('Invalid URL');
    this.#url = parsed;
    this.#queryObject = new URLSearchParamsImpl();
    this.#initialize(parsed);
  }

  static parse(url: unknown, base?: unknown): URLImpl | null {
    const parsed = parseAPIURL(toUSVString(url), optionalUSVString(base));
    if (parsed === null) return null;
    return URLImpl.fromRecord(parsed);
  }

  static canParse(url: unknown, base?: unknown): boolean {
    return parseAPIURL(toUSVString(url), optionalUSVString(base)) !== null;
  }

  get href(): string {
    return serializeURL(this.#url);
  }

  set href(value: string) {
    const parsed = parseURL(toUSVString(value)).url;
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
    basicURLParse(`${toUSVString(value)}:`, {
      stateOverride: 'scheme start',
      url: this.#url,
    });
  }

  get username(): string {
    return this.#url.username;
  }

  set username(value: string) {
    if (cannotHaveUsernamePasswordPort(this.#url)) return;
    setURLUsername(this.#url, toUSVString(value));
  }

  get password(): string {
    return this.#url.password;
  }

  set password(value: string) {
    if (cannotHaveUsernamePasswordPort(this.#url)) return;
    setURLPassword(this.#url, toUSVString(value));
  }

  get host(): string {
    if (this.#url.host === null) return '';
    const host = serializeHost(this.#url.host);
    return this.#url.port === null ? host : `${host}:${this.#url.port}`;
  }

  set host(value: string) {
    if (hasOpaquePath(this.#url)) return;
    basicURLParse(toUSVString(value), {
      stateOverride: 'host',
      url: this.#url,
    });
  }

  get hostname(): string {
    return this.#url.host === null ? '' : serializeHost(this.#url.host);
  }

  set hostname(value: string) {
    if (hasOpaquePath(this.#url)) return;
    basicURLParse(toUSVString(value), {
      stateOverride: 'hostname',
      url: this.#url,
    });
  }

  get port(): string {
    return this.#url.port === null ? '' : String(this.#url.port);
  }

  set port(value: string) {
    if (cannotHaveUsernamePasswordPort(this.#url)) return;
    value = toUSVString(value);
    if (value === '') this.#url.port = null;
    else basicURLParse(value, { stateOverride: 'port', url: this.#url });
  }

  get pathname(): string {
    return serializeURLPath(this.#url);
  }

  set pathname(value: string) {
    if (hasOpaquePath(this.#url)) return;
    value = toUSVString(value);
    this.#url.path = [];
    basicURLParse(value, { stateOverride: 'path start', url: this.#url });
  }

  get search(): string {
    const query = this.#url.query;
    return query === null || query === '' ? '' : `?${query}`;
  }

  set search(value: string) {
    value = toUSVString(value);
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
    value = toUSVString(value);
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

  static createForBinding(newTarget: object): URLImpl {
    return Reflect.construct(
      URLImpl,
      [urlBindingConstruction],
      newTarget as NewTarget,
    );
  }

  static initializeForBinding(
    url: URLImpl,
    input: string,
    base?: string,
  ): void {
    const parsed = parseAPIURL(input, base);
    if (parsed === null) throw new TypeError('Invalid URL');
    url.#initialize(parsed);
  }

  static initializeRecordForBinding(url: URLImpl, record: URLRecord): void {
    url.#initialize(record);
  }

  static fromRecord(record: URLRecord): URLImpl {
    const url = new URLImpl(urlBindingConstruction);
    url.#initialize(record);
    return url;
  }

  static setQuery(url: URLImpl, query: string | null): void {
    url.#url.query = query;
  }

  static getQueryObject(url: URLImpl): URLSearchParamsImpl {
    return url.#queryObject;
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

  constructor(init: URLSearchParamsInit = '') {
    this.#initialize(init);
  }

  get size(): number {
    return this.#list.length;
  }

  append(name: string, value: string): void {
    this.#list.push([toUSVString(name), toUSVString(value)]);
    this.#update();
  }

  delete(name: string, value?: string): void {
    const convertedName = toUSVString(name);
    const convertedValue = value === undefined ? undefined : toUSVString(value);
    removeMatching(this.#list, (tuple) =>
      tuple[0] === convertedName &&
      (convertedValue === undefined || tuple[1] === convertedValue));
    this.#update();
  }

  get(name: string): string | null {
    const convertedName = toUSVString(name);
    return this.#list.find((tuple) => tuple[0] === convertedName)?.[1] ?? null;
  }

  getAll(name: string): string[] {
    const convertedName = toUSVString(name);
    return this.#list
      .filter((tuple) => tuple[0] === convertedName)
      .map((tuple) => tuple[1]);
  }

  has(name: string, value?: string): boolean {
    const convertedName = toUSVString(name);
    const convertedValue = value === undefined ? undefined : toUSVString(value);
    return this.#list.some((tuple) =>
      tuple[0] === convertedName &&
      (convertedValue === undefined || tuple[1] === convertedValue));
  }

  set(name: string, value: string): void {
    const convertedName = toUSVString(name);
    const convertedValue = toUSVString(value);
    const first = this.#list.findIndex((tuple) => tuple[0] === convertedName);

    if (first === -1) {
      this.#list.push([convertedName, convertedValue]);
    } else {
      this.#list[first] = [convertedName, convertedValue];
      for (let index = this.#list.length - 1; index > first; index--) {
        if (this.#list[index]![0] === convertedName) this.#list.splice(index, 1);
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
    callback: (value: string, key: string, parent: URLSearchParams) => void,
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

  static initializeForBinding(
    query: URLSearchParamsImpl,
    init: URLSearchParamsInit,
  ): void {
    query.#initialize(init);
  }

  static associateURL(query: URLSearchParamsImpl, url: URLImpl): void {
    query.#urlObject = url;
  }

  static replaceList(query: URLSearchParamsImpl, list: FormTuple[]): void {
    query.#list.splice(0, query.#list.length, ...list);
  }

  static valuePairs(query: URLSearchParamsImpl): readonly FormTuple[] {
    return query.#list;
  }

  static stringify(query: URLSearchParamsImpl): string {
    return serializeFormUrlEncoded(query.#list);
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

    if (isObject(init)) {
      const iterator = Reflect.get(init, Symbol.iterator);
      if (iterator !== undefined && iterator !== null) {
        if (typeof iterator !== 'function') throw new TypeError('Value is not iterable');
        for (const entry of init as Iterable<unknown>) {
          if (!isObject(entry)) throw new TypeError('Sequence entry is not iterable');
          const values = Array.from(entry as Iterable<unknown>, toUSVString);
          if (values.length !== 2) {
            throw new TypeError('Sequence entry must contain exactly two items');
          }
          this.#list.push([values[0]!, values[1]!]);
        }
        return;
      }

      const converted = new Map<string, string>();
      for (const key of Reflect.ownKeys(init)) {
        const descriptor = Reflect.getOwnPropertyDescriptor(init, key);
        if (!descriptor?.enumerable) continue;
        converted.set(toUSVString(key), toUSVString(Reflect.get(init, key)));
      }
      this.#list.push(...converted);
      return;
    }

    URLSearchParamsImpl.replaceList(
      this,
      parseFormUrlEncodedString(toUSVString(init)),
    );
  }

  #update(): void {
    if (this.#urlObject === null) return;
    const serialized = serializeFormUrlEncoded(this.#list);
    URLImpl.setQuery(this.#urlObject, serialized === '' ? null : serialized);
  }
}

export type URLSearchParamsInit =
  | Iterable<Iterable<unknown>>
  | Map<string, string>
  | Record<PropertyKey, unknown>
  | string
  | null
  | undefined;

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

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null ||
    typeof value === 'function';
}

function removeMatching(
  list: FormTuple[],
  matches: (tuple: FormTuple) => boolean,
): void {
  for (let index = list.length - 1; index >= 0; index--) {
    if (matches(list[index]!)) list.splice(index, 1);
  }
}

function optionalUSVString(value: unknown): string | undefined {
  return value === undefined ? undefined : toUSVString(value);
}

function toUSVString(value: unknown): string {
  if (typeof value === 'symbol') throw new TypeError('Cannot convert a symbol to a string');
  return String(value).toWellFormed();
}

const urlBindingConstruction = Symbol('URL binding construction');

type NewTarget = new (...argumentsList: never[]) => object;
