import {
  type InternalPromise, type InternalPromiseWithResolvers, asciiLower, HTML_NAMESPACE, SVG_NAMESPACE,
  stripAndCollapseASCIIWhitespace, InternalError,
} from '../../../infra/index';
import { addon, isomorphicDecode, isomorphicEncode } from '../../../js-engine/index';
import {
  arg, atArg, attr, ctor, defineDictionary, defineEnumeration, defineIncludes, defineInterface, definePartialInterface,
  defineTypedef, dictMember, emptyDictionary, idlType, impl, integer, nullable, onError, op, roAttr, reference, union,
  DOMExceptionNames, DOMExceptionImpl, xattr,
} from '../../../web-idl/core/index';
import { createSelectlet, type Selectlet } from '../../../selectlet/index';
import { decode, getEncoding, utf8DecodeWithoutBOM, utf8Encode, type Encoding } from '../../../encoding/index';
import {
  aboutBlankURL, areSameOrigin, areSameSite, copyURL, createOpaqueOrigin, effectiveDomain,
  isRegistrableDomainSuffixOfOrEqualTo, parseHost, serializeHost, serializeOrigin, serializeURL,
  type Origin, type URLRecord,
} from '../../../url/index';
import { HTTPCookie, parseHTTPDate, parseLinkHeader, type CookieHost } from '../../../http/index';
import { getMIMETypeEssence } from '../../../mime/index';
import {
  fetch, FetchRequest, isFilteredResponse, isOkStatus, parseReferrerPolicyFromHeader,
  type FetchController, type FetchResponse, type ReferrerPolicy,
} from '../../../fetch/index';
import {
  Stylelet, LengthLiteral, CSSStyleSheetImpl, getStylesheetEncoding, parseStylesheetContents, RuleListContext,
  TreeScope, StyleletContext, type StyleSheetListImpl, type StyleSheetLoad,
} from '../../../stylelet/index';

import { currentCoarsenedWallTime, type DOMHighResTimeStamp } from '../../timing/index';
import { isValidAttributeLocalName, isValidElementLocalName, validateAndExtract } from '../infra/index';
import { ElementTag } from './element-definitions/index';
import { DOMStringListImpl } from '../string-list';
import {
  EventHandlerMap, ModuleMap, SpeculationRulesParseResult, type EventHandlerCallback, type SpeculationRuleSet,
} from '../../scripting/index';
import { EventImpl, CustomEventImpl, type EventTargetImpl } from '../events/index';
import {
  InsecureRequestsPolicy, PolicyContainer, OpenerPolicy, PermissionsPolicy, SandboxingFlagSet,
  type SandboxingFlag,
} from '../../browsing/policy/index';
import { CSPList } from '../../browsing/policy/csp/index';
import { RangeImpl } from '../ranges/index';
import { NodeIteratorImpl, TreeWalkerImpl, SHOW_ALL, type NodeFilterCallback } from '../traversal/index';
// The observer retains registrations; rendering input and scheduled notification remain provisional.
import { IntersectionObserverImpl, type IntersectionObserverEntryImpl } from '../intersection-observer/index';
import type { NavigationTimingRecord } from '../../performance/index';
import type { WindowImpl, WindowProxyHandle } from '../../browsing/window/index';
// eslint-disable-next-line browlet/dependency-direction -- DOM's legacy event factory includes HTML-defined event interfaces.
import { MessageEventImpl } from '../../communication/index';
import type { BrowletEnvironment } from '../../environment';
import type { DocumentParser } from '../../html/parser/index';
import type { SerializedRecord } from '../../scripting/structured-data/index';
import type {
  BrowsingContext, Navigable, NotRestoredReasonDetails, NavigationParams, HistoryHandlingBehavior,
} from '../../browsing/navigation/index';
import type { FocusableArea } from '../../interaction/index';

import { HTMLCollectionImpl, NodeListImpl } from './collections';
import { HTMLAllCollectionImpl } from './html-all-collection';
import { AttrImpl } from './attribute';
import { CDATASectionImpl } from './cdata-section';
import { CommentImpl } from './comment';
import { DOMImplementationImpl } from './dom-implementation';
import { ProcessingInstructionImpl } from './processing-instruction';
import { DocumentFragmentImpl } from './document-fragment';
import { DocumentTypeImpl } from './document-type';
import { ShadowRootImpl, type ShadowRootMode } from './shadow-root';
import type { ElementImpl } from './element';
import { NodeImpl, NodeType } from './node';
import {
  DocumentOrShadowRootMixin, documentOrShadowRootIDL,
} from './document-or-shadow-root';
import { ParentNodeMixin, parentNodeIDL } from './parent-node';
import { nonElementParentNodeIDL } from './non-element-parent-node';
import { TextImpl } from './text';
import {
  findElement, findElementById, findElementsByClassName, findElementsByTagName,
  findElementsByTagNameNS,
} from './lookups';
import { getElementConstructor } from './element-interfaces';
import { HTMLBaseElementImpl, HTMLHeadElementImpl, HTMLTitleElementImpl } from './html/metadata/index';
import { HTMLElementImpl, HTMLScriptElementImpl } from './html/index';
import { HTMLHtmlElementImpl } from './html/document/index';
import { HTMLBodyElementImpl } from './html/sections/index';
import { HTMLFrameElementImpl, HTMLFrameSetElementImpl } from './html/legacy/index';
import {
  HTMLEmbedElementImpl, HTMLIFrameElementImpl, HTMLImageElementImpl, HTMLObjectElementImpl,
  HTMLVideoElementImpl, type HTMLMediaElementImpl,
} from './html/embedded/index';
import { HTMLFormElementImpl } from './html/forms/index';
import { SVGSVGElementImpl, SVGTitleElementImpl, type SVGScriptElementImpl } from './svg/index';
import type { CustomElementRegistryImpl } from './html/custom-elements/index';
import type { HTMLDialogElementImpl } from './html/interactive/index';

/** Owns a document tree, node creation, and document loading state. */
// https://dom.spec.whatwg.org/#interface-document
export class DocumentImpl extends NodeImpl {
  /** Browser settings used by this document's loading, policy, and event operations. */
  declare env: BrowletEnvironment;
  /** The document's URL record, independent of its base URL. */
  // https://dom.spec.whatwg.org/#concept-document-url
  url = copyURL(aboutBlankURL);
  /** Origin used by the document's security and same-origin checks. */
  origin: Origin = createOpaqueOrigin();
  /** Whether DOM operations use HTML or XML rules. */
  type: DocumentType = 'xml';
  /** Compatibility mode selected by the parser. */
  mode = DocumentMode.NoQuirks;
  /** Invalidates live collections after any tree or attribute mutation in this document. */
  collectionVersion = 0;
  /** MIME type of the document's content. */
  contentType = 'application/xml';
  /** Encoding name exposed by characterSet and its legacy aliases. */
  encoding = 'UTF-8';
  /** Inherited fallback base for about:blank and iframe srcdoc documents. */
  aboutBaseURL: URLRecord | null = null;
  /** Cookie lookup URL captured at creation, including inherited scheme, host, and path. */
  // https://github.com/whatwg/html/issues/332
  // SPEC_CLASH(document-cookie-url-history): retain this URL across same-document URL changes, matching browsers.
  cookieURL = copyURL(this.url);
  /** Loading state exposed by readyState. */
  currentDocumentReadiness: DocumentReadyState = 'complete';
  /** Whether this document may be retained for restoration from session history. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#concept-document-salvageable
  salvageable = true;
  /** Reasons recorded when this document becomes ineligible for restoration. */
  bfcacheBlockingDetails = new Set<NotRestoredReasonDetails>();
  /** Open dialogs in the order maintained by dialog opening and closing steps. */
  // https://html.spec.whatwg.org/multipage/dom.html#open-dialogs-list
  // TODO(HTML §4.11.4): dialog lifecycle steps must maintain membership.
  openDialogs: HTMLDialogElementImpl[] = [];
  /** Whether load abortion has stopped this document's active parser. */
  activeParserWasAborted = false;
  /** Associated parser, retained through readiness timing and released when loading finishes. */
  parser: DocumentParser | null = null;
  /** Worker globals whose owner sets contain this document. */
  // PROVISIONAL: worker creation and ownership registration are not implemented.
  ownedWorkers: { ownerSet: Set<DocumentImpl>; }[] = [];
  /** Worklet globals whose lifetime is tied to this document. */
  // PROVISIONAL: worklet creation and registration are not implemented.
  workletGlobalScopes: { terminate(): void; }[] = [];
  /** Referrer recorded when the document was created, or the empty string. */
  referrer = '';
  /** Custom element registry associated with this document, if any. */
  customElementRegistry: CustomElementRegistryImpl | null = null;
  /** Module scripts known to this document. */
  moduleMap = new ModuleMap();
  /** Rule sets registered for this document's speculative loading. */
  // https://html.spec.whatwg.org/multipage/speculative-loading.html#document-sr-sets
  speculationRuleSets: SpeculationRuleSet[] = [];
  /** Policies inherited or supplied when the document was created. */
  policyContainer = new PolicyContainer();
  /** HTTP status of the resource that created this Document; zero when there was no response. */
  httpStatus = 0;
  /** Source modification time in Unix milliseconds, when supplied by the loader. */
  lastModificationTime?: number;
  /** Default selected by a successfully processed content-language meta pragma. */
  // https://html.spec.whatwg.org/multipage/semantics.html#pragma-set-default-language
  // TODO(HTML §4.2.5): meta pragma processing must populate this state.
  pragmaLanguage?: string;
  /** First protocol language, or the empty string when none was supplied. */
  // https://html.spec.whatwg.org/multipage/dom.html#language
  contentLanguage = '';
  /** Permissions policy controlling features in this document. */
  permissionsPolicy = new PermissionsPolicy();
  /** Cross-origin opener policy selected for this document. */
  openerPolicy = new OpenerPolicy();
  /** Sandbox restrictions currently applied to the document. */
  activeSandboxingFlagSet = new SandboxingFlagSet();
  /** Whether parsing may create declarative shadow roots. */
  allowDeclarativeShadowRoots = false;
  /** Ancestor origins retained for navigation, or null before selection. */
  internalAncestorOriginObjectsList: Origin[] | null = null;
  /** Serialized ancestor origins, or null before selection. */
  ancestorOriginsList: DOMStringListImpl | null = null;
  /** Whether this document was created from an iframe's srcdoc content. */
  // https://html.spec.whatwg.org/multipage/iframe-embed-object.html#an-iframe-srcdoc-document
  isIframeSrcdocDocument = false;
  /** Whether this is the initial about:blank document of a browsing context. */
  isInitialAboutBlank = false;
  /** Whether cross-origin redirects occurred while creating this document. */
  wasCreatedViaCrossOriginRedirects = false;
  /** Navigation identifier while loading, or null outside that phase. */
  duringLoadingNavigationID: string | null = null;
  /** Navigation and document-loading milestones. */
  loadTimingInfo: DocumentLoadTimingInfo = {
    navigationStartTime: 0,
    domInteractiveTime: 0,
    domContentLoadedEventStartTime: 0,
    domContentLoadedEventEndTime: 0,
    domCompleteTime: 0,
    loadEventStartTime: 0,
    loadEventEndTime: 0,
  };
  /** Unload timestamps inherited from the document replaced by this navigation. */
  // https://html.spec.whatwg.org/multipage/dom.html#previous-document-unload-timing
  // TODO(HTML navigation): capture and pass the departing document's unload timing.
  previousDocumentUnloadTiming: DocumentUnloadTimingInfo = {
    unloadEventStartTime: 0,
    unloadEventEndTime: 0,
  };
  /** Retained navigation inputs; public Performance entry creation is provisional. */
  navigationTimingEntry?: NavigationTimingRecord;
  /** Completion timestamp, or null until the document is completely loaded. */
  completelyLoadedTime: number | null = null;
  /** Whether tasks that depend on loading completion may proceed. */
  readyForPostLoadTasks = false;
  /** Elements whose pending work delays rendering, independently of script-blocking stylesheets. */
  // https://html.spec.whatwg.org/multipage/dom.html#render-blocking-element-set
  renderBlockingElements = new Set<ElementImpl>();
  /** Classic script currently executing in this document's tree, or null outside its execution. */
  // https://html.spec.whatwg.org/multipage/dom.html#dom-document-currentscript
  // TODO(HTML §4.12.1): script execution must set/restore this, including null for modules and shadow trees.
  currentScript: HTMLScriptElementImpl | SVGScriptElementImpl | null = null;

