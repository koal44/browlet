import { getRelevantRealm } from '../bindings';
import type { DocumentImpl } from '../dom/nodes/document';
import type { UnsafeMoment } from '../performance/clock';
import type { Navigable } from '../browsing/navigable';
import type { WindowImpl } from '../browsing/window/window';
import type { WindowAgent } from './agents';
import { queueGlobalTask, renderingTaskSource } from './tasks';

/*
 * A rendering-opportunity host observes display refreshes, an embedder signal,
 * or a deterministic test driver independently of HTML task execution. It
 * reports an opportunity here; it never runs rendering steps itself.
 *
 * https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model
 */
export class WindowRenderingProducer {
  readonly #agent: WindowAgent;
  readonly #host: RenderingOpportunityHost;
  readonly #update: RenderingUpdateHooks;
  #stopObserving: (() => void) | null = null;

  constructor(
    agent: WindowAgent,
    host: RenderingOpportunityHost,
    update: RenderingUpdateHooks = {},
  ) {
    this.#agent = agent;
    this.#host = host;
    this.#update = update;
  }

  start(): void {
    if (this.#stopObserving !== null) {
      throw new Error('A rendering producer is already running');
    }

    this.#stopObserving = this.#host.observeRenderingOpportunities(
      (navigables) => { this.#produceRenderingTasks(navigables); },
    );
  }

  stop(): void {
    this.#stopObserving?.();
    this.#stopObserving = null;
  }

  #produceRenderingTasks(navigables: readonly Navigable[]): void {
    const windows = new Set<WindowImpl>();
    for (const navigable of navigables) {
      if (!this.#host.hasRenderingOpportunity(navigable)) continue;

      const window = navigable.activeWindow;
      if (
        window !== null &&
        getRelevantRealm(window).agent === this.#agent
      ) windows.add(window);
    }
    if (windows.size === 0) return;

    this.#agent.eventLoop.setLastRenderOpportunityTime(
      this.#host.unsafeSharedCurrentTime(),
    );
    for (const window of windows) {
      queueGlobalTask(renderingTaskSource, window, () => {
        this.#updateRendering();
      });
    }
  }

  #updateRendering(): void {
    const frameTimestamp = this.#agent.eventLoop.lastRenderOpportunityTime;
    if (frameTimestamp === null) {
      throw new Error('A rendering task needs a rendering-opportunity time');
    }

    const documents = this.#collectRenderableDocuments();
    let unsafeStyleAndLayoutStartTime: UnsafeMoment | null = null;
    for (const phase of renderingUpdatePhases) {
      if (phase === 'recalculateStylesUpdateLayoutAndResizeObservations') {
        unsafeStyleAndLayoutStartTime = this.#host.unsafeSharedCurrentTime();
      }

      const run = this.#update[phase];
      if (run === undefined) continue;
      for (const document of documents) {
        run({ document, frameTimestamp, unsafeStyleAndLayoutStartTime });
      }
    }
  }

  #collectRenderableDocuments(): DocumentImpl[] {
    const documents: DocumentImpl[] = [];
    const filters = this.#update.filters;
    for (const window of this.#agent.windowObjects) {
      const document = window.getAssociatedDocument();
      if (!document.isFullyActive()) continue;

      const navigable = document.getNodeNavigable();
      if (
        navigable === null ||
        !this.#host.hasRenderingOpportunity(navigable) ||
        filters?.isRenderBlocked?.(document) === true ||
        filters?.hasHiddenVisibilityState?.(document) === true ||
        filters?.isRenderingSuppressedForViewTransitions?.(document) === true ||
        filters?.shouldSkipRendering?.(document) === true
      ) continue;

      if (
        filters?.wouldRenderingHaveVisibleEffect?.(document) === false &&
        filters.hasAnimationFrameCallbacks?.(document) === false
      ) continue;

      documents.push(document);
    }

    /*
     * HTML orders this list parent-before-child, with siblings in their
     * navigable containers' shadow-including tree order. Browlet currently
     * creates only top-level traversables. Traverse the child topology when
     * it arrives; sorting only by depth would not be sufficient.
     */
    return documents;
  }
}

export type RenderingOpportunityHost = {
  hasRenderingOpportunity(this: void, navigable: Navigable): boolean;
  observeRenderingOpportunities(
    this: void,
    notify: (navigables: readonly Navigable[]) => void,
  ): () => void;
  unsafeSharedCurrentTime(this: void): UnsafeMoment;
};

export type RenderingUpdateHooks = Readonly<Partial<Record<
  RenderingUpdatePhase,
  (context: RenderingUpdateContext) => void
>>> & {
  readonly filters?: RenderingDocumentFilters;
};

export type RenderingUpdateContext = {
  readonly document: DocumentImpl;
  readonly frameTimestamp: UnsafeMoment;
  readonly unsafeStyleAndLayoutStartTime: UnsafeMoment | null;
};

export type RenderingDocumentFilters = {
  readonly hasAnimationFrameCallbacks?: DocumentPredicate;
  readonly hasHiddenVisibilityState?: DocumentPredicate;
  readonly isRenderBlocked?: DocumentPredicate;
  readonly isRenderingSuppressedForViewTransitions?: DocumentPredicate;
  readonly shouldSkipRendering?: DocumentPredicate;
  readonly wouldRenderingHaveVisibleEffect?: DocumentPredicate;
};

export type RenderingUpdatePhase =
  typeof renderingUpdatePhases[number];

/*
 * Keep this order aligned with HTML's "update the rendering" algorithm.
 * Every currently missing owner is an absent hook rather than a fake
 * implementation: CSSOM View, Web Animations, Fullscreen, Canvas, animation
 * frames, ResizeObserver/layout, focus, View Transitions,
 * IntersectionObserver, rendering/paint timing, display, and the top layer.
 */
export const renderingUpdatePhases = [
  'reveal',
  'flushAutofocusCandidates',
  'runResizeSteps',
  'runScrollSteps',
  'evaluateMediaQueriesAndReportChanges',
  'updateAnimationsAndSendEvents',
  'runFullscreenSteps',
  'runCanvasContextLostSteps',
  'runAnimationFrameCallbacks',
  'recalculateStylesUpdateLayoutAndResizeObservations',
  'runFocusFixup',
  'performPendingTransitionOperations',
  'updateIntersectionObservations',
  'recordRenderingTime',
  'markPaintTiming',
  'updateRenderingAndUserInterface',
  'processTopLayerRemovals',
] as const;

type DocumentPredicate = (
  this: void,
  document: DocumentImpl,
) => boolean;
