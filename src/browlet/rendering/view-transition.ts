import { InternalError } from '../../infra/index';
import { defineInterface, impl } from '../../web-idl/core/index';

import type { DocumentImpl } from '../dom/nodes/index';
import type { BrowletEnvironment } from '../environment/index';

/** ViewTransition identity required by navigation events; rendering does not create these yet. */
// https://drafts.csswg.org/css-view-transitions-2/#the-domtransition-interface
// TODO(CSS View Transitions): Implement lifecycle state, promises, types, transitionRoot, skipTransition(), and waitUntil().
export class ViewTransitionImpl {
  /** Document whose rendering participates in this transition. */
  document: DocumentImpl;
  /** Environment owning the transition's platform object and eventual promises. */
  env: BrowletEnvironment;

  constructor(document: DocumentImpl, env: BrowletEnvironment) {
    this.document = document;
    this.env = env;
  }

  /** Activate a prepared transition and settle its readiness. */
  // https://drafts.csswg.org/css-view-transitions-2/#activate-view-transition
  activate(): void {
    // TODO(CSS View Transitions): Honor a skipped/done transition, release rendering suppression,
    // validate snapshot size, capture the new state, set up pseudo-elements/styles, enter the
    // animating phase, and settle ready. Skipping, capture failure, and promise state are unfinished.
    throw new InternalError('View transition activation is not implemented');
  }
}

// Identity-only dependency: the remaining interface members need their CSS lifecycle audit.
/*
 * [Exposed=Window]
 * interface ViewTransition {
 *   readonly attribute Promise<undefined> updateCallbackDone;
 *   readonly attribute Promise<undefined> ready;
 *   readonly attribute Promise<undefined> finished;
 *   undefined skipTransition();
 *   [SameObject] readonly attribute ViewTransitionTypeSet types;
 *   readonly attribute Element transitionRoot;
 *   undefined waitUntil(Promise<any> promise);
 * };
 */
export const viewTransitionIDL = defineInterface({
  name: 'ViewTransition', exposed: 'Window', implementation: impl(ViewTransitionImpl),
  members: [],
});
