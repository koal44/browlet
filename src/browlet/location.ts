import {
  arg, attr, defineInterface, idlType, op, readonlyAttr, xattr,
} from '../web-idl/declaration/index';
import { bind } from '../web-idl/index';
import { withLocationStub } from './stubs/interfaces';

/*
 * [Exposed=Window]
 * interface Location { // but see also additional creation steps and overridden internal methods
 *   [LegacyUnforgeable] stringifier attribute USVString href;
 *   [LegacyUnforgeable] readonly attribute USVString origin;
 *   [LegacyUnforgeable] attribute USVString protocol;
 *   [LegacyUnforgeable] attribute USVString host;
 *   [LegacyUnforgeable] attribute USVString hostname;
 *   [LegacyUnforgeable] attribute USVString port;
 *   [LegacyUnforgeable] attribute USVString pathname;
 *   [LegacyUnforgeable] attribute USVString search;
 *   [LegacyUnforgeable] attribute USVString hash;
 *
 *   [LegacyUnforgeable] undefined assign(USVString url);
 *   [LegacyUnforgeable] undefined replace(USVString url);
 *   [LegacyUnforgeable] undefined reload();
 *
 *   [LegacyUnforgeable] readonly attribute DOMStringList ancestorOrigins;
 * };
 */
export class LocationImpl
  extends withLocationStub(class {})
  implements Location
{
  readonly #url: URL;

  constructor(url: URL) {
    super();
    this.#url = new URL(url);
  }

  get hash(): string {
    return this.#url.hash;
  }

  set hash(_value: string) {
    navigationNotImplemented();
  }

  get host(): string {
    return this.#url.host;
  }

  set host(_value: string) {
    navigationNotImplemented();
  }

  get hostname(): string {
    return this.#url.hostname;
  }

  set hostname(_value: string) {
    navigationNotImplemented();
  }

  get href(): string {
    return this.#url.href;
  }

  set href(_value: string) {
    navigationNotImplemented();
  }

  toString(): string {
    return this.href;
  }

  get origin(): string {
    return this.#url.origin;
  }

  get pathname(): string {
    return this.#url.pathname;
  }

  set pathname(_value: string) {
    navigationNotImplemented();
  }

  get port(): string {
    return this.#url.port;
  }

  set port(_value: string) {
    navigationNotImplemented();
  }

  get protocol(): string {
    return this.#url.protocol;
  }

  set protocol(_value: string) {
    navigationNotImplemented();
  }

  get search(): string {
    return this.#url.search;
  }

  set search(_value: string) {
    navigationNotImplemented();
  }

  assign(_url: string | URL): void {
    navigationNotImplemented();
  }

  reload(): void {
    navigationNotImplemented();
  }

  replace(_url: string | URL): void {
    navigationNotImplemented();
  }
}

// -- Web IDL ------------------------------------------------------------

export const locationIDL = defineInterface({
  binding: bind(LocationImpl),
  exposed: 'Window',
  members: [
    attr('href', idlType.USVString, {
      ...xattr('LegacyUnforgeable'),
      stringifier: true,
    }),
    readonlyAttr('origin', idlType.USVString, xattr('LegacyUnforgeable')),
    ...[
      'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash',
    ].map((name) => attr(
      name,
      idlType.USVString,
      xattr('LegacyUnforgeable'),
    )),
    ...['assign', 'replace'].map((name) => op(
      name,
      idlType.undefined,
      [arg('url', idlType.USVString)],
      xattr('LegacyUnforgeable'),
    )),
    op('reload', idlType.undefined, [], xattr('LegacyUnforgeable')),
  ],
  name: 'Location',
});

function navigationNotImplemented(): never {
  throw new Error('Browlet navigation is not implemented');
}