  /** Associated browsing context, or null for a detached document. */
  #browsingContext: BrowsingContext | null = null;
  /** First base element with an href attribute, whose frozen URL supplies the base. */
  #firstBaseElement: HTMLBaseElementImpl | null = null;
  /** First element child, maintained before tree mutation participants run. */
  #documentElement: ElementImpl | null = null;
  /** Selected HTML or SVG title whose child text supplies the document title. */
  #titleElement: HTMLTitleElementImpl | SVGTitleElementImpl | null = null;
  /** Normalized text of the selected title, refreshed by mutation hooks. */
  #title = '';
  /** One internal observer shared by this document's deferred images, frames, and media. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#lazy-load-intersection-observer
  #lazyLoadIntersectionObserver: IntersectionObserverImpl | null = null;
  /** Internal subscribers notified when navigation changes this document's activity. */
  #fullyActiveObservers = new Set<FullyActiveStateObserver>();
  /** Lazily created style engine for this document. */
  #stylelet?: Stylelet;
  /** Stylesheet collections and matching context, retained independently of the engine. */
  #styleScope?: TreeScope;
  /** Selector parsing and compilation caches shared by queries in this document. */
  #selectlet?: Selectlet<NodeImpl, ElementImpl, DocumentImpl, DocumentFragmentImpl>;
  /** Focus and style-sheet behavior shared with shadow roots. */
  #documentOrShadowRootMixin: DocumentOrShadowRootMixin;
  /** Live child collection and element-child navigation. */
  #parentNodeMixin: ParentNodeMixin;
  /** Ordered set of sheet owners currently blocking script execution. */
  // https://html.spec.whatwg.org/#script-blocking-style-sheet-set
  #scriptBlockingStyleSheets = new Set<ElementImpl>();
  /** Shared wait resolved when the blocking style-sheet set becomes empty. */
  #scriptBlockingStyleSheetsReady: InternalPromiseWithResolvers<void> | null = null;
  /** Stable factory object associated with this document. */
  #implementation?: DOMImplementationImpl;
  /** Cached live collection returned by document.all. */
  #all?: HTMLAllCollectionImpl;
  /** Stable live collections exposed by the document's tree accessors. */
  #images?: HTMLCollectionImpl;
  #embeds?: HTMLCollectionImpl;
  #links?: HTMLCollectionImpl;
  #forms?: HTMLCollectionImpl;
  #scripts?: HTMLCollectionImpl;
  /** Retains identity when a named property matches multiple elements. */
  #namedCollections = new Map<string, HTMLCollectionImpl>();
  /** Parser input callback installed while document.write() is permitted. */
  #writer?: DocumentWriter;
  /** Document event-handler attributes and their registered listeners. */
  #eventHandlers = new EventHandlerMap(this, [{ name: 'onreadystatechange', type: 'readystatechange' }]);

  constructor(env: BrowletEnvironment) {
    super(NodeType.Document, null, env);
    this.nodeDocument = this;
    this.#documentOrShadowRootMixin = new DocumentOrShadowRootMixin(this);
    this.#parentNodeMixin = new ParentNodeMixin(this);
  }

  static is(value: unknown): value is DocumentImpl {
    return value instanceof DocumentImpl;
  }

  // https://dom.spec.whatwg.org/#dom-document-url
  get URL(): string {
    return serializeURL(this.url);
  }

  /** Legacy alias of the serialized document URL. */
  // https://dom.spec.whatwg.org/#dom-document-documenturi
  get documentURI(): string {
    return this.URL;
  }

  // https://dom.spec.whatwg.org/#dom-node-baseuri
  override get baseURI(): string {
    return serializeURL(this.getBaseURL());
  }

  // https://dom.spec.whatwg.org/#dom-document-characterset
  get characterSet(): string {
    return this.encoding;
  }

  /** Legacy alias of characterSet. */
  get charset(): string {
    return this.characterSet;
  }

  /** Legacy alias of characterSet. */
  get inputEncoding(): string {
    return this.characterSet;
  }

  /** Associated browsing context; detaching releases connected rendering blockers. */
  get browsingContext(): BrowsingContext | null {
    return this.#browsingContext;
  }

  // https://html.spec.whatwg.org/multipage/infrastructure.html#becomes-browsing-context-disconnected
  set browsingContext(context: BrowsingContext | null) {
    const disconnected = this.#browsingContext !== null && context === null;
    this.#browsingContext = context;
    if (disconnected && this.isRenderBlocked()) {
      for (const element of this.renderBlockingElements) {
        if (element.isConnected) element.unblockRendering();
      }
    }
  }

  /** Associated WindowProxy handle, or null without a browsing context. */
  // https://html.spec.whatwg.org/#dom-document-defaultview
  get defaultView(): WindowProxyHandle | null {
    return this.browsingContext?.windowProxy ?? null;
  }

  /** Effective security domain; assignment can relax a site-keyed tuple origin. */
  // https://html.spec.whatwg.org/multipage/browsers.html#dom-document-domain
  get domain(): string {
    const domain = effectiveDomain(this.origin);
    return domain === null ? '' : serializeHost(domain);
  }

  set domain(value: string) {
    if (this.browsingContext === null) {
      throw new DOMExceptionImpl('A document without a browsing context cannot set its domain', DOMExceptionNames.security);
    }
    if (this.activeSandboxingFlagSet.has('sandboxed-document-domain')) {
      throw new DOMExceptionImpl('The document is sandboxed against domain relaxation', DOMExceptionNames.security);
    }
    const origin = this.origin;
    const domain = effectiveDomain(origin);
    if (origin.kind === 'opaque' || domain === null) {
      throw new DOMExceptionImpl('An opaque-origin document cannot set its domain', DOMExceptionNames.security);
    }
    if (!isRegistrableDomainSuffixOfOrEqualTo(value, domain)) {
      throw new DOMExceptionImpl('The value is not a registrable domain suffix or equal host', DOMExceptionNames.security);
    }
    const cluster = this.env.realm.agent.agentCluster;
    if (cluster === null) throw new InternalError('Document domain relaxation requires an agent cluster');
    if (cluster.isOriginKeyed) return;
    origin.domain = parseHost(value).host!;
  }

  /** Whether this document cannot participate in the document.cookie API. */
  // https://html.spec.whatwg.org/multipage/dom.html#cookie-averse-document-object
  // SPEC_CLASH(document-cookie-averse): use the inherited cookie URL, matching browsers and WHATWG HTML #332.
  get isCookieAverse(): boolean {
    return this.browsingContext === null || this.cookieURL.scheme !== 'http' && this.cookieURL.scheme !== 'https';
  }

  /** Whether the live ancestor chain prevents establishing a same-site cookie context. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#set-up-a-window-environment-settings-object
  // Implements the "has cross-site ancestor" query shared by Fetch settings and document.cookie.
  get hasCrossSiteAncestor(): boolean {
    const navigable = this.getNodeNavigable();
    // SPEC_GAP(window-settings-inactive-ancestry): HTML does not handle a null navigable; retain a cross-site cookie context.
    // A detached/inactive Document has no current ancestor chain to establish a cookie site.
    if (navigable === null) return true;
    const origin = this.origin;
    for (let parent = navigable.parent; parent !== null; parent = parent.parent) {
      const parentDocument = parent.activeDocument;
      if (parentDocument === null || !areSameSite(parentDocument.origin, origin)) return true;
    }
    return false;
  }

  /** Read cookies for the retained cookie URL, excluding HttpOnly cookies. */
  // https://html.spec.whatwg.org/multipage/dom.html#dom-document-cookie
  get cookie(): string {
    if (this.isCookieAverse) return '';
    // SPEC_CLASH(document-cookie-sandbox): throw for opaque inherited srcdoc, as in Chromium/Firefox; WebKit silently denies it.
    if (this.origin.kind === 'opaque') {
      throw new DOMExceptionImpl('An opaque-origin document cannot access cookies', DOMExceptionNames.security);
    }
    const { userAgent } = this.env;
    if (!userAgent.cookiesEnabled) return '';
    const { scheme, host, path } = this.cookieURL;
    // HTTP(S) URLs have a domain/IP host and a non-opaque path.
    const cookies = userAgent.cookieStore.retrieveCookies(
      scheme === 'https', host as CookieHost, path, false, this.hasCrossSiteAncestor ? 'none' : 'strict-or-less',
    );
    return utf8DecodeWithoutBOM(isomorphicEncode(HTTPCookie.serialize(cookies)));
  }

  /** Process one non-HTTP cookie assignment against the retained cookie URL. */
  // https://html.spec.whatwg.org/multipage/dom.html#dom-document-cookie
  set cookie(value: string) {
    if (this.isCookieAverse) return;
    // SPEC_CLASH(document-cookie-sandbox): throw for opaque inherited srcdoc, as in Chromium/Firefox; WebKit silently denies it.
    if (this.origin.kind === 'opaque') {
      throw new DOMExceptionImpl('An opaque-origin document cannot access cookies', DOMExceptionNames.security);
    }
    const { userAgent } = this.env;
    if (!userAgent.cookiesEnabled) return;
    const { scheme, host, path } = this.cookieURL;
    // HTTP(S) URLs have a domain/IP host and a non-opaque path.
    userAgent.cookieStore.parseAndStoreCookie(
      isomorphicDecode(utf8Encode(value)), scheme === 'https', host as CookieHost, path as string[],
      false, false, !this.hasCrossSiteAncestor,
    );
    userAgent.cookieStore.garbageCollectCookies(host as CookieHost);
  }

