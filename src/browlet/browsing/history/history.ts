import {
  arg, attr, defineEnumeration, defineInterface, DOMExceptionImpl, DOMExceptionNames,
  idlType, impl, integer, nullable, op, reference, roAttr,
} from '../../../web-idl/core/index';

import type { DocumentImpl } from '../../dom/nodes/index';
import type { BrowletEnvironment } from '../../environment/index';
import type { HistoryHandlingBehavior } from '../navigation/index';

/** Document-owned classic history state, exposed through its Window. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-history-interface
export class HistoryImpl {
  /** Relevant environment, whose global supplies the current associated Document. */
  env: BrowletEnvironment;
  /** Deserialized state retained between history updates; initially null. */
  stateValue: unknown = null;
  /** Stored script-visible length, updated by history application rather than by the getter. */
  lengthValue = 0;
  /** Stored script-visible position, also used by synchronous history updates. */
  index = 0;

  constructor(env: BrowletEnvironment) {
    this.env = env;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-history-length
  get length(): number {
    this.#requireFullyActiveDocument();
    return this.lengthValue;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-history-scroll-restoration
  get scrollRestoration(): ScrollRestoration {
    return this.#requireFullyActiveDocument().getNodeNavigable()!.activeSessionHistoryEntry.scrollRestorationMode;
  }

  set scrollRestoration(value: ScrollRestoration) {
    this.#requireFullyActiveDocument().getNodeNavigable()!.activeSessionHistoryEntry.scrollRestorationMode = value;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-history-state
  get state(): unknown {
    // SPEC_CLASH(history-inactive-state): Follow HTML's activity check; Chromium/WebKit can return cached null for a replaced Window.
    this.#requireFullyActiveDocument();
    return this.stateValue;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-history-go
  go(delta: number): void {
    this.deltaTraverse(delta);
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-history-back
  back(): void {
    this.deltaTraverse(-1);
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-history-forward
  forward(): void {
    this.deltaTraverse(1);
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-history-pushstate
  pushState(data: unknown, _unused: string, url: string | null): void {
    this.pushOrReplaceState(data, url, 'push');
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-history-replacestate
  replaceState(data: unknown, _unused: string, url: string | null): void {
    this.pushOrReplaceState(data, url, 'replace');
  }

  /** Request reload or traversal from this History's relevant global's current Document. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#delta-traverse
  deltaTraverse(delta: number): void {
    const document = this.#requireFullyActiveDocument();
    const navigable = document.getNodeNavigable()!;
    if (navigable.isNavigationOrHistoryUpdateBlocked()) return;
    if (delta === 0) {
      navigable.reload();
      return;
    }
    navigable.traversable.traverseHistoryByDelta(delta, document);
  }

  /** Serialize state, validate URL rewriting, and request a cancelable same-document history update. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#shared-history-push/replace-state-steps
  pushOrReplaceState(data: unknown, url: string | null, historyHandling: HistoryHandlingBehavior): void {
    // SPEC_CLASH(history-state-serialization-order): Follow HTML/Firefox; Chromium/WebKit serialize before checking activity.
    // HTML #347/#359 made the pre-operation activity check explicit; see the navigation roadmap.
    const document = this.#requireFullyActiveDocument();
    const window = document.getRelevantGlobalObject()!;
    const serializedData = this.env.serializeForStorage(data);
    let newURL = document.url;
    if (url !== null && url !== '') {
      // SPEC_CLASH(history-state-url-encoding): Follow HTML/Firefox/WebKit's Document encoding; Chromium uses UTF-8.
      const parsed = this.env.encodingParseURL(url);
      if (parsed === null || !document.canHaveURLRewritten(parsed)) {
        throw new DOMExceptionImpl('History cannot rewrite the Document URL', DOMExceptionNames.security);
      }
      newURL = parsed;
    }

    const navigable = window.navigable;
    // SPEC_GAP(history-state-detached-during-serialization): HTML omits the lost-navigable case; follow all three browsers with SecurityError.
    // Serialization runs author code; Mozilla bug 634834 also requires rechecking ownership afterward.
    if (navigable === null) {
      throw new DOMExceptionImpl('History lost its navigable during state serialization', DOMExceptionNames.security);
    }
    if (navigable.isNavigationOrHistoryUpdateBlocked()) return;
    if (!window.navigation.firePushReplaceReloadNavigateEvent(historyHandling, newURL, true, {
      classicHistoryAPIState: serializedData,
    })) return;
    document.updateURLAndHistory(newURL, serializedData, historyHandling);
  }

  /** Check the receiver's relevant global, including when another realm's accessor is borrowed. */
  #requireFullyActiveDocument(): DocumentImpl {
    const document = this.env.getAssociatedDocument();
    if (document === null || !document.isFullyActive()) {
      throw new DOMExceptionImpl('History requires a fully active Document', DOMExceptionNames.security);
    }
    return document;
  }
}

/** Whether traversal automatically restores an entry's saved scroll position. */
export type ScrollRestoration = 'auto' | 'manual';

/*
 * enum ScrollRestoration { "auto", "manual" };
 */
export const scrollRestorationIDL = defineEnumeration({
  name: 'ScrollRestoration',
  values: ['auto', 'manual'] satisfies ScrollRestoration[],
});

/*
 * [Exposed=Window]
 * interface History {
 *   readonly attribute unsigned long length;
 *   attribute ScrollRestoration scrollRestoration;
 *   readonly attribute any state;
 *   undefined go(optional long delta = 0);
 *   undefined back();
 *   undefined forward();
 *   undefined pushState(any data, DOMString unused, optional USVString? url = null);
 *   undefined replaceState(any data, DOMString unused, optional USVString? url = null);
 * };
 */
export const historyIDL = defineInterface({
  name: 'History',
  exposed: 'Window',
  implementation: impl(HistoryImpl),
  members: [
    roAttr('length', idlType.unsignedLong),
    attr('scrollRestoration', reference('ScrollRestoration')),
    roAttr('state', idlType.any),
    op('go', idlType.undefined, [
      arg('delta', idlType.long, { optional: true, default: integer(0) }),
    ]),
    op('back', idlType.undefined),
    op('forward', idlType.undefined),
    op('pushState', idlType.undefined, [
      arg('data', idlType.any), arg('unused', idlType.DOMString),
      arg('url', nullable(idlType.USVString), { optional: true, default: null }),
    ]),
    op('replaceState', idlType.undefined, [
      arg('data', idlType.any), arg('unused', idlType.DOMString),
      arg('url', nullable(idlType.USVString), { optional: true, default: null }),
    ]),
  ],
});
