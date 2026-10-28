import { InternalError } from '../../../infra/index';
import { defineInterface, idlType, impl, roAttr } from '../../../web-idl/core/index';

import type { WindowEnvironment } from '../../environment';

/** Historical browser-bar state derived from the owning Window's popup classification. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#barprop
export class BarPropImpl {
  /** Owning Window environment, used to query its current browsing context. */
  env: WindowEnvironment;

  constructor(env: WindowEnvironment) {
    this.env = env;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-BarProp-visible
  get visible(): boolean {
    const context = this.env.window.browsingContext;
    // SPEC_CLASH(detached-barprop-visible): follow HTML/Gecko's true; Blink/WebKit return false.
    if (context === null) return true;
    const top = context.topLevelBrowsingContext;
    // SPEC_GAP(barprop-inactive-context): HTML dereferences a null top-level context for an inactive Document.
    if (top === null) throw new InternalError('BarProp visibility with an inactive browsing context is unspecified');
    return !top.isPopup;
  }
}

/*
 * [Exposed=Window]
 * interface BarProp {
 *   readonly attribute boolean visible;
 * };
 */
export const barPropIDL = defineInterface({
  name: 'BarProp',
  exposed: 'Window',
  implementation: impl(BarPropImpl),
  members: [roAttr('visible', idlType.boolean)],
});
