import type { DocumentImpl } from '../dom/nodes/document';
import type { ElementImpl } from '../dom/nodes/element';
import {
  createNewTopLevelBrowsingContextAndDocument, type BrowsingContext,
} from './browsing-context';
import {
  createDocumentState, createSessionHistoryEntry, type DocumentState,
  type SessionHistoryEntry,
} from './navigation/session-history';
import type { UserAgent } from '../user-agent';
import type { WindowImpl } from './window/window';
import type { FetchPromptTarget, fetchPromptTargetBrand } from '../../fetch/index';
import { InternalError } from '../../infra/internal-error';

export class Navigable {
  id = Symbol('Navigable');
  isTopLevelTraversable: boolean = false;
  parent: Navigable | null = null;
  currentSessionHistoryEntry!: SessionHistoryEntry;
  #activeSessionHistoryEntry: SessionHistoryEntry | null = null;
  isClosing = false;
  isDelayingLoadEvents = false;

  get activeSessionHistoryEntry(): SessionHistoryEntry {
    if (this.#activeSessionHistoryEntry === null) {
      throw new InternalError('Navigable has not been initialized');
    }
    return this.#activeSessionHistoryEntry;
  }

  set activeSessionHistoryEntry(entry: SessionHistoryEntry) {
    const previousDocument = this.#activeSessionHistoryEntry
      ?.documentState.document ?? null;
    const document = entry.documentState.document;
    if (document === null) {
      this.#activeSessionHistoryEntry = entry;
      if (previousDocument !== null) {
        previousDocument.notifyFullyActiveStateChanged();
      }
      return;
    }

    const browsingContext = document.getBrowsingContext();
    if (browsingContext === null) {
      throw new InternalError('An active Document needs a browsing context');
    }
    if (
      browsingContext.navigable !== null &&
      browsingContext.navigable !== this
    ) {
      throw new InternalError('A browsing context cannot be active in two navigables');
    }

    this.#activeSessionHistoryEntry = entry;
    browsingContext.setNavigable(this);
    if (previousDocument !== document) {
      if (previousDocument !== null) {
        previousDocument.notifyFullyActiveStateChanged();
      }
      document.notifyFullyActiveStateChanged();
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

  initialize(documentState: DocumentState, parent: Navigable | null = null): void {
    if (documentState.document === null) {
      throw new InternalError('A navigable must be initialized with a Document');
    }
    if (this instanceof TopLevelTraversable && parent !== null) {
      throw new InternalError('A top-level traversable must have a null parent');
    }

    const entry = createSessionHistoryEntry(documentState);
    this.currentSessionHistoryEntry = entry;
    this.activeSessionHistoryEntry = entry;
    this.parent = parent;

    // TODO(HTML page visibility): Set the Document's initial visibility state
    // to the traversable navigable's system visibility state.
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
  override isTopLevelTraversable = true as const;
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

  const traversable = new TopLevelTraversable();
  traversable.initialize(documentState);
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
