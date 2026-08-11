import { withLocationStub } from './stubs/interfaces';

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

function navigationNotImplemented(): never {
  throw new Error('Browlet navigation is not implemented');
}
