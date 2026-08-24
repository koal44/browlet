import { DocumentImpl } from '../../dom/nodes/document';
import {
  EventTargetImpl, type EventTargetVirtuals,
} from '../../dom/events/event-target';
import { asDocument, withWindowStub } from '../../stubs';
import {
  arg, defineInterface, definePartialInterface, idlType, op, readonlyAttr,
  reference, union, xattr,
} from '../../../web-idl/declaration/index';
import { bind } from '../../../web-idl/index';
import { LocationImpl } from './location';

/*
 * [Global=Window,
 *  Exposed=Window,
 *  LegacyUnenumerableNamedProperties]
 * interface Window : EventTarget {
 *   // the current browsing context
 *   [LegacyUnforgeable] readonly attribute WindowProxy window;
 *   [Replaceable] readonly attribute WindowProxy self;
 *   [LegacyUnforgeable] readonly attribute Document document;
 *   attribute DOMString name;
 *   [PutForwards=href, LegacyUnforgeable] readonly attribute Location location;
 *   readonly attribute History history;
 *   [Replaceable] Navigation navigation;
 *   readonly attribute CustomElementRegistry customElements;
 *   [Replaceable] readonly attribute BarProp locationbar;
 *   [Replaceable] readonly attribute BarProp menubar;
 *   [Replaceable] readonly attribute BarProp personalbar;
 *   [Replaceable] readonly attribute BarProp scrollbars;
 *   [Replaceable] readonly attribute BarProp statusbar;
 *   [Replaceable] readonly attribute BarProp toolbar;
 *   attribute DOMString status;
 *   undefined close();
 *   readonly attribute boolean closed;
 *   undefined stop();
 *   undefined focus();
 *   undefined blur();
 *
 *   // other browsing contexts
 *   [Replaceable] readonly attribute WindowProxy frames;
 *   [Replaceable] readonly attribute unsigned long length;
 *   [LegacyUnforgeable] readonly attribute WindowProxy? top;
 *   attribute any opener;
 *   [Replaceable] readonly attribute WindowProxy? parent;
 *   readonly attribute Element? frameElement;
 *   WindowProxy? open(optional USVString url = "", optional DOMString target = "_blank", optional [LegacyNullToEmptyString] DOMString features = "");
 *
 *   getter object (DOMString name);
 *
 *   // the user agent
 *   readonly attribute Navigator navigator;
 *   [Replaceable] readonly attribute Navigator clientInformation;
 *   readonly attribute boolean originAgentCluster;
 *
 *   // user prompts
 *   undefined alert();
 *   undefined alert(DOMString message);
 *   boolean confirm(optional DOMString message = "");
 *   DOMString? prompt(optional DOMString message = "", optional DOMString default = "");
 *   undefined print();
 *
 *   undefined postMessage(any message, USVString targetOrigin, optional sequence<object> transfer = []);
 *   undefined postMessage(any message, optional WindowPostMessageOptions options = {});
 * };
 * Window includes GlobalEventHandlers;
 * Window includes WindowEventHandlers;
 *
 * dictionary WindowPostMessageOptions : StructuredSerializeOptions {
 *   USVString targetOrigin = "/";
 * };
 *
 * partial interface Window {
 *   [Replaceable] readonly attribute (Event or undefined) event; // legacy
 * };
 */
