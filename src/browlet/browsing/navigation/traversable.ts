import { InternalError, internalType, type InternalPromise } from '../../../infra/index';
import { StorageShed } from '../../../storage/index';
import type { FetchPromptTarget, fetchPromptTargetBrand } from '../../../fetch/index';

import type { DocumentImpl, DocumentVisibilityState } from '../../dom/nodes/index';
import { SourceSnapshotParams, type DocumentBackedState, type SessionHistoryEntry } from './state/index';
import type { NavigationType } from './api/index';

import { Navigable, type HistoryHandlingBehavior, type UnloadCancellationResult, type UserNavigationInvolvement } from './navigable';
import { SessionHistoryTraversalQueue, type SessionHistoryTraversalSteps } from './session-history-traversal-queue';

/** Coordinates session-history traversal for its descendant navigables. */
// https://html.spec.whatwg.org/multipage/document-sequences.html#traversable-navigable
export class Traversable extends Navigable implements FetchPromptTarget {
  /** Joint session-history step currently applied to this traversable. */
  currentSessionHistoryStep = 0;
  /** Top-level history entries retained for traversal. */
  sessionHistoryEntries: SessionHistoryEntry[] = [];
  /** Browser-owned queue serializing history traversal across Documents and descendant Agents. */
  sessionHistoryTraversalQueue: SessionHistoryTraversalQueue;
  /** Whether apply-history-step is already running a nested operation. */
  runningNestedApplyHistoryStep = false;
  /** Visibility reported by the host for this traversable. */
  systemVisibilityState: DocumentVisibilityState = 'visible';
  /** Whether web content, rather than the user, created this traversable. */
  isCreatedByWebContent = false;
  /** Session storage retained across this traversable's Documents. */
  // https://storage.spec.whatwg.org/#traversable-navigable-storage-shed
  storageShed = new StorageShed();
  /** Type-only identification as an eligible Fetch prompt destination. */
  declare [fetchPromptTargetBrand]: true;

  constructor(documentState: DocumentBackedState, parent: Navigable | null = null) {
    super(documentState, parent);
    this.sessionHistoryTraversalQueue = new SessionHistoryTraversalQueue(documentState.document.env.userAgent);
    documentState.document.setInitialVisibilityState(this.systemVisibilityState);
    documentState.document.notifyFullyActiveStateChanged();
  }

  override isTraversable(): this is Traversable {
    return true;
  }

