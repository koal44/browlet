import { InternalError, type InternalPromise, type InternalPromiseWithResolvers } from '../../../../infra/index';
import { reference } from '../../../../web-idl/core/index';

import type { SerializedRecord } from '../../../scripting/structured-data/index';

import type { NavigationImpl } from './navigation';
import { NavigationHistoryEntryImpl } from './navigation-history-entry';

/** Retains one Navigation method's state and the two independently settled results. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigation-api-method-tracker
export class NavigationAPIMethodTracker {
  /** Navigation that owns the method invocation. */
  navigation: NavigationImpl;
  /** Destination key for traversal, or null for navigate/reload. */
  key: string | null;
  /** Author value delivered unchanged to the navigate event. */
  info: unknown;
  /** State to install on commit, or null when traversing without a state change. */
  serializedState: SerializedRecord | null;
  /** Entry selected at commit, independently of later changes to currentEntry. */
  committedToEntry: NavigationHistoryEntryImpl | null = null;
  /** Resolves on commit; remains fulfilled if completion later fails. */
  committedPromise: InternalPromise<NavigationHistoryEntryImpl>;
  /** Resolves on completion and is marked handled at creation. */
  finishedPromise: InternalPromise<NavigationHistoryEntryImpl>;
  /** Whether navigate-event firing has yet to accept this navigate/reload request. */
  pending: boolean;
  /** Settlement functions retained with the committed promise. */
  #committed: InternalPromiseWithResolvers<NavigationHistoryEntryImpl>;
  /** Settlement functions retained with the finished promise. */
  #finished: InternalPromiseWithResolvers<NavigationHistoryEntryImpl>;

  constructor(navigation: NavigationImpl, key: string | null, info: unknown,
    serializedState: SerializedRecord | null, pending: boolean)
  {
    this.navigation = navigation;
    this.key = key;
    this.info = info;
    this.serializedState = serializedState;
    this.pending = pending;
    // SPEC_CLASH(navigation-result-realms): HTML/Gecko/Chromium use the receiver realm for trackers; WebKit uses the method realm.
    const P = navigation.env.InternalPromise;
    this.#committed = P.withResolvers(reference(NavigationHistoryEntryImpl));
    this.#finished = P.withResolvers(reference(NavigationHistoryEntryImpl));
    this.committedPromise = this.#committed.promise;
    this.finishedPromise = this.#finished.promise;
    this.finishedPromise.observe(() => {}, () => {});
  }

  /** Install state and resolve committed before navigation invokes author callbacks. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#notify-about-the-committed-to-entry
  notifyCommittedToEntry(entry: NavigationHistoryEntryImpl): void {
    this.committedToEntry = entry;
    if (this.serializedState !== null) {
      entry.sessionHistoryEntry.navigationAPIState = this.serializedState;
      this.serializedState = null;
    }
    this.#committed.resolve(entry);
  }

  /** Finish with the entry captured at commit, then release the Navigation registration. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#resolve-the-finished-promise
  resolveFinished(): void {
    if (this.committedToEntry === null) throw new InternalError('Navigation has not committed');
    this.#finished.resolve(this.committedToEntry);
    this.cleanup();
  }

  /** Reject both results; rejecting an already committed promise has no effect. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#reject-the-finished-promise
  rejectFinished(exception: unknown): void {
    this.#committed.reject(exception);
    this.#finished.reject(exception);
    this.cleanup();
  }

  /** Remove this tracker from its ongoing or upcoming-traversal registration. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigation-api-method-tracker-clean-up
  cleanup(): void {
    if (this.navigation.ongoingAPIMethodTracker === this) {
      this.navigation.ongoingAPIMethodTracker = null;
    } else {
      if (this.key === null || !this.navigation.upcomingTraverseAPIMethodTrackers.has(this.key)) {
        throw new InternalError('Navigation method tracker is not registered');
      }
      this.navigation.upcomingTraverseAPIMethodTrackers.delete(this.key);
    }
  }
}
