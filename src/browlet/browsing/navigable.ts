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

export class Navigable {
  id = Symbol('Navigable');
  parent: Navigable | null;
  currentSessionHistoryEntry: SessionHistoryEntry;
  #activeSessionHistoryEntry: SessionHistoryEntry;
  isClosing = false;
  isDelayingLoadEvents = false;

  /** Create the initial history entry and associate its Document with this navigable. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#initialize-the-navigable
  constructor(
    documentState: DocumentBackedState,
    parent: Navigable | null = null,
  ) {
    const document = documentState.document;
    const browsingContext = document.getBrowsingContext();
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

  get activeSessionHistoryEntry(): SessionHistoryEntry {
    return this.#activeSessionHistoryEntry;
  }

  set activeSessionHistoryEntry(entry: SessionHistoryEntry) {
    const previousDocument = this.#activeSessionHistoryEntry.documentState.document;
    const document = entry.documentState.document;
    if (document !== null) {
      const browsingContext = document.getBrowsingContext();
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
    return document.getBrowsingContext();
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

export class TraversableNavigable extends Navigable implements FetchPromptTarget {
  currentSessionHistoryStep = 0;
  sessionHistoryEntries: SessionHistoryEntry[] = [];
  sessionHistoryTraversalQueue = new SessionHistoryTraversalQueue();
  runningNestedApplyHistoryStep = false;
  systemVisibilityState: DocumentVisibilityState = 'visible';
  isCreatedByWebContent = false;
  /** Type-only identification as an eligible Fetch prompt destination. */
  declare [fetchPromptTargetBrand]: true;
}

export class TopLevelTraversable extends TraversableNavigable {
  constructor(documentState: DocumentBackedState) {
    super(documentState);
  }

  override get isTopLevelTraversable(): true {
    return true;
  }
}

/*
 * HTML's session history traversal parallel queue. Its enqueueing and
 * synchronization behavior enters with the history traversal algorithms.
 */
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
    : document.getOrigin();
  documentState.origin = document.getOrigin();
  documentState.navigableTargetName = targetName;
  documentState.aboutBaseURL = document.getAboutBaseURL();

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