  /** Source modification date in local time; unknown dates use the current time. */
  // https://html.spec.whatwg.org/multipage/dom.html#dom-document-lastmodified
  // SPEC_CLASH(document-last-modified-timezone): use Date's historical local offset; Windows Gecko/WebKit can disagree.
  get lastModified(): string {
    const date = new Date(this.lastModificationTime ?? Date.now());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = String(date.getFullYear()).padStart(4, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${month}/${day}/${year} ${hours}:${minutes}:${seconds}`;
  }

  // https://html.spec.whatwg.org/#dom-document-readystate
  get readyState(): DocumentReadyState {
    return this.currentDocumentReadiness;
  }

  /** The associated parser while it has neither stopped nor been aborted. */
  // https://html.spec.whatwg.org/multipage/dom.html#active-parser
  get activeParser(): DocumentParser | null {
    const parser = this.parser;
    return parser === null || parser.stopped ? null : parser;
  }

  /** Callback invoked when this document's readiness changes. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#handler-onreadystatechange
  get onreadystatechange(): EventHandlerCallback | null {
    return this.#eventHandlers.get('onreadystatechange');
  }

  set onreadystatechange(value: EventHandlerCallback | null) {
    this.#eventHandlers.set('onreadystatechange', value);
  }

  // https://dom.spec.whatwg.org/#dom-document-compatmode
  get compatMode(): 'BackCompat' | 'CSS1Compat' {
    return this.mode === DocumentMode.Quirks
      ? 'BackCompat'
      : 'CSS1Compat';
  }

  // https://dom.spec.whatwg.org/#dom-document-doctype
  get doctype(): DocumentTypeImpl | null {
    for (let child = this.firstChild; child; child = child.nextSibling) {
      if (child.isDocumentType()) return child;
    }

    return null;
  }

  /** First element child of the document, or null before one is inserted. */
  // https://dom.spec.whatwg.org/#dom-document-documentelement
  get documentElement(): ElementImpl | null {
    return this.#documentElement;
  }

  /** Document element when it is an HTML html element. */
  // https://html.spec.whatwg.org/multipage/dom.html#the-html-element-2
  get htmlElement(): HTMLHtmlElementImpl | null {
    const root = this.documentElement;
    return root instanceof HTMLHtmlElementImpl ? root : null;
  }

  /** Forward the reflected keyword to the HTML html element, when one exists. */
  // https://html.spec.whatwg.org/multipage/dom.html#dom-document-dir
  get dir(): string { return this.htmlElement?.dir ?? ''; }
  set dir(value: string) {
    const html = this.htmlElement;
    if (html !== null) html.dir = value;
  }

  /** First head child of the document's HTML html element. */
  // https://html.spec.whatwg.org/#dom-document-head
  get head(): HTMLHeadElementImpl | null {
    const html = this.htmlElement;
    if (html === null) return null;

    for (let child = html.firstChild; child; child = child.nextSibling) {
      if (HTMLHeadElementImpl.is(child)) return child;
    }

    return null;
  }

  /** First HTML title element in the ordinary document tree, including outside head. */
  // https://html.spec.whatwg.org/multipage/dom.html#the-title-element-2
  get htmlTitleElement(): HTMLTitleElementImpl | null {
    return findElement(this, (element) => HTMLTitleElementImpl.is(element));
  }

  /** Title text with ASCII whitespace stripped and collapsed. */
  // https://html.spec.whatwg.org/multipage/dom.html#document.title
  get title(): string {
    return this.#title;
  }

  set title(value: string) {
    const root = this.documentElement;
    let title: ElementImpl | null = this.#titleElement;
    if (root instanceof SVGSVGElementImpl) {
      if (title === null) {
        title = this.createElementNode('title', SVG_NAMESPACE);
        root.insertBefore(title, root.firstChild);
      }
    } else if (root instanceof HTMLElementImpl) {
      if (title === null) {
        const head = this.head;
        if (head === null) return;
        title = this.createElementNode('title', HTML_NAMESPACE);
        head.appendChild(title);
      }
    } else {
      return;
    }
    title.stringReplaceAll(value);
  }

  /** First body or frameset child of an HTML document element. */
  // https://html.spec.whatwg.org/#dom-document-body
  get body(): HTMLBodyElementImpl | HTMLFrameSetElementImpl | null {
    const html = this.htmlElement;
    if (html === null) return null;

    for (let child = html.firstChild; child; child = child.nextSibling) {
      if (child instanceof HTMLBodyElementImpl || child instanceof HTMLFrameSetElementImpl) {
        return child;
      }
    }

    return null;
  }

  set body(value: HTMLElementImpl | null) {
    if (!(value instanceof HTMLBodyElementImpl) && !(value instanceof HTMLFrameSetElementImpl)) {
      throw new DOMExceptionImpl('Document body must be an HTML body or frameset', DOMExceptionNames.hierarchyRequest);
    }
    const body = this.body;
    if (body === value) return;
    if (body !== null) {
      body.parentNode!.replaceChild(value, body);
      return;
    }
    const root = this.documentElement;
    if (root === null) {
      throw new DOMExceptionImpl('Document has no document element', DOMExceptionNames.hierarchyRequest);
    }
    root.appendChild(value);
  }

  /** Live HTML img descendants in tree order. */
  // https://html.spec.whatwg.org/multipage/dom.html#dom-document-images
  get images(): HTMLCollectionImpl {
    return this.#images ??= HTMLCollectionImpl.fromRoot(this,
      (element) => element instanceof HTMLImageElementImpl);
  }

  /** Live HTML embed descendants, regardless of named-property exposure. */
  // https://html.spec.whatwg.org/multipage/dom.html#dom-document-embeds
  get embeds(): HTMLCollectionImpl {
    return this.#embeds ??= HTMLCollectionImpl.fromRoot(this,
      (element) => element instanceof HTMLEmbedElementImpl);
  }

  /** Legacy alias for the same embeds collection. */
  // https://html.spec.whatwg.org/multipage/dom.html#dom-document-plugins
  get plugins(): HTMLCollectionImpl {
    return this.embeds;
  }

  /** Live HTML a/area descendants with an href content attribute, including an empty one. */
  // https://html.spec.whatwg.org/multipage/dom.html#dom-document-links
  get links(): HTMLCollectionImpl {
    return this.#links ??= HTMLCollectionImpl.fromRoot(this, (element) => {
      const tag = element.tag;
      return (tag === ElementTag.HTMLA || tag === ElementTag.HTMLArea) && element.hasAttributeNS(null, 'href');
    });
  }

  /** Live HTML form descendants in tree order. */
  // https://html.spec.whatwg.org/multipage/dom.html#dom-document-forms
  get forms(): HTMLCollectionImpl {
    return this.#forms ??= HTMLCollectionImpl.fromRoot(this,
      (element) => element instanceof HTMLFormElementImpl);
  }

  /** Live HTML script descendants; SVG scripts do not belong to this collection. */
  // https://html.spec.whatwg.org/multipage/dom.html#dom-document-scripts
  get scripts(): HTMLCollectionImpl {
    return this.#scripts ??= HTMLCollectionImpl.fromRoot(this,
      (element) => element instanceof HTMLScriptElementImpl);
  }

  /** Focusable area currently designated by HTML focus management. */
  // https://html.spec.whatwg.org/multipage/interaction.html#focused-area-of-the-document
  get focusedArea(): FocusableArea {
    // TODO(HTML §6.6): initialize focus state and maintain it through focus updates and fixup.
    throw new InternalError('Document focused area is not implemented');
  }

  /** Focused element visible from this document's tree. */
  get activeElement(): ElementImpl | null {
    return this.#documentOrShadowRootMixin.activeElement;
  }

  get styleSheets(): StyleSheetListImpl {
    return this.#documentOrShadowRootMixin.styleSheets;
  }

  get adoptedStyleSheets(): CSSStyleSheetImpl[] {
    return this.#documentOrShadowRootMixin.adoptedStyleSheets;
  }

  get children(): HTMLCollectionImpl {
    return this.#parentNodeMixin.children;
  }

  /** Stable live collection of all descendant elements, independent of native platform support. */
  // https://html.spec.whatwg.org/#dom-document-all
  get all(): HTMLAllCollectionImpl {
    return this.#all ??= new HTMLAllCollectionImpl(this);
  }

  get firstElementChild(): ElementImpl | null {
    return this.#parentNodeMixin.firstElementChild;
  }

  get lastElementChild(): ElementImpl | null {
    return this.#parentNodeMixin.lastElementChild;
  }

  get childElementCount(): number {
    return this.#parentNodeMixin.childElementCount;
  }

  /** Stable DOM factory object; the associated document selects origin and allocation realm. */
  // https://dom.spec.whatwg.org/#dom-document-implementation
  get implementation(): DOMImplementationImpl {
    return this.#implementation ??= new DOMImplementationImpl(this);
  }

  /** Document containing this active document's navigable container, or null without one. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#doc-container-document
  get containerDocument(): DocumentImpl | null {
    return this.getNodeNavigable()?.containerDocument ?? null;
  }

  /** Refresh the root after an element is linked to or unlinked from this document. */
  updateDocumentElement(): void {
    let root: ElementImpl | null = null;
    for (let child = this.firstChild; child; child = child.nextSibling) {
      if (child.isElement()) {
        root = child;
        break;
      }
    }
    if (root === this.#documentElement) return;
    this.#documentElement = root;
    this.updateTitleElement();
  }

  /** Refresh title selection after a title element moves, or the document root changes. */
  updateTitleElement(changedTitle?: HTMLTitleElementImpl | SVGTitleElementImpl): void {
    if (changedTitle !== undefined && changedTitle !== this.#titleElement && changedTitle.getRoot() !== this) return;
    const root = this.#documentElement;
    const title = root instanceof SVGSVGElementImpl
      ? this.#getSVGTitle(root)
      : this.htmlTitleElement;
    if (title === this.#titleElement) return;
    this.#titleElement = title;
    this.#title = stripAndCollapseASCIIWhitespace(title?.getChildTextContent() ?? '');
  }

  /** Refresh normalized text when the selected title's direct children change. */
  updateTitleText(element: HTMLTitleElementImpl | SVGTitleElementImpl): void {
    if (element !== this.#titleElement) return;
    this.#title = stripAndCollapseASCIIWhitespace(element.getChildTextContent());
  }

  /** Live HTML descendants with exactly this name content attribute. */
  // https://html.spec.whatwg.org/multipage/dom.html#dom-document-getelementsbyname
  getElementsByName(name: string): NodeListImpl {
    return new NodeListImpl({
      root: this,
      collect: () => {
        const elements: ElementImpl[] = [];
        for (let node = this.firstChild; node; node = node.nextDescendant(this)) {
          if (node instanceof HTMLElementImpl && node.getAttributeNS(null, 'name') === name) {
            elements.push(node);
          }
        }
        return elements;
      },
    });
  }

  /** Nonempty names contributed by eligible elements, in tree order with each ID first. */
  // https://html.spec.whatwg.org/multipage/dom.html#dom-document-nameditem-which
  // SPEC_CLASH(document-named-scope): follow HTML on XML and detached documents; browsers restrict these cases.
  // SPEC_CLASH(document-named-order): follow HTML's tree/ID-first order; Gecko/WebKit enumeration differs.
  getSupportedPropertyNames(): ReadonlySet<string> {
    const names = new Set<string>();
    for (let node = this.firstChild; node; node = node.nextDescendant(this)) {
      if (!(node instanceof HTMLElementImpl)) continue;
      const type = node.getDocumentNamedItemType();
      if (type === 'none') continue;
      const name = node.getAttributeNS(null, 'name');
      if (type === 'name-or-id' || (type === 'name-or-id-with-name' && name)) {
        const id = node.getAttributeNS(null, 'id');
        if (id) names.add(id);
      }
      if (name) names.add(name);
    }
    return names;
  }

  /** Resolve a supported name to one element, its child WindowProxy, or a stable live collection. */
  // https://html.spec.whatwg.org/multipage/dom.html#dom-document-nameditem
  getNamedProperty(name: string): ElementImpl | WindowProxyHandle | HTMLCollectionImpl {
    let elements = this.#namedCollections.get(name);
    if (elements === undefined) {
      elements = HTMLCollectionImpl.fromRoot(this, (element) =>
        element instanceof HTMLElementImpl && element.matchesDocumentName(name));
      this.#namedCollections.set(name, elements);
    }
    if (elements.length !== 1) return elements;
    const element = elements.item(0)!;
    if (element instanceof HTMLIFrameElementImpl && element.contentNavigable !== null) {
      return element.contentNavigable.activeWindowProxy;
    }
    // SPEC_CLASH(document-named-iframe): HTML returns the iframe without a child navigable; Gecko returns undefined.
    return element;
  }

  prepend(...nodes: (NodeImpl | string)[]): void {
    this.#parentNodeMixin.prepend(...nodes);
  }

  append(...nodes: (NodeImpl | string)[]): void {
    this.#parentNodeMixin.append(...nodes);
  }

  replaceChildren(...nodes: (NodeImpl | string)[]): void {
    this.#parentNodeMixin.replaceChildren(...nodes);
  }

  moveBefore(node: NodeImpl, child: NodeImpl | null): void {
    this.#parentNodeMixin.moveBefore(node, child);
  }

  querySelector(selectors: string): ElementImpl | null {
    return this.#parentNodeMixin.querySelector(selectors);
  }

  querySelectorAll(selectors: string): NodeListImpl {
    return this.#parentNodeMixin.querySelectorAll(selectors);
  }

  // https://dom.spec.whatwg.org/#dom-document-createelement
  createElement(
    localName: string,
    options: string | ElementCreationOptions = {},
  ): ElementImpl {
    if (!isValidElementLocalName(localName)) {
      throw new DOMExceptionImpl('', DOMExceptionNames.invalidCharacter);
    }
    if (this.type === 'html') localName = asciiLower(localName);
    const namespace = this.type === 'html' || this.contentType === 'application/xhtml+xml' ? HTML_NAMESPACE : '';
    const [registry, isValue] = this.#extractElementCreationOptions(options);
    return this.createElementNode(localName, namespace, null, isValue, registry);
  }

  // https://dom.spec.whatwg.org/#dom-document-createelementns
  createElementNS(
    namespaceURI: string | null,
    qualifiedName: string,
    options: string | ElementCreationOptions = {},
  ): ElementImpl {
    const [namespace, prefix, localName] = validateAndExtract(namespaceURI, qualifiedName, 'element');
    const [registry, isValue] = this.#extractElementCreationOptions(options);
    return this.createElementNode(localName, namespace ?? '', prefix, isValue, registry);
  }

  /** Create a detached Document or XMLDocument in this document's environment. */
  createDocumentNode(xml = false): DocumentImpl {
    return this.env.constructNode(xml ? XMLDocumentImpl : DocumentImpl, []);
  }

  /** Copy document metadata without copying its browsing context or runtime services. */
  // https://dom.spec.whatwg.org/#concept-node-clone-single
  cloneDocument(document: DocumentImpl): DocumentImpl {
    const copy = document.createDocumentNode(this instanceof XMLDocumentImpl);
    copy.encoding = this.encoding;
    copy.contentType = this.contentType;
    copy.url = this.url;
    copy.origin = this.origin;
    copy.type = this.type;
    copy.mode = this.mode;
    copy.allowDeclarativeShadowRoots = this.allowDeclarativeShadowRoots;
    if (this.customElementRegistry?.isScoped) copy.customElementRegistry = this.customElementRegistry;
    return copy;
  }

  /** Validate XML-only CDATA construction; later data mutations need not preserve XML syntax. */
  // https://dom.spec.whatwg.org/#dom-document-createcdatasection
  createCDATASection(data: string): CDATASectionImpl {
    if (this.type === 'html') throw new DOMExceptionImpl('', DOMExceptionNames.notSupported);
    if (data.includes(']]>')) throw new DOMExceptionImpl('', DOMExceptionNames.invalidCharacter);
    return this.createCDATASectionNode(data);
  }

  /** Allocate existing CDATA data, including data that became non-XML after mutation. */
  createCDATASectionNode(data: string): CDATASectionImpl {
    return this.env.constructNode(CDATASectionImpl, [data, this]);
  }

  /** Create and initialize a processing instruction in this document. */
  // https://dom.spec.whatwg.org/#dom-document-createprocessinginstruction
  createProcessingInstruction(target: string, data: string): ProcessingInstructionImpl {
    return this.env.constructNode(ProcessingInstructionImpl, [target, data, this]);
  }

  /** Copy retained instruction data without repeating public creation validation. */
  createProcessingInstructionNode(target: string, data: string): ProcessingInstructionImpl {
    // SPEC_GAP(processing-instruction-clone-attributes): Cloning copies data without specifying
    // how to initialize the pseudo-attribute map. Reparse the copied data through the shared setter.
    const copy = this.createProcessingInstruction(target, '');
    copy.data = data;
    return copy;
  }

  /** Copy a foreign node into this document, selecting the destination's registry and realm. */
  // https://dom.spec.whatwg.org/#dom-document-importnode
  importNode(node: NodeImpl, options: boolean | ImportNodeOptions): NodeImpl {
    if (node.isDocument() || node.isShadowRoot()) throw new DOMExceptionImpl('', DOMExceptionNames.notSupported);
    let registry: CustomElementRegistryImpl | null = null;
    let subtree: boolean;
    if (typeof options === 'boolean') {
      subtree = options;
    } else {
      subtree = !options.selfOnly;
      registry = options.customElementRegistry ?? null;
      this.#validateRegistry(registry);
    }
    registry ??= this.lookupCustomElementRegistry();
    return node.clone(this, subtree, null, registry);
  }

  // https://dom.spec.whatwg.org/#dom-document-createtextnode
  createTextNode(data: string): TextImpl {
    return this.env.constructNode(TextImpl, [data, this]);
  }

  // https://dom.spec.whatwg.org/#dom-document-createcomment
  createComment(data: string): CommentImpl {
    return this.env.constructNode(CommentImpl, [data, this]);
  }

  /** Create a live range collapsed at this document's start. */
  // https://dom.spec.whatwg.org/#dom-document-createrange
  createRange(): RangeImpl {
    return new RangeImpl(this, this.env);
  }

  /** Legacy author event construction; the result must be initialized before dispatch. */
  // https://dom.spec.whatwg.org/#dom-document-createevent
  createEvent(name: string): EventImpl {
    const constructor = legacyEventConstructors.get(asciiLower(name));
    // Other entries in DOM's legacy table are not exposed by Browlet yet.
    if (constructor === undefined) throw new DOMExceptionImpl('', DOMExceptionNames.notSupported);
    const event = this.env.createEvent(constructor);
    event.isTrusted = false;
    event.initialized = false;
    return event;
  }

  /** Create a traversal cursor rooted at the supplied node, even in another document. */
  // https://dom.spec.whatwg.org/#dom-document-createnodeiterator
  createNodeIterator(root: NodeImpl, whatToShow: number, filter: NodeFilterCallback | null): NodeIteratorImpl {
    return new NodeIteratorImpl(root, whatToShow, filter, this.env);
  }

  /** Create a walker whose initial position is its root, even in another document. */
  // https://dom.spec.whatwg.org/#dom-document-createtreewalker
  createTreeWalker(root: NodeImpl, whatToShow: number, filter: NodeFilterCallback | null): TreeWalkerImpl {
    return new TreeWalkerImpl(root, whatToShow, filter, this.env);
  }

  // https://dom.spec.whatwg.org/#dom-document-createattribute
  createAttribute(localName: string): AttrImpl {
    if (!isValidAttributeLocalName(localName)) {
      throw new DOMExceptionImpl(
        `Invalid attribute local name ${JSON.stringify(localName)}`,
        DOMExceptionNames.invalidCharacter,
      );
    }
    if (this.type === 'html') localName = asciiLower(localName);
    return this.createAttributeNode(localName, '', null, null);
  }

  // https://dom.spec.whatwg.org/#dom-document-createattributens
  createAttributeNS(namespace: string | null, qualifiedName: string): AttrImpl {
    const [namespaceURI, prefix, localName] = validateAndExtract(namespace, qualifiedName, 'attribute');
    return this.createAttributeNode(localName, '', namespaceURI, prefix);
  }

  /** Detach and adopt a non-document node, preserving the node's identity. */
  // https://dom.spec.whatwg.org/#dom-document-adoptnode
  adoptNode<T extends NodeImpl>(node: T): T {
    if (node.isDocument()) throw new DOMExceptionImpl('', DOMExceptionNames.notSupported);
    if (node.isShadowRoot()) throw new DOMExceptionImpl('', DOMExceptionNames.hierarchyRequest);
    node.adoptInto(this);
    return node;
  }

  /** Feed markup to the currently installed parser writer. */
  // https://html.spec.whatwg.org/#dom-document-write
  write(...text: string[]): void {
    const writer = this.#writer;

    if (!writer) {
      throw new InternalError('Document has no active parser');
    }

    writer(text.join(''));
  }

  // https://dom.spec.whatwg.org/#dom-nonelementparentnode-getelementbyid
  getElementById(id: string): ElementImpl | null {
    return findElementById(this, id);
  }

  /** Lazily bind Selectlet to this document's DOM adapter and selector exception policy. */
  getSelectorEngine(): Selectlet<NodeImpl, ElementImpl, DocumentImpl, DocumentFragmentImpl> {
    return this.#selectlet ??= createSelectlet(this, {
      env: this.env,
      errors: {
        syntax(error) {
          throw new DOMExceptionImpl(error.message, DOMExceptionNames.syntax);
        },
      },
    });
  }

  /** Convert all strings first, then assemble multiple arguments through ordinary insertion. */
  // https://dom.spec.whatwg.org/#convert-nodes-into-a-node
  convertNodesIntoNode(nodes: (NodeImpl | string)[]): NodeImpl {
    const converted = nodes.map((node) => typeof node === 'string' ? this.createTextNode(node) : node);
    if (converted.length === 1) return converted[0]!;
    const fragment = this.createDocumentFragment();
    for (const node of converted) fragment.appendChild(node);
    return fragment;
  }

  // https://dom.spec.whatwg.org/#dom-document-getelementsbyclassname
  getElementsByClassName(classNames: string): HTMLCollectionImpl {
    return findElementsByClassName(this, classNames);
  }

  // https://dom.spec.whatwg.org/#dom-document-getelementsbytagname
  getElementsByTagName(qualifiedName: string): HTMLCollectionImpl {
    return findElementsByTagName(this, qualifiedName);
  }

  // https://dom.spec.whatwg.org/#dom-document-getelementsbytagnamens
  getElementsByTagNameNS(
    namespaceURI: string | null,
    localName: string,
  ): HTMLCollectionImpl {
    return findElementsByTagNameNS(this, namespaceURI, localName);
  }

  // ---------------------------------------------------------------------
  // HTML document lifecycle
  // ---------------------------------------------------------------------

  /** Initialize both ancestor-origin lists using the creation caller's container document. */
  // https://html.spec.whatwg.org/multipage/dom.html#internal-ancestor-origin-objects-list-creation-steps
  // https://html.spec.whatwg.org/multipage/dom.html#ancestor-origins-list-creation-steps
  initializeAncestry(referrerPolicy: ReferrerPolicy, parentDocument: DocumentImpl | null): void {
    // SPEC_CLASH(ancestor-origins-before-activation): HTML creates ancestry before activation, but its container lookup requires an active document.
    // The creation caller already knows the container document; passing it preserves activation timing.
    this.internalAncestorOriginObjectsList = this.#createAncestorOriginObjects(referrerPolicy, parentDocument);
    this.ancestorOriginsList = new DOMStringListImpl(this.internalAncestorOriginObjectsList.map(serializeOrigin));
  }

  /** Populate the synchronously available element tree of an about:blank document. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#populate-with-html/head/body
  populateWithHTMLHeadBody(): void {
    const html = this.createElementNode('html', HTML_NAMESPACE);
    const head = this.createElementNode('head', HTML_NAMESPACE);
    const body = this.createElementNode('body', HTML_NAMESPACE);

    this.appendChild(html);
    html.appendChild(head);
    html.appendChild(body);
  }

  /** Update this Document's URL and same-document session history. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#url-and-history-update-steps
  updateURLAndHistory(
    _newURL: URLRecord, _serializedData: SerializedRecord | null = null,
    _historyHandling: HistoryHandlingBehavior = 'replace',
  ): void {
    // TODO: Update History/Navigation state and queue the shared same-document history steps.
    throw new InternalError('URL and history updates are not implemented');
  }

  /** Retarget this document's browsing context to its Window and enable execution. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#make-active
  makeActive(): void {
    const browsingContext = this.browsingContext;
    const window = this.getRelevantGlobalObject();
    if (browsingContext === null || window === null) {
      throw new InternalError('Active Document needs a browsing context and Window');
    }

    const env = window.env;
    browsingContext.windowProxy.setAssociatedWindow(env.realm.globalObject);
    env.markExecutionReady();
  }

  /** Change readiness, record the first HTML parsing milestones, and notify listeners synchronously. */
  // https://html.spec.whatwg.org/multipage/dom.html#update-the-current-document-readiness
  updateCurrentDocumentReadiness(readinessValue: DocumentReadyState): void {
    if (this.currentDocumentReadiness === readinessValue) return;
    this.currentDocumentReadiness = readinessValue;

    if (this.parser?.kind === 'html') {
      const now = this.env.timing.currentHighResolutionTime().toTimestamp();
      const timing = this.loadTimingInfo;
      if (readinessValue === 'complete' && timing.domCompleteTime === 0) {
        timing.domCompleteTime = now;
      } else if (readinessValue === 'interactive' && timing.domInteractiveTime === 0) {
        timing.domInteractiveTime = now;
      }
    }

    this.fireEvent('readystatechange');
  }

  /** Finish the loading milestones and events for Browlet's existing document routes. */
  // https://html.spec.whatwg.org/multipage/parsing.html#stop-parsing
  finishLoading(): void {
    const browsingContext = this.browsingContext;
    if (browsingContext === null) {
      throw new InternalError('A completely loaded Document needs a browsing context');
    }
    const window = browsingContext.activeWindow;
    if (window.getAssociatedDocument() !== this) {
      throw new InternalError('Only an active Document can finish loading');
    }

    // PROVISIONAL: these phases still run together; deferred scripts, load-event
    // delays, and separate DOM-manipulation tasks await the full parser lifecycle.
    const env = this.env;
    const timing = this.loadTimingInfo;
    const parser = this.parser;
    timing.domContentLoadedEventStartTime = env.timing.currentHighResolutionTime().toTimestamp();
    this.fireEvent('DOMContentLoaded', undefined, (event) => { event.bubbles = true; });
    timing.domContentLoadedEventEndTime = env.timing.currentHighResolutionTime().toTimestamp();
    this.updateCurrentDocumentReadiness('complete');
    parser?.detach();
    timing.loadEventStartTime = env.timing.currentHighResolutionTime().toTimestamp();
    this.readyForPostLoadTasks = true;
    window.fireEvent('load', undefined, undefined, true);
    timing.loadEventEndTime = env.timing.currentHighResolutionTime().toTimestamp();
    this.completelyFinishLoading();
  }

  /** Record that this document has completely finished loading. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#completely-finish-loading
  completelyFinishLoading(): void {
    if (this.browsingContext === null) {
      throw new InternalError('A completely loaded Document needs a browsing context');
    }
    this.completelyLoadedTime = currentCoarsenedWallTime().milliseconds;
    // PROVISIONAL: container/iframe load completion enters with child navigables.
  }

  /** Only HTML content without a body or frameset may acquire new rendering blockers. */
  // https://html.spec.whatwg.org/multipage/dom.html#allows-adding-render-blocking-elements
  allowsAddingRenderBlockingElements(): boolean {
    return this.contentType === 'text/html' && this.body === null;
  }

  /** Hold rendering for the initial body or pending elements until the user-agent cutoff. */
  // https://html.spec.whatwg.org/multipage/dom.html#render-blocked
  isRenderBlocked(): boolean {
    if (this.renderBlockingElements.size === 0 && !this.allowsAddingRenderBlockingElements()) return false;
    return this.env.timing.currentHighResolutionTime().milliseconds <= this.env.userAgent.renderBlockingTimeout;
  }

  /** Destroy an active document from a task on its owning event loop. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#destroy-a-document
  destroy(): void {
    const env = this.env;
    const eventLoop = env.responsibleEventLoop;
    if (eventLoop.currentlyRunningTask === null) {
      throw new InternalError('Document destruction requires a task on its owning event loop');
    }

    // PROVISIONAL: inactive history destruction needs the retained document state;
    // using the navigable's current active entry would clear a different document.
    const navigable = this.getNodeNavigable();
    if (navigable === null) {
      throw new InternalError('Inactive document destruction needs session-history ownership');
    }
    const documentState = navigable.activeSessionHistoryEntry.documentState;
    const global = env.getWindowOrWorkerGlobalScopeMixin();

    this.abort();
    this.salvageable = false;
    for (const port of global.messagePorts) port.disentangle();
    this.runUnloadingCleanup();
    eventLoop.removeTasksForDocument(this);
    global.handoffReports();
    global.clearReportingState();

    this.browsingContext = null;
    documentState.document = null;
    for (const evaluation of env.userAgent.pageEvaluations.get(navigable) ?? []) {
      evaluation.activeDocumentChanged();
    }
    env.userAgent.pageEvaluations.delete(navigable);
    this.notifyFullyActiveStateChanged();

    for (const worker of this.ownedWorkers) worker.ownerSet.delete(this);
    for (const worklet of this.workletGlobalScopes) worklet.terminate();
  }

  /** Stop this document's fetches and active parser from its owning event-loop task. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#abort-a-document
  abort(): void {
    const env = this.env;
    if (env.responsibleEventLoop.currentlyRunningTask === null) {
      throw new InternalError('Document abortion requires a task on its owning event loop');
    }
    if (env.fetchGroup.cancel()) this.makeUnsalvageable('fetch');

    const navigationID = this.duringLoadingNavigationID;
    if (navigationID !== null) {
      env.userAgent.webDriverBiDiNavigationAborted(this.getNodeNavigable(), {
        id: navigationID, status: 'canceled', url: this.url,
      });
      this.duringLoadingNavigationID = null;
    }

    const parser = this.activeParser;
    if (parser !== null) {
      this.activeParserWasAborted = true;
      parser.abort();
      this.makeUnsalvageable('parser-aborted');
    }
  }

  /** Clean up document-owned resources during unloading or destruction. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#unloading-document-cleanup-steps
  runUnloadingCleanup(): void {
    const env = this.env;
    const global = env.getWindowOrWorkerGlobalScopeMixin();
    for (const socket of global.webSockets) {
      socket.makeDisappear();
      this.makeUnsalvageable('websocket');
    }
    for (const transport of global.webTransports) transport.cleanup();
    if (!this.salvageable) {
      for (const source of global.eventSources) source.close();
      global.timers.clear();
    }
    env.userAgent.blobURLStore.removeForEnvironment(env);
    // TODO: connect fullscreen, media, service-worker, and lock cleanup as implemented.
  }

  /** Inherit the browsing context's upgrade policy before applying this document's own directives. */
  // https://w3c.github.io/webappsec-upgrade-insecure-requests/#nesting
  initializeInsecureRequestsPolicy(): void {
    const policy = this.browsingContext?.insecureRequestsPolicy;
    const env = this.env;
    if (policy?.upgrade) env.insecureRequestsPolicy = policy.clone();
    // Initial about:blank replacement can reuse the Window and environment.
    else if (env.insecureRequestsPolicy.upgrade) env.insecureRequestsPolicy = new InsecureRequestsPolicy();
  }

  /** Initialize the document's delivered Content Security Policies. */
  // https://w3c.github.io/webappsec-csp/#run-document-csp-initialization
  initializeCSP(): void {
    // An inherited list already carries its creator's origin. An empty new
    // list also needs an origin before later meta policies can be added.
    this.policyContainer.cspList ??= new CSPList(this.origin);
    this.policyContainer.cspList.initializeDocument(this);
  }

  /** Record the referrer selected by the request that created this document. */
  // Response-referrer steps extracted from document creation.
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#create-and-initialize-a-document-object
  initializeReferrer(request: FetchRequest | null): void {
    if (request === null) return;
    if (request.referrer === undefined) throw new InternalError('Navigation request referrer has not been resolved');
    this.referrer = request.referrer === null ? '' : serializeURL(request.referrer);
  }

  /** Reset document-loading milestones around the selected navigation start. */
  initializeLoadTimingInfo(navigationStartTime: DOMHighResTimeStamp): void {
    this.loadTimingInfo = {
      navigationStartTime, domInteractiveTime: 0, domContentLoadedEventStartTime: 0,
      domContentLoadedEventEndTime: 0, domCompleteTime: 0, loadEventStartTime: 0, loadEventEndTime: 0,
    };
  }

  /** Retain navigation timing inputs for this document. */
  // https://w3c.github.io/navigation-timing/#dfn-create-the-navigation-timing-entry
  createNavigationTimingEntry(navigationParams: NavigationParams): void {
    const controller = navigationParams.fetchController;
    if (controller === null) return;
    // PROVISIONAL(Navigation Timing): retain live inputs without exposing a
    // PerformanceNavigationTiming object before its Timeline foundation exists.
    this.navigationTimingEntry = {
      type: navigationParams.navigationTimingType,
      fetchTimingInfo: controller.extractFullTimingInfo(),
      bodyInfo: navigationParams.response.bodyInfo,
      documentTimingInfo: this.loadTimingInfo,
      responseStatus: navigationParams.response.status,
    };
  }

  /** Wait until navigation permits scripts in the newly created document. */
  // https://html.spec.whatwg.org/#scripts-may-run-for-the-newly-created-document
  waitForScriptsMayRun(): InternalPromise<void> {
    // PROVISIONAL(HTML navigation): current callers commit synchronously before
    // parser tasks run. Full navigation must supply its script-readiness gate.
    return this.env.InternalPromise.try(() => {}, idlType.undefined);
  }

  /** Process response Link fields for the selected document-loading phase. */
  // https://html.spec.whatwg.org/multipage/links.html#process-link-headers
  processLinkHeaders(_response: FetchResponse, _phase: 'pre-media' | 'media'): void {
    // PROVISIONAL(HTML Link): preload/link processing and media selection are
    // not implemented. Both loader phases reach this owner without side effects.
  }

  /** Select the preferred stylesheet set from Default-Style fields in response order. */
  // Implementation helper for CSSOM's response-header requirement.
  // https://drafts.csswg.org/cssom/#the-http-default-style-header
  // SPEC_CLASH(default-style-response-fields): Follow CSSOM's ordered fields; Chromium/WebKit ignore them and Firefox combines duplicates.
  processDefaultStyleHeaders(response: FetchResponse): void {
    for (const [name, value] of response.headerList) {
      if (asciiLower(name) === 'default-style') this.getStyleScope().changePreferredStyleSheetSetName(value);
    }
  }

  /** Load CSSOM's stylesheet Link relations once, independently of HTML's preload/header phases. */
  // https://drafts.csswg.org/cssom/#requirements-on-user-agents-implementing-the-http-link-header
  // SPEC_CLASH(http-link-stylesheets): Follow CSSOM and Firefox; Chromium/WebKit ignore stylesheet Link headers.
  processStyleSheetLinkHeaders(response: FetchResponse): void {
    // Retain header order even when requests complete in the opposite order.
    const sheets: (CSSStyleSheetImpl | null)[] = [];
    for (const [name, value] of response.headerList) {
      if (asciiLower(name) !== 'link') continue;
      for (const { href, parameters } of parseLinkHeader(value)) {
        const relations = asciiLower(parameters.get('rel') ?? '').split(/ +/);
        if (!relations.includes('stylesheet')) continue;
        // RFC 8288 §3.2 permits ignoring anchored links; they need not describe this document.
        if (parameters.has('anchor')) continue;
        const title = parameters.get('title') ?? '';
        const alternate = relations.includes('alternate');
        if (alternate && title === '') continue;
        const url = this.env.parseURL(href, this.getBaseURL());
        if (url === null) continue;
        const index = sheets.length;
        sheets.push(null);
        // SPEC_GAP(http-link-quirks-mode): CSSOM leaves early-header timing open; MIME checks use the document mode at response completion.
        this.fetchCSSStyleSheet(url, this.url, { initiatorType: 'link' }, (response, bytes) => {
          if (bytes === null) return;
          const sheet = this.createFetchedStyleSheet(url, response, bytes, {
            ownerNode: null, title, alternate, media: parameters.get('media') ?? '',
          });
          sheets[index] = sheet;
          let insertionIndex = 0;
          for (let i = 0; i < index; i++) if (sheets[i] !== null) insertionIndex++;
          this.getStyleScope().addHeaderStyleSheet(sheet, insertionIndex);
          // TODO(HTML stylesheet resources): Register the pending load before
          // fetching and release it after critical resources complete. Document's
          // addScriptBlockingStyleSheet()/removeScriptBlockingStyleSheet() hold
          // elements; header loads need ownership in that resource-lifecycle review.
          // Start loadStyleSheetImports() here when this owner tracks load completion.
        });
      }
    }
  }

  /** Retain the response's status, modification time, and fallback language. */
  // Implementation helper collecting response-derived Document state.
  initializeResponseMetadata(response: FetchResponse): void {
    this.httpStatus = response.status;
    // https://html.spec.whatwg.org/multipage/dom.html#dom-document-lastmodified
    const lastModified = response.headerList.get('Last-Modified');
    this.lastModificationTime = lastModified === null ? undefined : parseHTTPDate(lastModified, Date.now()) ?? undefined;
    // TODO(file loading): supply filesystem modification times when local-file navigation exists.
    // https://html.spec.whatwg.org/multipage/dom.html#the-lang-and-xml:lang-attributes
    const languages = response.headerList.getDecodeAndSplit('Content-Language');
    // SPEC_CLASH(language-protocol-fallback): Use the first language like Chromium/WebKit; HTML says unknown and Firefox matches all.
    this.contentLanguage = languages?.find((language) => language !== '') ?? '';
  }

  /** Parse against this Document's base URL using UTF-8; return null on failure. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#parse-a-url
  parseHTMLURL(input: string): URLRecord | null {
    return this.env.parseURL(input, this.getBaseURL());
  }

  /** Parse against this Document's base URL and encoding, including when it is detached. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#encoding-parsing-a-url
  encodingParseURL(input: string): URLRecord | null {
    return this.env.parseURL(input, this.getBaseURL(), this.encoding);
  }

  /** Encoding-parse and serialize a URL, preserving parse failure as null. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#encoding-parsing-and-serializing-a-url
  encodingParseAndSerializeURL(input: string): string | null {
    const url = this.encodingParseURL(input);
    return url === null ? null : serializeURL(url);
  }

  /** Read the retained first base's URL, or the fallback, without traversing the tree. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#document-base-url
  getBaseURL(): URLRecord {
    return this.#firstBaseElement === null ? this.getFallbackBaseURL() : this.#firstBaseElement.frozenBaseURL;
  }

  /** The base for resolving a base element's own href, or URLs without a base element. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#fallback-base-url
  getFallbackBaseURL(): URLRecord {
    if (this.isIframeSrcdocDocument) {
      if (this.aboutBaseURL === null) throw new InternalError('A srcdoc document must have an about base URL');
      return this.aboutBaseURL;
    }
    const url = this.url;
    if (
      this.aboutBaseURL !== null && url.scheme === 'about' && url.path === 'blank' &&
      url.username === '' && url.password === '' && url.host === null
    ) {
      return this.aboutBaseURL;
    }
    return url;
  }

  /** Change the document URL, then update consumers of its base URL. */
  // Initial construction and cloning assign URL state directly; live changes use this operation.
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#set-the-url
  setURL(url: URLRecord): void {
    this.url = url;
    this.respondToBaseURLChanges();
  }

  /** Update URL-dependent state without restarting already loaded resources. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#respond-to-base-url-changes
  respondToBaseURLChanges(): void {
    this.env.userAgent.updateURLDisplays(this);
    this.updateLinkStates();

    for (
      let descendant = this.firstChild;
      descendant !== null;
      descendant = descendant.nextShadowIncludingDescendant(this)
    ) {
      if (!HTMLScriptElementImpl.is(descendant)) continue;
      const oldResult = descendant.result;
      if (!(oldResult instanceof SpeculationRulesParseResult)) continue;

      const newResult = this.createSpeculationRulesParseResult(descendant.getChildTextContent());
      // Use the script's relevant Window, which adoption need not change.
      descendant.getRelevantGlobalObject().updateSpeculationRules(oldResult, newResult);
    }

    this.considerSpeculativeLoads();
  }

  /** Refresh hyperlink state after URLs resolve against a different document base. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#respond-to-base-url-changes
  updateLinkStates(): void {
    // PROVISIONAL: visited-link history and the corresponding style invalidation are not implemented.
  }

  /** Create the result record for speculation rules parsed against this document's base URL. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#create-a-speculation-rules-parse-result
  createSpeculationRulesParseResult(input: string): SpeculationRulesParseResult {
    return new SpeculationRulesParseResult(input, this);
  }

  /** Reconsider prefetch and prerender candidates for this document. */
  // https://html.spec.whatwg.org/multipage/speculative-loading.html#consider-speculative-loads
  considerSpeculativeLoads(): void {
    // PROVISIONAL: coalesced microtasks, rule matching, candidate selection,
    // prefetch, and prerender lifecycles are not implemented.
  }

  /** Observe a deferred resource element belonging to this document, sharing one internal observer. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#start-intersection-observing-a-lazy-loading-element
  startObservingLazyLoadingElement(element: LazyLoadingElement): void {
    this.#lazyLoadIntersectionObserver ??= new IntersectionObserverImpl(
      (entries: IntersectionObserverEntryImpl[]) => this.#resumeLazyLoadingElements(entries),
      {
        root: null,
        rootMargin: [new LengthLiteral(0, 'px'), new LengthLiteral(0, 'px'), new LengthLiteral(0, 'px'), new LengthLiteral(0, 'px')],
        scrollMargin: this.env.userAgent.lazyLoadScrollMargin,
        threshold: 0,
        delay: 0,
        trackVisibility: false,
      },
      this.env,
    );
    // Use implementation methods and records, never author-replaceable constructors or getters.
    // https://github.com/w3c/IntersectionObserver/issues/464
    this.#lazyLoadIntersectionObserver.observe(element);
  }

  /** Stop observing an element in this document without discarding the shared observer. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#stop-intersection-observing-a-lazy-loading-element
  stopObservingLazyLoadingElement(element: LazyLoadingElement): void {
    if (this.#lazyLoadIntersectionObserver === null) {
      throw new InternalError('A lazy-loading element must have an intersection observer');
    }
    this.#lazyLoadIntersectionObserver.unobserve(element);
  }

  /** Recompute the controlling base element after insertion, removal, or an href change. */
  // https://html.spec.whatwg.org/multipage/semantics.html#frozen-base-url
  updateBaseElement(changedHref?: HTMLBaseElementImpl): void {
    const first = findElement(this, (element) =>
      HTMLBaseElementImpl.is(element) && element.hasAttributeNS(null, 'href')
    ) as HTMLBaseElementImpl | null;
    if (first === this.#firstBaseElement && first !== changedHref) return;
    this.#firstBaseElement = first;
    first?.setFrozenBaseURL();
  }

  /** Navigable whose active document is this one; null for inactive history entries. */
  // https://html.spec.whatwg.org/#node-navigable
  getNodeNavigable(): Navigable | null {
    const navigable = this.browsingContext?.navigable;
    return navigable?.activeDocument === this ? navigable : null;
  }

  /** Collect the current child navigables in document tree order, excluding shadow trees. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#document-tree-child-navigables
  getDocumentTreeChildNavigables(): Navigable[] {
    if (this.getNodeNavigable() === null) return [];
    const navigables: Navigable[] = [];
    for (let node = this.firstChild; node !== null; node = node.nextDescendant(this)) {
      if (
        (node instanceof HTMLIFrameElementImpl || node instanceof HTMLObjectElementImpl ||
          node instanceof HTMLFrameElementImpl) && node.contentNavigable !== null
      ) navigables.push(node.contentNavigable);
    }
    return navigables;
  }

  /** Whether this document is active throughout its navigable ancestry. */
  // https://html.spec.whatwg.org/#fully-active
  isFullyActive(): boolean {
    const navigable = this.getNodeNavigable();
    if (navigable === null) return false;
    if (navigable.isTopLevelTraversable) return true;

    return navigable.containerDocument?.isFullyActive() ?? false;
  }

  /** Whether this Document may use a policy-controlled feature. */
  // https://html.spec.whatwg.org/multipage/iframe-embed-object.html#allowed-to-use
  isAllowedToUse(feature: string): boolean {
    if (this.browsingContext === null || !this.isFullyActive()) return false;
    // TODO(Permissions Policy): Evaluate feature enablement for this Document and its origin using permissionsPolicy.
    // Permissions Policy §9.10: https://w3c.github.io/webappsec-permissions-policy/#is-feature-enabled
    throw new InternalError(`Permissions Policy evaluation for ${feature} is not implemented`);
  }

  /** Subscribe to activity changes and return an unsubscribe function. */
  observeFullyActiveState(observer: FullyActiveStateObserver): () => void {
    this.#fullyActiveObservers.add(observer);
    return () => { this.#fullyActiveObservers.delete(observer); };
  }

  /** Notify internal subscribers after navigation or lifecycle state changes. */
  notifyFullyActiveStateChanged(): void {
    const fullyActive = this.isFullyActive();
    for (const observer of this.#fullyActiveObservers) {
      observer(fullyActive);
    }
  }

  /** Prevent restoration from history and retain the reason for that decision. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#make-document-unsalvageable
  makeUnsalvageable(reason: string): void {
    this.bfcacheBlockingDetails.add({ reason });
    this.salvageable = false;
  }

  /** Copy the selected restrictions into the document's existing flag set. */
  setActiveSandboxingFlagSet(sandboxingFlagSet: ReadonlySet<SandboxingFlag>): void {
    this.activeSandboxingFlagSet.clear();
    for (const flag of sandboxingFlagSet) {
      this.activeSandboxingFlagSet.add(flag);
    }
  }

  /** Propagate events to the relevant Window, except for load events. */
  // https://dom.spec.whatwg.org/#interface-document
  override getEventParent(event: EventImpl): EventTargetImpl | null {
    if (event.type === 'load' || this.browsingContext === null) {
      return null;
    }

    const window = this.getRelevantGlobalObject();
    if (window === null) {
      throw new InternalError(
        'A Document with a browsing context needs a relevant global object',
      );
    }
    return window;
  }

  /** Window of the construction realm, independent of which document is currently active. */
  getRelevantGlobalObject(): WindowImpl | null {
    const { realm } = this.env;
    return realm.isWindow() ? realm.windowImplementation : null;
  }

  /** Initialize or retrieve the style engine owned by this document. */
  getStyleEngine(): Stylelet {
    return this.#stylelet ??= new Stylelet(this.getStyleScope());
  }

  /** Initialize or retrieve the style scope for this document's tree. */
  getStyleScope(): TreeScope {
    return this.#styleScope ??= new TreeScope(this, new StyleletContext(this, this.env));
  }

  /** Fetch a CSS resource, reporting its outcome and delivering null bytes on rejection or failure. */
  // https://drafts.csswg.org/cssom/#fetch-a-css-style-sheet
  // SPEC_MISMATCH: fetch a CSS style sheet(parsed URL, referrer, document, request parameters, processTheResponse)
  // Fetch's consume-body callback provides the bytes after EOF and observes body
  // failures. Returning the controller permits the owning algorithm to stop it.
  fetchCSSStyleSheet(
    url: URLRecord, referrer: URLRecord,
    parameters: Partial<FetchRequest>,
    processTheResponse: (response: FetchResponse, bytes: Uint8Array | null, outcome: StyleSheetFetchOutcome) => void,
  ): FetchController {
    const env = this.env;
    const request = new FetchRequest(url, env);
    request.client = env;
    request.origin = this.origin;
    request.referrer = referrer;
    request.destination = 'style';
    request.policyContainer = this.policyContainer;
    Object.assign(request, parameters);
    const controller: FetchController = fetch(request, {
      processResponseConsumeBody: (response, body) => {
        if (controller.state !== 'ongoing' || response.type === 'error' || body === 'failure') {
          processTheResponse(response, null, 'failure');
          return;
        }
        const internalResponse = isFilteredResponse(response) ? response.internalResponse : response;
        // SPEC_CLASH(stylesheet-http-status): Follow all three browsers; CSSOM omits the successful-status check.
        if (!isOkStatus(internalResponse.status)) {
          processTheResponse(response, null, 'http-error');
          return;
        }
        let mimeType = internalResponse.headerList.extractMIMEType();
        const supported = mimeType !== null && getMIMETypeEssence(mimeType) === 'text/css';
        if (!supported && this.compatMode !== 'CSS1Compat' && response.type !== 'opaque') {
          internalResponse.headerList.set('Content-Type', 'text/css');
          mimeType = internalResponse.headerList.extractMIMEType();
        }
        if (mimeType === null || getMIMETypeEssence(mimeType) !== 'text/css') {
          processTheResponse(response, null, 'failure');
          return;
        }
        processTheResponse(response, body ?? new Uint8Array(), 'success');
      },
    }, env);
    return controller;
  }

  /** Decode accepted bytes and create the CSS implementation; its owner performs association. */
  // https://drafts.csswg.org/cssom/#create-a-css-style-sheet
  // https://drafts.csswg.org/css-syntax-3/#input-byte-stream
  createFetchedStyleSheet(
    url: URLRecord, response: FetchResponse, bytes: Uint8Array,
    options: FetchedStyleSheetOptions,
  ): CSSStyleSheetImpl {
    const env = this.env;
    const internalResponse = isFilteredResponse(response) ? response.internalResponse : response;
    const mimeType = internalResponse.headerList.extractMIMEType();
    const encoding = getStylesheetEncoding(bytes, {
      transportEncoding: mimeType?.parameters.get('charset'),
      environmentEncoding: options.encoding ?? getEncoding(this.encoding) ?? 'UTF-8',
    });
    const source = decode(bytes, encoding);
    const sheet = new CSSStyleSheetImpl({
      location: copyURL(url),
      baseURL: copyURL(internalResponse.url ?? url),
      encoding,
      referrerPolicy: parseReferrerPolicyFromHeader(internalResponse),
      ownerNode: options.ownerNode,
      parentStyleSheet: null,
      ownerRule: null,
      media: options.media,
      title: options.title,
      alternate: options.alternate,
      originClean: response.type !== 'opaque',
    }, env);
    // Parsing does not fetch imports. The owner explicitly starts loadStyleSheetImports()
    // and waits for its completion before reporting success or releasing blockers.
    sheet.replaceRules(parseStylesheetContents(source, new RuleListContext(sheet.ruleList, null, false, env)));
    return sheet;
  }

  /** Connect an explicit import load to Fetch; HTML supplies current request settings and consumes completion. */
  loadStyleSheetImports(
    sheet: CSSStyleSheetImpl,
    parameters: (parent: CSSStyleSheetImpl) => Partial<FetchRequest>, complete: (success: boolean) => void,
    started?: (load: StyleSheetLoad) => void,
  ): StyleSheetLoad {
    return sheet.loadImports((url, rule, loaded) => {
      const parent = rule.parentStyleSheet!;
      if (parent.encoding === undefined) throw new InternalError('Import loading requires the parent stylesheet encoding');
      // https://w3c.github.io/webappsec-referrer-policy/#integration-with-css
      const referrer = parent.location === null
        ? this.url : parent.baseURL ?? parent.location;
      const requestParameters: Partial<FetchRequest> = {
        // SPEC_CLASH(stylesheet-referrer-policy): Like Firefox, use the external sheet's own default when no valid header exists.
        referrerPolicy: parent.location === null
          ? this.policyContainer.referrerPolicy : parent.referrerPolicy || 'strict-origin-when-cross-origin',
        ...parameters(parent), initiatorType: 'css',
      };
      rule.url.applyRequestModifiers(requestParameters);
      const controller = this.fetchCSSStyleSheet(url, referrer, requestParameters, (response, bytes, outcome) => {
        // Failed HTTP imports retain an empty sheet; their response CSS must not be applied.
        loaded(outcome === 'failure' ? null : this.createFetchedStyleSheet(url, response, bytes ?? new Uint8Array(), {
          ownerNode: null, media: '', title: '', alternate: false, encoding: parent.encoding,
        }), outcome === 'success');
      });
      return () => controller.terminate();
    }, complete, started);
  }

  /** Temporarily route document.write() to a parser while the callback runs. */
  withWriter<T>(writer: DocumentWriter, callback: () => T): T {
    const previousWriter = this.#writer;
    this.#writer = writer;

    try {
      return callback();
    } finally {
      this.#writer = previousWriter;
    }
  }

  /** Allocate the registered element implementation for a namespace and local name. */
  createElementNode(
    localName: string, namespaceURI: string, prefix: string | null = null,
    isValue: string | null = null, registry: CustomElementRegistryImpl | null = this.customElementRegistry,
  ): ElementImpl {
    const implementation = getElementConstructor(namespaceURI, localName);
    const element = this.env.constructNode<ElementImpl>(
      implementation,
      [{
        document: this,
        localName,
        namespaceURI,
        prefix,
      }, this.env],
    );
    element.isValue = isValue;
    element.customElementRegistry = registry;
    // PROVISIONAL(custom elements): definition lookup and construction reactions remain with that subsystem.
    return element;
  }

  // https://dom.spec.whatwg.org/#dom-document-createdocumentfragment
  createDocumentFragment(): DocumentFragmentImpl {
    return this.env.constructNode(DocumentFragmentImpl, [this]);
  }

  /** Allocate a shadow root in this document's realm, including for an adopted host. */
  // https://dom.spec.whatwg.org/#concept-node-create
  // SPEC_CLASH(adopted-shadow-root-realm): follow DOM and Firefox; Chromium/WebKit use the host's original realm.
  createShadowRoot(host: ElementImpl, mode: ShadowRootMode): ShadowRootImpl {
    return this.env.constructNode(ShadowRootImpl, [host, mode]);
  }

  /** Allocate an attribute from an already selected name, namespace, and value. */
  createAttributeNode(
    localName: string,
    value: string,
    namespaceURI: string | null,
    prefix: string | null,
  ): AttrImpl {
    return this.env.constructNode(AttrImpl, [
      localName,
      value,
      namespaceURI,
      prefix,
      this,
      this.env,
    ]);
  }

  /** Allocate a doctype associated with this document. */
  createDocumentType(
    name: string,
    publicId: string,
    systemId: string,
  ): DocumentTypeImpl {
    return this.env.constructNode(
      DocumentTypeImpl,
      [name, publicId, systemId, this, this.env],
    );
  }

  /** Register a sheet owner that delays script execution. */
  addScriptBlockingStyleSheet(ownerNode: ElementImpl): void {
    this.#scriptBlockingStyleSheets.add(ownerNode);
  }

  /** Release a sheet owner and wake waiters when the blocking set becomes empty. */
  removeScriptBlockingStyleSheet(ownerNode: ElementImpl): void {
    if (!this.#scriptBlockingStyleSheets.delete(ownerNode)) return;
    if (this.#scriptBlockingStyleSheets.size > 0) return;

    const ready = this.#scriptBlockingStyleSheetsReady;
    this.#scriptBlockingStyleSheetsReady = null;
    ready?.resolve(undefined);
  }

  hasScriptBlockingStyleSheets(): boolean {
    return this.#scriptBlockingStyleSheets.size > 0;
  }

  /** Wait for the blocking set to empty, rechecking for sheets added before resumption. */
  waitForScriptBlockingStyleSheets(): InternalPromise<void> {
    const { env } = this;
    return env.InternalPromise.try(() => {
      if (this.#scriptBlockingStyleSheets.size === 0) return;
      const ready = this.#scriptBlockingStyleSheetsReady ??=
        env.InternalPromise.withResolvers(idlType.undefined);
      return ready.promise.then(() =>
        this.waitForScriptBlockingStyleSheets(),
      );
    }, idlType.undefined);
  }

  // https://html.spec.whatwg.org/multipage/dom.html#the-document-object
  protected override cloningSteps(copy: DocumentImpl, subtree: boolean): void {
    super.cloningSteps(copy, subtree);
    copy.aboutBaseURL = this.aboutBaseURL;
  }

  /** Update PI participation when a mutation changes which children precede the root. */
  protected override childrenChanged(): void {
    this.#updateStyleSheetProlog();
  }

  /** Root moves can change prolog membership without DOM children-changed steps. */
  protected override childrenMoved(): void {
    this.#updateStyleSheetProlog();
  }

  /** Classify document children once, including instructions that have left the prolog. */
  #updateStyleSheetProlog(): void {
    let inProlog = true;
    for (let child = this.firstChild; child; child = child.nextSibling) {
      if (child.isElement()) inProlog = false;
      else if (child.isProcessingInstruction()) child.setInProlog(inProlog);
    }
  }

  #getSVGTitle(root: SVGSVGElementImpl): SVGTitleElementImpl | null {
    for (let child = root.firstChild; child; child = child.nextSibling) {
      if (SVGTitleElementImpl.is(child)) return child;
    }
    return null;
  }

  /** Collect the parent's retained ancestry, masking the origins withheld by iframe policy. */
  // https://html.spec.whatwg.org/multipage/dom.html#internal-ancestor-origin-objects-list-creation-steps
  #createAncestorOriginObjects(referrerPolicy: ReferrerPolicy, parentDocument: DocumentImpl | null): Origin[] {
    const output: Origin[] = [];
    if (parentDocument === null) return output;

    // Assert: the parent document is fully active and its ancestry was initialized.
    const ancestorOrigins = parentDocument.internalAncestorOriginObjectsList;
    if (ancestorOrigins === null) throw new InternalError('Parent Document ancestry has not been initialized');
    // The specification also reads the navigable's container here, but never uses that local.
    // SPEC_CLASH(ancestor-origin-policy-masking): follow HTML's masking, also implemented by Gecko; Blink and WebKit expose the unmasked origins.
    let masked = referrerPolicy === 'no-referrer' ||
      (referrerPolicy === 'same-origin' && !areSameOrigin(parentDocument.origin, this.origin));
    output.push(masked ? createOpaqueOrigin() : parentDocument.origin);

    for (const origin of ancestorOrigins) {
      if (masked && areSameOrigin(origin, parentDocument.origin)) {
        output.push(createOpaqueOrigin());
        continue;
      }
      output.push(origin);
      masked = false;
    }
    return output;
  }

  /** Resume intersecting resources using the observer's internal, unprojected entries. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#start-intersection-observing-a-lazy-loading-element
  #resumeLazyLoadingElements(entries: IntersectionObserverEntryImpl[]): void {
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!;
      if (!entry.isIntersecting) continue;
      // Only lazy-loading elements are registered with this private observer.
      const element = entry.target as LazyLoadingElement;
      const video = HTMLVideoElementImpl.is(element) ? element : null;
      const steps = element.lazyLoadResumptionSteps;
      const posterSteps = video === null ? null : video.posterLazyLoadResumptionSteps;
      if (steps === null && posterSteps === null) continue;
      element.nodeDocument.stopObservingLazyLoadingElement(element);
      if (steps !== null) {
        element.lazyLoadResumptionSteps = null;
        steps();
      }
      if (posterSteps !== null) {
        video!.posterLazyLoadResumptionSteps = null;
        posterSteps();
      }
    }
  }

  #extractElementCreationOptions(
    options: string | ElementCreationOptions,
  ): [CustomElementRegistryImpl | null, string | null] {
    let registry = this.customElementRegistry;
    let isValue: string | null = null;
    if (typeof options !== 'string') {
      if (options.customElementRegistry !== undefined) registry = options.customElementRegistry;
      isValue = options.is ?? null;
      this.#validateRegistry(registry);
    }
    return [registry, isValue];
  }

  #validateRegistry(registry: CustomElementRegistryImpl | null): void {
    if (registry !== null && !registry.isScoped && registry !== this.customElementRegistry) {
      throw new DOMExceptionImpl('', DOMExceptionNames.notSupported);
    }
  }
}

// Supported entries in DOM's legacy createEvent table.
const legacyEventConstructors = new Map([
  ['event', EventImpl], ['events', EventImpl], ['htmlevents', EventImpl],
  ['customevent', CustomEventImpl], ['messageevent', MessageEventImpl],
]);

/*
 * [Exposed=Window]
 * interface Document : Node {
 *   constructor();
 *
 *   [SameObject] readonly attribute DOMImplementation implementation;
 *   readonly attribute USVString URL;
 *   readonly attribute USVString documentURI;
 *   readonly attribute DOMString compatMode;
 *   readonly attribute DOMString characterSet;
 *   readonly attribute DOMString charset; // legacy alias of .characterSet
 *   readonly attribute DOMString inputEncoding; // legacy alias of .characterSet
 *   readonly attribute DOMString contentType;
 *
 *   readonly attribute DocumentType? doctype;
 *   readonly attribute Element? documentElement;
 *   HTMLCollection getElementsByTagName(DOMString qualifiedName);
 *   HTMLCollection getElementsByTagNameNS(DOMString? namespace, DOMString localName);
 *   HTMLCollection getElementsByClassName(DOMString classNames);
 *
 *   [CEReactions, NewObject] Element createElement(DOMString localName, optional (DOMString or ElementCreationOptions) options = {});
 *   [CEReactions, NewObject] Element createElementNS(DOMString? namespace, DOMString qualifiedName, optional (DOMString or ElementCreationOptions) options = {});
 *   [NewObject] DocumentFragment createDocumentFragment();
 *   [NewObject] Text createTextNode(DOMString data);
 *   [NewObject] CDATASection createCDATASection(DOMString data);
 *   [NewObject] Comment createComment(DOMString data);
 *   [NewObject] ProcessingInstruction createProcessingInstruction(DOMString target, DOMString data);
 *
 *   [CEReactions, NewObject] Node importNode(Node node, optional (boolean or ImportNodeOptions) options = false);
 *   [CEReactions] Node adoptNode(Node node);
 *
 *   [NewObject] Attr createAttribute(DOMString localName);
 *   [NewObject] Attr createAttributeNS(DOMString? namespace, DOMString qualifiedName);
 *
 *   [NewObject] Event createEvent(DOMString interface); // legacy
 *
 *   [NewObject] Range createRange();
 *
 *   // NodeFilter.SHOW_ALL = 0xFFFFFFFF
 *   [NewObject] NodeIterator createNodeIterator(Node root, optional unsigned long whatToShow = 0xFFFFFFFF, optional NodeFilter? filter = null);
 *   [NewObject] TreeWalker createTreeWalker(Node root, optional unsigned long whatToShow = 0xFFFFFFFF, optional NodeFilter? filter = null);
 * };
 */
export const documentIDL = defineInterface<BrowletEnvironment>({
  name: 'Document',
  inherits: 'Node',
  exposed: 'Window',
  // HTML's constructor alias: https://html.spec.whatwg.org/multipage/nav-history-apis.html#htmldocument
  ...xattr(['LegacyWindowAlias', 'HTMLDocument']),
  implementation: impl(DocumentImpl, {
    constructWith: [atArg(0, (env) => env)],
  }),
  members: [
    ctor(),
    roAttr('implementation', reference('DOMImplementation'), xattr('SameObject')),
    roAttr('URL', idlType.USVString),
    roAttr('documentURI', idlType.USVString),
    roAttr('compatMode', idlType.DOMString),
    roAttr('characterSet', idlType.DOMString),
    roAttr('charset', idlType.DOMString),
    roAttr('inputEncoding', idlType.DOMString),
    roAttr('contentType', idlType.DOMString),
    roAttr('doctype', nullable(reference('DocumentType'))),
    roAttr('documentElement', nullable(reference('Element'))),
    op('getElementsByTagName', reference('HTMLCollection'), [
      arg('qualifiedName', idlType.DOMString),
    ]),
    op('getElementsByTagNameNS', reference('HTMLCollection'), [
      arg('namespace', nullable(idlType.DOMString)),
      arg('localName', idlType.DOMString),
    ]),
    op('getElementsByClassName', reference('HTMLCollection'), [
      arg('classNames', idlType.DOMString),
    ]),
    op('createElement', reference('Element'),
      [
        arg('localName', idlType.DOMString),
        arg('options', union(idlType.DOMString, reference('ElementCreationOptions')),
          { default: emptyDictionary, optional: true },
        ),
      ],
      xattr('CEReactions', 'NewObject'),
    ),
    op('createElementNS', reference('Element'),
      [
        arg('namespace', nullable(idlType.DOMString)), arg('qualifiedName', idlType.DOMString),
        arg('options', union(idlType.DOMString, reference('ElementCreationOptions')),
          { default: emptyDictionary, optional: true },
        ),
      ],
      xattr('CEReactions', 'NewObject'),
    ),
    op('createDocumentFragment', reference('DocumentFragment'), [], xattr('NewObject')),
    op('createTextNode', reference('Text'), [arg('data', idlType.DOMString)], xattr('NewObject')),
    op('createCDATASection', reference('CDATASection'),
      [arg('data', idlType.DOMString)], xattr('NewObject'),
    ),
    op('createComment', reference('Comment'), [arg('data', idlType.DOMString)], xattr('NewObject')),
    op('createProcessingInstruction', reference('ProcessingInstruction'),
      [arg('target', idlType.DOMString), arg('data', idlType.DOMString)], xattr('NewObject'),
    ),
    op('importNode', reference('Node'),
      [
        arg('node', reference('Node')),
        arg('options', union(idlType.boolean, reference('ImportNodeOptions')), { default: false, optional: true }),
      ],
      xattr('CEReactions', 'NewObject'),
    ),
    op('adoptNode', reference('Node'), [arg('node', reference('Node'))], xattr('CEReactions')),
    op('createAttribute', reference('Attr'), [arg('localName', idlType.DOMString)], xattr('NewObject')),
    op('createAttributeNS', reference('Attr'),
      [arg('namespace', nullable(idlType.DOMString)), arg('qualifiedName', idlType.DOMString)],
      xattr('NewObject'),
    ),
    op('createEvent', reference('Event'), [arg('interface', idlType.DOMString)], xattr('NewObject')),
    op('createRange', reference('Range'), [], xattr('NewObject')),
    op('createNodeIterator', reference('NodeIterator'),
      [
        arg('root', reference('Node')),
        arg('whatToShow', idlType.unsignedLong, { default: integer(SHOW_ALL), optional: true }),
        arg('filter', nullable(reference('NodeFilter')), { default: null, optional: true }),
      ],
      xattr('NewObject'),
    ),
    op('createTreeWalker', reference('TreeWalker'),
      [
        arg('root', reference('Node')),
        arg('whatToShow', idlType.unsignedLong, { default: integer(SHOW_ALL), optional: true }),
        arg('filter', nullable(reference('NodeFilter')), { default: null, optional: true }),
      ],
      xattr('NewObject'),
    ),
  ],
});

/** Loading stage exposed by the document's readyState attribute. */
export type DocumentReadyState = 'loading' | 'interactive' | 'complete';

/*
 * enum DocumentReadyState { "loading", "interactive", "complete" };
 */
export const documentReadyStateIDL = defineEnumeration({
  name: 'DocumentReadyState',
  values: ['loading', 'interactive', 'complete'] satisfies DocumentReadyState[],
});

/** Visibility reported for a document or its traversable. */
// https://html.spec.whatwg.org/multipage/interaction.html#document-visibility
export type DocumentVisibilityState = 'hidden' | 'visible';

/*
 * enum DocumentVisibilityState { "visible", "hidden" };
 */
export const documentVisibilityStateIDL = defineEnumeration({
  name: 'DocumentVisibilityState',
  values: ['visible', 'hidden'] satisfies DocumentVisibilityState[],
});

/*
 * typedef (HTMLScriptElement or SVGScriptElement) HTMLOrSVGScriptElement;
 */
export const htmlOrSVGScriptElementIDL = defineTypedef({
  name: 'HTMLOrSVGScriptElement',
  type: union(reference('HTMLScriptElement'), reference('SVGScriptElement')),
});

/*
 * [LegacyOverrideBuiltIns]
 * partial interface Document {
 *   static Document parseHTMLUnsafe((TrustedHTML or DOMString) html,
 *                                  optional (ParseHTMLUnsafeOptions or TrustedHTMLParserOptions) options = {});
 *   static Document parseHTML(DOMString html, optional SetHTMLOptions options = {});
 *
 *   // resource metadata management
 *   [PutForwards=href, LegacyUnforgeable] readonly attribute Location? location;
 *   attribute USVString domain;
 *   readonly attribute USVString referrer;
 *   attribute USVString cookie;
 *   readonly attribute DOMString lastModified;
 *   readonly attribute DocumentReadyState readyState;
 *
 *   // DOM tree accessors
 *   getter object (DOMString name);
 *   [CEReactions] attribute DOMString title;
 *   [CEReactions] attribute DOMString dir;
 *   [CEReactions] attribute HTMLElement? body;
 *   readonly attribute HTMLHeadElement? head;
 *   [SameObject] readonly attribute HTMLCollection images;
 *   [SameObject] readonly attribute HTMLCollection embeds;
 *   [SameObject] readonly attribute HTMLCollection plugins;
 *   [SameObject] readonly attribute HTMLCollection links;
 *   [SameObject] readonly attribute HTMLCollection forms;
 *   [SameObject] readonly attribute HTMLCollection scripts;
 *   NodeList getElementsByName(DOMString elementName);
 *   readonly attribute HTMLOrSVGScriptElement? currentScript; // classic scripts in a document tree only
 *
 *   // dynamic markup insertion
 *   [CEReactions] Document open(optional DOMString unused1, optional DOMString unused2); // both arguments are ignored
 *   WindowProxy? open(USVString url, DOMString name, DOMString features);
 *   [CEReactions] undefined close();
 *   [CEReactions] undefined write((TrustedHTML or DOMString)... text);
 *   [CEReactions] undefined writeln((TrustedHTML or DOMString)... text);
 *
 *   // user interaction
 *   readonly attribute WindowProxy? defaultView;
 *   boolean hasFocus();
 *   [CEReactions] attribute DOMString designMode;
 *   [CEReactions] boolean execCommand(DOMString commandId, optional boolean showUI = false, optional DOMString value = "");
 *   boolean queryCommandEnabled(DOMString commandId);
 *   boolean queryCommandIndeterm(DOMString commandId);
 *   boolean queryCommandState(DOMString commandId);
 *   boolean queryCommandSupported(DOMString commandId);
 *   DOMString queryCommandValue(DOMString commandId);
 *   readonly attribute boolean hidden;
 *   readonly attribute DocumentVisibilityState visibilityState;
 *
 *   // special event handler IDL attributes that only apply to Document objects
 *   [LegacyLenientThis] attribute EventHandler onreadystatechange;
 *   attribute EventHandler onvisibilitychange;
 *
 *   // obsolete members (HTML §16.2)
 *   [SameObject] readonly attribute HTMLAllCollection all;
 * };
 * Document includes GlobalEventHandlers;
 */
export const htmlDocumentIDL = definePartialInterface({
  name: 'Document',
  ...xattr('LegacyOverrideBuiltIns'),
  // The complete member/dependency inventory is in html/ROADMAP.md#section-311-document-state-and-declarations.
  members: [
    // TODO(HTML §§8.5–8.6): parseHTMLUnsafe and parseHTML need parser/sanitizer option types and algorithms.
    // TODO(HTML §7.2): location needs relevant-document navigation/security algorithms.
    attr('domain', idlType.USVString),
    roAttr('referrer', idlType.USVString),
    attr('cookie', idlType.USVString),
    roAttr('lastModified', idlType.DOMString),
    roAttr('readyState', reference('DocumentReadyState')),

    {
      kind: 'named-getter', method: 'getNamedProperty',
      returns: union(reference('Element'), reference('HTMLCollection'), reference('WindowProxy')),
      serializedType: idlType.object,
    },
    attr('title', idlType.DOMString, xattr('CEReactions')),
    attr('dir', idlType.DOMString, xattr('CEReactions')),
    attr('body', nullable(reference('HTMLElement')), xattr('CEReactions')),
    roAttr('head', nullable(reference('HTMLHeadElement'))),
    roAttr('images', reference('HTMLCollection'), xattr('SameObject')),
    roAttr('embeds', reference('HTMLCollection'), xattr('SameObject')),
    roAttr('plugins', reference('HTMLCollection'), xattr('SameObject')),
    roAttr('links', reference('HTMLCollection'), xattr('SameObject')),
    roAttr('forms', reference('HTMLCollection'), xattr('SameObject')),
    roAttr('scripts', reference('HTMLCollection'), xattr('SameObject')),
    op('getElementsByName', reference('NodeList'), [arg('elementName', idlType.DOMString)]),
    roAttr('currentScript', nullable(reference('HTMLOrSVGScriptElement'))),

    // TODO(HTML §8.4): open, close, and writeln; complete write's TrustedHTML conversion and insertion steps.
    op('write', idlType.undefined, [
      arg('text', idlType.DOMString, { variadic: true }),
    ]),
    roAttr('defaultView', nullable(reference('WindowProxy'))),
    // TODO(HTML §6): hasFocus, designMode, editing commands, hidden, and visibilityState.
    attr('onreadystatechange', reference('EventHandler'), {
      ...xattr('LegacyLenientThis'), ...onError('report'),
    }),
    // TODO(HTML §§6, 8.1): onvisibilitychange and GlobalEventHandlers.

    // Without native [[IsHTMLDDA]], omit the API instead of exposing a truthy substitute.
    // https://html.spec.whatwg.org/#dom-document-all
    roAttr('all', reference('HTMLAllCollection'), {
      ...xattr('SameObject'), enabled: addon.supportsHTMLDDA,
    }),
  ],
});

/** Converted element-creation options supported by the current declaration. */
export type ElementCreationOptions = {
  customElementRegistry?: CustomElementRegistryImpl | null;
  is?: string;
};

/*
 * dictionary ElementCreationOptions {
 *   CustomElementRegistry? customElementRegistry;
 *   DOMString is;
 * };
 */
export const elementCreationOptionsIDL = defineDictionary({
  name: 'ElementCreationOptions',
  members: [
    dictMember('customElementRegistry', nullable(reference('CustomElementRegistry'))),
    dictMember('is', idlType.DOMString),
  ],
});

/** Converted import options; the dictionary overload copies descendants by default. */
export type ImportNodeOptions = {
  customElementRegistry?: CustomElementRegistryImpl;
  selfOnly: boolean;
};

/*
 * dictionary ImportNodeOptions {
 *   CustomElementRegistry customElementRegistry;
 *   boolean selfOnly = false;
 * };
 */
export const importNodeOptionsIDL = defineDictionary({
  name: 'ImportNodeOptions',
  members: [
    dictMember('customElementRegistry', reference('CustomElementRegistry')),
    dictMember('selfOnly', idlType.boolean, { default: false }),
  ],
});

/** XMLDocument adds a platform interface identity to Document's existing XML behavior. */
// https://dom.spec.whatwg.org/#xmldocument
export class XMLDocumentImpl extends DocumentImpl {}

/*
 * [Exposed=Window]
 * interface XMLDocument : Document {};
 */
export const xmlDocumentIDL = defineInterface<BrowletEnvironment>({
  name: 'XMLDocument', inherits: 'Document', exposed: 'Window',
  implementation: impl(XMLDocumentImpl, {
    constructWith: [atArg(0, (env) => env)],
  }),
  members: [],
});

/*
 * Document includes ParentNode;
 */
export const documentIncludesParentNodeIDL = defineIncludes({
  interface: 'Document', mixin: parentNodeIDL.name,
});

/*
 * Document includes NonElementParentNode;
 */
export const documentIncludesNonElementParentNodeIDL = defineIncludes({
  interface: 'Document', mixin: nonElementParentNodeIDL.name,
});

/*
 * Document includes DocumentOrShadowRoot;
 */
export const documentIncludesDocumentOrShadowRootIDL = defineIncludes({
  interface: 'Document', mixin: documentOrShadowRootIDL.name,
});

/** HTTP rejection permits an empty import association; other failures do not supply a sheet. */
export type StyleSheetFetchOutcome = 'success' | 'http-error' | 'failure';

/** Association metadata captured by the initiating processing instruction or header. */
export type FetchedStyleSheetOptions = {
  ownerNode: ElementImpl | ProcessingInstructionImpl | null;
  media: string;
  title: string;
  alternate: boolean;
  encoding?: Encoding;
};

/** Active parser input used by document.write(). */
export type DocumentWriter = (markup: string) => void;

/** Selects HTML or XML rules for document operations. */
// https://dom.spec.whatwg.org/#concept-document-type
export type DocumentType = 'xml' | 'html';

/** Parser-selected compatibility mode for document and CSS behavior. */
// https://dom.spec.whatwg.org/#concept-document-mode
export enum DocumentMode {
  NoQuirks = 'no-quirks',
  Quirks = 'quirks',
  LimitedQuirks = 'limited-quirks',
}

/** Loading milestones, with zero for those not yet reached. */
// https://html.spec.whatwg.org/#document-load-timing-info
export type DocumentLoadTimingInfo = {
  /** Start of the navigation that created this document. */
  navigationStartTime: number;
  /** Transition to interactive readiness. */
  domInteractiveTime: DOMHighResTimeStamp;
  /** Start of DOMContentLoaded dispatch. */
  domContentLoadedEventStartTime: DOMHighResTimeStamp;
  /** Completion of DOMContentLoaded dispatch. */
  domContentLoadedEventEndTime: DOMHighResTimeStamp;
  /** Transition to complete readiness. */
  domCompleteTime: DOMHighResTimeStamp;
  /** Start of Window load-event dispatch. */
  loadEventStartTime: DOMHighResTimeStamp;
  /** Completion of Window load-event dispatch. */
  loadEventEndTime: DOMHighResTimeStamp;
};

/** Unload-event milestones from the preceding document, initially zero. */
// https://html.spec.whatwg.org/multipage/dom.html#document-unload-timing-info
export type DocumentUnloadTimingInfo = {
  /** Start of unload-event dispatch. */
  unloadEventStartTime: DOMHighResTimeStamp;
  /** Completion of unload-event dispatch. */
  unloadEventEndTime: DOMHighResTimeStamp;
};

type FullyActiveStateObserver = (fullyActive: boolean) => void;

/** The HTML element families that can retain a lazy-loading continuation. */
type LazyLoadingElement = HTMLImageElementImpl | HTMLIFrameElementImpl | HTMLMediaElementImpl;
