import type { DomletDocument } from '../domlet/nodes/document';
import {
  createSessionHistoryEntry, type DocumentState, type SessionHistoryEntry,
} from './session-history';

export class Navigable {
  readonly id = Symbol('Navigable');
  parent: Navigable | null = null;
  currentSessionHistoryEntry!: SessionHistoryEntry;
  activeSessionHistoryEntry!: SessionHistoryEntry;
  isClosing = false;
  isDelayingLoadEvents = false;

  get activeDocument(): DomletDocument | null {
    return this.activeSessionHistoryEntry.documentState.document;
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
