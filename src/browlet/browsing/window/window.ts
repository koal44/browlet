import type { URL } from 'node:url';
import type { DocumentImpl } from '../../dom/nodes/document';
import { ElementImpl } from '../../dom/nodes/element';
import type { EventImpl } from '../../dom/events/event';
import { EventTargetImpl } from '../../dom/events/event-target';
import {
  arg, defineIncludes, defineInterface, definePartialInterface, idlType, op,
  impl, roAttr, reference, union, xattr, type VoidFunction,
} from '../../../web-idl/index';
import { LocationImpl } from './location';
import type { WindowProxy, WindowProxyHandle } from './window-proxy';
import type { PerformanceImpl } from '../../performance/performance';
import type { WindowOrWorkerGlobalScopeMixin, TimerHandler } from '../../scripting/global-scope';
import type { StructuredSerializeOptionsRecord } from '../../scripting/structured-data/web-idl';
import type { BrowletEnvironment } from '../../scripting/environment';
import type { FetchRequestInfo, FetchRequestInit, ResponseImpl } from '../../../fetch/index';
import type { InternalPromise } from '../../../infra/promises';
import type { CSSStyleDeclarationImpl } from '../../../stylelet/index';
import { InternalError } from '../../../infra/internal-error';

/** Owns a document global and forwards shared browser facilities to its global-scope mixin. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-window-object
export class WindowImpl extends EventTargetImpl {
  /** Current associated document, attached by document construction. */
  #document: DocumentImpl | null = null;
  /** Event currently being invoked in this Window, restored after each listener. @deprecated */
  event: EventImpl | undefined = undefined;
  #location: LocationImpl;
  /** Shared global facilities installed during environment composition. */
  #globalScopeMixin: WindowOrWorkerGlobalScopeMixin | null = null;

  /** Provisional CSSOM entry point until Stylelet's Window partial is bound. */
  getComputedStyle = (
    element: ElementImpl,
    pseudoElement?: string | null,
  ): CSSStyleDeclarationImpl => {
    // PROVISIONAL: move this author operation onto Stylelet's Window
    // partial once CSSStyleDeclaration has a projected interface.
    if (pseudoElement !== null && pseudoElement !== undefined) {
      throw new InternalError('Pseudo-element computed style is not implemented');
    }

    return this.getAssociatedDocument().getCSSEngine().getComputedStyle(element);
  };

  constructor(url: URL, env: BrowletEnvironment) {
    super(env);
    this.#location = new LocationImpl(url);
  }

  static is(value: unknown): value is WindowImpl {
    return typeof value === 'object' && value !== null && #document in value;
  }

  get window(): WindowProxy {
    return this.getWindowProxy().platform;
  }

  get self(): WindowProxy {
    return this.getWindowProxy().platform;
  }

  get document(): DocumentImpl {
    return this.getAssociatedDocument();
  }

  get location(): LocationImpl {
    return this.#location;
  }

  set location(_href: string) {
    throw new InternalError('Browlet navigation is not implemented');
  }

  get isSecureContext(): boolean {
    return this.getWindowOrWorkerGlobalScopeMixin().isSecureContext;
  }

  get performance(): PerformanceImpl {
    return this.getWindowOrWorkerGlobalScopeMixin().performance;
  }

  setTimeout(
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ): number {
    return this.getWindowOrWorkerGlobalScopeMixin().setTimeout(
      this.#createTimerAction(handler),
      timeout ?? 0,
      args,
    );
  }

  clearTimeout(id?: number): void {
    this.getWindowOrWorkerGlobalScopeMixin().clearTimer(id ?? 0);
  }

  setInterval(
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ): number {
    return this.getWindowOrWorkerGlobalScopeMixin().setInterval(
      this.#createTimerAction(handler),
      timeout ?? 0,
      args,
    );
  }

  clearInterval(id?: number): void {
    this.getWindowOrWorkerGlobalScopeMixin().clearTimer(id ?? 0);
  }

  queueMicrotask(callback: VoidFunction): void {
    this.getWindowOrWorkerGlobalScopeMixin().queueMicrotask(callback);
  }

  fetch(input: FetchRequestInfo, init: FetchRequestInit): InternalPromise<ResponseImpl> {
    return this.getWindowOrWorkerGlobalScopeMixin().fetch(input, init);
  }

  structuredClone<T>(
    value: T,
    options?: StructuredSerializeOptionsRecord,
  ): T {
    return this.getWindowOrWorkerGlobalScopeMixin()
      .structuredClone(value, options) as T;
  }

  // -- Internal methods -------------------------------------------------

  getAssociatedDocument(): DocumentImpl {
    if (!this.#document) {
      throw new InternalError('Window has no associated Document');
    }
    return this.#document;
  }

  getWindowOrWorkerGlobalScopeMixin(): WindowOrWorkerGlobalScopeMixin {
    // Composition creates the environment before the Window, then attaches
    // the global-scope mixin before exposing the Window.
    if (this.#globalScopeMixin === null) {
      throw new InternalError('Window global-scope mixin is not initialized');
    }
    return this.#globalScopeMixin;
  }

  setWindowOrWorkerGlobalScopeMixin(
    mixin: WindowOrWorkerGlobalScopeMixin,
  ): void {
    if (this.#globalScopeMixin !== null) {
      throw new InternalError('Window global-scope mixin is already initialized');
    }
    this.#globalScopeMixin = mixin;
  }

  getNamedProperty(name: string): ElementImpl {
    const element = this.getAssociatedDocument().getElementById(name);
    if (!element) throw new InternalError(`Window named property ${name} disappeared`);
    return element;
  }

  getSupportedPropertyNames(): ReadonlySet<string> {
    const names = new Set<string>();
    for (const element of this.getAssociatedDocument()
      .getElementsByTagName('*')) {
      const name = element.getAttribute('id');
      if (name) names.add(name);
    }
    return names;
  }

  getWindowProxy(): WindowProxyHandle {
    const browsingContext = this.getAssociatedDocument().browsingContext;
    if (!browsingContext) {
      throw new InternalError('Window Document has no browsing context');
    }
    return browsingContext.windowProxy;
  }

  setAssociatedDocument(document: DocumentImpl): void {
    // The initial about:blank Document and its replacement can share this
    // Window. Each Document retains its relevant global when the Window's
    // associated Document advances.
    document.setRelevantGlobalObject(this);
    this.#document = document;
    if (this.#globalScopeMixin !== null) {
      this.#globalScopeMixin.setAssociatedDocument(document);
    }
  }

  override isWindow(): boolean {
    return true;
  }

  override getLegacyTargetOverride(): DocumentImpl {
    return this.getAssociatedDocument();
  }

  protected override isDefaultPassiveTarget(): boolean {
    return true;
  }

  // -- Private ----------------------------------------------------------

  #createTimerAction(handler: TimerHandler): (argumentsList: unknown[]) => void {
    if (typeof handler === 'string') {
      return () => {
        throw new InternalError(
          'String timer handlers await Trusted Types, CSP, and classic scripts',
        );
      };
    }

    const callbackThisValue = this.getWindowProxy().platform;
    return (argumentsList) => {
      Reflect.apply(handler, callbackThisValue, argumentsList);
    };
  }
}

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
 */
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
    roAttr('window', reference('WindowProxy'),
      xattr('LegacyUnforgeable'),
    ),
    roAttr('self', reference('WindowProxy'), xattr('Replaceable')),
    roAttr('document', reference('Document'),
      xattr('LegacyUnforgeable'),
    ),
    roAttr('location', reference('Location'),
      xattr(['PutForwards', 'href'], 'LegacyUnforgeable'),
    ),
    // Web IDL's unnamed getter has no implementation member name to bind
    // automatically, and Window supplies its dynamic supported-name set.
    op(undefined, idlType.object,
      [arg('name', idlType.DOMString)],
      {
        special: 'getter',
        getSupportedPropertyNames() {
          return (this as WindowImpl).getSupportedPropertyNames();
        },
        invoke(context, name) {
          return context.project(
            ElementImpl,
            (this as WindowImpl).getNamedProperty(name),
          );
        },
      },
    ),
  ],
});

/*
 * partial interface Window {
 *   [Replaceable] readonly attribute (Event or undefined) event; // legacy
 * };
 */
export const windowEventIDL = definePartialInterface({
  name: 'Window',
  exposed: 'Window',
  members: [
    roAttr('event', union(reference('Event'), idlType.undefined),
      xattr('Replaceable'),
    ),
  ],
});

/*
 * Window includes WindowOrWorkerGlobalScope;
 */
export const windowIncludesWindowOrWorkerGlobalScopeIDL = defineIncludes({
  interface: windowIDL.name,
  mixin: 'WindowOrWorkerGlobalScope',
});
