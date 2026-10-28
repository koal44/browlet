import type { URL } from 'node:url';

import { type InternalPromise, InternalError, TypeError } from '../../../infra/index';
import {
  arg, atArg, attr, defineIncludes, defineInterface, definePartialInterface, emptyDictionary, emptySequence, idlType,
  impl, invokeWith, nullable, op, roAttr, reference, sequence, union, xattr, type VoidFunction,
} from '../../../web-idl/core/index';
import { areSameOrigin, areSameOriginDomain, type Origin } from '../../../url/index';
import type { FetchRequestInfo, FetchRequestInit, ResponseImpl } from '../../../fetch/index';
import type { CSSStylePropertiesImpl } from '../../../stylelet/index';

import { ElementTag } from '../../dom/nodes/element-definitions/index';
import {
  ImportMap, mergeExistingAndNewImportMaps, domManipulationTaskSource, type ImportMapParseResult,
  type BrowletGlobalObject, type SpecifierResolutionRecord, type SpeculationRulesParseResult, type TimerAction,
} from '../../scripting/index';
import { type EventImpl, EventTargetImpl } from '../../dom/events/index';
import type { TrustedTypePolicyFactoryImpl } from '../policy/trusted-types/index';
import { HTMLCollectionImpl, type DocumentImpl, type ElementImpl } from '../../dom/nodes/index';
import { HTMLIFrameElementImpl, HTMLObjectElementImpl } from '../../dom/nodes/html/embedded/index';
import { HTMLFrameElementImpl } from '../../dom/nodes/html/legacy/index';
import type { PerformanceImpl } from '../../performance/index';
import { windowPostMessage, type WindowPostMessageOptions } from '../../communication/index';
import type { BrowletEnvironment, WindowEnvironment } from '../../environment';
import type { WindowOrWorkerGlobalScopeMixin, TimerHandler } from '../../global-scope';
import type { StructuredSerializeOptions } from '../../scripting/structured-data/index';
import type { BrowsingContext, Navigable } from '../navigation/index';

import { LocationImpl } from './location';
import { BarPropImpl } from './bar-prop';
import type { WindowProxyHandle } from './window-proxy';

