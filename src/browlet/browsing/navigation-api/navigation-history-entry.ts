import { atArg, defineInterface, idlType, impl, invokeWith, nullable, op, roAttr } from '../../../web-idl/core/index';
import { serializeURL } from '../../../url/index';

import { EventTargetImpl } from '../../dom/events/index';
import { eventHandlerAttr, EventHandlerMap, type EventHandlerCallback } from '../../scripting/index';
import type { BrowletEnvironment } from '../../environment/index';
import type { SessionHistoryEntry } from '../navigation/index';

/** A realm-owned view of one session-history record. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationhistoryentry
export class NavigationHistoryEntryImpl extends EventTargetImpl {
  /** Supported handler names shared by all history entries. */
  static #handlerDefinitions = new Map([['ondispose', 'dispose']]);

  declare env: BrowletEnvironment;
  /** Retained session-history identity, shared by entries in different Window realms. */
  sessionHistoryEntry: SessionHistoryEntry;
  /** Disposal listener for entries removed from the Navigation list. */
  override eventHandlers: EventHandlerMap = new EventHandlerMap(this, NavigationHistoryEntryImpl.#handlerDefinitions);

  constructor(sessionHistoryEntry: SessionHistoryEntry, env: BrowletEnvironment) {
    super(env);
    this.sessionHistoryEntry = sessionHistoryEntry;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigationhistoryentry-url
  get url(): string | null {
    const document = this.env.getAssociatedDocument()!;
    if (!document.isFullyActive()) return '';
    const { documentState, url } = this.sessionHistoryEntry;
    if (documentState.document !== document &&
      (documentState.requestReferrerPolicy === 'no-referrer' || documentState.requestReferrerPolicy === 'origin')) {
      return null;
    }
    return serializeURL(url);
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#concept-navigationhistoryentry-key
  get key(): string {
    return this.env.getAssociatedDocument()!.isFullyActive() ? this.sessionHistoryEntry.navigationAPIKey : '';
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#concept-navigationhistoryentry-id
  get id(): string {
    return this.env.getAssociatedDocument()!.isFullyActive() ? this.sessionHistoryEntry.navigationAPIID : '';
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#concept-navigationhistoryentry-index
  get index(): number {
    const document = this.env.getAssociatedDocument()!;
    if (!document.isFullyActive()) return -1;
    return document.getRelevantGlobalObject()!.navigation.getEntryIndex(this.sessionHistoryEntry);
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigationhistoryentry-samedocument
  get sameDocument(): boolean {
    const document = this.env.getAssociatedDocument()!;
    return document.isFullyActive() && this.sessionHistoryEntry.documentState.document === document;
  }

  get ondispose(): EventHandlerCallback | null { return this.eventHandlers.get('ondispose'); }
  set ondispose(callback: EventHandlerCallback | null) { this.eventHandlers.set('ondispose', callback); }

  /** Deserialize fresh state into the method environment selected by Binding. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigationhistoryentry-getstate
  getState(targetEnv: BrowletEnvironment): unknown {
    if (!this.env.getAssociatedDocument()!.isFullyActive()) return undefined;
    // SPEC_GAP(navigation-entry-state-realm): HTML omits StructuredDeserialize's required target realm; all browsers use the method realm.
    return targetEnv.deserialize(this.sessionHistoryEntry.navigationAPIState);
  }
}

export const navigationHistoryEntryIDL = defineInterface({
  name: 'NavigationHistoryEntry',
  inherits: 'EventTarget',
  exposed: 'Window',
  implementation: impl(NavigationHistoryEntryImpl),
  members: [
    roAttr('url', nullable(idlType.USVString)),
    roAttr('key', idlType.DOMString), roAttr('id', idlType.DOMString),
    roAttr('index', idlType.longLong), roAttr('sameDocument', idlType.boolean),
    op('getState', idlType.any,
      [],
      { ...invokeWith(atArg<BrowletEnvironment>(0, (_env, methodEnv) => methodEnv)) },
    ),
    eventHandlerAttr('ondispose'),
  ],
});
