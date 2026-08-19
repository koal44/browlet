import type { DomletDocument } from '../domlet/nodes/document';
import type { Realm } from './realm';
import type { WindowImpl } from './window';

export class WindowProxyController {
  readonly value: WindowProxyValue;
  #target?: WindowImpl;

  constructor(realm: Realm) {
    this.value = realm.global as unknown as WindowProxyValue;

    Object.defineProperties(this.value, {
      document: {
        configurable: true,
        get: () => this.target.document,
      },
      event: {
        configurable: true,
        get: () => this.target.event,
        set: (value: Event | undefined) => {
          Object.defineProperty(this.value, 'event', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
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
      getComputedStyle: {
        configurable: true,
        get: () => this.target.getComputedStyle,
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

  setWindow(window: WindowImpl): void {
    this.#target = window;
  }

  expose(name: string, value: unknown): void {
    Object.defineProperty(this.value, name, {
      configurable: true,
      writable: true,
      value,
    });
  }

  updateNamedProperties(document: DomletDocument): void {
    for (const element of document.getElementsByTagName('*')) {
      const name = element.getAttribute('id');

      if (!name || name in this.value) continue;

      Object.defineProperty(this.value, name, {
        configurable: true,
        get: () => this.target.document.getElementById(name) ?? undefined,
      });
    }
  }

  private get target(): WindowImpl {
    if (!this.#target) {
      throw new Error('WindowProxy has no associated Window');
    }

    return this.#target;
  }
}

export type WindowProxyValue = Window & {
  readonly document: DomletDocument;
  readonly self: WindowProxyValue;
  readonly window: WindowProxyValue;
};
