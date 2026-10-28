import { URL } from 'node:url';

import { InternalError } from '../../../infra/index';
import {
  arg, attr, defineInterface, idlType, impl, op, roAttr, xattr,
} from '../../../web-idl/core/index';

/** Exposes URL components for a Window; navigation operations remain unimplemented. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-location-interface
// PROVISIONAL: URL snapshot only. Document association, navigation, ancestor
// origins, and exotic property access await ROADMAP.md.
// TODO(HTML 7.2.4): Compose CrossOriginObjectBinding when installing Location's exotic methods.
export class LocationImpl {
  /** URL snapshot exposed by the current provisional Location implementation. */
  #url: URL;

  constructor(url: URL) {
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

  toString(): string {
    return this.href;
  }

  assign(_url: string): void {
    navigationNotImplemented();
  }

  reload(): void {
    navigationNotImplemented();
  }

  replace(_url: string): void {
    navigationNotImplemented();
  }
}

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
export const locationIDL = defineInterface({
  name: 'Location',
  exposed: 'Window',
  ...xattr('CrossOriginObject'),
  implementation: impl(LocationImpl),
  members: [
    attr('href', idlType.USVString, {
      ...xattr('LegacyUnforgeable', ['CrossOrigin', 'Setter']),
      stringifier: true,
    }),
    roAttr('origin', idlType.USVString, xattr('LegacyUnforgeable')),
    attr('protocol', idlType.USVString, xattr('LegacyUnforgeable')),
    attr('host', idlType.USVString, xattr('LegacyUnforgeable')),
    attr('hostname', idlType.USVString, xattr('LegacyUnforgeable')),
    attr('port', idlType.USVString, xattr('LegacyUnforgeable')),
    attr('pathname', idlType.USVString, xattr('LegacyUnforgeable')),
    attr('search', idlType.USVString, xattr('LegacyUnforgeable')),
    attr('hash', idlType.USVString, xattr('LegacyUnforgeable')),
    op('assign', idlType.undefined, [arg('url', idlType.USVString)], xattr('LegacyUnforgeable')),
    op('replace', idlType.undefined,
      [arg('url', idlType.USVString)],
      xattr('LegacyUnforgeable', 'CrossOrigin'),
    ),
    op('reload', idlType.undefined, [], xattr('LegacyUnforgeable')),
  ],
});

function navigationNotImplemented(): never {
  throw new InternalError('Browlet navigation is not implemented');
}
