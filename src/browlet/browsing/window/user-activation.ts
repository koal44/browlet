import { defineInterface, definePartialInterface, idlType, impl, reference, roAttr, xattr } from '../../../web-idl/core/index';

import type { WindowEnvironment } from '../../environment/index';

/** Live activation view retained by its owning Window. */
// https://html.spec.whatwg.org/multipage/interaction.html#the-useractivation-interface
// SPEC_CLASH(retained-user-activation-state): Keep HTML/Firefox/WebKit's retained Window state; Chromium clears it after removal or replacement.
export class UserActivationImpl {
  env: WindowEnvironment;

  constructor(env: WindowEnvironment) {
    this.env = env;
  }

  // https://html.spec.whatwg.org/multipage/interaction.html#dom-useractivation-hasbeenactive
  get hasBeenActive(): boolean {
    return this.env.window.hasStickyActivation();
  }

  // https://html.spec.whatwg.org/multipage/interaction.html#dom-useractivation-isactive
  get isActive(): boolean {
    return this.env.window.hasTransientActivation();
  }
}

/*
 * [Exposed=Window]
 * interface UserActivation {
 *   readonly attribute boolean hasBeenActive;
 *   readonly attribute boolean isActive;
 * };
 */
export const userActivationIDL = defineInterface({
  name: 'UserActivation', exposed: 'Window', implementation: impl(UserActivationImpl),
  members: [roAttr('hasBeenActive', idlType.boolean), roAttr('isActive', idlType.boolean)],
});

/*
 * partial interface Navigator {
 *   [SameObject] readonly attribute UserActivation userActivation;
 * };
 */
export const navigatorUserActivationIDL = definePartialInterface({
  name: 'Navigator',
  // SPEC_CLASH(retained-user-activation-identity): Keep HTML's SameObject lifetime; Firefox replaces the old Navigator's value after navigation.
  members: [roAttr('userActivation', reference('UserActivation'), xattr('SameObject'))],
});
