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
