import type { URL } from 'node:url';

import type { InternalPromise } from '../../../infra/promises';
import { InternalError } from '../../../infra/internal-error';
import {
  arg, defineIncludes, defineInterface, definePartialInterface, idlType, op,
  impl, roAttr, reference, union, xattr, type VoidFunction,
} from '../../../web-idl/index';
import type { CSSStyleDeclarationImpl } from '../../../stylelet/index';
import type { FetchRequestInfo, FetchRequestInit, ResponseImpl } from '../../../fetch/index';

import type { SpeculationRulesParseResult, TimerAction } from '../../scripting/index';
import { type EventImpl, EventTargetImpl } from '../../dom/events/index';
import type { TrustedTypePolicyFactoryImpl } from '../policy/trusted-types/index';
import { type DocumentImpl, ElementImpl } from '../../dom/nodes/index';
import type { PerformanceImpl } from '../../performance/index';
import type { WindowEnvironment } from '../../environment';
import type { WindowOrWorkerGlobalScopeMixin, TimerHandler } from '../../global-scope';
import type { StructuredSerializeOptionsRecord } from '../../scripting/structured-data/index';

import { LocationImpl } from './location';
import type { WindowProxyHandle } from './window-proxy';

/** Owns a document global and forwards shared browser facilities to its global-scope mixin. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-window-object
export class WindowImpl extends EventTargetImpl {
  declare env: WindowEnvironment;
  /** Current associated document, attached by document construction. */
  #document: DocumentImpl | null = null;
  /** Event currently being invoked in this Window, restored after each listener. @deprecated */
  event: EventImpl | undefined = undefined;
  /** Stable Location object; Web IDL forwards author assignments to its href. */
  readonly location: LocationImpl;
  /** Shared global facilities installed during environment composition. */
  #globalScopeMixin: WindowOrWorkerGlobalScopeMixin | null = null;

  /** Create Window state before composition attaches its document and global facilities. */
  constructor(url: URL, env: WindowEnvironment) {
    super(env);
    this.location = new LocationImpl(url);
  }

  /** Recognize a Window implementation by its private brand. */
  // UNUSED
  static is(value: unknown): value is WindowImpl {
    return typeof value === 'object' && value !== null && #document in value;
  }

  /** Handle for this Window's browsing context, preserving proxy identity across navigation. */
  get window(): WindowProxyHandle {
    return this.getWindowProxy();
  }

  /** Alias of window; replacing the public self property does not change this handle. */
  get self(): WindowProxyHandle {
    return this.getWindowProxy();
  }

  /** Current document, available after document construction attaches it. */
  get document(): DocumentImpl {
    return this.getAssociatedDocument();
  }

  /** Whether this Window's environment is a secure context. */
  get isSecureContext(): boolean {
    return this.getWindowOrWorkerGlobalScopeMixin().isSecureContext;
  }

  /** Performance object sharing this Window's environment and time origin. */
  get performance(): PerformanceImpl {
    return this.getWindowOrWorkerGlobalScopeMixin().performance;
  }

  /** Policy factory owned by this Window's global-scope mixin. */
  get trustedTypes(): TrustedTypePolicyFactoryImpl {
    return this.getWindowOrWorkerGlobalScopeMixin().trustedTypes;
  }

  /** Retrieve an element's computed style through the associated document's style engine. */
  getComputedStyle(
    element: ElementImpl,
    pseudoElement?: string | null,
  ): CSSStyleDeclarationImpl {
    // PROVISIONAL: move this author operation onto Stylelet's Window
    // partial once CSSStyleDeclaration has a projected interface.
    if (pseudoElement !== null && pseudoElement !== undefined) {
      throw new InternalError('Pseudo-element computed style is not implemented');
    }

    return this.getAssociatedDocument().getCSSEngine().getComputedStyle(element);
  }

  /** Schedule a one-shot timer; Web IDL has already converted and defaulted the delay. */
  setTimeout(
    handler: TimerHandler,
    timeout: number,
    ...argumentsList: unknown[]
  ): number {
    return this.getWindowOrWorkerGlobalScopeMixin().setTimeout(
      this.#createTimerAction(handler),
      timeout,
      argumentsList,
    );
  }

  /** Cancel an active timeout or interval using its converted timer ID. */
  clearTimeout(id: number): void {
    this.getWindowOrWorkerGlobalScopeMixin().clearTimer(id);
  }

  /** Schedule a repeating timer; Web IDL has already converted and defaulted the delay. */
  setInterval(
    handler: TimerHandler,
    timeout: number,
    ...argumentsList: unknown[]
  ): number {
    return this.getWindowOrWorkerGlobalScopeMixin().setInterval(
      this.#createTimerAction(handler),
      timeout,
      argumentsList,
    );
  }

  /** Cancel an active interval or timeout using its converted timer ID. */
  clearInterval(id: number): void {
    this.getWindowOrWorkerGlobalScopeMixin().clearTimer(id);
  }

  /** Queue a converted callback on this Window's event loop. */
  queueMicrotask(callback: VoidFunction): void {
    this.getWindowOrWorkerGlobalScopeMixin().queueMicrotask(callback);
  }

  /** Fetch with this Window's environment and converted request arguments. */
  fetch(input: FetchRequestInfo, init: FetchRequestInit): InternalPromise<ResponseImpl> {
    return this.getWindowOrWorkerGlobalScopeMixin().fetch(input, init);
  }

  /** Clone a value using this Window's execution facilities and transfer options. */
  structuredClone<T>(
    value: T,
    options?: StructuredSerializeOptionsRecord,
  ): T {
    return this.getWindowOrWorkerGlobalScopeMixin()
      .structuredClone(value, options) as T;
  }

  /** Replace registered speculation rules and queue any new parse error for this Window. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#update-speculation-rules
  updateSpeculationRules(_oldResult: SpeculationRulesParseResult, _newResult: SpeculationRulesParseResult): void {
    // PROVISIONAL: document rule-set registration and queued parse-error reporting are not implemented.
  }

  /** Return the current associated document, throwing until it has been attached. */
  getAssociatedDocument(): DocumentImpl {
    if (!this.#document) {
      throw new InternalError('Window has no associated Document');
    }
    return this.#document;
  }

  /** Return the global-scope mixin installed during environment composition. */
  getWindowOrWorkerGlobalScopeMixin(): WindowOrWorkerGlobalScopeMixin {
    // Composition creates the environment before the Window, then attaches
    // the global-scope mixin before exposing the Window.
    if (this.#globalScopeMixin === null) {
      throw new InternalError('Window global-scope mixin is not initialized');
    }
    return this.#globalScopeMixin;
  }

  /** Attach this Window's global-scope mixin exactly once during composition. */
  setWindowOrWorkerGlobalScopeMixin(
    mixin: WindowOrWorkerGlobalScopeMixin,
  ): void {
    if (this.#globalScopeMixin !== null) {
      throw new InternalError('Window global-scope mixin is already initialized');
    }
    this.#globalScopeMixin = mixin;
  }

  /** Retrieve a supported named element, throwing if its ID is no longer present. */
  getNamedProperty(name: string): ElementImpl {
    const element = this.getAssociatedDocument().getElementById(name);
    if (!element) throw new InternalError(`Window named property ${name} disappeared`);
    return element;
  }

  /** Collect element IDs in document order for the provisional named-property binding. */
  getSupportedPropertyNames(): ReadonlySet<string> {
    const names = new Set<string>();
    for (const element of this.getAssociatedDocument()
      .getElementsByTagName('*')) {
      const name = element.getAttribute('id');
      if (name) names.add(name);
    }
    return names;
  }

  /** Return the stable proxy handle of the associated document's browsing context. */
  getWindowProxy(): WindowProxyHandle {
    const browsingContext = this.getAssociatedDocument().browsingContext;
    if (!browsingContext) {
      throw new InternalError('Window Document has no browsing context');
    }
    return browsingContext.windowProxy;
  }

  /** Attach the current document and update document-dependent global facilities. */
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

  /** Identify this event target as a Window for event-dispatch rules. */
  override isWindow(): boolean {
    return true;
  }

  /** Use the associated document for legacy event target overrides. */
  override getLegacyTargetOverride(): DocumentImpl {
    return this.getAssociatedDocument();
  }

  /** Apply the default-passive listener rule for Window targets. */
  protected override isDefaultPassiveTarget(): boolean {
    return true;
  }

  // -- Private ----------------------------------------------------------

  /** Bind a converted callback to this Window's proxy for later timer delivery. */
  #createTimerAction(handler: TimerHandler): TimerAction {
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
