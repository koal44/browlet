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
  #document: DomletDocument | null = null;
  #currentEvent: Event | undefined;
  readonly #location: LocationImpl;
  readonly #timers = new Map<number, ReturnType<typeof setTimeout>>();
  #nextTimer = 1;

  constructor(url: URL) {
    super(windowEventTargetVirtuals);
    this.#location = new LocationImpl(url);
  }

  get document(): DomletDocument {
    if (!this.#document) {
      throw new Error('Window has no associated Document');
    }
    return this.#document;
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

  static setAssociatedDocument(
    window: WindowImpl,
    document: DomletDocument,
  ): void {
    if (window.#document && window.#document !== document) {
      DocumentImpl.setBrowsingContextWindow(window.#document, null);
    }
    window.#document = document;
    DocumentImpl.setBrowsingContextWindow(document, window);
  }

  static setCurrentEvent(window: WindowImpl, event: Event | undefined): void {
    window.#currentEvent = event;
  }
}

/*
 * Transitional direct-Window named-property shim. Remove this when Browlet
 * projects Window through Web IDL's global named-properties machinery.
 */
export function updateWindowNamedProperties(
  window: Window,
  document: DomletDocument,
): void {
  for (const element of document.getElementsByTagName('*')) {
    const name = element.getAttribute('id');
    if (!name || name in window) continue;

    Object.defineProperty(window, name, {
      configurable: true,
      get: () => window.document.getElementById(name) ?? undefined,
    });
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
