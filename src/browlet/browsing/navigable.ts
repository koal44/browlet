import { DocumentImpl } from '../dom/nodes/document';
import { NodeImpl } from '../dom/nodes/node';
import {
  BrowsingContext, createNewTopLevelBrowsingContextAndDocument,
} from './browsing-context';
import {
  createDocumentState, createSessionHistoryEntry, type DocumentState,
  type SessionHistoryEntry,
} from './navigation/session-history';
import type { UserAgent } from '../user-agent';
import type { WindowImpl } from './window/window';

export class Navigable {
  readonly id = Symbol('Navigable');
  parent: Navigable | null = null;
  currentSessionHistoryEntry!: SessionHistoryEntry;
  #activeSessionHistoryEntry: SessionHistoryEntry | null = null;
  isClosing = false;
  isDelayingLoadEvents = false;

  get activeSessionHistoryEntry(): SessionHistoryEntry {
    if (this.#activeSessionHistoryEntry === null) {
      throw new Error('Navigable has not been initialized');
    }
    return this.#activeSessionHistoryEntry;
  }

  set activeSessionHistoryEntry(entry: SessionHistoryEntry) {
    const document = entry.documentState.document;
    if (document === null) {
      this.#activeSessionHistoryEntry = entry;
      return;
    }

    const browsingContext = DocumentImpl.getBrowsingContext(document);
    if (browsingContext === null) {
      throw new Error('An active Document needs a browsing context');
    }
    if (
      browsingContext.navigable !== null &&
      browsingContext.navigable !== this
    ) {
      throw new Error('A browsing context cannot be active in two navigables');
    }

    this.#activeSessionHistoryEntry = entry;
    BrowsingContext.setNavigable(browsingContext, this);
  }

  get activeDocument(): DocumentImpl | null {
    return this.activeSessionHistoryEntry.documentState.document;
  }

  get activeBrowsingContext(): BrowsingContext | null {
    const document = this.activeDocument;
    if (document === null) return null;
    return DocumentImpl.getBrowsingContext(document);
  }

  get activeWindow(): WindowImpl | null {
    return this.activeBrowsingContext?.activeWindow ?? null;
  }

  allowedToPerformNavigationOrHistoryUpdate(): 'allowed' | 'blocked' {
    return 'allowed';
  }
}

export class TraversableNavigable extends Navigable {
  currentSessionHistoryStep = 0;
  readonly sessionHistoryEntries: SessionHistoryEntry[] = [];
  readonly sessionHistoryTraversalQueue =
    new SessionHistoryTraversalQueue();
  runningNestedApplyHistoryStep = false;
  systemVisibilityState: DocumentVisibilityState = 'visible';
  isCreatedByWebContent = false;
}

export class TopLevelTraversable extends TraversableNavigable {}

/*
 * Return the navigable whose active Document is node's node document.
 * Inactive Documents intentionally have no node navigable, even while their
 * session-history entries retain them for possible later reactivation.
 */
export function getNodeNavigable(node: NodeImpl): Navigable | null {
  const document = NodeImpl.getNodeDocument(node);
  if (document === null) return null;

  const browsingContext = DocumentImpl.getBrowsingContext(document);
  if (browsingContext === null) return null;

  const navigable = browsingContext.navigable;
  return navigable?.activeDocument === document ? navigable : null;
}

export function isFullyActive(document: DocumentImpl): boolean {
  const navigable = getNodeNavigable(document);
  if (navigable === null) return false;
  if (navigable instanceof TopLevelTraversable) return true;

  /*
   * HTML defines a child navigable's answer recursively through its container
   * element's node Document. Browlet does not yet implement navigable
   * containers. Its parent navigable is not an equivalent shortcut: after a
   * parent navigation, the container can remain in the inactive predecessor
   * Document while parent.activeDocument refers to its replacement.
   */
  return false;
}

/*
 * HTML's session history traversal parallel queue. Its enqueueing and
 * synchronization behavior enters with the history traversal algorithms.
 */
export class SessionHistoryTraversalQueue {}

export function initializeNavigable(
  navigable: Navigable,
  documentState: DocumentState,
  parent: Navigable | null = null,
): void {
  if (documentState.document === null) {
    throw new Error('A navigable must be initialized with a Document');
  }
  if (navigable instanceof TopLevelTraversable && parent !== null) {
    throw new Error('A top-level traversable must have a null parent');
  }

  const entry = createSessionHistoryEntry(documentState);
  navigable.currentSessionHistoryEntry = entry;
  navigable.activeSessionHistoryEntry = entry;
  navigable.parent = parent;

  // TODO(HTML page visibility): Set the Document's initial visibility state
  // to the traversable navigable's system visibility state.
}

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
    : DocumentImpl.getOrigin(document);
  documentState.origin = DocumentImpl.getOrigin(document);
  documentState.navigableTargetName = targetName;
  documentState.aboutBaseURL = DocumentImpl.getAboutBaseURL(document);

  const traversable = new TopLevelTraversable();
  initializeNavigable(traversable, documentState);
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
  throw new Error('Auxiliary browsing-context creation is not implemented');
}

function legacyCloneTraversableStorageShed(
  _opener: BrowsingContext,
  _traversable: TopLevelTraversable,
): void {
  throw new Error('Traversable storage cloning is not implemented');
}
