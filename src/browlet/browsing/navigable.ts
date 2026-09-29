import type { DocumentImpl } from '../dom/nodes/document';
import type { ElementImpl } from '../dom/nodes/element';
import { BrowsingContext } from './browsing-context';
import {
  createDocumentState, createSessionHistoryEntry, type DocumentBackedState,
  type SessionHistoryEntry,
} from './navigation/session-history';
import type { UserAgent } from '../user-agent';
import type { WindowImpl } from './window/window';
import { getRelevantRealm, retargetWindowProxy } from '../bindings';
import type { FetchPromptTarget, fetchPromptTargetBrand } from '../../fetch/index';
import { areSameOrigin, urlsEqual, type Origin, type URLRecord } from '../../url/index';
import { InternalError } from '../../infra/internal-error';

/** Owns a navigation destination and its current and active history entries. */
// https://html.spec.whatwg.org/multipage/document-sequences.html#navigable
export class Navigable {
  /** Stable identity across this navigable's documents and browsing contexts. */
  id = Symbol('Navigable');
  /** Containing navigable, or null at the top level. */
  parent: Navigable | null;
  /** History entry selected by the latest navigation or traversal. */
  currentSessionHistoryEntry: SessionHistoryEntry;
  #activeSessionHistoryEntry: SessionHistoryEntry;
  /** Whether closing this navigable has begun. */
  isClosing = false;
  /** Whether its navigation is delaying the container document's load event. */
  isDelayingLoadEvents = false;

  /** Create the initial history entry and associate its Document with this navigable. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#initialize-the-navigable
  constructor(
    documentState: DocumentBackedState,
    parent: Navigable | null = null,
  ) {
    const document = documentState.document;
    const browsingContext = document.browsingContext;
    if (browsingContext === null) throw new InternalError('An active Document needs a browsing context');

    this.parent = parent;
    this.currentSessionHistoryEntry = createSessionHistoryEntry(documentState);
    this.#activeSessionHistoryEntry = this.currentSessionHistoryEntry;
    browsingContext.setNavigable(this);
    document.notifyFullyActiveStateChanged();

    // TODO(HTML page visibility): Set initial Document visibility, after
    // traversable subclasses have initialized their system visibility state.
  }

  get isTopLevelTraversable(): boolean {
    return false;
  }

  /** Entry whose document is active; replacement updates document activity. */
  get activeSessionHistoryEntry(): SessionHistoryEntry {
    return this.#activeSessionHistoryEntry;
  }

  set activeSessionHistoryEntry(entry: SessionHistoryEntry) {
    const previousDocument = this.#activeSessionHistoryEntry.documentState.document;
    const document = entry.documentState.document;
    if (document !== null) {
      const browsingContext = document.browsingContext;
      if (browsingContext === null) throw new InternalError('An active Document needs a browsing context');
      browsingContext.setNavigable(this);
    }

    this.#activeSessionHistoryEntry = entry;
    if (previousDocument !== document) {
      previousDocument?.notifyFullyActiveStateChanged();
      document?.notifyFullyActiveStateChanged();
    }
  }

  get activeDocument(): DocumentImpl | null {
    return this.activeSessionHistoryEntry.documentState.document;
  }

  get activeBrowsingContext(): BrowsingContext | null {
    const document = this.activeDocument;
    if (document === null) return null;
    return document.browsingContext;
  }

  get activeWindow(): WindowImpl | null {
    return this.activeBrowsingContext?.activeWindow ?? null;
  }

