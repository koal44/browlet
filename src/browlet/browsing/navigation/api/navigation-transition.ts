import type { InternalPromise, InternalPromiseWithResolvers } from '../../../../infra/index';
import { defineInterface, idlType, impl, promise, reference, roAttr } from '../../../../web-idl/core/index';

import type { BrowletEnvironment } from '../../../environment/index';

import type { NavigationType } from './navigation';
import type { NavigationHistoryEntryImpl } from './navigation-history-entry';
import type { NavigationDestinationImpl } from './navigation-destination';

/** Retains the endpoints and independent commit/completion promises of an intercepted navigation. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationtransition
// TODO(HTML §§6.6, 7.4; CSSOM View): Automatic focus/scroll effects; manual interception can finish now.
export class NavigationTransitionImpl {
  /** Environment owning the transition and both promises. */
  env: BrowletEnvironment;
  /** Category of the intercepted navigation. */
  navigationType: NavigationType;
  /** Entry current when interception creates the transition. */
  from: NavigationHistoryEntryImpl;
  /** Same destination object supplied to the navigate event. */
  to: NavigationDestinationImpl;
  /** Settles when the navigation commits its entry and URL. */
  committed: InternalPromise<void>;
  /** Settles when interception handlers complete or fail. */
  finished: InternalPromise<void>;
  /** Commit settlement retained for the event's commit or abort algorithm. */
  #committed: InternalPromiseWithResolvers<void>;
  /** Completion settlement retained for the event's success or abort algorithm. */
  #finished: InternalPromiseWithResolvers<void>;

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#inner-navigate-event-firing-algorithm
  constructor(navigationType: NavigationType, from: NavigationHistoryEntryImpl,
    to: NavigationDestinationImpl, env: BrowletEnvironment)
  {
    this.env = env;
    this.navigationType = navigationType;
    this.from = from;
    this.to = to;
    this.#committed = env.InternalPromise.withResolvers(idlType.undefined);
    this.#finished = env.InternalPromise.withResolvers(idlType.undefined);
    this.committed = this.#committed.promise;
    this.finished = this.#finished.promise;
    this.finished.observe(() => {}, () => {});
    this.committed.observe(() => {}, () => {});
  }

  /** Settle commit after the navigate event has updated the entry and URL. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#commit-a-navigate-event
  resolveCommitted(): void {
    this.#committed.resolve(undefined);
  }

  /** Settle completion after the event producer has fired navigatesuccess. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigate-event-intercept-commit-handler-steps
  resolveFinished(): void {
    this.#finished.resolve(undefined);
  }

  /** Reject both promises, preserving an already fulfilled commit. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#abort-a-navigateevent
  reject(reason: unknown): void {
    this.#committed.reject(reason);
    this.#finished.reject(reason);
  }
}

/*
 * [Exposed=Window]
 * interface NavigationTransition {
 *   readonly attribute NavigationType navigationType;
 *   readonly attribute NavigationHistoryEntry from;
 *   readonly attribute NavigationDestination to;
 *   readonly attribute Promise<undefined> committed;
 *   readonly attribute Promise<undefined> finished;
 * };
 */
export const navigationTransitionIDL = defineInterface({
  name: 'NavigationTransition', exposed: 'Window', implementation: impl(NavigationTransitionImpl),
  members: [
    roAttr('navigationType', reference('NavigationType')), roAttr('from', reference('NavigationHistoryEntry')),
    // SPEC_CLASH(navigation-transition-destination): Follow HTML/Chromium/WebKit; Firefox has not exposed to.
    roAttr('to', reference('NavigationDestination')),
    roAttr('committed', promise(idlType.undefined)), roAttr('finished', promise(idlType.undefined)),
  ],
});
