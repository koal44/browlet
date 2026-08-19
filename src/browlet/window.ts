import {
  DocumentImpl, type DomletDocument,
} from '../domlet/nodes/document';
import {
  EventTargetImpl, type EventTargetHooks,
} from '../domlet/events/event-target';
import { LocationImpl } from './location';
import { withWindowStub } from './stubs/interfaces';

/*
 * partial interface Window {
 *   [Replaceable] readonly attribute (Event or undefined) event; // legacy
 * };
 */
export class WindowImpl
  extends withWindowStub(EventTargetImpl)
  implements Window
{
  readonly document: DomletDocument;
  #currentEvent: Event | undefined;
  readonly #listeners = new Map<
    string,
    Set<EventListenerOrEventListenerObject>
  >();
  readonly #location: LocationImpl;
  readonly #timers = new Map<number, ReturnType<typeof setTimeout>>();
  #nextTimer = 1;

  constructor(document: DomletDocument, url: URL) {
    super(windowEventTargetHooks);
    this.document = document;
    this.#location = new LocationImpl(url);
  }

  get location(): Location {
    return this.#location;
  }

  set location(_href: string) {
    throw new Error('Browlet navigation is not implemented');
  }

  /** @deprecated */
  get event(): Event | undefined {
    return this.#currentEvent;
  }

  set event(value: Event | undefined) {
    Object.defineProperty(this, 'event', {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  readonly getComputedStyle = (
    element: Element,
    pseudoElement?: string | null,
  ): CSSStyleDeclaration => {
    if (pseudoElement !== null && pseudoElement !== undefined) {
      throw new Error('Pseudo-element computed style is not implemented');
    }

    return DocumentImpl.getCSSEngine(this.document).getComputedStyle(element);
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
    // TODO(DOM section 2.9): The invoke algorithm must move this current-event
    // scoping to the Window associated with every listener callback.
    for (const listener of this.#listeners.get(event.type) ?? []) {
      const previousEvent = this.#currentEvent;
      this.#currentEvent = event;

      try {
        if (typeof listener === 'function') {
          listener.call(this, event);
        } else {
          listener.handleEvent(event);
        }
      } finally {
        this.#currentEvent = previousEvent;
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

const windowEventTargetHooks: EventTargetHooks = {
  isDefaultPassiveTarget: () => true,
};