  /** Nearest inclusive ancestor that owns session-history traversal. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#nav-traversable
  get traversable(): Traversable {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Walk the inclusive ancestor chain.
    let navigable: Navigable = this;
    while (!(navigable instanceof Traversable)) {
      if (navigable.parent === null) throw new InternalError('A navigable needs a traversable ancestor');
      navigable = navigable.parent;
    }
    return navigable;
  }

  /** The element embedding this navigable, or null when it has no container. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#nav-container
  get container(): ElementImpl | null {
    // PROVISIONAL: connect the container's content navigable when child navigables are implemented.
    return null;
  }

  allowedToPerformNavigationOrHistoryUpdate(): 'allowed' | 'blocked' {
    return 'allowed';
  }

  /** Choose whether navigation appends a history entry or replaces the active one. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigate-convert-to-replace
  resolveHistoryBehavior(url: URLRecord, origin: Origin): NavigationHistoryBehavior {
    const activeDocument = this.activeDocument;
    if (activeDocument === null) {
      throw new InternalError('Navigation requires an active Document');
    }

    const activeURL = this.activeSessionHistoryEntry.url;
    let historyHandling: NavigationHistoryBehavior =
      urlsEqual(url, activeURL) &&
      areSameOrigin(origin, activeDocument.origin)
        ? 'replace'
        : 'push';

    if (
      url.scheme === 'javascript' ||
      activeDocument.isInitialAboutBlank
    ) {
      historyHandling = 'replace';
    }
    return historyHandling;
  }

  /** Commit a new document by pushing or replacing this navigable's history entry. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#finalize-a-cross-document-navigation
  // PROVISIONAL: commits run synchronously until the history traversal queue is implemented.
  finalizeCrossDocumentNavigation(
    historyHandling: NavigationHistoryBehavior,
    userInvolvement: UserNavigationInvolvement,
    historyEntry: SessionHistoryEntry,
  ): void {
    this.isDelayingLoadEvents = false;
    const document = historyEntry.documentState.document;
    if (document === null) return;
    const activeDocument = this.activeDocument;
    if (activeDocument === null) {
      throw new InternalError('Navigation requires an active Document');
    }

    const browsingContext = document.browsingContext;
    if (browsingContext === null) {
      throw new InternalError('Navigation Document has no browsing context');
    }
    if (
      this.parent === null &&
      !(
        browsingContext.isAuxiliary &&
        browsingContext.openerBrowsingContext !== null
      ) &&
      !areSameOrigin(document.origin, activeDocument.origin)
    ) {
      historyEntry.documentState.navigableTargetName = '';
    }

    const traversable = requireTopLevelTraversable(this);
    const targetEntries = traversable.sessionHistoryEntries;
    let targetStep: number;
    if (historyHandling === 'push') {
      traversable.clearForwardSessionHistory();
      targetStep = traversable.currentSessionHistoryStep + 1;
      historyEntry.step = targetStep;
      targetEntries.push(historyEntry);
    } else {
      const entryToReplace = this.activeSessionHistoryEntry;
      const index = targetEntries.indexOf(entryToReplace);
      if (index < 0) {
        throw new InternalError('Active history entry is not in session history');
      }
      targetEntries[index] = historyEntry;
      historyEntry.step = entryToReplace.step;
      targetStep = traversable.currentSessionHistoryStep;
    }

    traversable.applyPushOrReplaceHistoryStep(this, targetStep, historyEntry);
    void userInvolvement;
  }
}

/** History action selected after resolving a navigation's default behavior. */
export type NavigationHistoryBehavior = 'push' | 'replace';

/** User participation in a navigation or history traversal. */
export type UserNavigationInvolvement = 'none' | 'activation' | 'browser UI';

/** Coordinates session-history traversal for its descendant navigables. */
// https://html.spec.whatwg.org/multipage/document-sequences.html#traversable-navigable
export class Traversable extends Navigable implements FetchPromptTarget {
  /** Joint session-history step currently applied to this traversable. */
  currentSessionHistoryStep = 0;
  /** Top-level history entries retained for traversal. */
  sessionHistoryEntries: SessionHistoryEntry[] = [];
  /** Queue reserved for serialized history traversal work. */
  sessionHistoryTraversalQueue = new SessionHistoryTraversalQueue();
  /** Whether apply-history-step is already running a nested operation. */
  runningNestedApplyHistoryStep = false;
  /** Visibility reported by the host for this traversable. */
  systemVisibilityState: DocumentVisibilityState = 'visible';
  /** Whether web content, rather than the user, created this traversable. */
  isCreatedByWebContent = false;
  /** Type-only identification as an eligible Fetch prompt destination. */
  declare [fetchPromptTargetBrand]: true;

