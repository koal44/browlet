import {
  DocumentImpl, type DomletDocument,
} from '../domlet/nodes/document';
import {
  EventTargetImpl, type EventTargetVirtuals,
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
  readonly #location: LocationImpl;
  readonly #timers = new Map<number, ReturnType<typeof setTimeout>>();
  #nextTimer = 1;

  constructor(document: DomletDocument, url: URL) {
    super(windowEventTargetVirtuals);
    this.document = document;
    this.#location = new LocationImpl(url);
    DocumentImpl.setBrowsingContextWindow(document, this);
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

  // -- Friends ----------------------------------------------------------

  static getCurrentEvent(window: WindowImpl): Event | undefined {
    return window.#currentEvent;
  }

  static setCurrentEvent(window: WindowImpl, event: Event | undefined): void {
    window.#currentEvent = event;
  }
}

// -- Virtual ------------------------------------------------------------
const windowEventTargetVirtuals: EventTargetVirtuals = {
  isDefaultPassiveTarget: () => true,
  isWindow: () => true,
  getLegacyTargetOverride: (target) => target instanceof WindowImpl
    ? target.document
    : target,
};
