import { defineInterface, impl, nullable, reference, roAttr } from '../../../../web-idl/core/index';

import type { BrowletEnvironment } from '../../../environment/index';

import type { NavigationType } from './navigation';
import type { NavigationHistoryEntryImpl } from './navigation-history-entry';

/** The entry pair and navigation type from a Document's most recent cross-document activation. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigation-activation-interface
// Window.firePageSwapEvent() creates a separate activation in the outgoing Document's realm.
export class NavigationActivationImpl {
  /** Environment owning the activation and its entry platform objects. */
  env: BrowletEnvironment;
  /** Previous entry, or null for an unavailable, cross-origin, or initial about:blank predecessor. */
  from: NavigationHistoryEntryImpl | null;
  /** Entry current when the Document was activated, retained across same-document navigation. */
  // SPEC_CLASH(navigation-activation-disabled): Follow the nonnullable IDL; Navigation only creates this with a current entry.
  entry: NavigationHistoryEntryImpl;
  /** Category of the navigation that activated the Document. */
  navigationType: NavigationType;

  constructor(from: NavigationHistoryEntryImpl | null, entry: NavigationHistoryEntryImpl,
    navigationType: NavigationType, env: BrowletEnvironment)
  {
    this.env = env;
    this.from = from;
    this.entry = entry;
    this.navigationType = navigationType;
  }
}

/*
 * [Exposed=Window]
 * interface NavigationActivation {
 *   readonly attribute NavigationHistoryEntry? from;
 *   readonly attribute NavigationHistoryEntry entry;
 *   readonly attribute NavigationType navigationType;
 * };
 */
export const navigationActivationIDL = defineInterface({
  name: 'NavigationActivation', exposed: 'Window', implementation: impl(NavigationActivationImpl),
  members: [
    roAttr('from', nullable(reference('NavigationHistoryEntry'))),
    roAttr('entry', reference('NavigationHistoryEntry')), roAttr('navigationType', reference('NavigationType')),
  ],
});