  /** Activate the committed entry and retarget its browsing context's WindowProxy. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#apply-the-push/replace-history-step
  // PROVISIONAL: only the supplied top-level entry participates in this history step.
  applyPushOrReplaceHistoryStep(
    navigable: Navigable,
    targetStep: number,
    historyEntry: SessionHistoryEntry,
  ): void {
    const document = historyEntry.documentState.document;
    if (document === null) return;
    const browsingContext = document.browsingContext;
    const realm = getRelevantRealm(document);
    if (browsingContext === null) {
      throw new InternalError('Navigation Document has no browsing context');
    }
    const window = realm.windowImplementation;

    navigable.currentSessionHistoryEntry = historyEntry;
    navigable.activeSessionHistoryEntry = historyEntry;
    this.currentSessionHistoryStep = targetStep;
    retargetWindowProxy(browsingContext.windowProxy, window);
    realm.env.markExecutionReady();
  }

  /** Discard entries after this traversable's current history step. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#clear-the-forward-session-history
  // Nested history lists enter with child navigables.
  clearForwardSessionHistory(): void {
    const firstForwardEntry = this.sessionHistoryEntries.findIndex(
      (entry) => entry.step !== 'pending' &&
        entry.step > this.currentSessionHistoryStep,
    );
    if (firstForwardEntry >= 0) {
      this.sessionHistoryEntries.splice(firstForwardEntry);
    }
  }
}

/** Traversable representing a top-level browser window or tab. */
// https://html.spec.whatwg.org/multipage/document-sequences.html#top-level-traversable
export class TopLevelTraversable extends Traversable {
  constructor(documentState: DocumentBackedState) {
    super(documentState);
  }

  /** Create a top-level destination and register its initial document and history. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#creating-a-new-top-level-traversable
  static create(
    userAgent: UserAgent,
    opener: BrowsingContext | null,
    targetName: string,
    openerNavigableForWebDriver?: Navigable,
  ): TopLevelTraversable {
    let document: DocumentImpl;

    if (opener === null) {
      [, document] = BrowsingContext.createTopLevel(userAgent);
    } else {
      [, document] = BrowsingContext.createAuxiliary(opener);
    }

    const documentState = createDocumentState(document);
    documentState.initiatorOrigin = opener === null
      ? null
      : document.origin;
    documentState.origin = document.origin;
    documentState.navigableTargetName = targetName;
    documentState.aboutBaseURL = document.aboutBaseURL;

    const traversable = new TopLevelTraversable(documentState);
    const initialHistoryEntry = traversable.activeSessionHistoryEntry;
    initialHistoryEntry.step = 0;
    traversable.sessionHistoryEntries.push(initialHistoryEntry);

    if (opener !== null) {
      legacyCloneTraversableStorageShed(opener, traversable);
    }

    userAgent.appendTopLevelTraversable(traversable);

    // TODO(WebDriver BiDi): Invoke "navigable created" with the traversable and
    // openerNavigableForWebDriver once Browlet exposes the BiDi integration.
    void openerNavigableForWebDriver;
    return traversable;
  }

  override get isTopLevelTraversable(): true {
    return true;
  }
}

/** Placeholder identity for a traversable's session-history work queue. */
// https://html.spec.whatwg.org/multipage/document-sequences.html#session-history-traversal-parallel-queue
// Queueing and synchronization await the history traversal algorithms.
export class SessionHistoryTraversalQueue {}

function requireTopLevelTraversable(navigable: Navigable): TopLevelTraversable {
  if (!(navigable instanceof TopLevelTraversable)) {
    throw new InternalError('Nested navigable history is not implemented');
  }
  return navigable;
}

/** Copy the opener's session-storage data into the new traversable. */
// https://storage.spec.whatwg.org/#legacy-clone-a-traversable-storage-shed
// SPEC_MISMATCH: (sourceTraversable, targetTraversable) -> undefined
// TODO: Resolve the opener's top-level traversable when session-storage sheds are implemented.
function legacyCloneTraversableStorageShed(
  _opener: BrowsingContext,
  _traversable: TopLevelTraversable,
): void {
  throw new InternalError('Traversable storage cloning is not implemented');
}
