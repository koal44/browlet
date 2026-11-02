import { atArg, defineInterface, idlType, impl, invokeWith, op, roAttr } from '../../../../web-idl/core/index';
import { serializeURL, type URLRecord } from '../../../../url/index';

import type { BrowletEnvironment } from '../../../environment/index';
import type { SerializedRecord } from '../../../scripting/structured-data/index';

import type { NavigationHistoryEntryImpl } from './navigation-history-entry';

/** Destination shared by a navigate event and its transition. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationdestination
export class NavigationDestinationImpl {
  /** Environment owning this destination's platform identity. */
  env: BrowletEnvironment;
  /** Destination URL; a precommit redirect can replace it. */
  urlRecord: URLRecord;
  /** Existing entry for a traversal, or null for push, replace, and reload. */
  entry: NavigationHistoryEntryImpl | null;
  /** Serialized destination state; precommit updates can replace it. */
  state: SerializedRecord;
  /** Original navigation classification, unchanged by interception. */
  sameDocument: boolean;

  constructor(url: URLRecord, entry: NavigationHistoryEntryImpl | null, state: SerializedRecord,
    sameDocument: boolean, env: BrowletEnvironment)
  {
    this.env = env;
    this.urlRecord = url;
    this.entry = entry;
    this.state = state;
    this.sameDocument = sameDocument;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigationdestination-url
  get url(): string { return serializeURL(this.urlRecord); }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigationdestination-key
  get key(): string { return this.entry?.key ?? ''; }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigationdestination-id
  get id(): string { return this.entry?.id ?? ''; }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigationdestination-index
  get index(): number { return this.entry?.index ?? -1; }

  /** Deserialize a fresh value into the method environment selected by Binding. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigationdestination-getstate
  getState(targetEnv: BrowletEnvironment): unknown {
    // SPEC_GAP(navigation-destination-state-realm): HTML omits the target realm; all browsers deserialize in the method realm.
    return targetEnv.deserialize(this.state);
  }
}

/*
 * [Exposed=Window]
 * interface NavigationDestination {
 *   readonly attribute USVString url;
 *   readonly attribute DOMString key;
 *   readonly attribute DOMString id;
 *   readonly attribute long long index;
 *   readonly attribute boolean sameDocument;
 *
 *   any getState();
 * };
 */
export const navigationDestinationIDL = defineInterface<BrowletEnvironment>({
  name: 'NavigationDestination', exposed: 'Window', implementation: impl(NavigationDestinationImpl),
  members: [
    roAttr('url', idlType.USVString), roAttr('key', idlType.DOMString), roAttr('id', idlType.DOMString),
    roAttr('index', idlType.longLong), roAttr('sameDocument', idlType.boolean),
    op('getState', idlType.any,
      [],
      invokeWith(atArg(0, (_env, methodEnv) => methodEnv)),
    ),
  ],
});
