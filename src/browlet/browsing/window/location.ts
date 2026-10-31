import { InternalError } from '../../../infra/index';
import {
  arg, atArg, attr, defineInterface, DOMExceptionImpl, DOMExceptionNames, idlType, impl, invokeWith, op, reference, roAttr, xattr,
  type AttributeMember,
} from '../../../web-idl/core/index';
import {
  aboutBlankURL, areSameOriginDomain, cannotHaveUsernamePasswordPort, copyURL, hasOpaquePath,
  obtainURLOrigin, parseBasicURL, serializeHost, serializeOrigin, serializeURL, serializeURLPath,
  type URLRecord,
} from '../../../url/index';

import type { DocumentImpl } from '../../dom/nodes/index';
import type { DOMStringListImpl } from '../../dom/index';
import type { BrowletEnvironment, WindowEnvironment } from '../../environment';
import type { NavigationHistoryBehavior } from '../navigation/index';

/** Retains a Window's Location identity and reads its browsing context's active Document. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-location-interface
export class LocationImpl {
  /** Owning Window environment, retained independently of which Document is active. */
  env: WindowEnvironment;
  /** Stable empty list returned after the owning Window loses its browsing context. */
  #emptyAncestorOrigins: DOMStringListImpl;

  constructor(env: WindowEnvironment) {
    this.env = env;
    this.#emptyAncestorOrigins = env.createDOMStringList([]);
  }

  /** Active Document of the owning Window's browsing context, or null after disconnection. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#relevant-document
  get relevantDocument(): DocumentImpl | null {
    // SPEC_CLASH(location-retained-url): follow HTML's live context and null-context fallback; browsers disagree.
    return this.env.window.browsingContext?.activeDocument ?? null;
  }

  /** Current relevant-Document URL; callers preparing navigation must copy before mutation. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#concept-location-url
  get url(): URLRecord {
    return this.relevantDocument?.url ?? aboutBlankURL;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-hash
  get hash(): string {
    const fragment = this.url.fragment;
    return fragment === null || fragment === '' ? '' : `#${fragment}`;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-host
  get host(): string {
    const url = this.url;
    if (url.host === null) return '';
    const host = serializeHost(url.host);
    return url.port === null ? host : `${host}:${url.port}`;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-hostname
  get hostname(): string {
    const host = this.url.host;
    return host === null ? '' : serializeHost(host);
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-href
  get href(): string {
    return serializeURL(this.url);
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-origin
  get origin(): string {
    return serializeOrigin(obtainURLOrigin(this.url));
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-pathname
  get pathname(): string {
    return serializeURLPath(this.url);
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-port
  get port(): string {
    return this.url.port?.toString() ?? '';
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-protocol
  get protocol(): string {
    return `${this.url.scheme}:`;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-search
  get search(): string {
    const query = this.url.query;
    return query === null || query === '' ? '' : `?${query}`;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-ancestororigins
  get ancestorOrigins(): DOMStringListImpl {
    const document = this.relevantDocument;
    if (document === null) return this.#emptyAncestorOrigins;
    if (document.ancestorOriginsList === null) throw new InternalError('Document ancestor origins are not initialized');
    return document.ancestorOriginsList;
  }

  /** Check the entry origin against the live Document, independently of platform-object access checks. */
  // Common first step of Location's URL-component and ancestorOrigins getters.
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-href
  checkEntryOrigin(entryEnv: BrowletEnvironment): void {
    const document = this.relevantDocument;
    if (document !== null && !areSameOriginDomain(document.origin, entryEnv.origin)) {
      throw new DOMExceptionImpl('Entry origin cannot access the Location Document', DOMExceptionNames.security);
    }
  }

  /** Parse against the entry settings and request navigation without an additional entry-origin check. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-href
  setHref(value: string, entryEnv: BrowletEnvironment, incumbentEnv: WindowEnvironment): void {
    if (this.relevantDocument === null) return;
    const url = entryEnv.encodingParseURL(value);
    if (url === null) throw new DOMExceptionImpl('Invalid Location URL', DOMExceptionNames.syntax);
    this.#navigate(url, 'auto', incumbentEnv);
  }

  /** Parse a scheme on a copy of the current URL and navigate only HTTP(S) results. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-protocol
  setProtocol(value: string, entryEnv: BrowletEnvironment, incumbentEnv: WindowEnvironment): void {
    if (this.relevantDocument === null) return;
    this.checkEntryOrigin(entryEnv);
    const url = copyURL(this.url);
    const result = parseBasicURL(`${value}:`, { url, stateOverride: 'scheme start' });
    if (result.url === null) throw new DOMExceptionImpl('Invalid Location protocol', DOMExceptionNames.syntax);
    // SPEC_CLASH(location-protocol-navigation): follow HTML's HTTP(S) gate and navigation after a rejected transition.
    // Chromium attempts FTP navigation; Gecko reparses mailto and returns without navigating unchanged HTTPS.
    if (url.scheme !== 'http' && url.scheme !== 'https') return;
    this.#navigate(url, 'auto', incumbentEnv);
  }

  /** Parse a host and optional port without mutating the current Document URL. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-host
  setHost(value: string, entryEnv: BrowletEnvironment, incumbentEnv: WindowEnvironment): void {
    if (this.relevantDocument === null) return;
    this.checkEntryOrigin(entryEnv);
    const url = copyURL(this.url);
    if (hasOpaquePath(url)) return;
    // SPEC_CLASH(location-component-parse-failure): follow HTML; keep partial parser results and navigate despite failure.
    // For 'bad host', Chromium escapes the space; Gecko/WebKit throw.
    // An overflowing new port keeps the old port here; WebKit clears it.
    parseBasicURL(value, { url, stateOverride: 'host' });
    this.#navigate(url, 'auto', incumbentEnv);
  }

  /** Parse a hostname while preserving the current URL's port. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-hostname
  setHostname(value: string, entryEnv: BrowletEnvironment, incumbentEnv: WindowEnvironment): void {
    if (this.relevantDocument === null) return;
    this.checkEntryOrigin(entryEnv);
    const url = copyURL(this.url);
    if (hasOpaquePath(url)) return;
    // For 'other.test:1234', Chromium/Gecko throw; HTML ignores the parse failure.
    parseBasicURL(value, { url, stateOverride: 'hostname' });
    this.#navigate(url, 'auto', incumbentEnv);
  }

  /** Parse or clear a port when the current URL supports one. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-port
  setPort(value: string, entryEnv: BrowletEnvironment, incumbentEnv: WindowEnvironment): void {
    if (this.relevantDocument === null) return;
    this.checkEntryOrigin(entryEnv);
    const url = copyURL(this.url);
    if (cannotHaveUsernamePasswordPort(url)) return;
    // SPEC_CLASH(location-component-parse-failure): follow URL's numeric prefix parsing and keep the old port on failure.
    // Gecko accepts a leading ':' and can throw on overflow; WebKit's Location clears failed integer parses.
    if (value === '') url.port = null;
    else parseBasicURL(value, { url, stateOverride: 'port' });
    this.#navigate(url, 'auto', incumbentEnv);
  }

  /** Replace a hierarchical path on a copy of the current URL. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-pathname
  setPathname(value: string, entryEnv: BrowletEnvironment, incumbentEnv: WindowEnvironment): void {
    if (this.relevantDocument === null) return;
    this.checkEntryOrigin(entryEnv);
    const url = copyURL(this.url);
    if (hasOpaquePath(url)) return;
    url.path = [];
    parseBasicURL(value, { url, stateOverride: 'path start' });
    this.#navigate(url, 'auto', incumbentEnv);
  }

  /** Replace or clear the query using UTF-8 regardless of Document encoding. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-search
  setSearch(value: string, entryEnv: BrowletEnvironment, incumbentEnv: WindowEnvironment): void {
    if (this.relevantDocument === null) return;
    this.checkEntryOrigin(entryEnv);
    const url = copyURL(this.url);
    if (value === '') {
      url.query = null;
    } else {
      const input = value.startsWith('?') ? value.slice(1) : value;
      url.query = '';
      // SPEC_CLASH(location-search-encoding): follow the merged UTF-8 rule; the current passage still passes Document encoding.
      // https://github.com/whatwg/html/pull/8309 also agrees with WPT and all three tested engines.
      // Href, assign, and replace retain entry-Document encoding; see the component clash follow-up in ROADMAP.md.
      parseBasicURL(input, { url, stateOverride: 'query' });
    }
    this.#navigate(url, 'auto', incumbentEnv);
  }

  /** Replace the fragment, returning without navigation when its parsed value is unchanged. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-hash
  setHash(value: string, entryEnv: BrowletEnvironment, incumbentEnv: WindowEnvironment): void {
    if (this.relevantDocument === null) return;
    this.checkEntryOrigin(entryEnv);
    const url = copyURL(this.url);
    const previousFragment = url.fragment ?? '';
    const input = value.startsWith('#') ? value.slice(1) : value;
    url.fragment = '';
    parseBasicURL(input, { url, stateOverride: 'fragment' });
    if (url.fragment === previousFragment) return;
    this.#navigate(url, 'auto', incumbentEnv);
  }

  /** Assign a URL after checking the entry origin against the current relevant Document. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-assign
  assign(value: string, entryEnv: BrowletEnvironment, incumbentEnv: WindowEnvironment): void {
    if (this.relevantDocument === null) return;
    this.checkEntryOrigin(entryEnv);
    const url = entryEnv.encodingParseURL(value);
    if (url === null) throw new DOMExceptionImpl('Invalid Location URL', DOMExceptionNames.syntax);
    this.#navigate(url, 'auto', incumbentEnv);
  }

  /** Reload the live relevant Document after checking the entry origin. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-reload
  reload(entryEnv: BrowletEnvironment): void {
    const document = this.relevantDocument;
    // SPEC_CLASH(location-disconnected-reload): follow HTML's null-Document return; Gecko throws for a removed iframe.
    if (document === null) return;
    this.checkEntryOrigin(entryEnv);
    // SPEC_CLASH(location-retained-reload): follow HTML's live Document; Chromium/WebKit ignore retained old Locations.
    const navigable = document.getNodeNavigable();
    if (navigable === null) throw new InternalError('Location reload requires the relevant Document to have a navigable');
    navigable.reload();
  }

  /** Request replacement history without an additional entry-origin check. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-replace
  replace(value: string, entryEnv: BrowletEnvironment, incumbentEnv: WindowEnvironment): void {
    if (this.relevantDocument === null) return;
    const url = entryEnv.encodingParseURL(value);
    if (url === null) throw new DOMExceptionImpl('Invalid Location URL', DOMExceptionNames.syntax);
    this.#navigate(url, 'replace', incumbentEnv);
  }

  /** Navigate the live relevant Document using the incumbent Window's Document and activation. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#location-object-navigate
  #navigate(url: URLRecord, historyHandling: NavigationHistoryBehavior = 'auto', incumbentEnv: WindowEnvironment): void {
    const document = this.relevantDocument!;
    // SPEC_GAP(location-inactive-window-navigation): use the live Document's navigable when the owning Window is inactive.
    const navigable = document.getNodeNavigable()!;
    const sourceDocument = incumbentEnv.window.document;
    if (document.completelyLoadedTime === null && !incumbentEnv.window.hasTransientActivation()) {
      historyHandling = 'replace';
    }
    navigable.navigate(url, sourceDocument, { exceptionsEnabled: true, historyHandling });
  }
}

/*
 * [Exposed=Window]
 * interface Location { // but see also additional creation steps and overridden internal methods
 *   [LegacyUnforgeable] stringifier attribute USVString href;
 *   [LegacyUnforgeable] readonly attribute USVString origin;
 *   [LegacyUnforgeable] attribute USVString protocol;
 *   [LegacyUnforgeable] attribute USVString host;
 *   [LegacyUnforgeable] attribute USVString hostname;
 *   [LegacyUnforgeable] attribute USVString port;
 *   [LegacyUnforgeable] attribute USVString pathname;
 *   [LegacyUnforgeable] attribute USVString search;
 *   [LegacyUnforgeable] attribute USVString hash;
 *
 *   [LegacyUnforgeable] undefined assign(USVString url);
 *   [LegacyUnforgeable] undefined replace(USVString url);
 *   [LegacyUnforgeable] undefined reload();
 *
 *   [LegacyUnforgeable] readonly attribute DOMStringList ancestorOrigins;
 * };
 */
