import { defineInterface, frozenArray, idlType, impl, nullable, op, reference, roAttr, xattr } from '../../../web-idl/core/index';
import { serializeURL, type URLRecord } from '../../../url/index';

import type { BrowletEnvironment } from '../../environment/index';

/** One exposed blocking reason, retaining its specification record. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#create-a-notrestoredreasondetails-object
export class NotRestoredReasonDetailsImpl implements NotRestoredReasonDetails {
  /** Environment in whose realm the detail is exposed. */
  env: BrowletEnvironment;
  /** Initialized backing record; internal creation never exposes the initial null slot. */
  #backingStruct: NotRestoredReasonDetails;

  constructor(backingStruct: NotRestoredReasonDetails, env: BrowletEnvironment) {
    this.env = env;
    this.#backingStruct = backingStruct;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-not-restored-reason-details-reason
  get reason() { return this.#backingStruct.reason; }
}

/*
 * [Exposed=Window]
 * interface NotRestoredReasonDetails {
 *   readonly attribute DOMString reason;
 *   [Default] object toJSON();
 * };
 */
export const notRestoredReasonDetailsIDL = defineInterface({
  name: 'NotRestoredReasonDetails', exposed: 'Window', implementation: impl(NotRestoredReasonDetailsImpl),
  members: [roAttr('reason', idlType.DOMString), op('toJSON', idlType.object, [], xattr('Default'))],
});

/** Public diagnostic tree created from an already collected and origin-filtered history record. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#create-a-notrestoredreasons-object
// TODO(Navigation Timing): Create and retain this value when constructing PerformanceNavigationTiming; its getter returns it.
export class NotRestoredReasonsImpl implements NotRestoredReasons {
  /** Environment shared by this diagnostic and every recursively created child/detail. */
  env: BrowletEnvironment;
  /** Creation-time detail membership; Binding retains the corresponding frozen platform array. */
  reasons: NotRestoredReasonDetailsImpl[] | null;
  /** Creation-time child membership; Binding retains the corresponding frozen platform array. */
  children: NotRestoredReasonsImpl[] | null;
  /** Record supplying current scalar getters; list membership is captured at creation. */
  #backingStruct: NotRestoredReasons;

  constructor(backingStruct: NotRestoredReasons, env: BrowletEnvironment) {
    this.env = env;
    this.#backingStruct = backingStruct;
    this.reasons = backingStruct.reasons?.map((reason) => new NotRestoredReasonDetailsImpl(reason, env)) ?? null;
    this.children = backingStruct.children?.map((child) => new NotRestoredReasonsImpl(child, env)) ?? null;
  }

  get src() { return this.#backingStruct.src; }
  get id() { return this.#backingStruct.id; }
  get name() { return this.#backingStruct.name; }
  get url() { return this.#backingStruct.url; }
}

// SPEC_CLASH(not-restored-reasons-json): Follow HTML's Default operation, retaining nested platform values and IDL member order; Chromium recursively copies into plain objects and orders url before name.
/*
 * [Exposed=Window]
 * interface NotRestoredReasons {
 *   readonly attribute USVString? src;
 *   readonly attribute DOMString? id;
 *   readonly attribute DOMString? name;
 *   readonly attribute USVString? url;
 *   readonly attribute FrozenArray<NotRestoredReasonDetails>? reasons;
 *   readonly attribute FrozenArray<NotRestoredReasons>? children;
 *   [Default] object toJSON();
 * };
 */
export const notRestoredReasonsIDL = defineInterface({
  name: 'NotRestoredReasons', exposed: 'Window', implementation: impl(NotRestoredReasonsImpl),
  members: [
    roAttr('src', nullable(idlType.USVString)), roAttr('id', nullable(idlType.DOMString)),
    roAttr('name', nullable(idlType.DOMString)),
    roAttr('url', nullable(idlType.USVString), {
      // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-not-restored-reasons-url
      overrideGet() {
        const url = (this as NotRestoredReasonsImpl).url;
        return url === null ? null : serializeURL(url);
      },
    }),
    // SPEC_CLASH(not-restored-reasons-array-identity): Follow HTML's retained arrays; Chromium creates a fresh array per getter call.
    roAttr('reasons', nullable(frozenArray(reference('NotRestoredReasonDetails')))),
    roAttr('children', nullable(frozenArray(reference('NotRestoredReasons')))),
    op('toJSON', idlType.object, [], xattr('Default')),
  ],
});

/** Shared detail shape used by Document's collected data and the implementation. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#nrr-details-struct
export interface NotRestoredReasonDetails {
  /** Blocking reason, initially empty before the producer assigns it. */
  reason: string;
}

/** Shared diagnostic shape; Binding serializes the URL and projects the captured lists. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#nrr-struct
export interface NotRestoredReasons {
  /** Container source as a scalar value string, initially null. */
  src: string | null;
  /** Container ID, initially null. */
  id: string | null;
  /** Container name, initially null. */
  name: string | null;
  /** Parsed document URL, initially null. */
  url: URLRecord | null;
  /** Blocking details, initially null. */
  reasons: NotRestoredReasonDetails[] | null;
  /** Child diagnostics, initially null. */
  children: NotRestoredReasons[] | null;
}