export class WindowImpl
  extends withWindowStub(EventTargetImpl)
  implements Window
{
  #document: DocumentImpl | null = null;
  #currentEvent: Event | undefined;
  readonly #location: LocationImpl;
  readonly #timers = new Map<number, ReturnType<typeof setTimeout>>();
  #nextTimer = 1;

  constructor(url: URL) {
    super(windowEventTargetVirtuals);
    this.#location = new LocationImpl(url);
  }

  get document(): Document {
    return asDocument(WindowImpl.getAssociatedDocument(this));
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

  readonly getComputedStyle = (
    element: Element,
    pseudoElement?: string | null,
  ): CSSStyleDeclaration => {
    if (pseudoElement !== null && pseudoElement !== undefined) {
      throw new Error('Pseudo-element computed style is not implemented');
    }

    return DocumentImpl.getCSSEngine(
      WindowImpl.getAssociatedDocument(this),
    ).getComputedStyle(element);
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

  static is(value: unknown): value is WindowImpl {
    return typeof value === 'object' && value !== null && #document in value;
  }

  static getAssociatedDocument(window: WindowImpl): DocumentImpl {
    if (!window.#document) {
      throw new Error('Window has no associated Document');
    }
    return window.#document;
  }

  static getCurrentEvent(window: WindowImpl): Event | undefined {
    return window.#currentEvent;
  }

  static getLocationImplementation(window: WindowImpl): LocationImpl {
    return window.#location;
  }

  static getNamedProperty(
    window: WindowImpl,
    name: string,
  ): Element {
    const element = WindowImpl.getAssociatedDocument(window)
      .getElementById(name);
    if (!element) throw new Error(`Window named property ${name} disappeared`);
    return element;
  }

  static getSupportedPropertyNames(
    window: WindowImpl,
  ): ReadonlySet<string> {
    const names = new Set<string>();
    for (const element of WindowImpl.getAssociatedDocument(window)
      .getElementsByTagName('*')) {
      const name = element.getAttribute('id');
      if (name) names.add(name);
    }
    return names;
  }

  static getWindowProxy(window: WindowImpl): Window {
    const browsingContext = DocumentImpl.getBrowsingContext(
      WindowImpl.getAssociatedDocument(window),
    );
    if (!browsingContext) {
      throw new Error('Window Document has no browsing context');
    }
    return browsingContext.windowProxy;
  }

  static setAssociatedDocument(
    window: WindowImpl,
    document: DocumentImpl,
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

// -- Web IDL ------------------------------------------------------------

export const windowIDL = defineInterface({
  binding: bind(WindowImpl, {
    initialize(context, value) {
      context.objects.project(
        LocationImpl,
        WindowImpl.getLocationImplementation(value as WindowImpl),
      );
    },
  }),
  exposed: 'Window',
  ...xattr(
    ['Global', 'Window'],
    'LegacyUnenumerableNamedProperties',
  ),
  inherits: 'EventTarget',
  members: [
    readonlyAttr('window', reference('WindowProxy'), bind({
      get() { return WindowImpl.getWindowProxy(this as WindowImpl); },
    }, xattr('LegacyUnforgeable'))),
    readonlyAttr('self', reference('WindowProxy'), bind({
      get() { return WindowImpl.getWindowProxy(this as WindowImpl); },
    }, xattr('Replaceable'))),
    readonlyAttr(
      'document',
      reference('Document'),
      xattr('LegacyUnforgeable'),
    ),
    readonlyAttr(
      'location',
      reference('Location'),
      xattr(['PutForwards', 'href'], 'LegacyUnforgeable'),
    ),
    op(undefined, idlType.object, [arg('name', idlType.DOMString)], bind({
      getSupportedPropertyNames() {
        return WindowImpl.getSupportedPropertyNames(this as WindowImpl);
      },
      invoke(_context, name) {
        return WindowImpl.getNamedProperty(this as WindowImpl, name as string);
      },
    }, {
      special: 'getter',
    })),
  ],
  name: 'Window',
});

export const windowEventIDL = definePartialInterface({
  exposed: 'Window',
  members: [readonlyAttr('event', union(
    reference('Event'),
    idlType.undefined,
  ), xattr('Replaceable'))],
  name: 'Window',
});

// -- Virtual ------------------------------------------------------------
const windowEventTargetVirtuals: EventTargetVirtuals = {
  isDefaultPassiveTarget: () => true,
  isWindow: () => true,
  getLegacyTargetOverride: (target) => WindowImpl.is(target)
    ? WindowImpl.getAssociatedDocument(target)
    : target,
};
