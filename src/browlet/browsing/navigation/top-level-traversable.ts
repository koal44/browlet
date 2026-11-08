import { InternalError } from '../../../infra/index';
import { DOMExceptionImpl } from '../../../web-idl/core/index';

import type { PointerId } from '../../interaction/events/index';
import type { DocumentImpl } from '../../dom/nodes/index';
import { DocumentState, type DocumentBackedState } from './state/index';
import type { PointerEventStream } from '../../interaction/index';
import type { UserAgent } from '../../user-agent';

import { BrowsingContext } from './browsing-context';
import type { Navigable } from './navigable';
import { Traversable } from './traversable';

/** Traversable representing a top-level browser window or tab. */
// https://html.spec.whatwg.org/multipage/document-sequences.html#top-level-traversable
export class TopLevelTraversable extends Traversable {
  /** Live input streams indexed by IDs local to this top-level context and its descendants. */
  // https://w3c.github.io/pointerevents/#dom-pointerevent-pointerid
  // MouseInputProcessor reserves ID 1 and registers it before delivery.
  // TODO(Pointer Events §3.1 / other input producers): assign other IDs and
  // remove retired streams after final notifications. Author construction/dispatch
  // never populates this map. UserAgent.activePointers retains source identity.
  pointerEventStreams = new Map<PointerId, PointerEventStream>();

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

    const documentState = DocumentState.create(document);
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
    // Seed the initial entry's script-visible values in the current synchronous creation path.
    [document.history.lengthValue, document.history.index] = traversable.getHistoryLengthAndIndex(0);

    if (opener !== null) {
      opener.topLevelTraversable.storageShed.cloneSessionStorageInto(traversable.storageShed);
    }

    userAgent.appendTopLevelTraversable(traversable);
    userAgent.webDriverBiDiNavigableCreated(traversable, openerNavigableForWebDriver ?? null);
    return traversable;
  }

  override isTopLevelTraversable(): this is TopLevelTraversable {
    return true;
  }

  /** Repair pointer targets after unlinking, without dispatching during removal. */
  // https://w3c.github.io/pointerevents/#firing-events-using-the-pointerevent-interface
  // https://w3c.github.io/pointerevents/#implicit-release-of-pointer-capture
  // Scan the existing streams once per removal, rather than retaining a reverse
  // target registry or walking every node in the removed subtree.
  notifyPointerTargetRemoval(): void {
    for (const stream of this.pointerEventStreams.values()) {
      stream.clearDisconnectedTarget();
      const pending = stream.capture.pendingTargetOverride;
      if (pending && !pending.isConnected) stream.releasePointerCapture(pending);
    }
  }

  /** Discard one Document's pointer references while retaining the shared input sources and other Documents' state. */
  clearPointerStateForDocument(document: DocumentImpl): void {
    for (const stream of this.pointerEventStreams.values()) stream.clearForDocument(document);
  }

  /**
   * Request teardown of retained Documents, then remove this destination from browser ownership.
   * Closing supplies the browsing context captured before unloading.
   */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#destroy-a-top-level-traversable
  destroy(browsingContext: BrowsingContext | null = this.activeBrowsingContext): void {
    if (browsingContext === null) throw new InternalError('Top-level destruction requires its browsing context');
    const group = browsingContext.group;
    if (group === null) throw new InternalError('Top-level destruction requires a browsing context group');
    const userAgent = group.userAgent;
    // Cancel even while the first part is still awaiting history commitment.
    this.multipartResource?.cancel(new DOMExceptionImpl('', 'AbortError')).observe(() => {}, () => {});
    // SPEC_GAP(top-level-destruction-order): HTML leaves entry order open; request teardown in retained-list order.
    const documents = new Set(this.sessionHistoryEntries.map((entry) => entry.documentState.document));
    for (const document of documents) {
      document?.destroyAndDescendants().observe(() => {}, (error) => { userAgent.runInParallel(() => { throw error; }); });
    }
    this.pointerEventStreams.clear();
    group.remove(browsingContext);
    userAgent.removeTopLevelTraversableFromUI(this);
    userAgent.removeTopLevelTraversable(this);
    userAgent.webDriverBiDiNavigableDestroyed(this);
  }

  /** Close unless a script has already queued definite closing. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#close-a-top-level-traversable
  close(): void {
    if (this.isClosing) return;
    this.definitelyClose();
  }

  /** Check cancellation, then queue unloading and destroy this destination after unloading completes. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#definitely-close-a-top-level-traversable
  definitelyClose(): void {
    const document = this.activeDocument;
    if (document === null) throw new InternalError('Closing requires an active Document');
    const toUnload = document.getInclusiveDescendantNavigables();
    const userAgent = document.env.userAgent;
    userAgent.checkIfUnloadingIsCanceled(toUnload).observe((status) => {
      if (status !== 'continue') return;
      this.appendSessionHistoryTraversalSteps(() => {
        const activeDocument = this.activeDocument;
        if (activeDocument === null) throw new InternalError('Closing requires an active Document when unloading begins');
        // SPEC_GAP(top-level-close-destroyed-document): HTML retrieves the context after unloading can clear it; retain it before unloading.
        const browsingContext = activeDocument.browsingContext;
        if (browsingContext === null) throw new InternalError('Closing requires a browsing context when unloading begins');
        return activeDocument.unloadAndDescendants(null, () => { this.destroy(browsingContext); });
      });
    }, (error) => { userAgent.runInParallel(() => { throw error; }); });
  }

  /** Collect the active document tree's diagnostics and mask cross-origin descendants before exposure. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#build-not-restored-reasons-for-a-top-level-traversable-and-its-descendants
  buildNotRestoredReasons(): void {
    const document = this.activeDocument;
    if (document === null) throw new InternalError('Restoration diagnostics require an active Document');
    document.buildNotRestoredReasons();
    // TODO(HTML lifecycle): Unloading/cache eviction must call this before destruction; Navigation Timing must consume the filtered record.
  }
}
