import { InternalError, type InternalPromise } from '../../../infra/index';
import {
  arg, atArg, defineDictionary, defineEnumeration, defineInterface, dictMember, DOMExceptionImpl, emptyDictionary,
  idlType, impl, invokeWith, nullable, op, promise, reference, roAttr, sequence, type DOMException,
} from '../../../web-idl/core/index';
import { areSameOrigin, type URLRecord } from '../../../url/index';
import type { FormDataEntry } from '../../../xhr/index';

import { eventHandlerAttr, EventHandlerMap, type EventHandlerCallback } from '../../scripting/index';
import { EventTargetImpl } from '../../dom/events/index';
import type { ElementImpl } from '../../dom/nodes/index';
import { SourceSnapshotParams } from '../navigation/source-snapshot';
import type { BrowletEnvironment } from '../../environment';
import type { SerializedRecord } from '../../scripting/structured-data/index';
import type { NavigationHistoryBehavior, SessionHistoryEntry, UserNavigationInvolvement } from '../navigation/index';

import { NavigationHistoryEntryImpl } from './navigation-history-entry';
import { NavigationActivationImpl } from './navigation-activation';
import { NavigationCurrentEntryChangeEventImpl } from './navigation-current-entry-change-event';
import { NavigationAPIMethodTracker } from './method-tracker';
import type { NavigationTransitionImpl } from './navigation-transition';
import type { NavigateEventImpl } from './navigate-event';

