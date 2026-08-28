import { DocumentImpl } from '../../dom/nodes/document';
import {
  EventTargetImpl, type EventTargetVirtuals,
} from '../../dom/events/event-target';
import { asDocument, withWindowStub } from '../../stubs';
import {
  arg, defineIncludes, defineInterface, definePartialInterface, idlType, op,
  impl, roAttr, reference, union, xattr,
} from '../../../web-idl/declaration/index';
import { bind } from '../../../web-idl/index';
import { LocationImpl } from './location';
import { WindowOrWorkerGlobalScopeMixin } from '../../scripting/global-scope';

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
  #globalScopeMixin: WindowOrWorkerGlobalScopeMixin | null = null;

  constructor(url: URL) {
    super(windowEventTargetVirtuals);
    this.#location = new LocationImpl(url);
  }

  get window(): Window & typeof globalThis {
    return WindowImpl.getWindowProxy(this) as Window & typeof globalThis;
  }

  get self(): Window & typeof globalThis {
    return WindowImpl.getWindowProxy(this) as Window & typeof globalThis;
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

  get performance(): Performance {
    return WindowImpl.getWindowOrWorkerGlobalScopeMixin(this).performance;
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

  setTimeout(
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ): number {
    return WindowImpl.getWindowOrWorkerGlobalScopeMixin(this).setTimeout(
      createTimerAction(this, handler),
      timeout ?? 0,
      args,
    );
  }

  clearTimeout(id?: number): void {
    WindowImpl.getWindowOrWorkerGlobalScopeMixin(this).clearTimer(id ?? 0);
  }

  setInterval(
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ): number {
    return WindowImpl.getWindowOrWorkerGlobalScopeMixin(this).setInterval(
      createTimerAction(this, handler),
      timeout ?? 0,
      args,
    );
  }

  clearInterval(id?: number): void {
    WindowImpl.getWindowOrWorkerGlobalScopeMixin(this).clearTimer(id ?? 0);
  }

  queueMicrotask(callback: VoidFunction): void {
    WindowImpl.getWindowOrWorkerGlobalScopeMixin(this)
      .queueMicrotask(callback);
  }

  structuredClone<T>(
    value: T,
    options?: StructuredSerializeOptions,
  ): T {
    return WindowImpl.getWindowOrWorkerGlobalScopeMixin(this)
      .structuredClone(value, options) as T;
  }

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

  static getWindowOrWorkerGlobalScopeMixin(
    window: WindowImpl,
  ): WindowOrWorkerGlobalScopeMixin {
    // HTML creates the Window with its realm, then immediately sets up its
    // environment settings object before projecting or exposing the Window.
    if (window.#globalScopeMixin === null) {
      throw new Error('Window global-scope mixin is not initialized');
    }
    return window.#globalScopeMixin;
  }

  static setWindowOrWorkerGlobalScopeMixin(
    window: WindowImpl,
    mixin: WindowOrWorkerGlobalScopeMixin,
  ): void {
    if (window.#globalScopeMixin !== null) {
      throw new Error('Window global-scope mixin is already initialized');
    }
    window.#globalScopeMixin = mixin;
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
    /*
     * The initial about:blank Document and its replacement can share this
     * Window. Each Document nevertheless retains the Window as its relevant
     * global object when the Window's associated Document advances.
     */
    DocumentImpl.setRelevantGlobalObject(document, window);
    window.#document = document;
    if (window.#globalScopeMixin !== null) {
      WindowOrWorkerGlobalScopeMixin.setAssociatedDocument(
        window.#globalScopeMixin,
        document,
      );
    }
  }

  static setCurrentEvent(window: WindowImpl, event: Event | undefined): void {
    window.#currentEvent = event;
  }
}

// -- Web IDL ------------------------------------------------------------

export const windowIDL = defineInterface({
  name: 'Window',
  inherits: 'EventTarget',
  exposed: 'Window',
  ...xattr(
    ['Global', 'Window'],
    'LegacyUnenumerableNamedProperties',
  ),
  implementation: impl(WindowImpl),
  members: [
    roAttr(
      'window',
      reference('WindowProxy'),
      xattr('LegacyUnforgeable'),
    ),
    roAttr('self', reference('WindowProxy'), xattr('Replaceable')),
    roAttr(
      'document',
      reference('Document'),
      xattr('LegacyUnforgeable'),
    ),
    roAttr(
      'location',
      reference('Location'),
      xattr(['PutForwards', 'href'], 'LegacyUnforgeable'),
    ),
    // Web IDL's unnamed getter has no implementation member name to bind
    // automatically, and Window supplies its dynamic supported-name set.
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
});

export const windowEventIDL = definePartialInterface({
  name: 'Window',
  exposed: 'Window',
  members: [roAttr('event', union(
    reference('Event'),
    idlType.undefined,
  ), xattr('Replaceable'))],
});

/*
 * Window includes WindowOrWorkerGlobalScope;
 */
export const windowIncludesWindowOrWorkerGlobalScopeIDL = defineIncludes({
  interface: windowIDL.name,
  mixin: 'WindowOrWorkerGlobalScope',
});

// -- Virtual ------------------------------------------------------------

const windowEventTargetVirtuals: EventTargetVirtuals = {
  isDefaultPassiveTarget: () => true,
  isWindow: () => true,
  getLegacyTargetOverride: (target) => WindowImpl.is(target)
    ? WindowImpl.getAssociatedDocument(target)
    : target,
};

function createTimerAction(
  window: WindowImpl,
  handler: TimerHandler,
): (argumentsList: readonly unknown[]) => void {
  if (typeof handler === 'string') {
    return () => {
      throw new Error(
        'String timer handlers await Trusted Types, CSP, and classic scripts',
      );
    };
  }

  const callbackThisValue = WindowImpl.getWindowProxy(window);
  return (argumentsList) => {
    Reflect.apply(handler, callbackThisValue, argumentsList);
  };
}
