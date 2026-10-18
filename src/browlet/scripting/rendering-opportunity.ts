import { InternalError } from '../../infra/internal-error';

import type { UnsafeMoment } from '../timing/index';
import type { DocumentImpl } from '../dom/nodes/index';
import type { Navigable } from '../browsing/navigation/index';

import type { WindowAgent } from './agents';
import type { BrowletRealm } from './realm';
import { renderingTaskSource } from './tasks';

// The host reports refresh opportunities; rendering steps run later as HTML tasks.
/** Turns host rendering opportunities into tasks for a Window agent. */
// https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model
export class WindowRenderingProducer {
  #agent: WindowAgent;
  #host: RenderingOpportunityHost;
  #update: RenderingUpdateHooks;
  /** Unregisters the current host observation, or null while stopped. */
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
      throw new InternalError('A rendering producer is already running');
    }

    this.#stopObserving = this.#host.observeRenderingOpportunities(
      (navigables) => { this.#produceRenderingTasks(navigables); },
    );
  }

  stop(): void {
    this.#stopObserving?.();
    this.#stopObserving = null;
  }

  #produceRenderingTasks(navigables: Navigable[]): void {
    const realms = new Set<BrowletRealm>();
    for (const navigable of navigables) {
      if (!this.#host.hasRenderingOpportunity(navigable)) continue;

      const window = navigable.activeWindow;
      if (window === null) continue;
      const realm = window.env.realm;
      if (realm.agent === this.#agent) realms.add(realm);
    }
    if (realms.size === 0) return;

    this.#agent.eventLoop.lastRenderOpportunityTime =
      this.#host.unsafeSharedCurrentTime();
    for (const realm of realms) {
      realm.queueGlobalTask(renderingTaskSource, () => {
        this.#updateRendering();
      });
    }
  }

  #updateRendering(): void {
    const frameTimestamp = this.#agent.eventLoop.lastRenderOpportunityTime;
    if (frameTimestamp === null) {
      throw new InternalError('A rendering task needs a rendering-opportunity time');
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
        document.isRenderBlocked() ||
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

    // HTML orders this list parent-before-child, with siblings in their
    // navigable containers' shadow-including tree order. Browlet currently
    // creates only top-level traversables. Traverse the child topology when
    // it arrives; sorting only by depth would not be sufficient.
    return documents;
  }
}

export type RenderingOpportunityHost = {
  hasRenderingOpportunity(this: void, navigable: Navigable): boolean;
  observeRenderingOpportunities(
    this: void,
    notify: (navigables: Navigable[]) => void,
  ): () => void;
  unsafeSharedCurrentTime(this: void): UnsafeMoment;
};

// https://html.spec.whatwg.org/multipage/dom.html#semantics
// TODO(rendering): connect DOM, element-state, and style changes to the production
// style/layout and presentation owners. Presentation must follow current document
// state after the initial render too; cached derived state must be invalidated or
// recomputed. The mutation/invalidation contract remains with those future owners.
export type RenderingUpdateHooks = Readonly<Partial<Record<
  RenderingUpdatePhase,
  (context: RenderingUpdateContext) => void
>>> & {
  filters?: RenderingDocumentFilters;
};

export type RenderingUpdateContext = {
  document: DocumentImpl;
  frameTimestamp: UnsafeMoment;
  unsafeStyleAndLayoutStartTime: UnsafeMoment | null;
};

// Provisional queries for missing rendering owners. Replace document-state
// callbacks with direct queries as visibility, view transitions, and animation
// frames are implemented. Visual-effect and skip decisions belong to rendering
// and scheduling policy; display opportunities still require host input.
export type RenderingDocumentFilters = {
  hasAnimationFrameCallbacks?: DocumentPredicate;
  hasHiddenVisibilityState?: DocumentPredicate;
  isRenderingSuppressedForViewTransitions?: DocumentPredicate;
  shouldSkipRendering?: DocumentPredicate;
  wouldRenderingHaveVisibleEffect?: DocumentPredicate;
};

export type RenderingUpdatePhase =
  typeof renderingUpdatePhases[number];

// Keep this order aligned with HTML's "update the rendering" algorithm.
// Every currently missing owner is an absent hook rather than a fake
// implementation: CSSOM View, Web Animations, Fullscreen, Canvas, animation
// frames, ResizeObserver/layout, focus, View Transitions,
// IntersectionObserver, rendering/paint timing, display, and the top layer.
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