export const locationIDL = defineInterface<BrowletEnvironment>({
  name: 'Location',
  exposed: 'Window',
  ...xattr('CrossOriginObject'),
  implementation: impl(LocationImpl),
  members: [
    attr('href', idlType.USVString, {
      get: locationGetter('href'),
      set: locationSetter('setHref'),
      ...xattr('LegacyUnforgeable', ['CrossOrigin', 'Setter']),
      stringifier: true,
    }),
    roAttr('origin', idlType.USVString, {
      get: locationGetter('origin'), ...xattr('LegacyUnforgeable'),
    }),
    attr('protocol', idlType.USVString, {
      get: locationGetter('protocol'), set: locationSetter('setProtocol'), ...xattr('LegacyUnforgeable'),
    }),
    attr('host', idlType.USVString, {
      get: locationGetter('host'), set: locationSetter('setHost'), ...xattr('LegacyUnforgeable'),
    }),
    attr('hostname', idlType.USVString, {
      get: locationGetter('hostname'), set: locationSetter('setHostname'), ...xattr('LegacyUnforgeable'),
    }),
    attr('port', idlType.USVString, {
      get: locationGetter('port'), set: locationSetter('setPort'), ...xattr('LegacyUnforgeable'),
    }),
    attr('pathname', idlType.USVString, {
      get: locationGetter('pathname'), set: locationSetter('setPathname'), ...xattr('LegacyUnforgeable'),
    }),
    attr('search', idlType.USVString, {
      get: locationGetter('search'), set: locationSetter('setSearch'), ...xattr('LegacyUnforgeable'),
    }),
    attr('hash', idlType.USVString, {
      get: locationGetter('hash'), set: locationSetter('setHash'), ...xattr('LegacyUnforgeable'),
    }),
    op('assign', idlType.undefined,
      [arg('url', idlType.USVString)],
      {
        ...invokeWith(
          atArg<BrowletEnvironment>(1, (_env, methodEnv) => entryEnvironment(methodEnv)),
          atArg<BrowletEnvironment>(2, (_env, methodEnv, incumbentEnv) => incumbentEnv ?? methodEnv),
        ),
        ...xattr('LegacyUnforgeable'),
      },
    ),
    op('replace', idlType.undefined,
      [arg('url', idlType.USVString)],
      {
        ...invokeWith(
          atArg<BrowletEnvironment>(1, (_env, methodEnv) => entryEnvironment(methodEnv)),
          atArg<BrowletEnvironment>(2, (_env, methodEnv, incumbentEnv) => incumbentEnv ?? methodEnv),
        ),
        ...xattr('LegacyUnforgeable', 'CrossOrigin'),
      },
    ),
    op('reload', idlType.undefined,
      [],
      {
        ...invokeWith(atArg<BrowletEnvironment>(0, (_env, methodEnv) => entryEnvironment(methodEnv))),
        ...xattr('LegacyUnforgeable'),
      },
    ),
    roAttr('ancestorOrigins', reference('DOMStringList'), {
      get: locationGetter('ancestorOrigins'), ...xattr('LegacyUnforgeable'),
    }),
  ],
});