  /** Append traversal work to this traversable's session-history parallel queue. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#tn-append-session-history-traversal-steps
  appendSessionHistoryTraversalSteps(steps: SessionHistoryTraversalSteps): void {
    this.sessionHistoryTraversalQueue.append(steps);
  }

  /** Append tagged work that history application may select ahead of ordinary traversal work. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#tn-append-session-history-sync-nav-steps
  appendSessionHistorySynchronousNavigationSteps(targetNavigable: Navigable, steps: SessionHistoryTraversalSteps): void {
    this.sessionHistoryTraversalQueue.append(Object.assign(() => steps(), { targetNavigable }));
  }

  /** Reconcile a synchronous same-document change with this traversable's joint history. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#finalize-a-same-document-navigation
  finalizeSameDocumentNavigation(
    targetNavigable: Navigable, targetEntry: SessionHistoryEntry, entryToReplace: SessionHistoryEntry | null,
    historyHandling: HistoryHandlingBehavior, userInvolvement: UserNavigationInvolvement,
  ): void {
    // TODO(HTML §7.4.1.4/§7.4.6): Enforce traversal-queue ownership alongside the other history operations.
    // Return joint-history completion once applyPushOrReplaceHistoryStep() uses the coordinator, retaining nested queue ownership.
    // SPEC_CLASH(same-document-finalization-active-entry): HTML's exact-entry check drops earlier queued pushes/replacements.
    // Preserve updates within the active DocumentState; discard work from a replaced or destroyed Document.
    // https://github.com/whatwg/html/issues/10232 and https://github.com/whatwg/html/issues/10274
    if (targetEntry.document === null || targetNavigable.activeSessionHistoryEntry.documentState !== targetEntry.documentState) return;

    const targetEntries = targetNavigable.getSessionHistoryEntries();
    let targetStep: number;
    if (entryToReplace === null) {
      this.clearForwardSessionHistory();
      targetStep = this.currentSessionHistoryStep + 1;
      targetEntry.step = targetStep;
      targetEntries.push(targetEntry);
    } else {
      const index = targetEntries.indexOf(entryToReplace);
      if (index < 0) throw new InternalError('The same-document replacement entry is not present in session history');
      targetEntries[index] = targetEntry;
      targetEntry.step = entryToReplace.step;
      targetStep = this.currentSessionHistoryStep;
    }
    this.applyPushOrReplaceHistoryStep(targetStep, historyHandling, userInvolvement, targetNavigable, targetEntry);
  }

  /** Reapply the current joint-history step after adding or removing a child. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#update-for-navigable-creation/destruction
  updateForNavigableCreationOrDestruction(): InternalPromise<HistoryStepResult> {
    return this.applyHistoryStep(this.currentSessionHistoryStep, false, null, null, 'none', null);
  }

  /** Traverse joint history; an omitted source Document denotes a browser-UI request. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#traverse-the-history-by-a-delta
  traverseHistoryByDelta(delta: number, sourceDocument?: DocumentImpl): void {
    const sourceSnapshotParams = sourceDocument === undefined ? null : new SourceSnapshotParams(sourceDocument);
    const initiatorToCheck = sourceDocument?.getNodeNavigable() ?? null;
    const userInvolvement = sourceDocument === undefined ? 'browser UI' : 'none';
    this.appendSessionHistoryTraversalSteps(() => {
      const allSteps = this.getAllUsedHistorySteps();
      const currentStepIndex = allSteps.indexOf(this.currentSessionHistoryStep);
      if (currentStepIndex < 0) throw new InternalError('The current history step is not present');
      const targetStep = allSteps[currentStepIndex + delta];
      if (targetStep === undefined) return;
      return this.applyTraverseHistoryStep(targetStep, sourceSnapshotParams, initiatorToCheck, userInvolvement);
    });
  }

  /** Select the greatest retained step at or before the request, including gaps left by removed children. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#getting-the-used-step
  getUsedStep(step: number): number {
    const steps = this.getAllUsedHistorySteps();
    for (let index = steps.length - 1; index >= 0; index--) {
      if (steps[index]! <= step) return steps[index]!;
    }
    throw new InternalError('The requested history step has no retained predecessor');
  }

  /** Count distinct joint-history steps and locate the selected step within them. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#getting-the-history-object-length-and-index
  getHistoryLengthAndIndex(step: number): [length: number, index: number] {
    const steps = this.getAllUsedHistorySteps();
    const index = steps.indexOf(step);
    if (index < 0) throw new InternalError('The selected history step is not present');
    return [steps.length, index];
  }

  /** Collect distinct history steps in ascending order, including retained descendant histories. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#getting-all-used-history-steps
  // The sorted, duplicate-free array supports the callers' indexed history lookup.
  getAllUsedHistorySteps(): number[] {
    // TODO(HTML §7.4.1.4/§7.4.6): Enforce queue ownership after local commits and history application use their specified queues.
    const entryLists = new Set([this.sessionHistoryEntries]);
    const usedSteps = new Set<number>();
    for (const entries of entryLists) {
      for (const entry of entries) {
        if (entry.step === 'pending') throw new InternalError('Used history steps require committed entries');
        usedSteps.add(entry.step);
        for (const nested of entry.documentState.nestedHistories) entryLists.add(nested.entries);
      }
    }
    return [...usedSteps].sort((a, b) => a - b);
  }

  /** Apply the current joint-history step as a reload, with cancellation checks and no external initiator. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#apply-the-reload-history-step
  applyReloadHistoryStep(userInvolvement: UserNavigationInvolvement): InternalPromise<HistoryStepResult> {
    return this.applyHistoryStep(this.currentSessionHistoryStep, true, null, null, userInvolvement, 'reload');
  }

  /** Apply a traversal with cancellation checks, its captured source, and initiating navigable. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#apply-the-traverse-history-step
  // Browser-UI delta traversal supplies null source/initiator, as accepted by the underlying apply-history-step operation.
  applyTraverseHistoryStep(
    step: number, sourceSnapshotParams: SourceSnapshotParams | null,
    initiatorToCheck: Navigable | null, userInvolvement: UserNavigationInvolvement,
  ): InternalPromise<HistoryStepResult> {
    return this.applyHistoryStep(step, true, sourceSnapshotParams, initiatorToCheck, userInvolvement, 'traverse');
  }

  /** Resume an intercepted same-document traversal after its cancellation checks have passed. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#resume-applying-the-traverse-history-step
  resumeTraverseHistoryStep(step: number, userInvolvement: UserNavigationInvolvement): InternalPromise<HistoryStepResult> {
    return this.applyHistoryStep(step, false, null, null, userInvolvement, 'traverse');
  }

  /** Activate the selected entry and retarget its browsing context's WindowProxy. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#apply-the-push/replace-history-step
  // PROVISIONAL: Only the supplied entry participates; §7.4.6 must select all affected navigables from the target step.
  applyPushOrReplaceHistoryStep(
    targetStep: number, historyHandling: HistoryHandlingBehavior, userInvolvement: UserNavigationInvolvement,
    navigable: Navigable, historyEntry: SessionHistoryEntry,
  ): void {
    const document = historyEntry.documentState.document;
    if (document === null) return;
    if (navigable.activeDocument === document) {
      // TODO(HTML §7.4.6): Reconcile same-document history on the Document's event loop without
      // repeating synchronous events, rewinding a newer active entry, or reinitializing Navigation.
      // Nested application must coordinate joint-step allocation with queued updates (HTML issue #12576).
      throw new InternalError('Same-document history-step application is not implemented');
    }

    // TODO(HTML §7.4.6): Unload/reactivate Documents and update nonchanging Documents on their own event loops.
    // Forward user involvement to those updates; source/initiator and cancellation checks are null/false on this path.
    void userInvolvement;
    const previousEntryForActivation = navigable.activeSessionHistoryEntry;
    [document.history.lengthValue, document.history.index] = this.getHistoryLengthAndIndex(targetStep);
    document.latestEntry = historyEntry;
    navigable.currentSessionHistoryEntry = historyEntry;
    navigable.activeSessionHistoryEntry = historyEntry;
    this.currentSessionHistoryStep = targetStep;
    document.makeActive();
    // TODO(HTML §7.4.6.1): Replace this provisional activation with activateHistoryEntry() through the full coordinator,
    // once savePersistedState() can capture the departing entry rather than throwing at its §7.4.6.5 boundary.
    document.setInitialVisibilityState(navigable.traversable.systemVisibilityState);
    // This provisional caller only commits newly-created Documents. Reactivation and same-document
    // updates need their separate §7.2.6.4 algorithms, events, and tracker settlement.
    document.getRelevantGlobalObject()!.navigation.initializeEntriesForNewDocument(
      navigable.getSessionHistoryEntriesForNavigationAPI(targetStep), historyEntry,
    );
    document.getRelevantGlobalObject()!.navigation.updateActivation(historyHandling, previousEntryForActivation);
    // PROVISIONAL: this local loader commits synchronously. Full history application owns the same script gate
    // after persisted-state restoration, BiDi committed reporting, and fragment-scroll scheduling.
    document.setReadyToRunScripts();
  }

  /** Begin applying joint history, waiting for cancellation before advancing current entries. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#apply-the-history-step
  // The UserAgent-owned completion carries the result while keeping the traversal queue occupied.
  applyHistoryStep(
    step: number, checkForCancelation: boolean, sourceSnapshotParams: SourceSnapshotParams | null,
    initiatorToCheck: Navigable | null, userInvolvement: UserNavigationInvolvement, navigationType: NavigationType | null,
  ): InternalPromise<HistoryStepResult> {
    const queue = this.sessionHistoryTraversalQueue;
    const userAgent = queue.userAgent;
    const P = userAgent.HostPromise;
    const resultType = internalType<HistoryStepResult>();
    return P.try(() => {
      if (!queue.isExecuting) throw new InternalError('History application must begin in its session history traversal queue');
      const targetStep = this.getUsedStep(step);
      if (initiatorToCheck !== null) {
        if (sourceSnapshotParams === null) throw new InternalError('History traversal with an initiator requires a source snapshot');
        for (const navigable of this.getNavigablesThatWillChangeOrReload(targetStep)) {
          if (!initiatorToCheck.isAllowedBySandboxingToNavigate(navigable, sourceSnapshotParams)) return 'initiator-disallowed';
        }
      }

      const crossing = this.getNavigablesThatMightCrossDocuments(targetStep);
      const check = checkForCancelation
        ? userAgent.checkIfUnloadingIsCanceled(crossing, this, targetStep, userInvolvement)
        : P.resolve('continue', internalType<UnloadCancellationResult>());
      return check.then((result) => {
        if (result !== 'continue') return result;
        // Cancellation callbacks can change entries and child navigables. Select both lists before writing current entries.
        let changingNavigables = this.getNavigablesThatWillChangeOrReload(targetStep);
        if (navigationType === null) {
          // SPEC_CLASH(history-bookkeeping-navigation): HTML lets creation/destruction take over pending navigations (#12724).
          // Follow browser isolation and Ladybird's guard: leave reload/document changes to their owning navigation.
          changingNavigables = changingNavigables.filter((navigable) => {
            const ongoing = navigable.ongoingNavigation;
            if (ongoing !== null && ongoing !== 'traversal') return false;
            const targetEntry = navigable.getTargetHistoryEntry(targetStep);
            return ongoing === 'traversal' ||
              (targetEntry.document === navigable.activeDocument && !targetEntry.documentState.reloadPending);
          });
        }
        const nonchangingNavigables = this.getNavigablesThatOnlyNeedHistoryLengthAndIndexUpdate(targetStep);
        for (const navigable of changingNavigables) {
          const targetEntry = navigable.getTargetHistoryEntry(targetStep);
          navigable.currentSessionHistoryEntry = targetEntry;
          if (targetEntry.document !== navigable.activeDocument) {
            const window = navigable.activeWindow;
            if (window === null) throw new InternalError('History-step Navigation cleanup requires an active Window');
            window.env.queueTask('navigation-and-traversal', {
              run: () => {
                const navigation = navigable.activeWindow?.navigation;
                if (navigation === undefined) throw new InternalError('History-step Navigation cleanup requires an active Window');
                navigation.ongoingNavigateEvent = null;
                navigation.ongoingAPIMethodTracker = null;
              },
            });
          }
          // Assignment wakes parallel waits without aborting the successful navigation's event or tracker.
          navigable.ongoingNavigation = 'traversal';
        }

        // TODO(HTML §7.4.6.1, step 9 onward): Connect Navigable.prepareHistoryStep() to a continuation queue,
        // processing ready jobs alongside runSynchronousNavigationSteps() and wake-ups for new tagged appends.
        // Add each dequeued continuation's navigable to the waiting set before dispatching its activation/update job.
        // Retain displayed-Document ownership through deactivation (HTML #12668); population can replace its shared state.
        // Call Document.deactivateForCrossDocumentNavigation() for cross-document changes before activation.
        // Move the capture/unload branch into this coordinator, using separate operations with consistent return contracts.
        // Until then, deactivation returns the immediate unload wait, or void when capture will append later unloading.
        // Its CSS eligibility/setup, visibility, and cache-admission owners still throw explicitly.
        // Call activateHistoryEntry() for non-update-only continuations after any required unloading.
        // Connect failureSteps to completion so rejected jobs release the wait without duplicate reporting.
        // Run Document.updateForHistoryStepApplication() on each Document's loop, including classic
        // state, latestEntry, Navigation notifications, visibility, scrolling, and persisted state.
        // Update nonchangingNavigables on their loops and finish the joint step only after all jobs complete.
        // Connect task-discard notifications to coordinator cleanup; in-flight population still needs teardown cancellation.
        void nonchangingNavigables;
        throw new InternalError('History-step population and activation is not implemented');
      }, undefined, resultType);
    }, resultType);
  }

  /** Run eligible synchronous navigations before taking the next ready history continuation. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#sync-navigations-jump-queue
  runSynchronousNavigationSteps(waitingNavigables: Set<Navigable>): InternalPromise<void> {
    const queue = this.sessionHistoryTraversalQueue;
    const P = queue.userAgent.HostPromise;
    const runNext = (): void | InternalPromise<void> => {
      if (this.runningNestedApplyHistoryStep) return;
      while (true) {
        let steps: SessionHistoryTraversalSteps | undefined;
        for (const candidate of queue.algorithmSet) {
          if (candidate.targetNavigable !== undefined && !waitingNavigables.has(candidate.targetNavigable)) {
            steps = candidate;
            break;
          }
        }
        if (steps === undefined) return;
        queue.algorithmSet.delete(steps);
        this.runningNestedApplyHistoryStep = true;
        try {
          const completion = queue.runSteps(steps);
          if (completion !== undefined) {
            return P.fromInternal(completion).then(() => {
              this.runningNestedApplyHistoryStep = false;
              return runNext();
            }, (error) => {
              this.runningNestedApplyHistoryStep = false;
              throw error;
            }, internalType<void>());
          }
        } catch (error) {
          this.runningNestedApplyHistoryStep = false;
          throw error;
        }
        this.runningNestedApplyHistoryStep = false;
      }
    };
    return P.try(() => queue.runSteps(runNext), internalType<void>());
  }

  /** Select entries that differ from the current entry or have a pending reload. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#get-all-navigables-whose-current-session-history-entry-will-change-or-reload
  getNavigablesThatWillChangeOrReload(targetStep: number): Navigable[] {
    const results: Navigable[] = [];
    const navigablesToCheck: Navigable[] = [this];
    for (const navigable of navigablesToCheck) {
      const targetEntry = navigable.getTargetHistoryEntry(targetStep);
      const reloadPending = targetEntry.documentState.reloadPending;
      if (targetEntry !== navigable.currentSessionHistoryEntry || reloadPending) results.push(navigable);
      if (targetEntry.document === navigable.activeDocument && !reloadPending) {
        for (const child of navigable.childNavigables) navigablesToCheck.push(child);
      }
    }
    return results;
  }

  /** Select unchanged branches whose Documents only need the joint-history length and index. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#getting-all-navigables-that-only-need-history-object-length/index-update
  getNavigablesThatOnlyNeedHistoryLengthAndIndexUpdate(targetStep: number): Navigable[] {
    const results: Navigable[] = [];
    const navigablesToCheck: Navigable[] = [this];
    for (const navigable of navigablesToCheck) {
      const targetEntry = navigable.getTargetHistoryEntry(targetStep);
      if (targetEntry === navigable.currentSessionHistoryEntry && !targetEntry.documentState.reloadPending) {
        results.push(navigable);
        for (const child of navigable.childNavigables) navigablesToCheck.push(child);
      }
    }
    return results;
  }

  /** Select possible cross-document traversals; descendants of a selected navigable unload with it. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#getting-all-navigables-that-might-experience-a-cross-document-traversal
  getNavigablesThatMightCrossDocuments(targetStep: number): Navigable[] {
    const results: Navigable[] = [];
    const navigablesToCheck: Navigable[] = [this];
    for (const navigable of navigablesToCheck) {
      const targetEntry = navigable.getTargetHistoryEntry(targetStep);
      if (targetEntry.document !== navigable.activeDocument || targetEntry.documentState.reloadPending) {
        results.push(navigable);
      } else {
        for (const child of navigable.childNavigables) navigablesToCheck.push(child);
      }
    }
    return results;
  }

  /** Discard forward entries in this traversable and the child histories retained after pruning. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#clear-the-forward-session-history
  clearForwardSessionHistory(): void {
    // TODO(HTML §7.4.1.4/§7.4.6): Enforce queue ownership after local commits and history application use their specified queues.
    const step = this.currentSessionHistoryStep;
    const entryLists = new Set([this.sessionHistoryEntries]);
    for (const entries of entryLists) {
      for (let i = entries.length - 1; i >= 0; i--) {
        const entryStep = entries[i]!.step;
        if (entryStep === 'pending') throw new InternalError('Forward history clearing requires committed entries');
        if (entryStep > step) entries.splice(i, 1);
      }
      for (const entry of entries) {
        for (const nested of entry.documentState.nestedHistories) entryLists.add(nested.entries);
      }
    }
  }
}

/** Outcome of applying a history step, including cancellation before or during navigate-event firing. */
export type HistoryStepResult = 'initiator-disallowed' | 'canceled-by-beforeunload' | 'canceled-by-navigate' | 'applied';
