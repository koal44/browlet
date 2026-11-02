import {
  navigationCurrentEntryChangeEventIDL, navigationCurrentEntryChangeEventInitIDL,
} from './navigation-current-entry-change-event';
import { popStateEventIDL, popStateEventInitIDL } from './pop-state-event';
import { hashChangeEventIDL, hashChangeEventInitIDL } from './hash-change-event';
import { pageSwapEventIDL, pageSwapEventInitIDL } from './page-swap-event';
import { pageRevealEventIDL, pageRevealEventInitIDL } from './page-reveal-event';
import { pageTransitionEventIDL, pageTransitionEventInitIDL } from './page-transition-event';
import { beforeUnloadEventIDL } from './before-unload-event';

/** History and document-lifecycle event declarations, independent of their navigation producers. */
export const navigationEventIDLDefinitions = [
  navigationCurrentEntryChangeEventIDL, navigationCurrentEntryChangeEventInitIDL,
  popStateEventIDL, popStateEventInitIDL,
  hashChangeEventIDL, hashChangeEventInitIDL,
  pageSwapEventIDL, pageSwapEventInitIDL,
  pageRevealEventIDL, pageRevealEventInitIDL,
  pageTransitionEventIDL, pageTransitionEventInitIDL,
  beforeUnloadEventIDL,
];