/** Window-owned view of contiguous same-origin session history. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigation-interface
export class NavigationImpl extends EventTargetImpl {
  declare env: BrowletEnvironment;
  /** Realm-owned entries; history application supplies their session-history records. */
  entryList: NavigationHistoryEntryImpl[] = [];
  /** Position in the entry list, or -1 before initialization. */
  currentEntryIndex = -1;
  /** Ongoing intercepted transition; navigate-event firing must install, settle, and clear it. */
  transition: NavigationTransitionImpl | null = null;
  /** Most recent cross-document activation, retained while the associated Document is inactive. */
  // SPEC_CLASH(navigation-activation-inactive): HTML/Firefox/WebKit retain this value; Chromium's getter returns null while inactive.
  activation: NavigationActivationImpl | null = null;
  /** Accepted navigate event, retained until completion or abortion. */
  ongoingNavigateEvent: NavigateEventImpl | null = null;
  /** Whether focusing steps changed focus during this navigation. */
  focusChangedDuringOngoingNavigation = false;
  /** Whether interception replaces the usual history scroll restoration. */
  suppressNormalScrollRestorationDuringOngoingNavigation = false;
  /** Tracker accepted by navigate-event firing, or null without an API-initiated navigation. */
  ongoingAPIMethodTracker: NavigationAPIMethodTracker | null = null;
  /** Traversal requests awaiting event firing, in insertion order by destination key. */
  upcomingTraverseAPIMethodTrackers = new Map<string, NavigationAPIMethodTracker>();
  /** Attribute listeners; navigate/success event production remains unfinished. */
  #eventHandlers = new EventHandlerMap(this, [
    { name: 'onnavigate', type: 'navigate' },
    { name: 'onnavigatesuccess', type: 'navigatesuccess' },
    { name: 'onnavigateerror', type: 'navigateerror' },
    { name: 'oncurrententrychange', type: 'currententrychange' },
  ]);

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigation-current-entry
  get currentEntry(): NavigationHistoryEntryImpl | null {
    if (this.hasEntriesAndEventsDisabled()) return null;
    if (this.currentEntryIndex === -1) throw new InternalError('Navigation entries have not been initialized');
    return this.entryList[this.currentEntryIndex]!;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigation-cangoback
  get canGoBack(): boolean {
    if (this.hasEntriesAndEventsDisabled()) return false;
    if (this.currentEntryIndex === -1) throw new InternalError('Navigation entries have not been initialized');
    return this.currentEntryIndex !== 0;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigation-cangoforward
  get canGoForward(): boolean {
    if (this.hasEntriesAndEventsDisabled()) return false;
    if (this.currentEntryIndex === -1) throw new InternalError('Navigation entries have not been initialized');
    return this.currentEntryIndex !== this.entryList.length - 1;
  }

  get onnavigate(): EventHandlerCallback | null { return this.#eventHandlers.get('onnavigate'); }
  set onnavigate(callback: EventHandlerCallback | null) { this.#eventHandlers.set('onnavigate', callback); }

  get onnavigatesuccess(): EventHandlerCallback | null { return this.#eventHandlers.get('onnavigatesuccess'); }
  set onnavigatesuccess(callback: EventHandlerCallback | null) { this.#eventHandlers.set('onnavigatesuccess', callback); }

  get onnavigateerror(): EventHandlerCallback | null { return this.#eventHandlers.get('onnavigateerror'); }
  set onnavigateerror(callback: EventHandlerCallback | null) { this.#eventHandlers.set('onnavigateerror', callback); }

  get oncurrententrychange(): EventHandlerCallback | null { return this.#eventHandlers.get('oncurrententrychange'); }
  set oncurrententrychange(callback: EventHandlerCallback | null) { this.#eventHandlers.set('oncurrententrychange', callback); }

  /** Cancel the active event and reset its focus and scroll bookkeeping. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#abort-the-ongoing-navigation
  // Navigable's notification entry points select the loop and repeat this for reentrant navigation.
  // TODO(HTML §§7.3.3, 7.4): Connect the actual destruction, stop, and navigation producers.
  abortOngoingNavigation(error?: DOMException): void {
    const event = this.ongoingNavigateEvent;
    if (event === null) throw new InternalError('Navigation has no ongoing navigate event');
    this.focusChangedDuringOngoingNavigation = false;
    this.suppressNormalScrollRestorationDuringOngoingNavigation = false;
    error ??= new this.env.DOMException('', 'AbortError');
    // This internal cancellation also applies to noncancelable events during dispatch.
    if (event.dispatching) event.defaultPrevented = true;
    event.abort(error);
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigation-entries
  entries(): NavigationHistoryEntryImpl[] {
    return this.hasEntriesAndEventsDisabled() ? [] : this.entryList;
  }

  /** Store a snapshot on the current entry and synchronously report its changed contents. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigation-updatecurrententry
  updateCurrentEntry(options: NavigationUpdateCurrentEntryOptions): void {
    const current = this.currentEntry;
    if (current === null) throw new DOMExceptionImpl('Navigation has no current entry', 'InvalidStateError');
    const serializedState = this.env.serializeForStorage(options.state);
    // Author getters can change the current entry; update the originally captured entry.
    current.sessionHistoryEntry.navigationAPIState = serializedState;
    // TODO: Integrate Document destruction with this EventTarget's lifetime; serialization can destroy its Window.
    this.fireEvent('currententrychange', NavigationCurrentEntryChangeEventImpl, (event) => {
      (event as NavigationCurrentEntryChangeEventImpl).from = current;
    });
  }

  /** Prepare a navigation request and retain its commit/completion promises. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigation-navigate
  navigate(url: string, options: NavigationNavigateOptions, methodEnv: BrowletEnvironment): NavigationResult {
    const urlRecord = this.env.parseHTMLURL(url);
    if (urlRecord === null) {
      return this.createEarlyErrorResult(new DOMExceptionImpl('Invalid navigation URL', 'SyntaxError'), methodEnv);
    }
    if (urlRecord.scheme === 'javascript') {
      return this.createEarlyErrorResult(new DOMExceptionImpl('JavaScript URLs cannot use Navigation', 'NotSupportedError'), methodEnv);
    }
    const document = this.env.getAssociatedDocument()!;
    // SPEC_CLASH(navigation-initial-push-order): HTML/Gecko/WebKit reject before state serialization; Chromium serializes first.
    if (options.history === 'push' && document.navigationMustBeReplace(urlRecord)) {
      return this.createEarlyErrorResult(new DOMExceptionImpl('This navigation must replace the entry', 'NotSupportedError'), methodEnv);
    }
    let serializedState: SerializedRecord;
    try { serializedState = this.env.serializeForStorage(options.state); }
    catch (error) { return this.createEarlyErrorResult(error, methodEnv); }
    // SPEC_CLASH(navigation-inactive-serialization): Follow HTML/Chromium's serialization before activity checks; Gecko/WebKit differ after destruction.
    if (!document.isFullyActive() || document.unloadCounter > 0) {
      return this.createEarlyErrorResult(new DOMExceptionImpl('The Document cannot initiate navigation', 'InvalidStateError'), methodEnv);
    }
    const tracker = this.setupNavigateReloadMethodTracker(options.info, serializedState);
    document.getNodeNavigable()!.navigate(urlRecord, document, {
      historyHandling: options.history, navigationAPIState: serializedState, apiMethodTracker: tracker,
    });
    return this.getMethodTrackerResult(tracker, methodEnv);
  }

  /** Prepare reload, preserving the current entry's state unless options supplies a new value. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigation-reload
  reload(options: NavigationReloadOptions, methodEnv: BrowletEnvironment): NavigationResult {
    const document = this.env.getAssociatedDocument()!;
    let serializedState = this.env.serializeForStorage(undefined);
    if (options.state !== undefined) {
      try { serializedState = this.env.serializeForStorage(options.state); }
      catch (error) { return this.createEarlyErrorResult(error, methodEnv); }
    } else {
      const current = this.currentEntry;
      if (current !== null) serializedState = current.sessionHistoryEntry.navigationAPIState;
    }
    // SPEC_CLASH(navigation-inactive-serialization): Use the same HTML ordering as navigate().
    if (!document.isFullyActive() || document.unloadCounter > 0) {
      return this.createEarlyErrorResult(new DOMExceptionImpl('The Document cannot initiate reload', 'InvalidStateError'), methodEnv);
    }
    const tracker = this.setupNavigateReloadMethodTracker(options.info, serializedState);
    document.getNodeNavigable()!.reload({ navigationAPIState: serializedState, apiMethodTracker: tracker });
    return this.getMethodTrackerResult(tracker, methodEnv);
  }

  /** Request a destination present in this Navigation's entry list. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigation-traverseto
  traverseTo(key: string, options: NavigationOptions, methodEnv: BrowletEnvironment): NavigationResult {
    if (this.currentEntryIndex === -1 || !this.entryList.some((entry) => entry.sessionHistoryEntry.navigationAPIKey === key)) {
      return this.createEarlyErrorResult(new DOMExceptionImpl('No Navigation entry has this key', 'InvalidStateError'), methodEnv);
    }
    return this.#performTraversal(key, options, methodEnv);
  }

  /** Request the preceding entry in this Navigation's own history. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigation-back
  back(options: NavigationOptions, methodEnv: BrowletEnvironment): NavigationResult {
    if (this.currentEntryIndex === -1 || this.currentEntryIndex === 0) {
      return this.createEarlyErrorResult(new DOMExceptionImpl('There is no preceding Navigation entry', 'InvalidStateError'), methodEnv);
    }
    const key = this.entryList[this.currentEntryIndex - 1]!.sessionHistoryEntry.navigationAPIKey;
    return this.#performTraversal(key, options, methodEnv);
  }

  /** Request the following entry in this Navigation's own history. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigation-forward
  forward(options: NavigationOptions, methodEnv: BrowletEnvironment): NavigationResult {
    if (this.currentEntryIndex === -1 || this.currentEntryIndex === this.entryList.length - 1) {
      return this.createEarlyErrorResult(new DOMExceptionImpl('There is no following Navigation entry', 'InvalidStateError'), methodEnv);
    }
    const key = this.entryList[this.currentEntryIndex + 1]!.sessionHistoryEntry.navigationAPIKey;
    return this.#performTraversal(key, options, methodEnv);
  }

  /** Create independent rejected results; early errors do not mark either result handled. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigation-api-early-error-result
  createEarlyErrorResult(error: unknown, env: BrowletEnvironment): NavigationResult {
    // SPEC_CLASH(navigation-result-realms): HTML/Gecko/WebKit use method-realm early rejection promises; Chromium uses the receiver.
    // Result dictionary allocation keeps Binding's receiver realm, as Chromium/WebKit do; Gecko uses the method realm.
    return {
      committed: env.InternalPromise.reject(error, reference(NavigationHistoryEntryImpl)),
      finished: env.InternalPromise.reject(error, reference(NavigationHistoryEntryImpl)),
    };
  }

  /** Return the tracked promises, or an early AbortError when event firing never accepted the request. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigation-api-method-tracker-derived-result
  getMethodTrackerResult(tracker: NavigationAPIMethodTracker | null, env: BrowletEnvironment): NavigationResult {
    // SPEC_GAP(navigation-null-tracker-result): HTML accepts null but only dereferences it; current callers always supply a tracker.
    if (tracker === null) throw new InternalError('A Navigation result requires its method tracker');
    if (tracker.pending) return this.createEarlyErrorResult(new DOMExceptionImpl('Navigation was aborted', 'AbortError'), env);
    return { committed: tracker.committedPromise, finished: tracker.finishedPromise };
  }

  /** Allocate a navigate/reload tracker; disabled entry lists intentionally leave both promises pending. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#set-up-a-navigate/reload-api-method-tracker
  setupNavigateReloadMethodTracker(info: unknown, serializedState: SerializedRecord | null): NavigationAPIMethodTracker {
    return new NavigationAPIMethodTracker(this, null, info, serializedState, !this.hasEntriesAndEventsDisabled());
  }

  /** Register the promises and info for one upcoming destination-key traversal. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#add-an-upcoming-traverse-api-method-tracker
  addUpcomingTraverseMethodTracker(destinationKey: string, info: unknown): NavigationAPIMethodTracker {
    const tracker = new NavigationAPIMethodTracker(this, destinationKey, info, null, false);
    this.upcomingTraverseAPIMethodTrackers.set(destinationKey, tracker);
    return tracker;
  }

  /** Whether the relevant global's current Document permits Navigation entries and events. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#has-entries-and-events-disabled
  hasEntriesAndEventsDisabled(): boolean {
    const document = this.env.getAssociatedDocument()!;
    return !document.isFullyActive() || document.isInitialAboutBlank || document.origin.kind === 'opaque';
  }

  /** Locate the entry by session-history identity, independently of its exposed key or ID. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#getting-the-navigation-api-entry-index
  getEntryIndex(she: SessionHistoryEntry): number {
    return this.entryList.findIndex((entry) => entry.sessionHistoryEntry === she);
  }

  /** Initialize a new Document from its already-filtered contiguous same-origin history. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#initialize-the-navigation-api-entries-for-a-new-document
  initializeEntriesForNewDocument(newSHEs: SessionHistoryEntry[], initialSHE: SessionHistoryEntry): void {
    if (this.entryList.length !== 0 || this.currentEntryIndex !== -1) {
      throw new InternalError('Navigation entries are already initialized');
    }
    if (this.hasEntriesAndEventsDisabled()) return;
    for (const she of newSHEs) this.entryList.push(new NavigationHistoryEntryImpl(she, this.env));
    this.currentEntryIndex = this.getEntryIndex(initialSHE);
  }

  /** Update the retained activation after history application has selected this Document's current entry. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#update-document-for-history-step-application
  // Extracts step 7; the complete history application and reactivation/pageshow ordering remain in §7.4.6.2.
  // TODO(HTML 7.4.6.2): Audit activation-before-reactivation ordering for newly visible predecessor entries at the real caller.
  updateActivation(navigationType: NavigationType | null, previousEntryForActivation?: SessionHistoryEntry): void {
    if (previousEntryForActivation === undefined || navigationType === null) return;
    const document = this.env.getAssociatedDocument()!;
    const previousState = previousEntryForActivation.documentState;
    const previousDocument = previousState.document;
    if (navigationType !== 'reload' && previousDocument === document) return;
    const entry = this.currentEntry;
    // SPEC_CLASH(navigation-activation-disabled): Follow Chromium/WebKit; HTML can assign null despite entry's nonnullable IDL.
    if (entry === null) return;

    // SPEC_CLASH(navigation-activation-clear-from): Follow HTML's null-from description and browser resets; its update steps omit clearing stale from.
    let from: NavigationHistoryEntryImpl | null = null;
    const previousEntryIndex = this.getEntryIndex(previousEntryForActivation);
    if (previousEntryIndex !== -1) {
      from = this.entryList[previousEntryIndex]!;
    } else if (navigationType === 'replace' && previousState.origin !== null && areSameOrigin(previousState.origin, document.origin)) {
      // TODO(HTML 7.4.6): Full history teardown must preserve the previous active Document's initial-about:blank flag.
      if (previousDocument === null) throw new InternalError('Activation replacement requires the previous Document');
      if (!previousDocument.isInitialAboutBlank) from = new NavigationHistoryEntryImpl(previousEntryForActivation, this.env);
    }
    if (this.activation === null) {
      this.activation = new NavigationActivationImpl(from, entry, navigationType, this.env);
    } else {
      // SPEC_CLASH(navigation-activation-identity): HTML/Chromium/Gecko update the retained object; inspected WebKit source replaces it.
      this.activation.from = from;
      this.activation.entry = entry;
      this.activation.navigationType = navigationType;
    }
  }

  /** Reconcile a reactivated Document's entries, deferring disposal until after its pageshow. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#update-the-navigation-api-entries-for-reactivation
  updateEntriesForReactivation(newSHEs: SessionHistoryEntry[], reactivatedSHE: SessionHistoryEntry): void {
    if (this.hasEntriesAndEventsDisabled()) return;
    const newNHEs: NavigationHistoryEntryImpl[] = [];
    const oldNHEs = [...this.entryList];
    for (const she of newSHEs) {
      const oldIndex = oldNHEs.findIndex((entry) => entry.sessionHistoryEntry === she);
      const entry = oldIndex === -1
        ? new NavigationHistoryEntryImpl(she, this.env)
        : oldNHEs.splice(oldIndex, 1)[0]!;
      newNHEs.push(entry);
    }
    this.entryList = newNHEs;
    this.currentEntryIndex = this.getEntryIndex(reactivatedSHE);
    // The §7.4.6.2 reactivation caller must update the list before firing pageshow.
    this.env.queueTask('navigation-and-traversal', () => {
      for (const entry of oldNHEs) entry.fireEvent('dispose');
    });
  }

  /** Update an entry list and its navigation notifications as one same-document commit. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#update-the-navigation-api-entries-for-a-same-document-navigation
  updateEntriesForSameDocumentNavigation(_destinationSHE: SessionHistoryEntry, _navigationType: NavigationType): void {
    if (this.hasEntriesAndEventsDisabled()) return;
    // TODO(HTML 7.2.6.4): Mutate push/replace/traverse entries; notify the ongoing method tracker
    // before author events using notifyCommittedToEntry(); capture the ongoing event/tracker;
    // prepare/clean up script around currententrychange, disposal, and intercept commit handlers.
    // Do not apply only the list edits.
    throw new InternalError('Same-document Navigation entry updates and commit notifications are not implemented');
  }

  /** Decide whether push, replace, or reload may continue after its navigate event. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#fire-a-push/replace/reload-navigate-event
  firePushReplaceReloadNavigateEvent(
    _navigationType: NavigationType, _destinationURL: URLRecord, _isSameDocument: boolean,
    _options: PushReplaceReloadNavigateEventOptions = {},
  ): boolean {
    // TODO(HTML 7.2.6): Abort previous navigation, handle disabled entries/events and tracker state,
    // create NavigateEvent/NavigationDestination with the event's controller and matching signal,
    // initialize focus/scroll state, and run the inner event/cancellation algorithm.
    throw new InternalError('Navigation API navigate-event firing is not implemented');
  }

  /** Reuse a pending destination request or prepare its queued traversal. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#performing-a-navigation-api-traversal
  #performTraversal(key: string, options: NavigationOptions, methodEnv: BrowletEnvironment): NavigationResult {
    const document = this.env.getAssociatedDocument()!;
    if (!document.isFullyActive() || document.unloadCounter > 0) {
      return this.createEarlyErrorResult(new DOMExceptionImpl('The Document cannot traverse history', 'InvalidStateError'), methodEnv);
    }
    const current = this.currentEntry!;
    if (key === current.sessionHistoryEntry.navigationAPIKey) {
      // SPEC_CLASH(navigation-result-realms): HTML/WebKit create no-op traversal promises in the method realm; Chromium/Gecko use the receiver.
      return {
        committed: methodEnv.InternalPromise.resolve(current, reference(NavigationHistoryEntryImpl)),
        finished: methodEnv.InternalPromise.resolve(current, reference(NavigationHistoryEntryImpl)),
      };
    }
    const upcoming = this.upcomingTraverseAPIMethodTrackers.get(key);
    if (upcoming !== undefined) return this.getMethodTrackerResult(upcoming, methodEnv);
    const tracker = this.addUpcomingTraverseMethodTracker(key, options.info);
    const navigable = document.getNodeNavigable()!;
    const traversable = navigable.traversable;
    try {
      const sourceSnapshotParams = new SourceSnapshotParams(document);
      traversable.appendSessionHistoryTraversalSteps(() => {
        const target = navigable.getSessionHistoryEntries().find((entry) => entry.navigationAPIKey === key);
        if (target === undefined || target === navigable.activeSessionHistoryEntry) {
          this.#queueTraversalFailure(tracker, 'InvalidStateError');
          return;
        }
        if (target.step === 'pending') throw new InternalError('Navigation traversal requires a committed history step');
        const result = traversable.applyTraverseHistoryStep(target.step, sourceSnapshotParams, navigable, 'none');
        if (result === 'canceled-by-beforeunload') this.#queueTraversalFailure(tracker, 'AbortError');
        else if (result === 'initiator-disallowed') this.#queueTraversalFailure(tracker, 'SecurityError');
        // A canceled navigate event owns abortion and navigateerror; successful application owns commit/finish.
      });
    } catch (error) {
      // An unfinished owner must not leave a reusable tracker for work that was never queued.
      this.upcomingTraverseAPIMethodTrackers.delete(key);
      throw error;
    }
    return this.getMethodTrackerResult(tracker, methodEnv);
  }

  /** Deliver parallel traversal failures through the Navigation owner's task queue. */
  #queueTraversalFailure(tracker: NavigationAPIMethodTracker, name: 'InvalidStateError' | 'AbortError' | 'SecurityError'): void {
    this.env.queueTask('navigation-and-traversal', () => {
      // SPEC_CLASH(navigation-delayed-traversal-rejection): HTML can clean up a settled tracker twice; follow Gecko's guard for obsolete work.
      // https://github.com/whatwg/html/issues/12176
      if (this.ongoingAPIMethodTracker !== tracker &&
        (tracker.key === null || this.upcomingTraverseAPIMethodTrackers.get(tracker.key) !== tracker)) return;
      tracker.rejectFinished(new DOMExceptionImpl('Navigation traversal failed', name));
    });
  }
}

/** Navigation category supplied to the event algorithms. */
export type NavigationType = 'push' | 'replace' | 'reload' | 'traverse';

/** Converted update options; Web IDL requires the state member before invocation. */
export type NavigationUpdateCurrentEntryOptions = {
  state: unknown;
};

/** Converted options shared by all Navigation-initiated requests. */
export type NavigationOptions = { info?: unknown; };
/** Navigation URL handling and optional state after Web IDL conversion. */
export type NavigationNavigateOptions = NavigationOptions & { state?: unknown; history: NavigationHistoryBehavior; };
/** Reload keeps existing state when the state member is absent or undefined. */
export type NavigationReloadOptions = NavigationOptions & { state?: unknown; };
/** Distinct promises sharing a destination entry but independently reporting commit and completion. */
export type NavigationResult = {
  committed: InternalPromise<NavigationHistoryEntryImpl>;
  finished: InternalPromise<NavigationHistoryEntryImpl>;
};

/**
 * Optional event inputs. Involvement defaults to 'none'; source, form data, and classic state to null;
 * Navigation API state defaults to storage-serialized null. The tracker may be omitted.
 */
export type PushReplaceReloadNavigateEventOptions = {
  userInvolvement?: UserNavigationInvolvement;
  sourceElement?: ElementImpl | null;
  formDataEntryList?: FormDataEntry[] | null;
  navigationAPIState?: SerializedRecord;
  classicHistoryAPIState?: SerializedRecord | null;
  apiMethodTracker?: NavigationAPIMethodTracker | null;
};

export const navigationTypeIDL = defineEnumeration({
  name: 'NavigationType',
  values: ['push', 'replace', 'reload', 'traverse'] satisfies NavigationType[],
});

// TODO(HTML 7.2.6.10): navigate-event firing, interception, and transition commit/success producers.
// Navigation and traversal effects remain in Navigable/Traversable.
export const navigationIDL = defineInterface<BrowletEnvironment>({
  name: 'Navigation',
  inherits: 'EventTarget',
  exposed: 'Window',
  implementation: impl(NavigationImpl),
  members: [
    op('entries', sequence(reference('NavigationHistoryEntry'))),
    roAttr('currentEntry', nullable(reference('NavigationHistoryEntry'))),
    op('updateCurrentEntry', idlType.undefined, [arg('options', reference('NavigationUpdateCurrentEntryOptions'))]),
    roAttr('transition', nullable(reference('NavigationTransition'))),
    roAttr('activation', nullable(reference('NavigationActivation'))),
    roAttr('canGoBack', idlType.boolean), roAttr('canGoForward', idlType.boolean),
    op('navigate', reference('NavigationResult'),
      [arg('url', idlType.USVString), arg('options', reference('NavigationNavigateOptions'), { optional: true, default: emptyDictionary })],
      invokeWith(atArg(2, (_env, methodEnv) => methodEnv)),
    ),
    op('reload', reference('NavigationResult'),
      [arg('options', reference('NavigationReloadOptions'), { optional: true, default: emptyDictionary })],
      invokeWith(atArg(1, (_env, methodEnv) => methodEnv)),
    ),
    op('traverseTo', reference('NavigationResult'),
      [arg('key', idlType.DOMString), arg('options', reference('NavigationOptions'), { optional: true, default: emptyDictionary })],
      invokeWith(atArg(2, (_env, methodEnv) => methodEnv)),
    ),
    op('back', reference('NavigationResult'),
      [arg('options', reference('NavigationOptions'), { optional: true, default: emptyDictionary })],
      invokeWith(atArg(1, (_env, methodEnv) => methodEnv)),
    ),
    op('forward', reference('NavigationResult'),
      [arg('options', reference('NavigationOptions'), { optional: true, default: emptyDictionary })],
      invokeWith(atArg(1, (_env, methodEnv) => methodEnv)),
    ),
    eventHandlerAttr('onnavigate'), eventHandlerAttr('onnavigatesuccess'),
    eventHandlerAttr('onnavigateerror'), eventHandlerAttr('oncurrententrychange'),
  ],
});

export const navigationUpdateCurrentEntryOptionsIDL = defineDictionary({
  name: 'NavigationUpdateCurrentEntryOptions',
  members: [dictMember('state', idlType.any, { required: true })],
});

export const navigationOptionsIDL = defineDictionary({
  name: 'NavigationOptions', members: [dictMember('info', idlType.any)],
});
export const navigationNavigateOptionsIDL = defineDictionary({
  name: 'NavigationNavigateOptions', inherits: 'NavigationOptions',
  members: [dictMember('state', idlType.any), dictMember('history', reference('NavigationHistoryBehavior'), { default: 'auto' })],
});
export const navigationReloadOptionsIDL = defineDictionary({
  name: 'NavigationReloadOptions', inherits: 'NavigationOptions', members: [dictMember('state', idlType.any)],
});
export const navigationResultIDL = defineDictionary({
  name: 'NavigationResult',
  members: [
    dictMember('committed', promise(reference('NavigationHistoryEntry'))),
    dictMember('finished', promise(reference('NavigationHistoryEntry'))),
  ],
});
export const navigationHistoryBehaviorIDL = defineEnumeration({
  name: 'NavigationHistoryBehavior', values: ['auto', 'push', 'replace'] satisfies NavigationHistoryBehavior[],
});