/** Owns a document global and forwards shared browser facilities to its global-scope mixin. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-window-object
export class WindowImpl extends EventTargetImpl implements BrowletGlobalObject {
  declare env: WindowEnvironment;
  // HTML §8.1.3.3 — internal global state, retained when the associated Document changes.
  // TODO: Connect engine rejection notifications, checkpoint delivery, and import-map processing.
  inErrorReportingMode = false;
  outstandingRejectedPromises = new WeakSet<Promise<unknown>>();
  aboutToBeNotifiedRejectedPromises: Promise<unknown>[] = [];
  importMap = new ImportMap();
  resolvedModuleSet = new Set<SpecifierResolutionRecord>();
  /** Event currently being invoked in this Window, restored after each listener. @deprecated */
  event: EventImpl | undefined = undefined;
  /** Stable Location object; Web IDL forwards author assignments to its href. */
  readonly location: LocationImpl;
  /** Location-bar object retained even if its public attribute is replaced. */
  readonly locationbar: BarPropImpl;
  /** Menu-bar object retained for this Window's lifetime. */
  readonly menubar: BarPropImpl;
  /** Personal-bar object retained for this Window's lifetime. */
  readonly personalbar: BarPropImpl;
  /** Scrollbar object retained for this Window's lifetime. */
  readonly scrollbars: BarPropImpl;
  /** Status-bar object retained for this Window's lifetime. */
  readonly statusbar: BarPropImpl;
  /** Toolbar object retained for this Window's lifetime. */
  readonly toolbar: BarPropImpl;
  /** Last assigned status string, with no effect on browser UI. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-window-status
  status = '';
  /** Current associated document, attached by document construction. */
  #document: DocumentImpl | null = null;
  /** Live named collections retained for the current associated Document. */
  #namedCollections = new Map<string, HTMLCollectionImpl>();
  /** Shared global facilities installed during environment composition. */
  #globalScopeMixin: WindowOrWorkerGlobalScopeMixin | null = null;

  /** Create Window state before composition attaches its document and global facilities. */
  constructor(url: URL, env: WindowEnvironment) {
    super(env);
    this.location = new LocationImpl(url);
    this.locationbar = new BarPropImpl(env);
    this.menubar = new BarPropImpl(env);
    this.personalbar = new BarPropImpl(env);
    this.scrollbars = new BarPropImpl(env);
    this.statusbar = new BarPropImpl(env);
    this.toolbar = new BarPropImpl(env);
  }

  /** Recognize a Window implementation by its private brand. */
  static is(value: unknown): value is WindowImpl {
    return typeof value === 'object' && value !== null && #document in value;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#window-bc
  get browsingContext(): BrowsingContext | null {
    return this.getAssociatedDocument().browsingContext;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#window-navigable
  get navigable(): Navigable | null {
    return this.getAssociatedDocument().getNodeNavigable();
  }

  /** Handle for this Window's realm global-this value, preserving proxy identity across navigation. */
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

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-name
  get name(): string {
    return this.navigable?.targetName ?? '';
  }

  set name(value: string) {
    const navigable = this.navigable;
    if (navigable !== null) navigable.activeSessionHistoryEntry.documentState.navigableTargetName = value;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-window-closed
  get closed(): boolean {
    const navigable = this.navigable;
    return navigable === null || navigable.isClosing;
  }

  /** Replaceable alias of the realm global-this value. */
  get frames(): WindowProxyHandle {
    return this.getWindowProxy();
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-length
  get length(): number {
    return this.getAssociatedDocument().getDocumentTreeChildNavigables().length;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-top
  get top(): WindowProxyHandle | null {
    return this.navigable?.topLevelTraversable.activeWindowProxy ?? null;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-opener
  get opener(): WindowProxyHandle | null {
    return this.browsingContext?.openerBrowsingContext?.windowProxy ?? null;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-parent
  get parent(): WindowProxyHandle | null {
    const navigable = this.navigable;
    if (navigable === null) return null;
    return (navigable.parent ?? navigable).activeWindowProxy;
  }

  /** Whether this Window's environment is a secure context. */
  get isSecureContext(): boolean {
    return this.getWindowOrWorkerGlobalScopeMixin().isSecureContext;
  }

  get crossOriginIsolated(): boolean {
    return this.getWindowOrWorkerGlobalScopeMixin().crossOriginIsolated;
  }

  /** Whether this Window's agent cluster is keyed by origin. */
  // https://html.spec.whatwg.org/multipage/browsers.html#dom-originAgentCluster
  get originAgentCluster(): boolean {
    const cluster = this.env.realm.agent.agentCluster;
    if (cluster === null) throw new InternalError('Window origin keying requires an agent cluster');
    return cluster.isOriginKeyed;
  }

  /** Performance object sharing this Window's environment and time origin. */
  get performance(): PerformanceImpl {
    return this.getWindowOrWorkerGlobalScopeMixin().performance;
  }

  /** Policy factory owned by this Window's global-scope mixin. */
  get trustedTypes(): TrustedTypePolicyFactoryImpl {
    return this.getWindowOrWorkerGlobalScopeMixin().trustedTypes;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-window-close
  close(): void {
    const traversable = this.navigable;
    if (traversable === null || !traversable.isTopLevelTraversable || traversable.isClosing) return;
    // TODO: Snapshot source params, then require script-closability, incumbent
    // browsing-context familiarity, and sandbox navigation permission before
    // setting isClosing and queueing definite closing on the DOM manipulation source.
    throw new InternalError('Window closing authorization and lifecycle are not implemented');
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-window-stop
  stop(): void {
    this.navigable?.stopLoading();
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-opener
  disownOpener(): void {
    const context = this.browsingContext;
    if (context !== null) context.openerBrowsingContext = null;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-frameElement
  getFrameElement(currentEnv: BrowletEnvironment): ElementImpl | null {
    const container = this.navigable?.container ?? null;
    if (container === null || !areSameOriginDomain(container.nodeDocument.origin, currentEnv.origin)) return null;
    return container;
  }

  // https://html.spec.whatwg.org/multipage/webappapis.html#windoworworkerglobalscope
  extractOrigin(entryEnv: BrowletEnvironment): Origin | null {
    return this.getWindowOrWorkerGlobalScopeMixin().extractOrigin(entryEnv);
  }

  /** Retrieve an element's computed style through the associated document's style engine. */
  getComputedStyle(
    element: ElementImpl,
    pseudoElement?: string | null,
  ): CSSStylePropertiesImpl {
    // TODO: §7.2 target-document selection, pseudo-elements, and live resolved values.
    if (pseudoElement !== null && pseudoElement !== undefined) {
      throw new InternalError('Pseudo-element computed style is not implemented');
    }

    return this.getAssociatedDocument().getStyleEngine().getComputedStyle(element);
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

  /** Report a value as an uncaught exception at this Window. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#dom-reporterror
  reportError(exception: unknown): void {
    // SPEC_CLASH(report-error-muting): Follow HTML's algorithm and Chrome/Safari
    // by applying classic-script muting; HTML notes Firefox does not mute here.
    this.env.reportException(exception);
  }

  /** Fetch with this Window's environment and converted request arguments. */
  fetch(input: FetchRequestInfo, init: FetchRequestInit): InternalPromise<ResponseImpl> {
    return this.getWindowOrWorkerGlobalScopeMixin().fetch(input, init);
  }

  /** Clone a value using this Window's execution facilities and transfer options. */
  structuredClone<T>(
    value: T,
    options?: StructuredSerializeOptions,
  ): T {
    return this.getWindowOrWorkerGlobalScopeMixin()
      .structuredClone(value, options) as T;
  }

  /** Send through either converted postMessage overload, retaining the invoking environment. */
  postMessage(
    message: unknown,
    targetOriginOrOptions: string | WindowPostMessageOptions,
    transfer: object[] = [],
    env: BrowletEnvironment,
  ): void {
    const options = typeof targetOriginOrOptions === 'string'
      ? { targetOrigin: targetOriginOrOptions, transfer } : targetOriginOrOptions;
    windowPostMessage(this, message, options, env);
  }

  /** Register a parsed import map, reporting any retained parse error at this Window. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#register-an-import-map
  registerImportMap(result: ImportMapParseResult): void {
    if (result.errorToRethrow !== null) {
      this.env.reportException(result.errorToRethrow);
      return;
    }
    // Successful creation supplies a map; failed creation supplies an error above.
    this.mergeImportMap(result.importMap!);
  }

  /** Update this global's import map without changing completed resolutions. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#merge-existing-and-new-import-maps
  mergeImportMap(newImportMap: ImportMap): void {
    mergeExistingAndNewImportMaps(this, newImportMap);
  }

  /** Register a rule set, reporting parse errors now or as DOM manipulation tasks. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#register-speculation-rules
  registerSpeculationRules(result: SpeculationRulesParseResult, queueErrors = false): void {
    if (result.errorToRethrow !== null) {
      if (queueErrors) {
        this.env.realm.queueGlobalTask(domManipulationTaskSource, () => {
          this.env.reportException(result.errorToRethrow);
        });
      } else {
        this.env.reportException(result.errorToRethrow);
      }
      return;
    }
    const document = this.getAssociatedDocument();
    // Successful creation supplies a rule set; failed creation supplies an error above.
    document.speculationRuleSets.push(result.speculationRuleSet!);
    document.considerSpeculativeLoads();
  }

  /** Remove a successful result's rule set and reconsider this document's speculative loads. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#unregister-speculation-rules
  unregisterSpeculationRules(result: SpeculationRulesParseResult): void {
    if (result.errorToRethrow !== null) return;
    const document = this.getAssociatedDocument();
    document.speculationRuleSets = document.speculationRuleSets.filter((ruleSet) => ruleSet !== result.speculationRuleSet);
    document.considerSpeculativeLoads();
  }

  /** Replace registered speculation rules and queue any new parse error for this Window. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#update-speculation-rules
  updateSpeculationRules(oldResult: SpeculationRulesParseResult, newResult: SpeculationRulesParseResult): void {
    const document = this.getAssociatedDocument();
    document.speculationRuleSets = document.speculationRuleSets.filter((ruleSet) => ruleSet !== oldResult.speculationRuleSet);
    this.registerSpeculationRules(newResult, true);
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

  /** Resolve a supported name to a child WindowProxy, one element, or a stable live collection. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-window-nameditem
  getNamedProperty(name: string): WindowProxyHandle | ElementImpl | HTMLCollectionImpl {
    const document = this.getAssociatedDocument();
    for (const child of document.getDocumentTreeChildNavigables()) {
      if (child.targetName === name) return child.activeWindowProxy;
    }

    let elements = this.#namedCollections.get(name);
    if (elements === undefined) {
      elements = HTMLCollectionImpl.fromRoot(document, (element) =>
        this.#getNamedElementName(element) === name || element.getAttributeNS(null, 'id') === name);
      this.#namedCollections.set(name, elements);
    }
    return elements.length === 1 ? elements.item(0)! : elements;
  }

  /** Collect child target names, eligible name attributes, and IDs in contributing-element tree order. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#named-access-on-the-window-object
  getSupportedPropertyNames(): ReadonlySet<string> {
    const document = this.getAssociatedDocument();
    const childNames = this.#getChildNavigableTargetNames();
    const names = new Set<string>();
    for (let node = document.firstChild; node !== null; node = node.nextDescendant(document)) {
      if (!node.isElement()) continue;
      if (
        (node instanceof HTMLIFrameElementImpl || node instanceof HTMLObjectElementImpl ||
          node instanceof HTMLFrameElementImpl) && node.contentNavigable !== null
      ) {
        const targetName = node.contentNavigable.targetName;
        if (childNames.has(targetName)) names.add(targetName);
      }
      const name = this.#getNamedElementName(node);
      if (name) names.add(name);
      const id = node.getAttributeNS(null, 'id');
      if (id) names.add(id);
    }
    return names;
  }

  /** Return this realm's stable proxy handle, even after its Document loses its browsing context. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-window
  getWindowProxy(): WindowProxyHandle {
    return this.env.realm.windowProxy;
  }

  /** Attach the current document and update document-dependent global facilities. */
  setAssociatedDocument(document: DocumentImpl): void {
    if (this.#document !== document) this.#namedCollections.clear();
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

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#document-tree-child-navigable-target-name-property-set
  #getChildNavigableTargetNames(): ReadonlySet<string> {
    const seen = new Set<string>();
    const names = new Set<string>();
    for (const child of this.getAssociatedDocument().getDocumentTreeChildNavigables()) {
      const name = child.targetName;
      if (name === '' || seen.has(name)) continue;
      seen.add(name);
      const document = child.activeDocument;
      if (document === null) throw new InternalError('A named child navigable needs an active Document');
      // SPEC_CLASH(window-named-child-origin): follow HTML; Blink/Gecko also allow matching container names.
      if (areSameOrigin(document.origin, this.env.origin)) names.add(name);
    }
    return names;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-window-nameditem-filter
  #getNamedElementName(element: ElementImpl): string | null {
    switch (element.tag) {
      case ElementTag.HTMLEmbed:
      case ElementTag.HTMLForm:
      case ElementTag.HTMLImg:
      case ElementTag.HTMLObject:
        return element.getAttributeNS(null, 'name');
      default:
        return null;
    }
  }

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
export const windowIDL = defineInterface<BrowletEnvironment>({
  name: 'Window',
  inherits: 'EventTarget',
  exposed: 'Window',
  ...xattr(
    ['Global', 'Window'],
    'LegacyUnenumerableNamedProperties',
    'CrossOriginObject',
  ),
  implementation: impl(WindowImpl),
  members: [
    roAttr('window', reference('WindowProxy'),
      xattr('LegacyUnforgeable', 'CrossOrigin'),
    ),
    roAttr('self', reference('WindowProxy'), xattr('Replaceable', 'CrossOrigin')),
    roAttr('document', reference('Document'),
      xattr('LegacyUnforgeable'),
    ),
    attr('name', idlType.DOMString),
    roAttr('location', reference('Location'),
      xattr(['PutForwards', 'href'], 'LegacyUnforgeable', ['CrossOrigin', ['Getter', 'Setter']]),
    ),
    roAttr('locationbar', reference('BarProp'), xattr('Replaceable')),
    roAttr('menubar', reference('BarProp'), xattr('Replaceable')),
    roAttr('personalbar', reference('BarProp'), xattr('Replaceable')),
    roAttr('scrollbars', reference('BarProp'), xattr('Replaceable')),
    roAttr('statusbar', reference('BarProp'), xattr('Replaceable')),
    roAttr('toolbar', reference('BarProp'), xattr('Replaceable')),
    attr('status', idlType.DOMString),
    op('close', idlType.undefined, [], xattr('CrossOrigin')),
    roAttr('closed', idlType.boolean, xattr('CrossOrigin')),
    op('stop', idlType.undefined),
    roAttr('frames', reference('WindowProxy'), xattr('Replaceable', 'CrossOrigin')),
    roAttr('length', idlType.unsignedLong, xattr('Replaceable', 'CrossOrigin')),
    roAttr('top', nullable(reference('WindowProxy')), xattr('LegacyUnforgeable', 'CrossOrigin')),
    attr('opener', idlType.any, {
      ...xattr('CrossOrigin'),
      get() { return (this as WindowImpl).opener?.platform ?? null; },
      set(env, value) {
        if (value === null) (this as WindowImpl).disownOpener();
        else if (!Reflect.defineProperty(env.realm.globalObject, 'opener', {
          value, writable: true, enumerable: true, configurable: true,
        })) throw new TypeError('Cannot redefine property: opener');
      },
    }),
    roAttr('parent', nullable(reference('WindowProxy')), xattr('Replaceable', 'CrossOrigin')),
    roAttr('frameElement', nullable(reference('Element')), {
      get(_env, methodEnv) { return (this as WindowImpl).getFrameElement(methodEnv); },
    }),
    op('open', nullable(reference('WindowProxy')),
      [
        arg('url', idlType.USVString, { optional: true, default: '' }),
        arg('target', idlType.DOMString, { optional: true, default: '_blank' }),
        arg('features', idlType.DOMString,
          { optional: true, default: '', ...xattr('LegacyNullToEmptyString') },
        ),
      ],
      {
        invoke(env, url, target, features) {
          const eventLoop = env.responsibleEventLoop;
          // Direct host calls use the operation's environment, as Origin.from does.
          const entryEnv = eventLoop.executionContextStack.length === 0
            ? env : eventLoop.entryExecutionContext.realm.env;
          return entryEnv.openWindow(url, target, features);
        },
      },
    ),
    roAttr('originAgentCluster', idlType.boolean),
    op('postMessage', idlType.undefined,
      [
        arg('message', idlType.any), arg('targetOrigin', idlType.USVString),
        arg('transfer', sequence(idlType.object), { optional: true, default: emptySequence }),
      ],
      { ...invokeWith(atArg(3, (_env, methodEnv) => methodEnv)), ...xattr('CrossOrigin') },
    ),
    op('postMessage', idlType.undefined,
      [arg('message', idlType.any), arg('options', reference('WindowPostMessageOptions'), { optional: true, default: emptyDictionary })],
      { ...invokeWith(atArg(3, (_env, methodEnv) => methodEnv)), ...xattr('CrossOrigin') },
    ),
    {
      kind: 'named-getter', method: 'getNamedProperty',
      returns: union(reference('WindowProxy'), reference('Element'), reference('HTMLCollection')),
      serializedType: idlType.object,
    },
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