function locationGetter(
  name: 'href' | 'origin' | 'protocol' | 'host' | 'hostname' | 'port' | 'pathname' | 'search' | 'hash' | 'ancestorOrigins',
): NonNullable<AttributeMember<BrowletEnvironment>['get']> {
  return function(_env, methodEnv) {
    const location = this as LocationImpl;
    location.checkEntryOrigin(entryEnvironment(methodEnv));
    return location[name];
  };
}

// Binding selects execution inputs after conversion; implementations own URL parsing and navigation.
function locationSetter(
  setter: 'setHref' | 'setProtocol' | 'setHost' | 'setHostname' | 'setPort' | 'setPathname' | 'setSearch' | 'setHash',
): NonNullable<AttributeMember<BrowletEnvironment>['set']> {
  return function(_env, value, methodEnv, incumbentEnv) {
    (this as LocationImpl)[setter](value as string, entryEnvironment(methodEnv), (incumbentEnv ?? methodEnv) as WindowEnvironment);
  };
}

/** Use the running entry script's environment, or the member's environment for a direct host call. */
function entryEnvironment(methodEnv: BrowletEnvironment): BrowletEnvironment {
  const loop = methodEnv.responsibleEventLoop;
  // Borrowing another Window's method does not change the retained script entry.
  // The empty-stack fallback matches direct host calls to Window.open and Origin.from.
  return loop.executionContextStack.length === 0 ? methodEnv : loop.entryExecutionContext.realm.env;
}
