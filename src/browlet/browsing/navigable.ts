import type { DocumentImpl } from '../dom/nodes/document';
import type { ElementImpl } from '../dom/nodes/element';
import {
  createNewTopLevelBrowsingContextAndDocument, type BrowsingContext,
} from './browsing-context';
import {
  createDocumentState, createSessionHistoryEntry, type DocumentBackedState,
  type SessionHistoryEntry,
} from './navigation/session-history';
import type { UserAgent } from '../user-agent';
import type { WindowImpl } from './window/window';
import type { FetchPromptTarget, fetchPromptTargetBrand } from '../../fetch/index';
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
  get traversableNavigable(): TraversableNavigable {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Walk the inclusive ancestor chain.
    let navigable: Navigable = this;
    while (!(navigable instanceof TraversableNavigable)) {
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
}

/** Coordinates session-history traversal for its descendant navigables. */
// https://html.spec.whatwg.org/multipage/document-sequences.html#traversable-navigable
export class TraversableNavigable extends Navigable implements FetchPromptTarget {
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
}

/** Traversable representing a top-level browser window or tab. */
// https://html.spec.whatwg.org/multipage/document-sequences.html#top-level-traversable
export class TopLevelTraversable extends TraversableNavigable {
  constructor(documentState: DocumentBackedState) {
    super(documentState);
  }

  override get isTopLevelTraversable(): true {
    return true;
  }
}

/** Placeholder identity for a traversable's session-history work queue. */
// https://html.spec.whatwg.org/multipage/document-sequences.html#session-history-traversal-parallel-queue
// Queueing and synchronization await the history traversal algorithms.
export class SessionHistoryTraversalQueue {}

export function createNewTopLevelTraversable(
  userAgent: UserAgent,
  opener: BrowsingContext | null,
  targetName: string,
  openerNavigableForWebDriver?: Navigable,
): TopLevelTraversable {
  let document: DocumentImpl;

  if (opener === null) {
    [, document] = createNewTopLevelBrowsingContextAndDocument(userAgent);
  } else {
    document = createNewAuxiliaryBrowsingContextAndDocument(opener);
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

function createNewAuxiliaryBrowsingContextAndDocument(
  _opener: BrowsingContext,
): DocumentImpl {
  throw new InternalError('Auxiliary browsing-context creation is not implemented');
}

function legacyCloneTraversableStorageShed(
  _opener: BrowsingContext,
  _traversable: TopLevelTraversable,
): void {
  throw new InternalError('Traversable storage cloning is not implemented');
}
