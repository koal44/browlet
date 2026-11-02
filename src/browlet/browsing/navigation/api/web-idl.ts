import {
  navigationIDL, navigationTypeIDL, navigationUpdateCurrentEntryOptionsIDL, navigationOptionsIDL,
  navigationNavigateOptionsIDL, navigationReloadOptionsIDL, navigationResultIDL, navigationHistoryBehaviorIDL,
} from './navigation';
import { navigationHistoryEntryIDL } from './navigation-history-entry';
import { navigationTransitionIDL } from './navigation-transition';
import { navigationActivationIDL } from './navigation-activation';
import { navigationDestinationIDL } from './navigation-destination';
import {
  navigateEventIDL, navigateEventInitIDL, navigationInterceptOptionsIDL,
  navigationFocusResetIDL, navigationScrollBehaviorIDL, navigationInterceptHandlerIDL,
} from './navigate-event';
import { navigationPrecommitControllerIDL, navigationPrecommitHandlerIDL } from './navigation-precommit-controller';

/** Navigation API declarations assembled by Browlet's binding world. */
export const navigationIDLDefinitions = [
  navigationIDL, navigationTypeIDL, navigationUpdateCurrentEntryOptionsIDL,
  navigationOptionsIDL, navigationNavigateOptionsIDL, navigationReloadOptionsIDL, navigationResultIDL, navigationHistoryBehaviorIDL,
  navigationHistoryEntryIDL,
  navigationTransitionIDL, navigationDestinationIDL, navigationActivationIDL,
  navigateEventIDL, navigateEventInitIDL,
  navigationInterceptOptionsIDL, navigationFocusResetIDL, navigationScrollBehaviorIDL, navigationInterceptHandlerIDL,
  navigationPrecommitControllerIDL, navigationPrecommitHandlerIDL,
];
