import type { DomletDocument } from '../domlet/nodes/document';
import { LocationImpl } from './location';
import { withWindowStub } from './stubs/interfaces';

export class WindowImpl
  extends withWindowStub(class {})
  implements Window
{
  readonly document: DomletDocument;
  readonly #listeners = new Map<
    string,
    Set<EventListenerOrEventListenerObject>
  >();
  readonly #location: LocationImpl;
  readonly #timers = new Map<number, ReturnType<typeof setTimeout>>();
  #nextTimer = 1;

  constructor(document: DomletDocument, url: URL) {
    super();
    this.document = document;
    this.#location = new LocationImpl(url);
  }

  get location(): Location {
    return this.#location;
  }

  set location(_href: string) {
    throw new Error('Browlet navigation is not implemented');
  }

  readonly getComputedStyle = (
    element: Element,
    pseudoElement?: string | null,
  ): CSSStyleDeclaration => {
    if (pseudoElement !== null && pseudoElement !== undefined) {
      throw new Error('Pseudo-element computed style is not implemented');
    }

    return this.document.cssEngine.getComputedStyle(element);
  };

  readonly addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    _options?: boolean | AddEventListenerOptions,
  ): void => {
    let listeners = this.#listeners.get(type);

    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(type, listeners);
    }

    listeners.add(listener);
  }) as Window['addEventListener'];

  readonly removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    _options?: boolean | EventListenerOptions,
  ): void => {
    this.#listeners.get(type)?.delete(listener);
  }) as Window['removeEventListener'];

  readonly dispatchEvent = (event: Event): boolean => {
    for (const listener of this.#listeners.get(event.type) ?? []) {
      if (typeof listener === 'function') {
        listener.call(this, event);
      } else {
        listener.handleEvent(event);
      }
    }

    return true;
  };

  readonly setTimeout = (
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ): number => {
    const id = this.#nextTimer++;
    const timer = setTimeout(() => {
      this.#timers.delete(id);

      if (typeof handler === 'string') {
        throw new Error('String timer handlers are not implemented');
      }

      (handler as (...arguments_: unknown[]) => unknown)(...args);
    }, timeout);

    this.#timers.set(id, timer);
    return id;
  };

  readonly clearTimeout = (id?: number): void => {
    if (id === undefined) return;

    const timer = this.#timers.get(id);
    if (!timer) return;

    clearTimeout(timer);
    this.#timers.delete(id);
  };
}
