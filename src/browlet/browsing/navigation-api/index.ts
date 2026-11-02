export {
  NavigationImpl, navigationIDL, navigationTypeIDL, navigationUpdateCurrentEntryOptionsIDL,
  type NavigationType, type NavigationUpdateCurrentEntryOptions, type PushReplaceReloadNavigateEventOptions,
  navigationOptionsIDL, navigationNavigateOptionsIDL, navigationReloadOptionsIDL, navigationResultIDL,
  navigationHistoryBehaviorIDL, type NavigationOptions, type NavigationNavigateOptions, type NavigationReloadOptions,
  type NavigationResult,
} from './navigation';
export { NavigationAPIMethodTracker } from './method-tracker';
export { NavigationTransitionImpl, navigationTransitionIDL } from './navigation-transition';
export { NavigationActivationImpl, navigationActivationIDL } from './navigation-activation';
export { NavigationDestinationImpl, navigationDestinationIDL } from './navigation-destination';
export {
  NavigateEventImpl, navigateEventIDL, navigateEventInitIDL, type NavigateEventInit,
  navigationInterceptOptionsIDL, navigationFocusResetIDL, navigationScrollBehaviorIDL, navigationInterceptHandlerIDL,
  type NavigationInterceptOptions, type NavigationInterceptHandler, type NavigationFocusReset, type NavigationScrollBehavior,
} from './navigate-event';
export {
  NavigationPrecommitControllerImpl, navigationPrecommitControllerIDL, navigationPrecommitHandlerIDL,
  type NavigationPrecommitHandler,
} from './navigation-precommit-controller';
export { NavigationHistoryEntryImpl, navigationHistoryEntryIDL } from './navigation-history-entry';
export {
  NavigationCurrentEntryChangeEventImpl, navigationCurrentEntryChangeEventIDL, navigationCurrentEntryChangeEventInitIDL,
  type NavigationCurrentEntryChangeEventInit,
} from './navigation-current-entry-change-event';
export { navigationIDLDefinitions } from './web-idl';
