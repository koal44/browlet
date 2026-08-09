import type { Document } from '../domlet/nodes/document';
import type { Realm } from './realm';
import type { Window } from './window';

export class WindowProxy {
  readonly value: WindowProxyValue;
  #target?: Window;

  constructor(realm: Realm) {
    this.value = realm.global as WindowProxyValue;

    Object.defineProperties(this.value, {
      document: {
        configurable: true,
        get: () => this.target.document,
      },
      addEventListener: {
        configurable: true,
        get: () => this.target.addEventListener,
      },
      clearTimeout: {
        configurable: true,
        get: () => this.target.clearTimeout,
      },
      dispatchEvent: {
        configurable: true,
        get: () => this.target.dispatchEvent,
      },
      location: {
        configurable: true,
        get: () => this.target.location,
      },
      opener: {
        configurable: true,
        get: () => null,
      },
      parent: {
        configurable: true,
        get: () => this.value,
      },
      removeEventListener: {
        configurable: true,
        get: () => this.target.removeEventListener,
      },
      self: {
        configurable: true,
        get: () => this.value,
      },
      setTimeout: {
        configurable: true,
        get: () => this.target.setTimeout,
      },
      top: {
        configurable: true,
        get: () => this.value,
      },
      window: {
        configurable: true,
        get: () => this.value,
      },
    });
  }

  setWindow(window: Window): void {
    this.#target = window;
  }

  expose(name: string, value: unknown): void {
    Object.defineProperty(this.value, name, {
      configurable: true,
      writable: true,
      value,
    });
  }

  updateNamedProperties(document: Document): void {
    for (const element of document.getElementsByTagName('*')) {
      const name = element.getAttribute('id');

      if (!name || name in this.value) continue;

      Object.defineProperty(this.value, name, {
        configurable: true,
        get: () => this.target.document.getElementById(name) ?? undefined,
      });
    }
  }

  private get target(): Window {
    if (!this.#target) {
      throw new Error('WindowProxy has no associated Window');
    }

    return this.#target;
  }
}

export type WindowProxyValue = {
  readonly document: Document;
  readonly location: URL;
  readonly self: WindowProxyValue;
  readonly window: WindowProxyValue;
  [name: string]: unknown;
};
